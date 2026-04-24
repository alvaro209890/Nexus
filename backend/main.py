from __future__ import annotations

import json
import logging
import multiprocessing
import os
import re
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

load_dotenv()

logging.basicConfig(level=os.getenv("NEXUS_LOG_LEVEL", "INFO"))
logger = logging.getLogger("nexus.backend")

app = FastAPI(title="Nexus API", version="0.3.0")

DEFAULT_DOCUMENTS_DIR = "/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/BD_NEXUS"
DOCUMENTS_DIR = Path(os.getenv("DOCUMENTS_DIR", DEFAULT_DOCUMENTS_DIR)).expanduser()
USERS_DIR = DOCUMENTS_DIR / "users"
for directory in (DOCUMENTS_DIR, USERS_DIR):
    directory.mkdir(parents=True, exist_ok=True)

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_TIMEOUT_SECONDS = int(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "90"))

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
CHROMA_HOST = os.getenv("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8001"))
CHROMA_COLLECTION_PREFIX = os.getenv("CHROMA_COLLECTION", "nexus_documents")
EMBEDDING_MODEL_NAME = os.getenv(
    "EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "nexus-98e32")
MAX_DEEPSEEK_CHARS = int(os.getenv("MAX_DEEPSEEK_CHARS", "18000"))
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "3000"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "300"))
CHAT_MEMORY_TURNS = int(os.getenv("CHAT_MEMORY_TURNS", "20"))
PDF_EXTRACT_TIMEOUT_SECONDS = int(os.getenv("PDF_EXTRACT_TIMEOUT_SECONDS", "180"))
PDF_PYPDF_MIN_CHARS = int(os.getenv("PDF_PYPDF_MIN_CHARS", "80"))
SEARCH_TIMEOUT_SECONDS = float(os.getenv("SEARCH_TIMEOUT_SECONDS", "8"))

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://nexus-98e32.web.app",
    "https://nexus-98e32.firebaseapp.com",
    "https://nexus.cursar.space",
]
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("NEXUS_CORS_ORIGINS", ",".join(DEFAULT_CORS_ORIGINS)).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

groq_client = None
embedding_model = None
chroma_client = None
chroma_collections: dict[str, Any] = {}
firebase_request = None
processing_executor = ThreadPoolExecutor(max_workers=max(2, min(4, (os.cpu_count() or 2))))
search_executor = ThreadPoolExecutor(max_workers=2)
manifest_lock = threading.Lock()
active_processing_jobs: set[str] = set()
active_processing_lock = threading.Lock()
cancelled_processing_jobs: set[str] = set()
embedding_model_lock = threading.Lock()
chroma_client_lock = threading.Lock()
vector_index_lock = threading.Lock()


@dataclass
class AuthenticatedUserContext:
    uid: str
    email: str | None
    display_name: str | None
    provider_ids: list[str]
    user_dir: Path
    profile_path: Path
    originals_dir: Path
    markdown_dir: Path
    incoming_dir: Path
    manifest_path: Path
    folders_path: Path
    processing_events_dir: Path
    memory_dir: Path
    notes_dir: Path
    note_versions_dir: Path
    collection_name: str


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[ChatMessage] = Field(default_factory=list)
    limit: int = Field(default=5, ge=1, le=10)
    session_id: str = Field(default="default", min_length=1)


class ChatSessionCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=120)


class ChatSessionUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PersistedChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str
    timestamp: str
    references: list[dict[str, Any]] = Field(default_factory=list)


class ChatSessionSummary(BaseModel):
    session_id: str
    title: str
    created_at: str
    updated_at: str
    turn_count: int = 0
    message_count: int = 0
    last_message_preview: str = ""


class ChatSessionDetail(ChatSessionSummary):
    messages: list[PersistedChatMessage] = Field(default_factory=list)


class SearchResult(BaseModel):
    document_id: str
    chunk_id: str
    score: float | None
    snippet: str
    metadata: dict[str, Any]
    markdown_path: str | None = None
    pdf_path: str | None = None
    classification: str | None = None
    suggested_name: str | None = None
    source_kind: str = "document"


class DocumentRecord(BaseModel):
    document_id: str
    source_kind: str = "document"
    sha256: str
    original_name: str
    classification: str
    document_type: str | None = None
    domain: str | None = None
    suggested_name: str
    title: str
    author: str | None = None
    date: str | None = None
    year: str
    technologies: list[str] = Field(default_factory=list)
    summary: str = ""
    folder_path: str = ""
    tags: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    project: str | None = None
    classification_confidence: float | None = None
    folder_confidence: float | None = None
    title_confidence: float | None = None
    review_status: str | None = None
    processing_status: str = "ready"
    processing_progress: int | None = None
    processing_error: str | None = None
    processing_started_at: str | None = None
    processing_completed_at: str | None = None
    pdf_path: str
    markdown_path: str
    chunks_indexed: int
    uploaded_at: str
    size_bytes: int | None = None


class DocumentProcessingEvent(BaseModel):
    event_id: str
    document_id: str
    stage: str
    status: str
    level: str
    message: str
    progress: int | None = None
    timestamp: str


class DocumentProcessingDetail(BaseModel):
    document: DocumentRecord
    events: list[DocumentProcessingEvent] = Field(default_factory=list)
    can_retry: bool = False
    is_processing: bool = False


class NoteRecord(BaseModel):
    note_id: str
    source_kind: str = "note"
    title: str
    content: str
    tags: list[str] = Field(default_factory=list)
    author: str | None = None
    created_at: str
    updated_at: str
    current_version: int = 1
    version_count: int = 1
    summary: str = ""
    markdown_path: str
    chunks_indexed: int = 0
    size_bytes: int | None = None


class NoteCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)


class NoteUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    content: str | None = Field(default=None, min_length=1)
    tags: list[str] | None = None


class NoteVersionRecord(BaseModel):
    note_id: str
    version: int
    title: str
    content: str
    tags: list[str] = Field(default_factory=list)
    author: str | None = None
    created_at: str
    updated_at: str
    snapshot_at: str


class AuthenticatedUserProfile(BaseModel):
    uid: str
    email: str | None = None
    display_name: str | None = None
    provider_ids: list[str] = Field(default_factory=list)
    status: str = "active"
    created_at: str
    last_login_at: str
    user_root: str
    profile_path: str
    originals_dir: str
    markdown_dir: str
    incoming_dir: str | None = None
    manifest_path: str
    folders_path: str
    memory_dir: str
    collection_name: str


class FolderRecord(BaseModel):
    path: str
    name: str
    created_at: str


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent_path: str = Field(default="", max_length=240)


class LookupIntent(BaseModel):
    is_specific_document_request: bool = False
    search_terms: list[str] = Field(default_factory=list)
    title_or_filename: str | None = None
    classification: str | None = None
    year: str | None = None
    project: str | None = None
    folder_hint: str | None = None


ACTIVE_PROCESSING_STATUSES = {"queued", "extracting", "classifying", "indexing"}
DOCUMENT_SOURCE_KIND = "document"
NOTE_SOURCE_KIND = "note"


def warn_missing_provider_keys() -> None:
    if not DEEPSEEK_API_KEY:
        print("DEEPSEEK_API_KEY not configured. File classification will use fallback providers.")
    if not GROQ_API_KEY:
        print("GROQ_API_KEY not configured. Chat and Groq lookup will not work.")


warn_missing_provider_keys()


def require_authenticated_user(authorization: str | None = Header(default=None)) -> AuthenticatedUserContext:
    token = extract_bearer_token(authorization)
    decoded_token = verify_firebase_id_token(token)
    return build_user_context(decoded_token)


@app.get("/health")
async def health_check() -> dict[str, Any]:
    return {
        "status": "ok",
        "documents_dir": str(DOCUMENTS_DIR),
        "users_dir": str(USERS_DIR),
        "firebase_project_id": FIREBASE_PROJECT_ID,
        "providers": {
            "deepseek": {
                "configured": bool(DEEPSEEK_API_KEY),
                "model": DEEPSEEK_MODEL,
                "base_url": DEEPSEEK_BASE_URL,
                "role": "classification",
            },
            "groq": {
                "configured": bool(GROQ_API_KEY),
                "model": GROQ_MODEL,
                "role": "chat_and_lookup",
            },
        },
        "chroma": {
            "host": CHROMA_HOST,
            "port": CHROMA_PORT,
            "collection_prefix": CHROMA_COLLECTION_PREFIX,
        },
    }


@app.post("/auth/sync", response_model=AuthenticatedUserProfile)
async def sync_authenticated_user(
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> AuthenticatedUserProfile:
    profile = upsert_user_profile(current_user)
    return AuthenticatedUserProfile(**profile)


@app.post("/upload-document")
async def upload_document(
    file: UploadFile = File(...),
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> dict[str, Any]:
    return process_uploaded_pdf(file=file, current_user=current_user)


@app.post("/upload-documents")
async def upload_documents(
    files: list[UploadFile] = File(...),
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="At least one PDF file is required.")

    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for upload in files:
        try:
            results.append(process_uploaded_pdf(file=upload, current_user=current_user))
        except HTTPException as exc:
            errors.append(
                {
                    "filename": safe_filename(upload.filename or "document.pdf"),
                    "detail": str(exc.detail),
                }
            )
        except Exception as exc:
            logger.exception("Unexpected multi-upload failure for file=%s", upload.filename)
            errors.append(
                {
                    "filename": safe_filename(upload.filename or "document.pdf"),
                    "detail": str(exc),
                }
            )

    return {
        "results": results,
        "errors": errors,
        "uploaded_count": len(results),
        "failed_count": len(errors),
    }


def process_uploaded_pdf(
    *,
    file: UploadFile,
    current_user: AuthenticatedUserContext,
) -> dict[str, Any]:
    if not is_pdf_upload(file):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    ensure_user_storage(current_user)

    document_id = str(uuid.uuid4())
    original_name = safe_filename(file.filename or "document.pdf")
    staging_path = current_user.incoming_dir / f"{document_id}__{original_name}"

    logger.info(
        "Starting upload for user=%s document_id=%s filename=%s",
        current_user.uid,
        document_id,
        original_name,
    )

    save_upload(file, staging_path)
    file_hash = hash_file(staging_path)

    existing_record = find_document_by_hash(current_user, file_hash)
    if existing_record is not None:
        staging_path.unlink(missing_ok=True)
        logger.info(
            "Duplicate upload skipped for user=%s document_id=%s sha256=%s",
            current_user.uid,
            document_id,
            file_hash,
        )
        return {
            **existing_record,
            "duplicate": True,
            "message": "Document already indexed for this user. Returning existing record.",
        }

    queued_record = build_queued_document_record(
        document_id=document_id,
        file_hash=file_hash,
        original_name=original_name,
        staging_path=staging_path,
    )
    append_manifest_record(current_user, queued_record)
    append_document_processing_event(
        current_user,
        document_id,
        stage="queued",
        status="queued",
        level="info",
        message="Upload recebido. O documento entrou na fila de processamento.",
        progress=0,
        timestamp=str(queued_record.get("uploaded_at") or datetime.now(UTC).isoformat()),
    )
    enqueue_document_processing(current_user, document_id)

    return {
        **queued_record,
        "duplicate": False,
        "message": "Document queued for background processing.",
    }


@app.get("/documents", response_model=list[DocumentRecord])
async def list_documents(
    limit: int = Query(default=50, ge=1, le=500),
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> list[DocumentRecord]:
    records = [
        hydrate_document_record(record)
        for record in read_manifest_records(current_user)
        if not is_note_record(record)
    ]
    visible_records = records[-limit:][::-1]
    return [DocumentRecord(**record) for record in visible_records]


@app.get("/documents/{document_id}/processing", response_model=DocumentProcessingDetail)
async def get_document_processing_detail(
    document_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> DocumentProcessingDetail:
    record = find_document_by_id(current_user, document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Document not found for this user.")

    events = read_document_processing_events(current_user, document_id, record=record)
    return DocumentProcessingDetail(
        document=DocumentRecord(**record),
        events=[DocumentProcessingEvent(**event) for event in events],
        can_retry=document_can_retry(current_user, record),
        is_processing=is_document_processing_status(record),
    )


@app.get("/folders", response_model=list[FolderRecord])
async def list_folders(
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> list[FolderRecord]:
    return [FolderRecord(**folder) for folder in read_folder_records(current_user)]


@app.get("/notes", response_model=list[NoteRecord])
async def list_notes(
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> list[NoteRecord]:
    records = [
        hydrate_note_record(record)
        for record in read_manifest_records(current_user)
        if is_note_record(record)
    ]
    records.sort(key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)
    return [NoteRecord(**record) for record in records]


@app.get("/notes/{note_id}", response_model=NoteRecord)
async def get_note(
    note_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> NoteRecord:
    record = find_note_by_id(current_user, note_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Note not found for this user.")
    return NoteRecord(**record)


@app.post("/notes", response_model=NoteRecord)
async def create_note_endpoint(
    request: NoteCreateRequest,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> NoteRecord:
    return NoteRecord(**create_note(current_user, request))


@app.patch("/notes/{note_id}", response_model=NoteRecord)
async def update_note_endpoint(
    note_id: str,
    request: NoteUpdateRequest,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> NoteRecord:
    if request.title is None and request.content is None and request.tags is None:
        raise HTTPException(status_code=400, detail="At least one note field must be updated.")
    return NoteRecord(**update_note(current_user, note_id, request))


@app.delete("/notes/{note_id}")
async def delete_note_endpoint(
    note_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> dict[str, str]:
    record = find_note_by_id(current_user, note_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Note not found for this user.")

    remove_document_from_vector_store(current_user, note_id)
    prune_document_annotations(current_user, note_id)
    delete_note_storage(current_user, note_id, record)
    if not remove_manifest_record(current_user, note_id):
        raise HTTPException(status_code=404, detail="Note not found for this user.")
    return {"note_id": note_id, "status": "deleted"}


@app.get("/notes/{note_id}/versions", response_model=list[NoteVersionRecord])
async def list_note_versions(
    note_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> list[NoteVersionRecord]:
    if find_note_by_id(current_user, note_id) is None:
        raise HTTPException(status_code=404, detail="Note not found for this user.")
    return [NoteVersionRecord(**item) for item in read_note_versions(current_user, note_id)]


@app.get("/notes/{note_id}/versions/{version}", response_model=NoteVersionRecord)
async def get_note_version(
    note_id: str,
    version: int,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> NoteVersionRecord:
    if version < 1:
        raise HTTPException(status_code=400, detail="Version must be greater than zero.")
    for snapshot in read_note_versions(current_user, note_id):
        if int(snapshot.get("version") or 0) == version:
            return NoteVersionRecord(**snapshot)
    raise HTTPException(status_code=404, detail="Note version not found for this user.")


@app.post("/folders", response_model=FolderRecord)
async def create_folder(
    request: FolderCreateRequest,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> FolderRecord:
    ensure_user_storage(current_user)

    parent_parts = sanitize_relative_folder(request.parent_path)
    name_slug = safe_slug(request.name, "")
    if not name_slug:
        raise HTTPException(status_code=400, detail="Folder name is invalid.")

    full_parts = [*parent_parts, name_slug[:60]]
    if len(full_parts) > 5:
        raise HTTPException(status_code=400, detail="Folder path is too deep.")

    folder_path = "/".join(full_parts)
    if not folder_path:
        raise HTTPException(status_code=400, detail="Folder path is invalid.")

    originals_target = current_user.originals_dir.joinpath(*full_parts)
    markdown_target = current_user.markdown_dir.joinpath(*full_parts)
    originals_target.mkdir(parents=True, exist_ok=True)
    markdown_target.mkdir(parents=True, exist_ok=True)

    folders = read_folder_records(current_user)
    existing = next((folder for folder in folders if str(folder.get("path") or "") == folder_path), None)
    if existing is not None:
        return FolderRecord(**existing)

    folder_record = {
        "path": folder_path,
        "name": full_parts[-1],
        "created_at": datetime.now(UTC).isoformat(),
    }
    folders.append(folder_record)
    write_folder_records(current_user, folders)
    return FolderRecord(**folder_record)


@app.get("/documents/{document_id}/download")
async def download_document(
    document_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> FileResponse:
    record = find_document_by_id(current_user, document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Document not found for this user.")

    pdf_path = Path(str(record.get("pdf_path") or "")).expanduser()
    if not pdf_path.exists() or not pdf_path.is_file():
        raise HTTPException(status_code=404, detail="Stored PDF is missing.")
    try:
        pdf_path.relative_to(current_user.originals_dir)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Document path is outside the user's storage.") from exc

    download_name = safe_filename(str(record.get("original_name") or pdf_path.name))
    return FileResponse(path=pdf_path, filename=download_name, media_type="application/pdf")


@app.post("/documents/{document_id}/retry", response_model=DocumentRecord)
async def retry_document_processing(
    document_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> DocumentRecord:
    clean_document_id = document_id.strip()
    if not clean_document_id:
        raise HTTPException(status_code=400, detail="Document id is required.")

    record = find_document_by_id(current_user, clean_document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Document not found for this user.")

    if is_document_processing_status(record):
        raise HTTPException(status_code=409, detail="This document is already being processed.")
    if not document_can_retry(current_user, record):
        raise HTTPException(status_code=409, detail="No retry artifacts are available for this document.")

    clear_document_job_cancelled(current_user.uid, clean_document_id)
    remove_document_from_vector_store(current_user, clean_document_id)
    append_document_processing_event(
        current_user,
        clean_document_id,
        stage="queued",
        status="queued",
        level="info",
        message="Retry manual solicitado. O documento voltou para a fila de processamento.",
        progress=0,
    )

    updated = update_manifest_record(
        current_user,
        clean_document_id,
        {
            "processing_status": "queued",
            "processing_progress": 0,
            "processing_error": None,
            "processing_started_at": None,
            "processing_completed_at": None,
            "chunks_indexed": 0,
        },
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Document not found for this user.")

    enqueue_document_processing(current_user, clean_document_id)
    return DocumentRecord(**hydrate_document_record(updated))


@app.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> dict[str, str]:
    clean_document_id = document_id.strip()
    if not clean_document_id:
        raise HTTPException(status_code=400, detail="Document id is required.")

    record = find_document_by_id(current_user, clean_document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Document not found for this user.")

    mark_document_job_cancelled(current_user.uid, clean_document_id)
    remove_document_from_vector_store(current_user, clean_document_id)
    prune_document_annotations(current_user, clean_document_id)
    delete_document_files(current_user, record)
    document_processing_events_path(current_user, clean_document_id).unlink(missing_ok=True)

    if not remove_manifest_record(current_user, clean_document_id):
        raise HTTPException(status_code=404, detail="Document not found for this user.")

    return {"document_id": clean_document_id, "status": "deleted"}


@app.get("/search-semantic", response_model=list[SearchResult])
async def search_semantic(
    query: str = Query(..., min_length=1),
    limit: int = Query(default=5, ge=1, le=20),
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> list[SearchResult]:
    return hybrid_search(current_user=current_user, query=query, limit=limit)


@app.post("/chat")
async def chat(
    request: ChatRequest,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> dict[str, Any]:
    ensure_groq_configured()

    session_id = safe_session_id(request.session_id)
    persistent_history = load_session_memory(current_user, session_id)
    should_search_documents = should_use_document_context(request.message, persistent_history)
    references: list[SearchResult] = []
    if should_search_documents:
        search_query = build_contextual_search_query(request.message, persistent_history)
        recent_references = recent_turn_reference_results(persistent_history)
        lookup_references = lookup_specific_documents_with_groq(
            current_user=current_user,
            user_message=search_query,
            limit=request.limit,
        )
        semantic_references = semantic_search(
            current_user=current_user,
            query=search_query,
            limit=min(request.limit * 2, 20),
        )
        references = merge_search_results(
            [recent_references, lookup_references, semantic_references],
            limit=request.limit,
            dedupe_by_document=True,
        )

    context = build_rag_context(current_user, references)
    messages = build_chat_messages(request, context, persistent_history, should_search_documents)

    client = get_groq_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=0.2,
    )
    answer = response.choices[0].message.content or ""
    save_session_turn(
        current_user=current_user,
        session_id=session_id,
        user_message=request.message,
        assistant_message=answer,
        references=references,
    )

    return {
        "answer": answer,
        "references": [result.model_dump() for result in references],
        "session_id": session_id,
    }


@app.get("/chat-sessions", response_model=list[ChatSessionSummary])
async def list_chat_sessions(
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> list[ChatSessionSummary]:
    sessions = [ChatSessionSummary(**session) for session in read_chat_sessions_index(current_user)]
    return sorted(sessions, key=lambda item: item.updated_at, reverse=True)


@app.post("/chat-sessions", response_model=ChatSessionSummary)
async def create_chat_session(
    request: ChatSessionCreateRequest | None = None,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> ChatSessionSummary:
    title = request.title if request else None
    session = create_or_update_chat_session(
        current_user=current_user,
        session_id=build_new_session_id(),
        title=title or "Novo chat",
    )
    return ChatSessionSummary(**session)


@app.get("/chat-sessions/{session_id}", response_model=ChatSessionDetail)
async def get_chat_session(
    session_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> ChatSessionDetail:
    clean_session_id = safe_session_id(session_id)
    summary = get_chat_session_summary(current_user, clean_session_id)
    messages = load_chat_messages(current_user, clean_session_id)
    if summary is None and not messages:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    summary = ensure_chat_session_summary(current_user, clean_session_id, messages=messages)
    return ChatSessionDetail(**summary, messages=[PersistedChatMessage(**message) for message in messages])


@app.patch("/chat-sessions/{session_id}", response_model=ChatSessionSummary)
async def update_chat_session(
    session_id: str,
    request: ChatSessionUpdateRequest,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> ChatSessionSummary:
    clean_session_id = safe_session_id(session_id)
    summary = get_chat_session_summary(current_user, clean_session_id)
    messages = load_chat_messages(current_user, clean_session_id)
    if summary is None and not messages:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    updated = ensure_chat_session_summary(
        current_user,
        clean_session_id,
        title=request.title.strip(),
        messages=messages,
    )
    return ChatSessionSummary(**updated)


@app.delete("/chat-sessions/{session_id}")
async def delete_chat_session(
    session_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> dict[str, str]:
    clean_session_id = safe_session_id(session_id)
    delete_chat_session_storage(current_user, clean_session_id)
    return {"session_id": clean_session_id, "status": "deleted"}


@app.get("/memory/{session_id}")
async def get_memory(
    session_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> dict[str, Any]:
    clean_session_id = safe_session_id(session_id)
    return {
        "session_id": clean_session_id,
        "turns": load_session_memory(current_user, clean_session_id),
    }


@app.delete("/memory/{session_id}")
async def delete_memory(
    session_id: str,
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> dict[str, str]:
    clean_session_id = safe_session_id(session_id)
    delete_chat_session_storage(current_user, clean_session_id)
    return {"session_id": clean_session_id, "status": "deleted"}


def is_pdf_upload(file: UploadFile) -> bool:
    filename = (file.filename or "").lower()
    content_type = (file.content_type or "").lower()
    return filename.endswith(".pdf") or content_type == "application/pdf"


def save_upload(file: UploadFile, destination: Path) -> None:
    try:
        with destination.open("wb") as output:
            shutil.copyfileobj(file.file, output)
    finally:
        file.file.close()


def hash_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as input_file:
        for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_filename(value: str) -> str:
    value = value.strip().replace("\\", "/").split("/")[-1]
    value = re.sub(r"[^A-Za-z0-9._ -]+", "-", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value or "document.pdf"


def safe_slug(value: str, fallback: str = "documento") -> str:
    value = value.strip().lower()
    value = value.replace("ç", "c")
    value = re.sub(r"[áàãâä]", "a", value)
    value = re.sub(r"[éèêë]", "e", value)
    value = re.sub(r"[íìîï]", "i", value)
    value = re.sub(r"[óòõôö]", "o", value)
    value = re.sub(r"[úùûü]", "u", value)
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or fallback


def normalize_search_text(value: str) -> str:
    return safe_slug(value, fallback="")


def tokenize_search_terms(value: str) -> list[str]:
    normalized = normalize_search_text(value)
    return [token for token in normalized.split("-") if len(token) >= 2]


def safe_session_id(value: str) -> str:
    return safe_slug(value, fallback="default")[:80]


def user_folder_name(uid: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", uid):
        return uid
    suffix = sha256(uid.encode("utf-8")).hexdigest()[:8]
    return f"{safe_slug(uid, fallback='user')[:96]}-{suffix}"


def collection_name_for_user(uid: str) -> str:
    base = safe_slug(uid, fallback="user")
    suffix = sha256(uid.encode("utf-8")).hexdigest()[:8]
    return f"{CHROMA_COLLECTION_PREFIX}_{base[:40]}_{suffix}"


def extract_provider_ids(decoded_token: dict[str, Any]) -> list[str]:
    provider_ids: set[str] = set()
    firebase_claims = decoded_token.get("firebase")
    if isinstance(firebase_claims, dict):
        sign_in_provider = firebase_claims.get("sign_in_provider")
        if isinstance(sign_in_provider, str) and sign_in_provider.strip():
            provider_ids.add(sign_in_provider)

        identities = firebase_claims.get("identities")
        if isinstance(identities, dict):
            for provider_id in identities:
                if isinstance(provider_id, str) and provider_id.strip():
                    provider_ids.add(provider_id)

    return sorted(provider_ids)


def build_user_context(decoded_token: dict[str, Any]) -> AuthenticatedUserContext:
    uid = str(
        decoded_token.get("uid")
        or decoded_token.get("sub")
        or decoded_token.get("user_id")
        or ""
    ).strip()
    if not uid:
        raise HTTPException(status_code=401, detail="Firebase token does not contain a valid uid.")

    folder_name = user_folder_name(uid)
    user_dir = USERS_DIR / folder_name
    return AuthenticatedUserContext(
        uid=uid,
        email=str(decoded_token.get("email")).strip() if decoded_token.get("email") else None,
        display_name=str(decoded_token.get("name")).strip() if decoded_token.get("name") else None,
        provider_ids=extract_provider_ids(decoded_token),
        user_dir=user_dir,
        profile_path=user_dir / "profile.json",
        originals_dir=user_dir / "originals",
        markdown_dir=user_dir / "markdown",
        incoming_dir=user_dir / "incoming",
        manifest_path=user_dir / "manifest.jsonl",
        folders_path=user_dir / "folders.json",
        processing_events_dir=user_dir / "processing-events",
        memory_dir=user_dir / "memory",
        notes_dir=user_dir / "notes" / "current",
        note_versions_dir=user_dir / "notes" / "versions",
        collection_name=collection_name_for_user(uid),
    )


def ensure_user_storage(current_user: AuthenticatedUserContext) -> None:
    for directory in (
        current_user.user_dir,
        current_user.originals_dir,
        current_user.markdown_dir,
        current_user.incoming_dir,
        current_user.processing_events_dir,
        current_user.memory_dir,
        current_user.notes_dir,
        current_user.note_versions_dir,
        chat_sessions_data_dir(current_user),
    ):
        directory.mkdir(parents=True, exist_ok=True)
    current_user.manifest_path.touch(exist_ok=True)
    if not current_user.folders_path.exists():
        current_user.folders_path.write_text("[]", encoding="utf-8")


def read_json_object(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def upsert_user_profile(current_user: AuthenticatedUserContext) -> dict[str, Any]:
    ensure_user_storage(current_user)
    existing = read_json_object(current_user.profile_path) or {}
    timestamp = datetime.now(UTC).isoformat()
    profile = {
        "uid": current_user.uid,
        "email": current_user.email,
        "display_name": current_user.display_name,
        "provider_ids": current_user.provider_ids,
        "status": "active",
        "created_at": str(existing.get("created_at") or timestamp),
        "last_login_at": timestamp,
        "user_root": str(current_user.user_dir),
        "profile_path": str(current_user.profile_path),
        "originals_dir": str(current_user.originals_dir),
        "markdown_dir": str(current_user.markdown_dir),
        "incoming_dir": str(current_user.incoming_dir),
        "manifest_path": str(current_user.manifest_path),
        "folders_path": str(current_user.folders_path),
        "processing_events_dir": str(current_user.processing_events_dir),
        "memory_dir": str(current_user.memory_dir),
        "notes_dir": str(current_user.notes_dir),
        "note_versions_dir": str(current_user.note_versions_dir),
        "collection_name": current_user.collection_name,
    }
    current_user.profile_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    return profile


def extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header.")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Authorization header must use Bearer token.")
    return token.strip()


def get_google_request():
    global firebase_request
    if firebase_request is None:
        try:
            from google.auth.transport import requests as google_requests
        except ImportError as exc:
            raise HTTPException(
                status_code=500,
                detail="google-auth is not installed on the backend environment.",
            ) from exc
        firebase_request = google_requests.Request()
    return firebase_request


def verify_firebase_id_token(token: str) -> dict[str, Any]:
    try:
        from google.oauth2 import id_token as google_id_token
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="google-auth is not installed on the backend environment.",
        ) from exc

    try:
        decoded_token = google_id_token.verify_firebase_token(
            token,
            get_google_request(),
            FIREBASE_PROJECT_ID,
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired Firebase token.") from exc

    if not decoded_token:
        raise HTTPException(status_code=401, detail="Invalid Firebase token.")

    audience = decoded_token.get("aud")
    issuer = decoded_token.get("iss")
    expected_issuer = f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}"
    if audience != FIREBASE_PROJECT_ID or issuer != expected_issuer:
        raise HTTPException(status_code=401, detail="Firebase token does not belong to this project.")

    return decoded_token


def extract_pdf_markdown(pdf_path: Path) -> str:
    started_at = time.perf_counter()
    try:
        markdown_text = extract_pdf_markdown_with_pypdf(pdf_path)
        if len(markdown_text.strip()) >= PDF_PYPDF_MIN_CHARS:
            logger.info(
                "PDF extracted with pypdf in %.2fs for %s",
                time.perf_counter() - started_at,
                pdf_path.name,
            )
            return markdown_text
        logger.info(
            "PyPDF extracted only %s chars for %s, trying docling/OCR fallback",
            len(markdown_text.strip()),
            pdf_path.name,
        )
    except Exception as exc:
        logger.warning("PyPDF extraction failed for %s, trying docling fallback: %s", pdf_path.name, exc)

    try:
        markdown_text = extract_pdf_markdown_with_docling(pdf_path)
        if markdown_text.strip():
            logger.info(
                "PDF extracted with docling in %.2fs for %s",
                time.perf_counter() - started_at,
                pdf_path.name,
            )
            return markdown_text
        logger.warning("Docling returned empty markdown for %s", pdf_path.name)
    except Exception as exc:
        logger.warning("Docling extraction failed for %s: %s", pdf_path.name, exc)

    raise HTTPException(status_code=422, detail="Could not extract readable text from PDF.")


def extract_pdf_markdown_with_docling(pdf_path: Path) -> str:
    ctx = multiprocessing.get_context("spawn")
    queue: multiprocessing.Queue[dict[str, str]] = ctx.Queue()
    process = ctx.Process(target=docling_extract_worker, args=(str(pdf_path), queue))
    process.start()
    process.join(PDF_EXTRACT_TIMEOUT_SECONDS)

    if process.is_alive():
        process.terminate()
        process.join()
        raise RuntimeError(f"Docling extraction timed out after {PDF_EXTRACT_TIMEOUT_SECONDS}s.")

    payload: dict[str, str] | None = None
    if not queue.empty():
        payload = queue.get()
    queue.close()
    queue.join_thread()

    if process.exitcode not in (0, None):
        if payload and payload.get("error"):
            raise RuntimeError(payload["error"])
        raise RuntimeError(f"Docling extraction exited with code {process.exitcode}.")

    if not payload:
        raise RuntimeError("Docling extraction returned no data.")
    if payload.get("error"):
        raise RuntimeError(payload["error"])

    return payload.get("markdown", "")


def docling_extract_worker(pdf_path: str, queue: multiprocessing.Queue[dict[str, str]]) -> None:
    try:
        from docling.document_converter import DocumentConverter

        result = DocumentConverter().convert(pdf_path)
        queue.put({"markdown": result.document.export_to_markdown()})
    except Exception as exc:  # pragma: no cover
        queue.put({"error": str(exc)})


def extract_pdf_markdown_with_pypdf(pdf_path: Path) -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"PyPDF fallback is not available: {exc}") from exc

    try:
        reader = PdfReader(str(pdf_path))
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PyPDF fallback failed: {exc}") from exc

    content = "\n\n".join(page for page in pages if page)
    return content.strip()


def cleanup_failed_upload(
    *,
    staging_path: Path | None,
    pdf_path: Path | None,
    markdown_path: Path | None,
) -> None:
    for path in (staging_path, pdf_path, markdown_path):
        if path is None:
            continue
        try:
            path.unlink(missing_ok=True)
        except Exception:
            logger.warning("Failed to cleanup path after upload error: %s", path, exc_info=True)


def ensure_groq_configured() -> None:
    if not GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY is not configured.")


def get_groq_client():
    global groq_client
    ensure_groq_configured()
    if groq_client is None:
        from groq import Groq

        groq_client = Groq(api_key=GROQ_API_KEY)
    return groq_client


def deepseek_chat_completion(
    messages: list[dict[str, str]],
    *,
    response_format: dict[str, str] | None = None,
    temperature: float = 0.1,
    max_tokens: int = 1200,
) -> str:
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY is not configured.")

    payload: dict[str, Any] = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format is not None:
        payload["response_format"] = response_format

    response = requests.post(
        f"{DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=DEEPSEEK_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()
    return str(data["choices"][0]["message"]["content"] or "{}")


def analyze_document_with_deepseek(markdown_text: str, original_name: str) -> dict[str, Any]:
    prompt = {
        "task": (
            "Classify and summarize this document for a private multi-user document-management and RAG system. "
            "Prefer folder paths that help file separation by topic/project/year/type."
        ),
        "filename": original_name,
        "required_json_schema": {
            "classification": "manual | lei | contrato | artigo | nota_tecnica | outro",
            "suggested_name": "[AAAA] Tipo - Titulo.md",
            "folder_path": "relative path with 2 to 4 useful folders, e.g. area/project/year/type",
            "domain": "high-level business domain like financeiro, juridico, rh, operacoes, produto, comercial, tecnologia, or geral",
            "aliases": ["alternative file names, common short labels, synonyms users might search"],
            "entities": ["important entities such as client, project, contract code, product or area"],
            "confidence": {
                "classification": "float 0..1",
                "folder": "float 0..1",
                "title": "float 0..1"
            },
            "metadata": {
                "title": "string",
                "author": "string or null",
                "date": "YYYY-MM-DD or YYYY or null",
                "project": "project/client/product name or null",
                "technologies": ["string"],
                "tags": ["string"],
                "summary": "short string",
            },
        },
        "document_excerpt": markdown_text[:MAX_DEEPSEEK_CHARS],
    }

    if DEEPSEEK_API_KEY:
        try:
            raw = deepseek_chat_completion(
                [
                    {
                        "role": "system",
                        "content": (
                            "Return only valid JSON. Do not include markdown fences. "
                            "If data is unknown, use null or an empty list."
                        ),
                    },
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
                max_tokens=1200,
            )
            parsed = json.loads(raw)
            result = normalize_ai_result(parsed, original_name)
            result["provider"] = "deepseek"
            return result
        except Exception as exc:
            print(f"DeepSeek analysis failed, trying fallback provider: {exc}")

    if GROQ_API_KEY:
        fallback = analyze_document_with_groq(markdown_text, original_name)
        fallback["provider"] = "groq_fallback"
        return fallback

    fallback = fallback_document_analysis(markdown_text, original_name)
    fallback["provider"] = "heuristic"
    return fallback


def analyze_document_with_groq(markdown_text: str, original_name: str) -> dict[str, Any]:
    if not GROQ_API_KEY:
        return fallback_document_analysis(markdown_text, original_name)

    prompt = {
        "task": "Classify and summarize this document for a document-management RAG system.",
        "filename": original_name,
        "required_json_schema": {
            "classification": "manual | lei | contrato | artigo | nota_tecnica | outro",
            "suggested_name": "[AAAA] Tipo - Titulo.md",
            "folder_path": "relative path with 2 to 4 useful folders, e.g. area/project/year/type",
            "domain": "high-level business domain like financeiro, juridico, rh, operacoes, produto, comercial, tecnologia, or geral",
            "aliases": ["alternative file names, common short labels, synonyms users might search"],
            "entities": ["important entities such as client, project, contract code, product or area"],
            "confidence": {
                "classification": "float 0..1",
                "folder": "float 0..1",
                "title": "float 0..1"
            },
            "metadata": {
                "title": "string",
                "author": "string or null",
                "date": "YYYY-MM-DD or YYYY or null",
                "project": "project/client/product name or null",
                "technologies": ["string"],
                "tags": ["string"],
                "summary": "short string",
            },
        },
        "document_excerpt": markdown_text[:MAX_DEEPSEEK_CHARS],
    }

    client = get_groq_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "Return only valid JSON. Do not include markdown fences. "
                    "If data is unknown, use null or an empty list."
                ),
            },
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content or "{}"
    return normalize_ai_result(json.loads(raw), original_name)


def normalize_ai_result(parsed: dict[str, Any], original_name: str) -> dict[str, Any]:
    metadata = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
    technologies = metadata.get("technologies")
    if not isinstance(technologies, list):
        technologies = []
    confidence = parsed.get("confidence") if isinstance(parsed.get("confidence"), dict) else {}
    title = str(metadata.get("title") or Path(original_name).stem).strip() or Path(original_name).stem
    project = str(metadata.get("project") or "").strip() or None
    tags = normalize_string_list(metadata.get("tags"))
    aliases = build_document_aliases(
        original_name=original_name,
        suggested_name=str(parsed.get("suggested_name") or original_name),
        title=title,
        project=project,
        aliases=normalize_string_list(parsed.get("aliases")),
        tags=tags,
    )
    domain = infer_document_domain(
        raw_domain=str(parsed.get("domain") or ""),
        project=project,
        technologies=[str(item) for item in technologies if str(item).strip()],
        folder_path=str(parsed.get("folder_path") or ""),
    )
    document_type = str(parsed.get("classification") or "outro")
    classification_confidence = clamp_confidence(
        confidence.get("classification"),
        0.74 if document_type and document_type != "outro" else 0.48,
    )
    title_confidence = clamp_confidence(confidence.get("title"), 0.82 if title and title != Path(original_name).stem else 0.58)
    folder_confidence = clamp_confidence(confidence.get("folder"), 0.76 if domain != "geral" or project else 0.52)

    return {
        "classification": document_type,
        "document_type": document_type,
        "domain": domain,
        "suggested_name": str(parsed.get("suggested_name") or original_name),
        "folder_path": str(parsed.get("folder_path") or ""),
        "aliases": aliases,
        "entities": build_entities(
            normalize_string_list(parsed.get("entities")),
            project=project,
            title=title,
            tags=tags,
        ),
        "classification_confidence": classification_confidence,
        "folder_confidence": folder_confidence,
        "title_confidence": title_confidence,
        "review_status": derive_review_status(
            classification=document_type,
            domain=domain,
            classification_confidence=classification_confidence,
            folder_confidence=folder_confidence,
            title_confidence=title_confidence,
        ),
        "metadata": {
            "title": title,
            "author": metadata.get("author"),
            "date": metadata.get("date"),
            "project": project,
            "technologies": [str(item) for item in technologies if str(item).strip()],
            "tags": tags,
            "summary": metadata.get("summary") or "",
        },
    }


def build_file_plan(
    current_user: AuthenticatedUserContext,
    ai_result: dict[str, Any],
    original_name: str,
    document_id: str,
) -> dict[str, Any]:
    metadata = ai_result.get("metadata", {})
    classification = safe_slug(str(ai_result.get("document_type") or ai_result.get("classification") or "outro"), "outro")
    domain = safe_slug(str(ai_result.get("domain") or "geral"), "geral")
    title = str(metadata.get("title") or Path(original_name).stem)
    project = safe_slug(str(metadata.get("project") or ""), "")
    year = extract_year(str(metadata.get("date") or "")) or extract_year(
        str(ai_result.get("suggested_name") or "")
    )
    if not year:
        year = "sem-data"

    suggested_stem = Path(str(ai_result.get("suggested_name") or title)).stem
    if suggested_stem.lower().endswith(".pdf"):
        suggested_stem = Path(suggested_stem).stem
    normalized_stem = safe_slug(suggested_stem or title)
    short_id = document_id[:8]
    base_name = f"{year}__{classification}__{normalized_stem}__{short_id}"
    suggested_name = f"{base_name}.md"

    folder_parts = resolve_folder_parts(ai_result, domain, project, classification, year)
    relative_folder = "/".join(folder_parts)
    pdf_dir = current_user.originals_dir.joinpath(*folder_parts)
    markdown_dir = current_user.markdown_dir.joinpath(*folder_parts)

    return {
        "classification": classification,
        "document_type": classification,
        "domain": domain,
        "title": title,
        "year": year,
        "project": project or None,
        "folder_path": relative_folder,
        "suggested_name": suggested_name,
        "pdf_dir": pdf_dir,
        "markdown_dir": markdown_dir,
        "pdf_path": pdf_dir / f"{base_name}.pdf",
        "markdown_path": markdown_dir / f"{base_name}.md",
    }


def extract_year(value: str) -> str | None:
    match = re.search(r"\b(19|20)\d{2}\b", value)
    return match.group(0) if match else None


def resolve_folder_parts(
    ai_result: dict[str, Any],
    domain: str,
    project: str,
    classification: str,
    year: str,
) -> list[str]:
    requested_path = sanitize_relative_folder(str(ai_result.get("folder_path") or ""))
    requested_domain = requested_path[0] if len(requested_path) >= 1 else ""
    requested_project = requested_path[1] if len(requested_path) >= 2 else ""
    resolved_domain = safe_slug(domain or requested_domain or "geral", "geral")
    resolved_project = safe_slug(project or requested_project, "")
    parts = [resolved_domain]
    if resolved_project and resolved_project != resolved_domain:
        parts.append(resolved_project)
    parts.extend([year, classification])
    return parts[:4]


def sanitize_relative_folder(value: str) -> list[str]:
    raw_parts = re.split(r"[\\/]+", value.strip())
    parts: list[str] = []
    for raw_part in raw_parts:
        if raw_part in {"", ".", ".."}:
            continue
        slug = safe_slug(raw_part, "")
        if slug:
            parts.append(slug[:60])
    return parts[:4]


def normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def dedupe_text_list(values: list[str], *, limit: int = 12) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        cleaned = re.sub(r"\s+", " ", str(value or "")).strip()
        if len(cleaned) < 2:
            continue
        normalized = normalize_search_text(cleaned)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        output.append(cleaned[:160])
        if len(output) >= limit:
            break
    return output


def clamp_confidence(value: Any, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(0.0, min(parsed, 1.0))


def build_document_aliases(
    *,
    original_name: str,
    suggested_name: str,
    title: str,
    project: str | None,
    aliases: list[str],
    tags: list[str],
) -> list[str]:
    original_stem = Path(original_name).stem
    suggested_stem = Path(suggested_name).stem
    values = [
        title,
        original_name,
        original_stem,
        suggested_name,
        suggested_stem,
        project or "",
        *aliases,
        *tags[:4],
    ]
    return dedupe_text_list(values, limit=14)


def infer_document_domain(
    *,
    raw_domain: str,
    project: str | None,
    technologies: list[str],
    folder_path: str,
) -> str:
    requested = safe_slug(raw_domain, "")
    if requested:
        return requested

    project_slug = safe_slug(project or "", "")
    if project_slug:
        return project_slug

    for item in technologies:
        tech_slug = safe_slug(item, "")
        if tech_slug:
            return tech_slug

    folder_parts = sanitize_relative_folder(folder_path)
    if folder_parts:
        return folder_parts[0]
    return "geral"


def build_entities(values: list[str], *, project: str | None, title: str, tags: list[str]) -> list[str]:
    entity_candidates = [*values, project or "", *tags[:4]]
    title_tokens = [part for part in re.split(r"[\s,;:/()\-]+", title) if len(part.strip()) >= 4][:4]
    entity_candidates.extend(title_tokens)
    return dedupe_text_list(entity_candidates, limit=10)


def derive_review_status(
    *,
    classification: str,
    domain: str,
    classification_confidence: float,
    folder_confidence: float,
    title_confidence: float,
) -> str:
    low_scores = [score for score in (classification_confidence, folder_confidence, title_confidence) if score < 0.58]
    if low_scores:
        return "needs_review"
    if classification == "outro" and domain == "geral":
        return "needs_review"
    return "auto_ok"


def ensure_unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 10000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise HTTPException(status_code=500, detail=f"Could not create unique path for {path.name}.")


def record_source_kind(record: dict[str, Any]) -> str:
    source_kind = str(record.get("source_kind") or DOCUMENT_SOURCE_KIND).strip().lower()
    return NOTE_SOURCE_KIND if source_kind == NOTE_SOURCE_KIND else DOCUMENT_SOURCE_KIND


def is_note_record(record: dict[str, Any]) -> bool:
    return record_source_kind(record) == NOTE_SOURCE_KIND


def normalize_note_tags(value: Any) -> list[str]:
    return dedupe_text_list(normalize_string_list(value), limit=18)


def note_storage_path(current_user: AuthenticatedUserContext, note_id: str) -> Path:
    safe_id = safe_slug(note_id, fallback="note")
    return current_user.notes_dir / f"{safe_id}.md"


def note_versions_path(current_user: AuthenticatedUserContext, note_id: str) -> Path:
    safe_id = safe_slug(note_id, fallback="note")
    return current_user.note_versions_dir / safe_id


def note_version_path(current_user: AuthenticatedUserContext, note_id: str, version: int) -> Path:
    return note_versions_path(current_user, note_id) / f"v{version:04d}.json"


def note_summary(content: str, *, limit: int = 220) -> str:
    cleaned = re.sub(r"\s+", " ", content).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 3].rstrip() + "..."


def note_author_for_user(current_user: AuthenticatedUserContext) -> str:
    return current_user.display_name or current_user.email or current_user.uid


def write_note_content(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.strip() + "\n", encoding="utf-8")


def read_note_content(path: Path) -> str:
    if not path.exists() or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def build_note_record(
    *,
    note_id: str,
    title: str,
    content: str,
    tags: list[str],
    author: str,
    created_at: str,
    updated_at: str,
    current_version: int,
    markdown_path: Path,
    chunks_indexed: int,
) -> dict[str, Any]:
    clean_title = re.sub(r"\s+", " ", title).strip()[:160] or "Nova nota"
    clean_content = content.strip()
    summary = note_summary(clean_content)
    return {
        "document_id": note_id,
        "note_id": note_id,
        "source_kind": NOTE_SOURCE_KIND,
        "sha256": "",
        "original_name": clean_title,
        "classification": "nota",
        "document_type": "nota",
        "domain": "notas",
        "suggested_name": clean_title,
        "title": clean_title,
        "author": author,
        "date": updated_at[:10],
        "year": updated_at[:4] if len(updated_at) >= 4 else "sem-data",
        "technologies": [],
        "summary": summary,
        "folder_path": "",
        "tags": tags,
        "aliases": dedupe_text_list([clean_title, *tags], limit=12),
        "entities": [],
        "project": None,
        "classification_confidence": 1.0,
        "folder_confidence": 1.0,
        "title_confidence": 1.0,
        "review_status": "auto_ok",
        "processing_status": "ready",
        "processing_progress": 100,
        "processing_error": None,
        "processing_started_at": None,
        "processing_completed_at": updated_at,
        "pdf_path": "",
        "markdown_path": str(markdown_path),
        "chunks_indexed": chunks_indexed,
        "uploaded_at": created_at,
        "size_bytes": len(clean_content.encode("utf-8")),
        "content": clean_content,
        "created_at": created_at,
        "updated_at": updated_at,
        "current_version": current_version,
        "version_count": current_version,
    }


def create_note_version_snapshot(
    current_user: AuthenticatedUserContext,
    *,
    note_id: str,
    version: int,
    title: str,
    content: str,
    tags: list[str],
    author: str,
    created_at: str,
    updated_at: str,
) -> dict[str, Any]:
    snapshot = {
        "note_id": note_id,
        "version": version,
        "title": title,
        "content": content,
        "tags": tags,
        "author": author,
        "created_at": created_at,
        "updated_at": updated_at,
        "snapshot_at": updated_at,
    }
    snapshot_path = note_version_path(current_user, note_id, version)
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    return snapshot


def read_note_versions(current_user: AuthenticatedUserContext, note_id: str) -> list[dict[str, Any]]:
    versions_dir = note_versions_path(current_user, note_id)
    if not versions_dir.exists():
        return []

    snapshots: list[dict[str, Any]] = []
    for path in sorted(versions_dir.glob("v*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict) and str(payload.get("note_id") or "").strip() == note_id:
            snapshots.append(payload)
    snapshots.sort(key=lambda item: int(item.get("version") or 0), reverse=True)
    return snapshots


def hydrate_note_record(record: dict[str, Any]) -> dict[str, Any]:
    hydrated = dict(record)
    note_id = str(hydrated.get("note_id") or hydrated.get("document_id") or "").strip()
    title = re.sub(r"\s+", " ", str(hydrated.get("title") or hydrated.get("suggested_name") or "Nova nota")).strip()
    markdown_path = Path(str(hydrated.get("markdown_path") or "")).expanduser()
    content = str(hydrated.get("content") or "").strip()
    if not content and markdown_path:
        content = read_note_content(markdown_path).strip()

    created_at = str(hydrated.get("created_at") or hydrated.get("uploaded_at") or datetime.now(UTC).isoformat())
    updated_at = str(
        hydrated.get("updated_at")
        or hydrated.get("processing_completed_at")
        or created_at
    )
    tags = normalize_note_tags(hydrated.get("tags"))
    current_version = max(1, int(hydrated.get("current_version") or hydrated.get("version_count") or 1))
    size_bytes = hydrated.get("size_bytes")
    if size_bytes is None and content:
        size_bytes = len(content.encode("utf-8"))

    hydrated.update(
        {
            "document_id": note_id,
            "note_id": note_id,
            "source_kind": NOTE_SOURCE_KIND,
            "classification": "nota",
            "document_type": "nota",
            "domain": "notas",
            "original_name": title,
            "suggested_name": title,
            "title": title,
            "author": str(hydrated.get("author") or "").strip() or None,
            "date": updated_at[:10],
            "year": updated_at[:4] if len(updated_at) >= 4 else "sem-data",
            "technologies": [],
            "tags": tags,
            "aliases": dedupe_text_list([title, *tags], limit=12),
            "entities": [],
            "project": None,
            "summary": str(hydrated.get("summary") or note_summary(content)),
            "review_status": "auto_ok",
            "processing_status": "ready",
            "processing_progress": 100,
            "processing_error": None,
            "processing_started_at": None,
            "processing_completed_at": updated_at,
            "folder_path": "",
            "pdf_path": "",
            "markdown_path": str(markdown_path) if str(markdown_path) else "",
            "chunks_indexed": int(hydrated.get("chunks_indexed") or 0),
            "uploaded_at": created_at,
            "size_bytes": size_bytes,
            "content": content,
            "created_at": created_at,
            "updated_at": updated_at,
            "current_version": current_version,
            "version_count": max(current_version, int(hydrated.get("version_count") or current_version)),
        }
    )
    return hydrated


def hydrate_manifest_record(record: dict[str, Any]) -> dict[str, Any]:
    if is_note_record(record):
        return hydrate_note_record(record)
    return hydrate_document_record(record)


def build_queued_document_record(
    *,
    document_id: str,
    file_hash: str,
    original_name: str,
    staging_path: Path,
) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    title = Path(original_name).stem
    return {
        "document_id": document_id,
        "source_kind": DOCUMENT_SOURCE_KIND,
        "sha256": file_hash,
        "original_name": original_name,
        "classification": "outro",
        "document_type": "outro",
        "domain": "geral",
        "suggested_name": original_name,
        "title": title,
        "author": None,
        "date": None,
        "year": "sem-data",
        "technologies": [],
        "summary": "",
        "folder_path": "",
        "tags": [],
        "aliases": dedupe_text_list([original_name, title], limit=6),
        "entities": [],
        "project": None,
        "classification_confidence": None,
        "folder_confidence": None,
        "title_confidence": None,
        "review_status": "pending",
        "processing_status": "queued",
        "processing_progress": 0,
        "processing_error": None,
        "processing_started_at": None,
        "processing_completed_at": None,
        "pdf_path": str(staging_path),
        "markdown_path": "",
        "chunks_indexed": 0,
        "uploaded_at": now,
        "size_bytes": staging_path.stat().st_size if staging_path.exists() else None,
    }


def build_document_record(
    document_id: str,
    file_hash: str,
    original_name: str,
    ai_result: dict[str, Any],
    file_plan: dict[str, Any],
    pdf_path: Path,
    markdown_path: Path,
    chunks_indexed: int,
) -> dict[str, Any]:
    metadata = ai_result.get("metadata", {})
    technologies = metadata.get("technologies") if isinstance(metadata, dict) else []
    if not isinstance(technologies, list):
        technologies = []

    return {
        "document_id": document_id,
        "source_kind": DOCUMENT_SOURCE_KIND,
        "sha256": file_hash,
        "original_name": original_name,
        "classification": file_plan["classification"],
        "document_type": file_plan["document_type"],
        "domain": file_plan["domain"],
        "suggested_name": file_plan["suggested_name"],
        "title": str(metadata.get("title") or file_plan["title"]),
        "author": metadata.get("author"),
        "date": metadata.get("date"),
        "year": file_plan["year"],
        "technologies": [str(item) for item in technologies if str(item).strip()],
        "tags": normalize_string_list(metadata.get("tags")),
        "aliases": dedupe_text_list([str(item) for item in ai_result.get("aliases") or []], limit=14),
        "entities": dedupe_text_list([str(item) for item in ai_result.get("entities") or []], limit=10),
        "project": metadata.get("project"),
        "summary": str(metadata.get("summary") or ""),
        "classification_confidence": ai_result.get("classification_confidence"),
        "folder_confidence": ai_result.get("folder_confidence"),
        "title_confidence": ai_result.get("title_confidence"),
        "review_status": str(ai_result.get("review_status") or "auto_ok"),
        "processing_status": "ready",
        "processing_progress": 100,
        "processing_error": None,
        "processing_started_at": None,
        "processing_completed_at": datetime.now(UTC).isoformat(),
        "folder_path": file_plan["folder_path"],
        "pdf_path": str(pdf_path),
        "markdown_path": str(markdown_path),
        "chunks_indexed": chunks_indexed,
        "uploaded_at": datetime.now(UTC).isoformat(),
        "size_bytes": pdf_path.stat().st_size if pdf_path.exists() else None,
    }


def document_processing_events_path(current_user: AuthenticatedUserContext, document_id: str) -> Path:
    safe_id = safe_slug(document_id, fallback="document")
    return current_user.processing_events_dir / f"{safe_id}.jsonl"


def append_document_processing_event(
    current_user: AuthenticatedUserContext,
    document_id: str,
    *,
    stage: str,
    status: str,
    level: str,
    message: str,
    progress: int | None = None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    ensure_user_storage(current_user)
    event = {
        "event_id": uuid.uuid4().hex[:12],
        "document_id": document_id,
        "stage": safe_slug(stage, fallback="evento"),
        "status": safe_slug(status, fallback="info"),
        "level": safe_slug(level, fallback="info"),
        "message": str(message).strip()[:600],
        "progress": max(0, min(int(progress), 100)) if isinstance(progress, int) else None,
        "timestamp": str(timestamp or datetime.now(UTC).isoformat()),
    }
    with document_processing_events_path(current_user, document_id).open("a", encoding="utf-8") as output:
        output.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def read_document_processing_events(
    current_user: AuthenticatedUserContext,
    document_id: str,
    *,
    record: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    path = document_processing_events_path(current_user, document_id)
    events: list[dict[str, Any]] = []
    if path.exists():
        with path.open("r", encoding="utf-8") as input_file:
            for line in input_file:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue
                payload["document_id"] = document_id
                events.append(
                    {
                        "event_id": str(payload.get("event_id") or uuid.uuid4().hex[:12]),
                        "document_id": document_id,
                        "stage": safe_slug(str(payload.get("stage") or "evento"), fallback="evento"),
                        "status": safe_slug(str(payload.get("status") or "info"), fallback="info"),
                        "level": safe_slug(str(payload.get("level") or "info"), fallback="info"),
                        "message": str(payload.get("message") or "").strip()[:600],
                        "progress": int(payload["progress"]) if isinstance(payload.get("progress"), int) else None,
                        "timestamp": str(payload.get("timestamp") or datetime.now(UTC).isoformat()),
                    }
                )
    if events:
        return sorted(events, key=lambda item: str(item.get("timestamp") or ""))

    effective_record = hydrate_document_record(record) if record is not None else find_document_by_id(current_user, document_id)
    if effective_record is None:
        return []

    fallback_message = effective_record.get("processing_error") or documentStageDescription_for_backend(effective_record)
    fallback_timestamp = str(
        effective_record.get("processing_completed_at")
        or effective_record.get("processing_started_at")
        or effective_record.get("uploaded_at")
        or datetime.now(UTC).isoformat()
    )
    return [
        {
            "event_id": f"snapshot-{document_id[:8]}",
            "document_id": document_id,
            "stage": str(effective_record.get("processing_status") or "ready"),
            "status": str(effective_record.get("processing_status") or "ready"),
            "level": "danger" if str(effective_record.get("processing_status") or "") == "failed" else "info",
            "message": str(fallback_message),
            "progress": int(effective_record.get("processing_progress") or 0),
            "timestamp": fallback_timestamp,
        }
    ]


def documentStageDescription_for_backend(record: dict[str, Any]) -> str:
    status = str(record.get("processing_status") or "").strip().lower()
    if status == "queued":
        return "Documento aguardando worker livre para iniciar o processamento."
    if status == "extracting":
        return "Extraindo texto do PDF."
    if status == "classifying":
        return "Classificando metadados e destino do documento."
    if status == "indexing":
        return "Gerando chunks e embeddings para indexacao."
    if status == "failed":
        return "O processamento falhou antes da indexacao final."
    return "Documento pronto para busca e visualizacao."


def is_document_processing_status(record: dict[str, Any]) -> bool:
    return str(record.get("processing_status") or "").strip().lower() in ACTIVE_PROCESSING_STATUSES


def document_can_retry(current_user: AuthenticatedUserContext, record: dict[str, Any]) -> bool:
    if str(record.get("processing_status") or "").strip().lower() != "failed":
        return False
    if find_resumable_document_artifacts(current_user, record) is not None:
        return True

    raw_path = str(record.get("pdf_path") or "").strip()
    if not raw_path:
        return False
    source_pdf_path = Path(raw_path).expanduser()
    return source_pdf_path.exists() and source_pdf_path.is_file()


def enqueue_document_processing(current_user: AuthenticatedUserContext, document_id: str) -> None:
    job_key = f"{current_user.uid}:{document_id}"
    with active_processing_lock:
        if job_key in active_processing_jobs:
            return
        active_processing_jobs.add(job_key)
    processing_executor.submit(run_document_processing_job, current_user, document_id, job_key)


def processing_job_key(uid: str, document_id: str) -> str:
    return f"{uid}:{document_id}"


def mark_document_job_cancelled(uid: str, document_id: str) -> None:
    with active_processing_lock:
        cancelled_processing_jobs.add(processing_job_key(uid, document_id))


def clear_document_job_cancelled(uid: str, document_id: str) -> None:
    with active_processing_lock:
        cancelled_processing_jobs.discard(processing_job_key(uid, document_id))


def is_document_job_cancelled(uid: str, document_id: str) -> bool:
    with active_processing_lock:
        return processing_job_key(uid, document_id) in cancelled_processing_jobs


def ensure_document_job_not_cancelled(uid: str, document_id: str) -> None:
    if is_document_job_cancelled(uid, document_id):
        raise RuntimeError(f"Document {document_id} was deleted during processing.")


def run_document_processing_job(
    current_user: AuthenticatedUserContext,
    document_id: str,
    job_key: str,
) -> None:
    try:
        append_document_processing_event(
            current_user,
            document_id,
            stage="queued",
            status="started",
            level="info",
            message="Worker iniciado para processar o documento.",
            progress=0,
        )
        process_document_job(current_user, document_id)
    except Exception as exc:
        logger.exception("Background document processing failed for %s", document_id)
        append_document_processing_event(
            current_user,
            document_id,
            stage="failed",
            status="failed",
            level="danger",
            message=str(exc),
            progress=100,
        )
        update_manifest_record(
            current_user,
            document_id,
            {
                "processing_status": "failed",
                "processing_error": str(exc),
                "processing_completed_at": datetime.now(UTC).isoformat(),
            },
        )
    finally:
        with active_processing_lock:
            active_processing_jobs.discard(job_key)
            cancelled_processing_jobs.discard(job_key)


def process_document_job(current_user: AuthenticatedUserContext, document_id: str) -> None:
    ensure_user_storage(current_user)
    ensure_document_job_not_cancelled(current_user.uid, document_id)
    record = find_document_by_id(current_user, document_id)
    if record is None:
        raise RuntimeError(f"Queued document {document_id} no longer exists in the manifest.")

    started_at = str(record.get("processing_started_at") or datetime.now(UTC).isoformat())
    base_updates = {
        "processing_error": None,
        "processing_started_at": started_at,
        "processing_completed_at": None,
    }
    update_manifest_record(
        current_user,
        document_id,
        {
            **base_updates,
            "processing_status": "extracting",
            "processing_progress": 15,
        },
    )
    append_document_processing_event(
        current_user,
        document_id,
        stage="extracting",
        status="running",
        level="info",
        message="Iniciando extração de texto do PDF.",
        progress=15,
    )

    original_name = safe_filename(str(record.get("original_name") or "document.pdf"))
    file_hash = str(record.get("sha256") or "")
    resumed_paths = find_resumable_document_artifacts(current_user, record)

    if resumed_paths is not None:
        pdf_path, markdown_path = resumed_paths
        markdown_text = markdown_path.read_text(encoding="utf-8")
        ai_result = ai_result_from_record(record)
        file_plan = file_plan_from_record(record, current_user, pdf_path, markdown_path)
        update_manifest_record(
            current_user,
            document_id,
            {
                "processing_status": "indexing",
                "processing_progress": 72,
                "pdf_path": str(pdf_path),
                "markdown_path": str(markdown_path),
            },
        )
        append_document_processing_event(
            current_user,
            document_id,
            stage="indexing",
            status="running",
            level="info",
            message="Artefatos recuperados. Retomando indexação a partir do markdown salvo.",
            progress=72,
        )
    else:
        source_pdf_path = Path(str(record.get("pdf_path") or "")).expanduser()
        if not source_pdf_path.exists() or not source_pdf_path.is_file():
            raise RuntimeError(f"Queued document source is missing: {source_pdf_path}")

        markdown_text = extract_pdf_markdown(source_pdf_path)
        ensure_document_job_not_cancelled(current_user.uid, document_id)
        if not markdown_text.strip():
            raise RuntimeError("The uploaded PDF did not produce readable text.")

        update_manifest_record(
            current_user,
            document_id,
            {
                "processing_status": "classifying",
                "processing_progress": 45,
            },
        )
        append_document_processing_event(
            current_user,
            document_id,
            stage="classifying",
            status="running",
            level="info",
            message="Texto extraído. Classificando tipo, título e pasta do documento.",
            progress=45,
        )

        try:
            ai_result = analyze_document_with_groq(markdown_text, original_name)
        except Exception as exc:
            logger.warning("AI classification fallback for document_id=%s: %s", document_id, exc)
            ai_result = fallback_document_analysis(markdown_text, original_name)
        ensure_document_job_not_cancelled(current_user.uid, document_id)

        file_plan = build_file_plan(
            current_user=current_user,
            ai_result=ai_result,
            original_name=original_name,
            document_id=document_id,
        )
        pdf_path = ensure_unique_path(file_plan["pdf_path"])
        markdown_path = ensure_unique_path(file_plan["markdown_path"])
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        markdown_path.parent.mkdir(parents=True, exist_ok=True)

        update_manifest_record(
            current_user,
            document_id,
            {
                "classification": file_plan["classification"],
                "document_type": file_plan["document_type"],
                "domain": file_plan["domain"],
                "suggested_name": file_plan["suggested_name"],
                "title": file_plan["title"],
                "folder_path": file_plan["folder_path"],
                "year": file_plan["year"],
                "project": file_plan["project"],
                "processing_status": "indexing",
                "processing_progress": 72,
            },
        )
        append_document_processing_event(
            current_user,
            document_id,
            stage="indexing",
            status="running",
            level="info",
            message="Metadados definidos. Movendo arquivos e preparando a indexação vetorial.",
            progress=72,
        )

        shutil.move(str(source_pdf_path), str(pdf_path))
        markdown_path.write_text(markdown_text, encoding="utf-8")
        ensure_document_job_not_cancelled(current_user.uid, document_id)

    chunks = split_text(markdown_text)
    if not chunks:
        raise RuntimeError("The document could not be split into searchable chunks.")

    logger.info(
        "Starting vector indexing for document_id=%s chunks=%s filename=%s",
        document_id,
        len(chunks),
        original_name,
    )
    with vector_index_lock:
        ensure_document_job_not_cancelled(current_user.uid, document_id)
        embeddings = embed_texts(chunks)
        collection = get_chroma_collection(current_user.collection_name)
        chunk_ids = [f"{document_id}:{index}" for index in range(len(chunks))]
        metadatas = [
            build_chroma_metadata(
                current_user=current_user,
                document_id=document_id,
                file_hash=file_hash,
                chunk_index=index,
                pdf_path=pdf_path,
                markdown_path=markdown_path,
                original_name=original_name,
                suggested_name=file_plan["suggested_name"],
                year=file_plan["year"],
                ai_result=ai_result,
            )
            for index in range(len(chunks))
        ]

        try:
            collection.delete(where={"document_id": document_id})
        except Exception:
            logger.debug("Chroma cleanup skipped for document_id=%s", document_id)

        ensure_document_job_not_cancelled(current_user.uid, document_id)
        collection.upsert(
            ids=chunk_ids,
            documents=chunks,
            embeddings=embeddings,
            metadatas=metadatas,
        )
        ensure_document_job_not_cancelled(current_user.uid, document_id)
    logger.info(
        "Finished vector indexing for document_id=%s chunks=%s filename=%s",
        document_id,
        len(chunks),
        original_name,
    )
    append_document_processing_event(
        current_user,
        document_id,
        stage="indexing",
        status="completed",
        level="success",
        message=f"Indexação vetorial concluída com {len(chunks)} chunks prontos para busca.",
        progress=95,
    )

    final_record = build_document_record(
        document_id=document_id,
        file_hash=file_hash,
        original_name=original_name,
        ai_result=ai_result,
        file_plan=file_plan,
        pdf_path=pdf_path,
        markdown_path=markdown_path,
        chunks_indexed=len(chunks),
    )
    final_record["uploaded_at"] = str(record.get("uploaded_at") or final_record["uploaded_at"])
    final_record["processing_started_at"] = started_at
    final_record["processing_completed_at"] = datetime.now(UTC).isoformat()
    final_record["processing_progress"] = 100
    final_record["processing_status"] = "ready"
    final_record["processing_error"] = None

    update_manifest_record(current_user, document_id, final_record)
    append_document_processing_event(
        current_user,
        document_id,
        stage="ready",
        status="ready",
        level="success",
        message="Documento pronto para busca semântica, chat e visualização.",
        progress=100,
        timestamp=str(final_record["processing_completed_at"]),
    )


def list_recoverable_document_jobs() -> list[tuple[AuthenticatedUserContext, str]]:
    jobs: list[tuple[AuthenticatedUserContext, str]] = []
    if not USERS_DIR.exists():
        return jobs

    for user_dir in USERS_DIR.iterdir():
        if not user_dir.is_dir():
            continue
        current_user = build_user_context_from_storage(user_dir)
        if current_user is None:
            continue

        for record in read_manifest_records(current_user):
            if is_note_record(record):
                continue
            hydrated = hydrate_document_record(record)
            status = str(hydrated.get("processing_status") or "ready")
            document_id = str(hydrated.get("document_id") or "").strip()
            if not document_id or status not in {"queued", "extracting", "classifying", "indexing"}:
                if status != "failed" or find_resumable_document_artifacts(current_user, hydrated) is None:
                    continue
            jobs.append((current_user, document_id))

    return jobs


def build_user_context_from_storage(user_dir: Path) -> AuthenticatedUserContext | None:
    profile_path = user_dir / "profile.json"
    payload = read_json_object(profile_path) or {}
    uid = str(payload.get("uid") or user_dir.name).strip()
    if not uid:
        return None

    provider_ids = payload.get("provider_ids")
    return AuthenticatedUserContext(
        uid=uid,
        email=str(payload.get("email")).strip() if payload.get("email") else None,
        display_name=str(payload.get("display_name")).strip() if payload.get("display_name") else None,
        provider_ids=[str(item).strip() for item in provider_ids] if isinstance(provider_ids, list) else [],
        user_dir=user_dir,
        profile_path=profile_path,
        originals_dir=Path(str(payload.get("originals_dir") or user_dir / "originals")),
        markdown_dir=Path(str(payload.get("markdown_dir") or user_dir / "markdown")),
        incoming_dir=Path(str(payload.get("incoming_dir") or user_dir / "incoming")),
        manifest_path=Path(str(payload.get("manifest_path") or user_dir / "manifest.jsonl")),
        folders_path=Path(str(payload.get("folders_path") or user_dir / "folders.json")),
        processing_events_dir=Path(str(payload.get("processing_events_dir") or user_dir / "processing-events")),
        memory_dir=Path(str(payload.get("memory_dir") or user_dir / "memory")),
        notes_dir=Path(str(payload.get("notes_dir") or user_dir / "notes" / "current")),
        note_versions_dir=Path(str(payload.get("note_versions_dir") or user_dir / "notes" / "versions")),
        collection_name=str(payload.get("collection_name") or collection_name_for_user(uid)),
    )


def find_resumable_document_artifacts(
    current_user: AuthenticatedUserContext,
    record: dict[str, Any],
) -> tuple[Path, Path] | None:
    folder_parts = sanitize_relative_folder(str(record.get("folder_path") or ""))
    suggested_stem = Path(str(record.get("suggested_name") or "")).stem
    if not suggested_stem:
        return None

    pdf_path = current_user.originals_dir.joinpath(*folder_parts, f"{suggested_stem}.pdf")
    markdown_path = current_user.markdown_dir.joinpath(*folder_parts, f"{suggested_stem}.md")
    if pdf_path.exists() and pdf_path.is_file() and markdown_path.exists() and markdown_path.is_file():
        return pdf_path, markdown_path
    return None


def ai_result_from_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "classification": str(record.get("document_type") or record.get("classification") or "outro"),
        "document_type": str(record.get("document_type") or record.get("classification") or "outro"),
        "domain": str(record.get("domain") or "geral"),
        "suggested_name": str(record.get("suggested_name") or record.get("original_name") or "document.pdf"),
        "folder_path": str(record.get("folder_path") or ""),
        "aliases": normalize_string_list(record.get("aliases")),
        "entities": normalize_string_list(record.get("entities")),
        "classification_confidence": record.get("classification_confidence"),
        "folder_confidence": record.get("folder_confidence"),
        "title_confidence": record.get("title_confidence"),
        "review_status": str(record.get("review_status") or "auto_ok"),
        "metadata": {
            "title": str(record.get("title") or Path(str(record.get("original_name") or "document")).stem),
            "author": record.get("author"),
            "date": record.get("date"),
            "project": record.get("project"),
            "technologies": normalize_string_list(record.get("technologies")),
            "tags": normalize_string_list(record.get("tags")),
            "summary": str(record.get("summary") or ""),
        },
    }


def file_plan_from_record(
    record: dict[str, Any],
    current_user: AuthenticatedUserContext,
    pdf_path: Path,
    markdown_path: Path,
) -> dict[str, Any]:
    folder_parts = sanitize_relative_folder(str(record.get("folder_path") or ""))
    return {
        "classification": str(record.get("document_type") or record.get("classification") or "outro"),
        "document_type": str(record.get("document_type") or record.get("classification") or "outro"),
        "domain": str(record.get("domain") or "geral"),
        "title": str(record.get("title") or Path(str(record.get("original_name") or "document")).stem),
        "year": str(record.get("year") or "sem-data"),
        "project": record.get("project"),
        "folder_path": str(record.get("folder_path") or ""),
        "suggested_name": str(record.get("suggested_name") or pdf_path.with_suffix(".md").name),
        "pdf_dir": current_user.originals_dir.joinpath(*folder_parts),
        "markdown_dir": current_user.markdown_dir.joinpath(*folder_parts),
        "pdf_path": pdf_path,
        "markdown_path": markdown_path,
    }


@app.on_event("startup")
def resume_document_processing_jobs() -> None:
    for current_user, document_id in list_recoverable_document_jobs():
        update_manifest_record(
            current_user,
            document_id,
            {
                "processing_status": "queued",
                "processing_progress": 0,
                "processing_error": None,
                "processing_completed_at": None,
            },
        )
        append_document_processing_event(
            current_user,
            document_id,
            stage="queued",
            status="queued",
            level="warning",
            message="Processamento retomado automaticamente após reinício do backend.",
            progress=0,
        )
        enqueue_document_processing(current_user, document_id)


def append_manifest_record(current_user: AuthenticatedUserContext, record: dict[str, Any]) -> None:
    ensure_user_storage(current_user)
    with manifest_lock:
        with current_user.manifest_path.open("a", encoding="utf-8") as output:
            output.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_manifest_records(current_user: AuthenticatedUserContext) -> list[dict[str, Any]]:
    if not current_user.manifest_path.exists():
        return []
    records: list[dict[str, Any]] = []
    with manifest_lock:
        with current_user.manifest_path.open("r", encoding="utf-8") as input_file:
            for line in input_file:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return records


def write_manifest_records(current_user: AuthenticatedUserContext, records: list[dict[str, Any]]) -> None:
    ensure_user_storage(current_user)
    payload = "\n".join(json.dumps(record, ensure_ascii=False) for record in records)
    with manifest_lock:
        current_user.manifest_path.write_text(f"{payload}\n" if payload else "", encoding="utf-8")


def update_manifest_record(
    current_user: AuthenticatedUserContext,
    document_id: str,
    updates: dict[str, Any],
) -> dict[str, Any] | None:
    ensure_user_storage(current_user)
    updated_record: dict[str, Any] | None = None
    with manifest_lock:
        records: list[dict[str, Any]] = []
        with current_user.manifest_path.open("r", encoding="utf-8") as input_file:
            for line in input_file:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        for index, record in enumerate(records):
            if str(record.get("document_id") or "").strip() != document_id:
                continue
            merged = dict(record)
            merged.update(updates)
            records[index] = merged
            updated_record = merged
            break

        if updated_record is None:
            return None

        payload = "\n".join(json.dumps(record, ensure_ascii=False) for record in records)
        current_user.manifest_path.write_text(f"{payload}\n" if payload else "", encoding="utf-8")
    return updated_record


def remove_manifest_record(current_user: AuthenticatedUserContext, document_id: str) -> bool:
    ensure_user_storage(current_user)
    removed = False
    with manifest_lock:
        records: list[dict[str, Any]] = []
        with current_user.manifest_path.open("r", encoding="utf-8") as input_file:
            for line in input_file:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if str(payload.get("document_id") or "").strip() == document_id:
                    removed = True
                    continue
                records.append(payload)

        serialized = "\n".join(json.dumps(record, ensure_ascii=False) for record in records)
        current_user.manifest_path.write_text(f"{serialized}\n" if serialized else "", encoding="utf-8")
    return removed


def index_note_record(
    current_user: AuthenticatedUserContext,
    *,
    note_id: str,
    title: str,
    content: str,
    tags: list[str],
    author: str,
    created_at: str,
    updated_at: str,
    markdown_path: Path,
) -> int:
    chunks = split_text(content.strip())
    if not chunks:
        raise HTTPException(status_code=400, detail="A nota precisa ter conteúdo indexável.")

    embeddings = embed_texts(chunks)
    collection = get_chroma_collection(current_user.collection_name)
    ai_result = {
        "metadata": {
            "title": title,
            "author": author,
            "date": updated_at[:10],
            "project": "",
            "technologies": [],
            "tags": tags,
            "summary": note_summary(content),
        },
        "classification": "nota",
        "document_type": "nota",
        "domain": "notas",
        "aliases": [title, *tags],
        "entities": [],
        "review_status": "auto_ok",
        "source_kind": NOTE_SOURCE_KIND,
    }
    metadatas = [
        build_chroma_metadata(
            current_user=current_user,
            document_id=note_id,
            file_hash="",
            chunk_index=index,
            pdf_path=Path(""),
            markdown_path=markdown_path,
            original_name=title,
            suggested_name=title,
            year=updated_at[:4] if len(updated_at) >= 4 else "sem-data",
            ai_result=ai_result,
        )
        for index in range(len(chunks))
    ]
    for metadata in metadatas:
        metadata["source_kind"] = NOTE_SOURCE_KIND
        metadata["author"] = author
        metadata["created_at"] = created_at
        metadata["updated_at"] = updated_at
        metadata["note_id"] = note_id
        metadata["pdf_path"] = ""

    try:
        collection.delete(where={"document_id": note_id})
    except Exception:
        logger.debug("Chroma cleanup skipped for note_id=%s", note_id)

    collection.upsert(
        ids=[f"{note_id}:{index}" for index in range(len(chunks))],
        documents=chunks,
        embeddings=embeddings,
        metadatas=metadatas,
    )
    return len(chunks)


def create_note(
    current_user: AuthenticatedUserContext,
    request: NoteCreateRequest,
) -> dict[str, Any]:
    ensure_user_storage(current_user)
    note_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()
    title = re.sub(r"\s+", " ", request.title).strip()
    content = request.content.strip()
    if not title or not content:
        raise HTTPException(status_code=400, detail="Título e conteúdo são obrigatórios para a nota.")

    tags = normalize_note_tags(request.tags)
    author = note_author_for_user(current_user)
    markdown_path = note_storage_path(current_user, note_id)
    write_note_content(markdown_path, content)
    chunks_indexed = index_note_record(
        current_user,
        note_id=note_id,
        title=title,
        content=content,
        tags=tags,
        author=author,
        created_at=now,
        updated_at=now,
        markdown_path=markdown_path,
    )
    record = build_note_record(
        note_id=note_id,
        title=title,
        content=content,
        tags=tags,
        author=author,
        created_at=now,
        updated_at=now,
        current_version=1,
        markdown_path=markdown_path,
        chunks_indexed=chunks_indexed,
    )
    append_manifest_record(current_user, record)
    create_note_version_snapshot(
        current_user,
        note_id=note_id,
        version=1,
        title=title,
        content=content,
        tags=tags,
        author=author,
        created_at=now,
        updated_at=now,
    )
    return hydrate_note_record(record)


def update_note(
    current_user: AuthenticatedUserContext,
    note_id: str,
    request: NoteUpdateRequest,
) -> dict[str, Any]:
    existing = find_note_by_id(current_user, note_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Note not found for this user.")

    title = re.sub(r"\s+", " ", str(request.title or existing.get("title") or "")).strip()
    content = str(request.content if request.content is not None else existing.get("content") or "").strip()
    if request.tags is None:
        tags = normalize_note_tags(existing.get("tags"))
    else:
        tags = normalize_note_tags(request.tags)

    if not title or not content:
        raise HTTPException(status_code=400, detail="Título e conteúdo são obrigatórios para a nota.")

    created_at = str(existing.get("created_at") or existing.get("uploaded_at") or datetime.now(UTC).isoformat())
    updated_at = datetime.now(UTC).isoformat()
    current_version = max(1, int(existing.get("current_version") or existing.get("version_count") or 1)) + 1
    author = str(existing.get("author") or note_author_for_user(current_user))
    markdown_path = Path(str(existing.get("markdown_path") or note_storage_path(current_user, note_id)))

    write_note_content(markdown_path, content)
    chunks_indexed = index_note_record(
        current_user,
        note_id=note_id,
        title=title,
        content=content,
        tags=tags,
        author=author,
        created_at=created_at,
        updated_at=updated_at,
        markdown_path=markdown_path,
    )
    updated_record = build_note_record(
        note_id=note_id,
        title=title,
        content=content,
        tags=tags,
        author=author,
        created_at=created_at,
        updated_at=updated_at,
        current_version=current_version,
        markdown_path=markdown_path,
        chunks_indexed=chunks_indexed,
    )
    stored = update_manifest_record(current_user, note_id, updated_record)
    if stored is None:
        raise HTTPException(status_code=404, detail="Note not found for this user.")
    create_note_version_snapshot(
        current_user,
        note_id=note_id,
        version=current_version,
        title=title,
        content=content,
        tags=tags,
        author=author,
        created_at=created_at,
        updated_at=updated_at,
    )
    return hydrate_note_record(stored)


def delete_note_storage(current_user: AuthenticatedUserContext, note_id: str, record: dict[str, Any]) -> None:
    delete_document_files(current_user, record)
    versions_dir = note_versions_path(current_user, note_id)
    if versions_dir.exists():
        shutil.rmtree(versions_dir, ignore_errors=True)


def read_folder_records(current_user: AuthenticatedUserContext) -> list[dict[str, Any]]:
    ensure_user_storage(current_user)
    try:
        payload = json.loads(current_user.folders_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = []

    folders: list[dict[str, Any]] = []
    if isinstance(payload, list):
        for item in payload:
            if not isinstance(item, dict):
                continue
            folder_path = "/".join(sanitize_relative_folder(str(item.get("path") or "")))
            if not folder_path:
                continue
            folders.append(
                {
                    "path": folder_path,
                    "name": safe_slug(str(item.get("name") or folder_path.split("/")[-1]), folder_path.split("/")[-1]),
                    "created_at": str(item.get("created_at") or datetime.now(UTC).isoformat()),
                }
            )

    deduped: dict[str, dict[str, Any]] = {}
    for folder in folders:
        deduped[folder["path"]] = folder
    return sorted(deduped.values(), key=lambda item: item["path"])


def write_folder_records(current_user: AuthenticatedUserContext, folders: list[dict[str, Any]]) -> None:
    ensure_user_storage(current_user)
    current_user.folders_path.write_text(
        json.dumps(folders, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def hydrate_document_record(record: dict[str, Any]) -> dict[str, Any]:
    hydrated = dict(record)
    hydrated["source_kind"] = DOCUMENT_SOURCE_KIND
    document_type = safe_slug(
        str(hydrated.get("document_type") or hydrated.get("classification") or "outro"),
        "outro",
    )
    hydrated["classification"] = document_type
    hydrated["document_type"] = document_type

    technologies = normalize_string_list(hydrated.get("technologies"))
    tags = normalize_string_list(hydrated.get("tags"))
    project = str(hydrated.get("project") or "").strip() or None
    title = str(hydrated.get("title") or Path(str(hydrated.get("original_name") or "document")).stem).strip()
    suggested_name = str(hydrated.get("suggested_name") or hydrated.get("original_name") or title)
    domain = infer_document_domain(
        raw_domain=str(hydrated.get("domain") or ""),
        project=project,
        technologies=technologies,
        folder_path=str(hydrated.get("folder_path") or ""),
    )
    aliases = hydrated.get("aliases")
    entities = hydrated.get("entities")
    hydrated["technologies"] = technologies
    hydrated["tags"] = tags
    hydrated["project"] = project
    hydrated["title"] = title
    hydrated["suggested_name"] = suggested_name
    hydrated["domain"] = domain
    hydrated["aliases"] = dedupe_text_list(
        [str(item) for item in aliases] if isinstance(aliases, list) else build_document_aliases(
            original_name=str(hydrated.get("original_name") or "document.pdf"),
            suggested_name=suggested_name,
            title=title,
            project=project,
            aliases=[],
            tags=tags,
        ),
        limit=14,
    )
    hydrated["entities"] = dedupe_text_list(
        [str(item) for item in entities] if isinstance(entities, list) else [],
        limit=10,
    )
    hydrated["classification_confidence"] = clamp_confidence(
        hydrated.get("classification_confidence"),
        0.72 if document_type != "outro" else 0.48,
    )
    hydrated["folder_confidence"] = clamp_confidence(
        hydrated.get("folder_confidence"),
        0.75 if domain != "geral" or project else 0.52,
    )
    hydrated["title_confidence"] = clamp_confidence(
        hydrated.get("title_confidence"),
        0.82 if title and title != Path(str(hydrated.get("original_name") or "document")).stem else 0.58,
    )
    hydrated["review_status"] = str(
        hydrated.get("review_status")
        or derive_review_status(
            classification=document_type,
            domain=domain,
            classification_confidence=float(hydrated["classification_confidence"]),
            folder_confidence=float(hydrated["folder_confidence"]),
            title_confidence=float(hydrated["title_confidence"]),
        )
    )
    raw_status = str(hydrated.get("processing_status") or "").strip().lower()
    if raw_status not in {"queued", "extracting", "classifying", "indexing", "ready", "failed"}:
        raw_status = "ready" if int(hydrated.get("chunks_indexed") or 0) > 0 else "queued"
    hydrated["processing_status"] = raw_status
    progress = hydrated.get("processing_progress")
    if progress is None:
        default_progress = {
            "queued": 0,
            "extracting": 15,
            "classifying": 45,
            "indexing": 72,
            "ready": 100,
            "failed": 100,
        }
        hydrated["processing_progress"] = default_progress[raw_status]
    else:
        try:
            hydrated["processing_progress"] = max(0, min(int(progress), 100))
        except (TypeError, ValueError):
            hydrated["processing_progress"] = 0 if raw_status != "ready" else 100
    hydrated["processing_error"] = str(hydrated.get("processing_error") or "").strip() or None
    hydrated["processing_started_at"] = str(hydrated.get("processing_started_at") or "").strip() or None
    hydrated["processing_completed_at"] = str(hydrated.get("processing_completed_at") or "").strip() or None
    if hydrated.get("size_bytes") is None:
        pdf_path_value = str(hydrated.get("pdf_path") or "").strip()
        if pdf_path_value:
            pdf_path = Path(pdf_path_value)
            if pdf_path.exists() and pdf_path.is_file():
                hydrated["size_bytes"] = pdf_path.stat().st_size
    return hydrated


def find_document_by_hash(current_user: AuthenticatedUserContext, file_hash: str) -> dict[str, Any] | None:
    for record in reversed(read_manifest_records(current_user)):
        if is_note_record(record):
            continue
        if record.get("sha256") == file_hash:
            return hydrate_document_record(record)
    return None


def find_manifest_record_by_id(current_user: AuthenticatedUserContext, record_id: str) -> dict[str, Any] | None:
    clean_id = record_id.strip()
    if not clean_id:
        return None
    for record in reversed(read_manifest_records(current_user)):
        if str(record.get("document_id") or "").strip() == clean_id:
            return hydrate_manifest_record(record)
    return None


def find_document_by_id(current_user: AuthenticatedUserContext, document_id: str) -> dict[str, Any] | None:
    record = find_manifest_record_by_id(current_user, document_id)
    if record is None or is_note_record(record):
        return None
    return record


def find_note_by_id(current_user: AuthenticatedUserContext, note_id: str) -> dict[str, Any] | None:
    record = find_manifest_record_by_id(current_user, note_id)
    if record is None or not is_note_record(record):
        return None
    return record


def remove_document_from_vector_store(current_user: AuthenticatedUserContext, document_id: str) -> None:
    try:
        collection = get_chroma_collection(current_user.collection_name)
        collection.delete(where={"document_id": document_id})
    except Exception as exc:
        logger.warning("Failed to remove document vectors for %s: %s", document_id, exc)


def path_is_within(candidate: Path, root: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def cleanup_empty_parents(path: Path, stop_dir: Path) -> None:
    current = path.parent
    stop_resolved = stop_dir.resolve()
    while current.exists():
        try:
            current_resolved = current.resolve()
        except OSError:
            break
        if current_resolved == stop_resolved:
            break
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def delete_document_files(current_user: AuthenticatedUserContext, record: dict[str, Any]) -> None:
    candidate_roots = [
        current_user.originals_dir,
        current_user.markdown_dir,
        current_user.incoming_dir,
        current_user.notes_dir,
    ]
    for field_name in ("pdf_path", "markdown_path"):
        raw_path = str(record.get(field_name) or "").strip()
        if not raw_path:
            continue
        path = Path(raw_path).expanduser()
        matched_root = next((root for root in candidate_roots if path_is_within(path, root)), None)
        if matched_root is None:
            continue
        path.unlink(missing_ok=True)
        cleanup_empty_parents(path, matched_root)


def prune_document_annotations(current_user: AuthenticatedUserContext, document_id: str) -> None:
    candidate_dirs = [chat_sessions_data_dir(current_user), current_user.memory_dir]
    seen_paths: set[Path] = set()
    for base_dir in candidate_dirs:
        if not base_dir.exists():
            continue
        for path in base_dir.glob("*.jsonl"):
            if path in seen_paths:
                continue
            seen_paths.add(path)
            rewrite_chat_annotations_for_document(path, document_id)


def rewrite_chat_annotations_for_document(path: Path, document_id: str) -> None:
    updated_lines: list[str] = []
    changed = False
    with path.open("r", encoding="utf-8") as input_file:
        for raw_line in input_file:
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                updated_lines.append(raw_line.rstrip("\n"))
                continue

            references = payload.get("references")
            if isinstance(references, list):
                filtered = [
                    item for item in references
                    if not (isinstance(item, dict) and str(item.get("document_id") or "").strip() == document_id)
                ]
                if len(filtered) != len(references):
                    payload["references"] = filtered
                    changed = True

            focus_document = payload.get("focus_document")
            if isinstance(focus_document, dict) and str(focus_document.get("document_id") or "").strip() == document_id:
                payload["focus_document"] = None
                changed = True

            updated_lines.append(json.dumps(payload, ensure_ascii=False))

    if changed:
        path.write_text("\n".join(updated_lines) + ("\n" if updated_lines else ""), encoding="utf-8")


def fallback_document_analysis(markdown_text: str, original_name: str) -> dict[str, Any]:
    title = first_heading(markdown_text) or Path(original_name).stem
    year_match = re.search(r"\b(19|20)\d{2}\b", markdown_text[:3000])
    year = year_match.group(0) if year_match else "0000"
    aliases = build_document_aliases(
        original_name=original_name,
        suggested_name=f"[{year}] Documento - {title}.md",
        title=title,
        project=None,
        aliases=[],
        tags=[],
    )
    return {
        "classification": "outro",
        "document_type": "outro",
        "domain": "geral",
        "suggested_name": f"[{year}] Documento - {title}.md",
        "folder_path": "",
        "aliases": aliases,
        "entities": dedupe_text_list(re.findall(r"\b[A-Z][A-Za-z0-9_-]{3,}\b", markdown_text[:1500]), limit=8),
        "classification_confidence": 0.42,
        "folder_confidence": 0.4,
        "title_confidence": 0.62 if title and title != Path(original_name).stem else 0.5,
        "review_status": "needs_review",
        "metadata": {
            "title": title,
            "author": None,
            "date": year if year != "0000" else None,
            "project": None,
            "technologies": [],
            "tags": [],
            "summary": "",
        },
    }


def first_heading(markdown_text: str) -> str | None:
    for line in markdown_text.splitlines():
        cleaned = line.strip().lstrip("#").strip()
        if cleaned:
            return cleaned[:120]
    return None


def split_text(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= CHUNK_SIZE:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end == len(text):
            break
        start = max(0, end - CHUNK_OVERLAP)
    return chunks


def get_embedding_model():
    global embedding_model
    if embedding_model is None:
        with embedding_model_lock:
            if embedding_model is None:
                from sentence_transformers import SentenceTransformer

                embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return embedding_model


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    model = get_embedding_model()
    embeddings = model.encode(texts, normalize_embeddings=True)
    return [embedding.tolist() for embedding in embeddings]


def get_chroma_client():
    global chroma_client
    if chroma_client is None:
        with chroma_client_lock:
            if chroma_client is None:
                import chromadb

                chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    return chroma_client


def get_chroma_collection(collection_name: str):
    global chroma_collections
    if collection_name not in chroma_collections:
        client = get_chroma_client()
        chroma_collections[collection_name] = client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )
    return chroma_collections[collection_name]


def build_chroma_metadata(
    current_user: AuthenticatedUserContext,
    document_id: str,
    file_hash: str,
    chunk_index: int,
    pdf_path: Path,
    markdown_path: Path,
    original_name: str,
    suggested_name: str,
    year: str,
    ai_result: dict[str, Any],
) -> dict[str, str | int | float | bool]:
    metadata = ai_result.get("metadata", {})
    technologies = metadata.get("technologies") if isinstance(metadata, dict) else []
    if not isinstance(technologies, list):
        technologies = []
    source_kind = str(ai_result.get("source_kind") or DOCUMENT_SOURCE_KIND)
    folder_path = ""
    if source_kind == NOTE_SOURCE_KIND:
        folder_path = ""
    else:
        folder_path = "/".join(markdown_path.relative_to(current_user.markdown_dir).parts[:-1])

    return {
        "owner_uid": current_user.uid,
        "document_id": document_id,
        "source_kind": source_kind,
        "sha256": file_hash,
        "chunk_index": chunk_index,
        "original_name": original_name,
        "classification": str(ai_result.get("document_type") or ai_result.get("classification") or "outro"),
        "document_type": str(ai_result.get("document_type") or ai_result.get("classification") or "outro"),
        "domain": str(ai_result.get("domain") or "geral"),
        "suggested_name": suggested_name,
        "title": str(metadata.get("title") or Path(original_name).stem),
        "author": str(metadata.get("author") or ""),
        "date": str(metadata.get("date") or ""),
        "year": year,
        "technologies": json.dumps(technologies, ensure_ascii=False),
        "tags": json.dumps(normalize_string_list(metadata.get("tags")), ensure_ascii=False),
        "aliases": json.dumps(ai_result.get("aliases") or [], ensure_ascii=False),
        "entities": json.dumps(ai_result.get("entities") or [], ensure_ascii=False),
        "project": str(metadata.get("project") or ""),
        "summary": str(metadata.get("summary") or ""),
        "review_status": str(ai_result.get("review_status") or "auto_ok"),
        "folder_path": folder_path,
        "pdf_path": str(pdf_path),
        "markdown_path": str(markdown_path),
    }


def record_metadata_payload(record: dict[str, Any]) -> dict[str, Any]:
    hydrated = hydrate_manifest_record(record)
    return {
        "document_id": str(hydrated.get("document_id") or ""),
        "note_id": str(hydrated.get("note_id") or ""),
        "source_kind": str(hydrated.get("source_kind") or DOCUMENT_SOURCE_KIND),
        "title": str(hydrated.get("title") or ""),
        "original_name": str(hydrated.get("original_name") or ""),
        "suggested_name": str(hydrated.get("suggested_name") or ""),
        "classification": str(hydrated.get("classification") or ""),
        "document_type": str(hydrated.get("document_type") or ""),
        "domain": str(hydrated.get("domain") or ""),
        "author": str(hydrated.get("author") or ""),
        "year": str(hydrated.get("year") or ""),
        "project": str(hydrated.get("project") or ""),
        "folder_path": str(hydrated.get("folder_path") or ""),
        "created_at": str(hydrated.get("created_at") or hydrated.get("uploaded_at") or ""),
        "updated_at": str(hydrated.get("updated_at") or hydrated.get("processing_completed_at") or ""),
        "current_version": int(hydrated.get("current_version") or 0),
        "tags": json.dumps(hydrated.get("tags") or [], ensure_ascii=False),
        "aliases": json.dumps(hydrated.get("aliases") or [], ensure_ascii=False),
        "entities": json.dumps(hydrated.get("entities") or [], ensure_ascii=False),
        "review_status": str(hydrated.get("review_status") or ""),
        "summary": str(hydrated.get("summary") or ""),
        "markdown_path": str(hydrated.get("markdown_path") or ""),
        "pdf_path": str(hydrated.get("pdf_path") or ""),
    }


def manifest_search_result(record: dict[str, Any], score: float, *, snippet: str | None = None) -> SearchResult:
    metadata = record_metadata_payload(record)
    source_kind = str(record.get("source_kind") or DOCUMENT_SOURCE_KIND)
    default_snippet = str(record.get("summary") or record.get("suggested_name") or record.get("original_name") or "")[:800]
    return SearchResult(
        document_id=str(record.get("document_id") or ""),
        chunk_id=f"{record.get('document_id')}:manifest",
        score=score,
        snippet=(snippet or default_snippet)[:800],
        metadata=metadata,
        markdown_path=record.get("markdown_path"),
        pdf_path=record.get("pdf_path"),
        classification=record.get("classification"),
        suggested_name=record.get("suggested_name"),
        source_kind=source_kind,
    )


def build_note_search_snippet(content: str, terms: list[str]) -> str:
    clean_content = re.sub(r"\s+", " ", content).strip()
    if not clean_content:
        return ""
    lowered = clean_content.lower()
    for term in terms:
        if not term:
            continue
        position = lowered.find(term.lower())
        if position >= 0:
            start = max(0, position - 120)
            end = min(len(clean_content), position + 220)
            snippet = clean_content[start:end].strip()
            if start > 0:
                snippet = "..." + snippet
            if end < len(clean_content):
                snippet += "..."
            return snippet
    return clean_content[:320] + ("..." if len(clean_content) > 320 else "")


def metadata_search(
    current_user: AuthenticatedUserContext,
    query: str,
    limit: int = 5,
    lookup_intent: LookupIntent | None = None,
) -> list[SearchResult]:
    records = [hydrate_manifest_record(record) for record in read_manifest_records(current_user)]
    if not records:
        return []

    terms = list(lookup_intent.search_terms if lookup_intent else [])
    if lookup_intent and lookup_intent.title_or_filename:
        terms.append(lookup_intent.title_or_filename)
    terms.extend(tokenize_search_terms(query))
    normalized_terms = []
    for term in terms:
        normalized_terms.extend(tokenize_search_terms(term))
    normalized_terms = list(dict.fromkeys(normalized_terms))
    if not normalized_terms:
        return []

    results: list[tuple[float, dict[str, Any], str]] = []
    for record in records:
        source_kind = record_source_kind(record)
        title = normalize_search_text(str(record.get("title") or ""))
        original_name = normalize_search_text(str(record.get("original_name") or ""))
        suggested_name = normalize_search_text(str(record.get("suggested_name") or ""))
        aliases = normalize_search_text(" ".join(str(item) for item in record.get("aliases") or []))
        entities = normalize_search_text(" ".join(str(item) for item in record.get("entities") or []))
        project = normalize_search_text(str(record.get("project") or ""))
        domain = normalize_search_text(str(record.get("domain") or ""))
        folder_path = normalize_search_text(str(record.get("folder_path") or ""))
        classification = normalize_search_text(str(record.get("document_type") or record.get("classification") or ""))
        author = normalize_search_text(str(record.get("author") or ""))
        year = str(record.get("year") or "").strip()
        tags = " ".join(str(item) for item in record.get("tags") or [])
        tags_normalized = normalize_search_text(tags)
        summary = normalize_search_text(str(record.get("summary") or ""))
        review_status = str(record.get("review_status") or "")
        note_content_raw = str(record.get("content") or "") if source_kind == NOTE_SOURCE_KIND else ""
        note_content = normalize_search_text(note_content_raw)

        score = 0.0
        for term in normalized_terms:
            if term and term in original_name:
                score += 5.2
            if term and term in aliases:
                score += 4.9
            if term and term in suggested_name:
                score += 4.5
            if term and term in title:
                score += 4.0
            if term and term in author:
                score += 2.4
            if term and term in project:
                score += 2.8
            if term and term in domain:
                score += 2.7
            if term and term in folder_path:
                score += 2.2
            if term and term in entities:
                score += 2.1
            if term and term in tags_normalized:
                score += 1.8
            if term and term in classification:
                score += 1.9
            if term and term in summary:
                score += 1.0
            if term and term in note_content:
                score += 3.8

        if lookup_intent:
            if lookup_intent.classification:
                requested_classification = normalize_search_text(lookup_intent.classification)
                if requested_classification and requested_classification == classification:
                    score += 3.0
            if lookup_intent.year and lookup_intent.year == year:
                score += 3.0
            if lookup_intent.project:
                requested_project = normalize_search_text(lookup_intent.project)
                if requested_project and (requested_project in project or requested_project in domain):
                    score += 2.5
            if lookup_intent.folder_hint:
                requested_folder = normalize_search_text(lookup_intent.folder_hint)
                if requested_folder and requested_folder in folder_path:
                    score += 2.0

        if review_status == "auto_ok":
            score += 0.2
        elif review_status == "needs_review":
            score -= 0.15

        if score > 0:
            snippet = record.get("summary") or record.get("suggested_name") or record.get("original_name") or ""
            if source_kind == NOTE_SOURCE_KIND:
                snippet = build_note_search_snippet(note_content_raw, normalized_terms)
            results.append((score, record, str(snippet)))

    results.sort(key=lambda item: (item[0], str(item[1].get("updated_at") or item[1].get("uploaded_at") or "")), reverse=True)
    return [manifest_search_result(record, score, snippet=snippet) for score, record, snippet in results[:limit]]


def semantic_search(
    current_user: AuthenticatedUserContext,
    query: str,
    limit: int = 5,
) -> list[SearchResult]:
    try:
        collection = get_chroma_collection(current_user.collection_name)
        query_embedding = embed_texts([query])[0]
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=limit,
            include=["documents", "metadatas", "distances"],
        )
    except Exception as exc:
        print(f"Semantic search failed: {exc}")
        return []

    ids = results.get("ids", [[]])[0]
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    output: list[SearchResult] = []
    for index, chunk_id in enumerate(ids):
        metadata = dict(metadatas[index] or {})
        if str(metadata.get("owner_uid") or "") != current_user.uid:
            continue

        distance = distances[index] if index < len(distances) else None
        score = None if distance is None else max(0.0, 1.0 - float(distance))
        output.append(
            SearchResult(
                document_id=str(metadata.get("document_id") or ""),
                chunk_id=str(chunk_id),
                score=score,
                snippet=(documents[index] or "")[:800],
                metadata=metadata,
                markdown_path=metadata.get("markdown_path"),
                pdf_path=metadata.get("pdf_path"),
                classification=metadata.get("classification"),
                suggested_name=metadata.get("suggested_name"),
                source_kind=str(metadata.get("source_kind") or DOCUMENT_SOURCE_KIND),
            )
        )
    return output


def merge_search_results(
    result_groups: list[list[SearchResult]],
    *,
    limit: int,
    dedupe_by_document: bool = False,
) -> list[SearchResult]:
    merged: list[SearchResult] = []
    seen: set[str] = set()
    for group in result_groups:
        for result in group:
            key = result.document_id if dedupe_by_document else f"{result.document_id}:{result.chunk_id}"
            if key in seen:
                continue
            seen.add(key)
            merged.append(result)
            if len(merged) >= limit:
                return merged
    return merged


def hybrid_search(
    current_user: AuthenticatedUserContext,
    query: str,
    limit: int = 5,
) -> list[SearchResult]:
    metadata_results = metadata_search(current_user=current_user, query=query, limit=limit)
    semantic_results = semantic_search_with_timeout(current_user=current_user, query=query, limit=limit)
    return merge_search_results([metadata_results, semantic_results], limit=limit)


def semantic_search_with_timeout(
    current_user: AuthenticatedUserContext,
    query: str,
    limit: int = 5,
) -> list[SearchResult]:
    future = search_executor.submit(semantic_search, current_user, query, limit)
    try:
        return future.result(timeout=SEARCH_TIMEOUT_SECONDS)
    except FutureTimeoutError:
        logger.warning(
            "Semantic search timed out after %.1fs for user=%s query=%s",
            SEARCH_TIMEOUT_SECONDS,
            current_user.uid,
            query[:120],
        )
        return []
    except Exception as exc:
        logger.warning("Semantic search failed for user=%s: %s", current_user.uid, exc)
        return []


def extract_lookup_intent_with_groq(user_message: str) -> LookupIntent:
    if not GROQ_API_KEY:
        return LookupIntent()

    client = get_groq_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract document or note lookup intent for a private archive. "
                    "Return only valid JSON. Decide whether the user is asking for a specific file, document, PDF or note. "
                    "Use null for unknown singular fields and [] for missing term lists."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "user_message": user_message,
                        "required_json_schema": {
                            "is_specific_document_request": "boolean",
                            "search_terms": ["string"],
                            "title_or_filename": "string or null",
                            "classification": "string or null",
                            "year": "string or null",
                            "project": "string or null",
                            "folder_hint": "string or null",
                        },
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content or "{}"
    parsed = json.loads(raw)
    return LookupIntent(
        is_specific_document_request=bool(parsed.get("is_specific_document_request")),
        search_terms=normalize_string_list(parsed.get("search_terms")),
        title_or_filename=str(parsed.get("title_or_filename")).strip()
        if parsed.get("title_or_filename")
        else None,
        classification=str(parsed.get("classification")).strip() if parsed.get("classification") else None,
        year=str(parsed.get("year")).strip() if parsed.get("year") else None,
        project=str(parsed.get("project")).strip() if parsed.get("project") else None,
        folder_hint=str(parsed.get("folder_hint")).strip() if parsed.get("folder_hint") else None,
    )


def lookup_specific_documents_with_groq(
    current_user: AuthenticatedUserContext,
    user_message: str,
    limit: int = 5,
) -> list[SearchResult]:
    try:
        intent = extract_lookup_intent_with_groq(user_message)
    except Exception as exc:
        print(f"Groq lookup extraction failed, falling back to local metadata search: {exc}")
        intent = LookupIntent(
            is_specific_document_request=False,
            search_terms=tokenize_search_terms(user_message),
        )

    if not intent.is_specific_document_request and not intent.search_terms:
        return []

    return metadata_search(
        current_user=current_user,
        query=user_message,
        limit=limit,
        lookup_intent=intent,
    )


def should_use_document_context(
    user_message: str,
    persistent_history: list[dict[str, Any]] | None = None,
) -> bool:
    normalized = normalize_search_text(user_message)
    if not normalized:
        return False

    tokens = set(normalized.split("-"))
    document_terms = {
        "arquivo",
        "arquivos",
        "documento",
        "documentos",
        "nota",
        "notas",
        "anotacao",
        "anotacoes",
        "pdf",
        "pdfs",
        "acervo",
        "fonte",
        "fontes",
        "manifesto",
        "pasta",
        "pastas",
        "anexo",
        "anexos",
        "contrato",
        "contratos",
        "manual",
        "manuais",
        "lei",
        "leis",
        "nota",
        "notas",
        "relatorio",
        "relatorios",
        "base",
        "rag",
        "indexado",
        "indexados",
    }
    action_terms = {
        "procure",
        "procurar",
        "busque",
        "buscar",
        "pesquise",
        "pesquisar",
        "encontre",
        "encontrar",
        "localize",
        "localizar",
        "ache",
        "achar",
        "mostre",
        "mostrar",
        "liste",
        "listar",
        "resuma",
        "resumir",
        "resumo",
        "cite",
        "citar",
        "referencie",
        "referenciar",
        "compare",
        "comparar",
        "explique",
        "explicar",
        "detalhe",
        "detalhar",
    }
    follow_up_terms = {
        "isso",
        "esse",
        "essa",
        "desse",
        "dessa",
        "desse-arquivo",
        "desse-documento",
        "desse-pdf",
        "dele",
        "dela",
        "nele",
        "nela",
        "sobre-ele",
        "sobre-ela",
        "estes",
        "estas",
        "ele",
        "ela",
        "anterior",
        "acima",
        "continue",
        "continuar",
        "melhor",
        "detalhe",
        "detalhar",
        "explique",
        "explicar",
        "resuma",
        "resumir",
        "compare",
        "comparar",
        "conteudo",
        "fala",
        "diz",
        "trecho",
    }
    archive_phrases = (
        "no-meu-acervo",
        "nos-meus-arquivos",
        "nos-arquivos",
        "nos-documentos",
        "na-base",
        "na-minha-base",
        "na-pasta",
        "nas-pastas",
        "do-pdf",
        "do-documento",
        "do-arquivo",
        "da-nota",
        "nas-notas",
        "segundo-o",
        "com-base-no",
    )

    if tokens & document_terms:
        return True
    if (tokens & action_terms) and any(phrase in normalized for phrase in archive_phrases):
        return True
    if persistent_history and tokens & follow_up_terms and last_turn_has_references(persistent_history):
        return True
    return any(phrase in normalized for phrase in archive_phrases)


def last_turn_has_references(persistent_history: list[dict[str, Any]]) -> bool:
    for turn in reversed(persistent_history[-4:]):
        references = turn.get("references")
        if isinstance(references, list) and references:
            return True
    return False


def recent_turn_reference_results(persistent_history: list[dict[str, Any]], limit: int = 3) -> list[SearchResult]:
    output: list[SearchResult] = []
    seen_documents: set[str] = set()
    for turn in reversed(persistent_history[-4:]):
        focus_document = turn.get("focus_document")
        if isinstance(focus_document, dict):
            focus_result = search_result_from_saved_reference(focus_document, score=1.25)
            if focus_result and focus_result.document_id not in seen_documents:
                seen_documents.add(focus_result.document_id)
                output.append(focus_result)
                if len(output) >= limit:
                    return output
        references = turn.get("references")
        if not isinstance(references, list) or not references:
            continue
        for reference in references:
            result = search_result_from_saved_reference(reference, score=1.0)
            if result is None or result.document_id in seen_documents:
                continue
            seen_documents.add(result.document_id)
            output.append(result)
            if len(output) >= limit:
                return output
    return output


def search_result_from_saved_reference(reference: dict[str, Any], *, score: float) -> SearchResult | None:
    if not isinstance(reference, dict):
        return None
    document_id = str(reference.get("document_id") or "").strip()
    if not document_id:
        return None
    return SearchResult(
        document_id=document_id,
        chunk_id=str(reference.get("chunk_id") or f"recent-{document_id}"),
        score=score,
        snippet=str(reference.get("snippet") or ""),
        metadata={
            "title": reference.get("title") or reference.get("suggested_name") or "",
            "original_name": reference.get("original_name") or "",
            "source_kind": reference.get("source_kind") or DOCUMENT_SOURCE_KIND,
            "classification": reference.get("classification") or "",
            "document_type": reference.get("document_type") or reference.get("classification") or "",
            "domain": reference.get("domain") or "",
            "folder_path": reference.get("folder_path") or "",
            "chunk_index": reference.get("chunk_index") or "",
            "page": reference.get("page") or "",
            "aliases": json.dumps(reference.get("aliases") or [], ensure_ascii=False),
            "author": reference.get("author") or "",
            "updated_at": reference.get("updated_at") or "",
        },
        markdown_path=reference.get("markdown_path"),
        pdf_path=reference.get("pdf_path"),
        classification=reference.get("document_type") or reference.get("classification"),
        suggested_name=reference.get("suggested_name"),
        source_kind=str(reference.get("source_kind") or DOCUMENT_SOURCE_KIND),
    )


def build_contextual_search_query(user_message: str, persistent_history: list[dict[str, Any]]) -> str:
    clean_message = re.sub(r"\s+", " ", user_message).strip()
    if not clean_message:
        return user_message

    tokens = tokenize_search_terms(clean_message)
    if len(tokens) > 6 and not contains_follow_up_reference(clean_message):
        return clean_message

    prior_user_messages: list[str] = []
    referenced_titles: list[str] = []
    focus_labels: list[str] = []
    for turn in reversed(persistent_history[-4:]):
        user_text = re.sub(r"\s+", " ", str(turn.get("user") or "")).strip()
        if user_text:
            prior_user_messages.append(user_text[:240])
        focus_document = turn.get("focus_document")
        if isinstance(focus_document, dict):
            focus_label = str(
                focus_document.get("title")
                or focus_document.get("suggested_name")
                or focus_document.get("original_name")
                or ""
            ).strip()
            if focus_label and focus_label not in focus_labels:
                focus_labels.append(focus_label[:160])
        references = turn.get("references")
        if isinstance(references, list):
            for reference in references[:3]:
                if not isinstance(reference, dict):
                    continue
                title = str(reference.get("title") or reference.get("suggested_name") or "").strip()
                if title and title not in referenced_titles:
                    referenced_titles.append(title[:160])

    additions = focus_labels[:2] + prior_user_messages[:2] + referenced_titles[:3]
    if not additions:
        return clean_message
    return f"{clean_message}\nContexto recente para busca: " + " | ".join(additions)


def contains_follow_up_reference(user_message: str) -> bool:
    normalized = normalize_search_text(user_message)
    return any(
        phrase in normalized
        for phrase in (
            "isso",
            "esse",
            "essa",
            "desse",
            "dessa",
            "dele",
            "dela",
            "nele",
            "nela",
            "anterior",
            "acima",
            "continue",
            "melhor",
            "detalhe",
            "explique",
            "resuma",
            "fala",
            "conteudo",
            "diz",
        )
    )


def is_path_within(base: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False
    except FileNotFoundError:
        return False


def build_rag_context(current_user: AuthenticatedUserContext, references: list[SearchResult]) -> str:
    blocks: list[str] = []
    for index, reference in enumerate(references, start=1):
        source_kind = str(reference.source_kind or reference.metadata.get("source_kind") or DOCUMENT_SOURCE_KIND)
        title = reference.metadata.get("title") or reference.suggested_name or reference.document_id
        original_name = reference.metadata.get("original_name") or reference.suggested_name or ""
        classification = reference.metadata.get("document_type") or reference.classification or reference.metadata.get("classification") or ""
        domain = reference.metadata.get("domain") or ""
        author = reference.metadata.get("author") or ""
        year = reference.metadata.get("year") or ""
        score = f"{reference.score:.3f}" if isinstance(reference.score, float) else "metadata"
        markdown_path = reference.markdown_path
        source_text = reference.snippet
        if markdown_path:
            source_text = read_relevant_markdown(current_user, Path(markdown_path), reference.snippet)
        aliases = parse_reference_aliases(reference)
        blocks.append(
            "\n".join(
                [
                    f"[Fonte {index}] {title}",
                    f"Origem: {original_name}",
                    f"Tipo de item: {'nota' if source_kind == NOTE_SOURCE_KIND else 'documento'}",
                    f"Tipo: {classification}",
                    f"Autor: {author}" if author else "Autor: -",
                    f"Dominio: {domain}",
                    f"Ano: {year}",
                    f"Aliases: {' | '.join(aliases[:4])}" if aliases else "Aliases: -",
                    f"Score: {score}",
                    f"Trecho relevante:\n{source_text[:4000]}",
                ]
            )
        )
    return "\n\n".join(blocks)


def read_relevant_markdown(current_user: AuthenticatedUserContext, path: Path, fallback: str) -> str:
    try:
        if not path.exists() or not path.is_file():
            return fallback
        if not is_path_within(current_user.user_dir, path):
            return fallback
        text = path.read_text(encoding="utf-8")
        if not text:
            return fallback
        return extract_relevant_window(text, fallback, window=4000)
    except Exception:
        return fallback


def extract_relevant_window(text: str, fallback: str, *, window: int) -> str:
    clean_fallback = re.sub(r"\s+", " ", fallback or "").strip()
    if not clean_fallback:
        return text[:window]

    anchor = clean_fallback[:240]
    index = text.find(anchor)
    if index < 0:
        anchor_tokens = tokenize_search_terms(anchor)
        candidates = [token for token in anchor_tokens if len(token) >= 5][:8]
        scored_positions: list[tuple[int, int]] = []
        lowered = text.lower()
        for token in candidates:
            position = lowered.find(token.lower())
            if position >= 0:
                scored_positions.append((position, len(token)))
        if scored_positions:
            index = min(scored_positions, key=lambda item: item[0])[0]
        else:
            return fallback[:window] if fallback else text[:window]

    start = max(0, index - window // 3)
    end = min(len(text), start + window)
    start = max(0, end - window)
    return text[start:end].strip()


def build_chat_messages(
    request: ChatRequest,
    context: str,
    persistent_history: list[dict[str, Any]],
    searched_documents: bool,
) -> list[dict[str, str]]:
    system_prompt = (
        "Your name is Nexus. You are a precise, pragmatic and careful AI assistant for a private archive of documents and notes. "
        "Each authenticated user has a fully isolated workspace with isolated documents, notes and memory. "
        "DeepSeek organizes incoming files, while you help reason, locate the right document or note and answer quickly. "
        "Do not search or imply that you searched user files unless document context was supplied. "
        "For general questions, answer directly from reasoning and persistent memory. "
        "For archive questions, use only supplied context when citing documents or notes; if context was supplied, treat it as actual content or extracted excerpts available to you. "
        "Never say that you cannot access the file content when the context contains document excerpts or recovered markdown text. "
        "If the supplied context is insufficient, say exactly what is missing. "
        "When a document is clearly the current focus, keep answering about that same document until the user switches context. "
        "For file lookup requests, identify the best candidate first. For content requests, answer what the document says. "
        "When there are multiple plausible documents, say that briefly and ask for clarification instead of pretending one is certain. "
        "Before answering, identify the user's intent, separate facts from assumptions, and choose the shortest useful structure. "
        "When the task is complex, provide a direct answer first and then a small set of next steps or tradeoffs. "
        "When comparing or summarizing documents, synthesize across sources instead of copying long excerpts. "
        "For document answers, prefer: direct answer, then 1-3 short evidence bullets or cited facts from the supplied context. "
        "Prefer concise, actionable answers, ask a clarifying question when the request is ambiguous, and never invent references. "
        "Answer in the user's language and use persistent session memory to preserve user preferences and prior conclusions."
    )
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

    memory_summary = build_memory_summary(persistent_history)
    if memory_summary:
        messages.append({"role": "system", "content": f"Persistent session memory:\n{memory_summary}"})

    focus_document = get_current_focus_document(persistent_history)
    if focus_document:
        messages.append({"role": "system", "content": f"Current document in focus:\n{focus_document}"})

    for item in request.history[-10:]:
        messages.append({"role": item.role, "content": item.content})

    if searched_documents:
        context_block = context or "Busca em documentos e notas executada, mas nenhum item relevante foi encontrado."
    else:
        context_block = "Busca em documentos e notas nao executada porque a mensagem nao pediu itens do acervo."

    user_prompt = f"Contexto:\n{context_block}\n\nPergunta do usuario:\n{request.message}"
    messages.append({"role": "user", "content": user_prompt})
    return messages


def build_new_session_id() -> str:
    return f"chat-{uuid.uuid4().hex[:12]}"


def chat_sessions_index_path(current_user: AuthenticatedUserContext) -> Path:
    return current_user.memory_dir / "sessions.json"


def chat_sessions_data_dir(current_user: AuthenticatedUserContext) -> Path:
    return current_user.memory_dir / "sessions"


def legacy_session_memory_path(current_user: AuthenticatedUserContext, session_id: str) -> Path:
    return current_user.memory_dir / f"{session_id}.jsonl"


def session_memory_path(current_user: AuthenticatedUserContext, session_id: str) -> Path:
    return chat_sessions_data_dir(current_user) / f"{session_id}.jsonl"


def read_chat_sessions_index(current_user: AuthenticatedUserContext) -> list[dict[str, Any]]:
    path = chat_sessions_index_path(current_user)
    sessions: list[dict[str, Any]] = []
    if not path.exists():
        sessions = []
    else:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = []
        if isinstance(payload, list):
            sessions = [item for item in payload if isinstance(item, dict) and item.get("session_id")]

    known_ids = {str(item.get("session_id") or "").strip() for item in sessions}
    discovered = discover_chat_sessions_from_storage(current_user)
    changed = False
    for session in discovered:
        session_id = str(session.get("session_id") or "").strip()
        if session_id and session_id not in known_ids:
            sessions.append(session)
            known_ids.add(session_id)
            changed = True
    sessions.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    if changed:
        write_chat_sessions_index(current_user, sessions)
    return sessions


def write_chat_sessions_index(current_user: AuthenticatedUserContext, sessions: list[dict[str, Any]]) -> None:
    ensure_user_storage(current_user)
    chat_sessions_data_dir(current_user).mkdir(parents=True, exist_ok=True)
    chat_sessions_index_path(current_user).write_text(
        json.dumps(sessions, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def discover_chat_sessions_from_storage(current_user: AuthenticatedUserContext) -> list[dict[str, Any]]:
    candidates: list[tuple[str, Path]] = []
    for base_path in (chat_sessions_data_dir(current_user), current_user.memory_dir):
        if not base_path.exists():
            continue
        for file_path in base_path.glob("*.jsonl"):
            candidates.append((file_path.stem, file_path))

    discovered: list[dict[str, Any]] = []
    for session_id, file_path in candidates:
        clean_session_id = safe_session_id(session_id)
        messages = parse_persisted_messages(file_path)
        if not messages:
            continue
        first_timestamp = str(messages[0].get("timestamp") or datetime.now(UTC).isoformat())
        last_timestamp = str(messages[-1].get("timestamp") or first_timestamp)
        user_messages = [message for message in messages if message.get("role") == "user"]
        discovered.append(
            {
                "session_id": clean_session_id,
                "title": infer_chat_title(str(user_messages[0].get("content") or "")) if user_messages else "Novo chat",
                "created_at": first_timestamp,
                "updated_at": last_timestamp,
                "turn_count": len([message for message in messages if message.get("role") == "assistant"]),
                "message_count": len(messages),
                "last_message_preview": message_preview(messages),
            }
        )
    return discovered


def infer_chat_title(message: str) -> str:
    cleaned = re.sub(r"\s+", " ", message).strip()
    if not cleaned:
        return "Novo chat"
    title = cleaned[:72].strip()
    if len(cleaned) > 72:
        title = title.rstrip(" .,;:!?") + "..."
    return title or "Novo chat"


def message_preview(messages: list[dict[str, Any]]) -> str:
    if not messages:
        return ""
    content = str(messages[-1].get("content") or "").strip()
    if len(content) <= 120:
        return content
    return content[:117].rstrip() + "..."


def get_chat_session_summary(
    current_user: AuthenticatedUserContext,
    session_id: str,
) -> dict[str, Any] | None:
    for session in read_chat_sessions_index(current_user):
        if str(session.get("session_id") or "").strip() == session_id:
            return session
    return None


def ensure_chat_session_summary(
    current_user: AuthenticatedUserContext,
    session_id: str,
    *,
    title: str | None = None,
    messages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    ensure_user_storage(current_user)
    sessions = read_chat_sessions_index(current_user)
    existing = None
    for session in sessions:
        if str(session.get("session_id") or "").strip() == session_id:
            existing = dict(session)
            break

    now = datetime.now(UTC).isoformat()
    effective_messages = messages if messages is not None else load_chat_messages(current_user, session_id)
    summary = existing or {
        "session_id": session_id,
        "title": "Novo chat",
        "created_at": now,
        "updated_at": now,
        "turn_count": 0,
        "message_count": 0,
        "last_message_preview": "",
    }
    if title:
        summary["title"] = title[:120]
    elif not summary.get("title"):
        summary["title"] = "Novo chat"

    summary["updated_at"] = now if existing else summary["updated_at"]
    summary["turn_count"] = len([message for message in effective_messages if message.get("role") == "assistant"])
    summary["message_count"] = len(effective_messages)
    summary["last_message_preview"] = message_preview(effective_messages)

    next_sessions = [
        session for session in sessions if str(session.get("session_id") or "").strip() != session_id
    ]
    next_sessions.append(summary)
    next_sessions.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    write_chat_sessions_index(current_user, next_sessions)
    return summary


def create_or_update_chat_session(
    current_user: AuthenticatedUserContext,
    session_id: str,
    *,
    title: str | None = None,
) -> dict[str, Any]:
    clean_session_id = safe_session_id(session_id)
    return ensure_chat_session_summary(current_user, clean_session_id, title=title)


def delete_chat_session_storage(current_user: AuthenticatedUserContext, session_id: str) -> None:
    clean_session_id = safe_session_id(session_id)
    session_memory_path(current_user, clean_session_id).unlink(missing_ok=True)
    legacy_session_memory_path(current_user, clean_session_id).unlink(missing_ok=True)
    next_sessions = [
        session
        for session in read_chat_sessions_index(current_user)
        if str(session.get("session_id") or "").strip() != clean_session_id
    ]
    write_chat_sessions_index(current_user, next_sessions)


def parse_persisted_messages(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    messages: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as input_file:
        for line in input_file:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue

            timestamp = str(payload.get("timestamp") or datetime.now(UTC).isoformat())
            if payload.get("role") in {"user", "assistant"} and payload.get("content"):
                messages.append(
                    {
                        "role": str(payload["role"]),
                        "content": str(payload["content"]),
                        "timestamp": timestamp,
                        "references": payload.get("references") if isinstance(payload.get("references"), list) else [],
                        "focus_document": payload.get("focus_document") if isinstance(payload.get("focus_document"), dict) else None,
                    }
                )
                continue

            user_content = str(payload.get("user") or "").strip()
            assistant_content = str(payload.get("assistant") or "").strip()
            references = payload.get("references") if isinstance(payload.get("references"), list) else []
            focus_document = payload.get("focus_document") if isinstance(payload.get("focus_document"), dict) else None
            if user_content:
                messages.append(
                    {
                        "role": "user",
                        "content": user_content,
                        "timestamp": timestamp,
                        "references": [],
                    }
                )
            if assistant_content:
                messages.append(
                    {
                        "role": "assistant",
                        "content": assistant_content,
                        "timestamp": timestamp,
                        "references": references,
                        "focus_document": focus_document,
                    }
                )
    return messages


def load_chat_messages(
    current_user: AuthenticatedUserContext,
    session_id: str,
) -> list[dict[str, Any]]:
    path = session_memory_path(current_user, session_id)
    if path.exists():
        return parse_persisted_messages(path)

    legacy_path = legacy_session_memory_path(current_user, session_id)
    if not legacy_path.exists():
        return []

    messages = parse_persisted_messages(legacy_path)
    if messages:
        chat_sessions_data_dir(current_user).mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as output:
            for message in messages:
                output.write(json.dumps(message, ensure_ascii=False) + "\n")
        legacy_path.unlink(missing_ok=True)
    return messages


def load_session_memory(
    current_user: AuthenticatedUserContext,
    session_id: str,
) -> list[dict[str, Any]]:
    messages = load_chat_messages(current_user, session_id)
    turns: list[dict[str, Any]] = []
    pending_user = ""
    pending_timestamp = ""
    for message in messages:
        role = str(message.get("role") or "")
        if role == "user":
            pending_user = str(message.get("content") or "")
            pending_timestamp = str(message.get("timestamp") or "")
            continue
        if role == "assistant":
            turns.append(
                {
                    "timestamp": str(message.get("timestamp") or pending_timestamp or datetime.now(UTC).isoformat()),
                    "user": pending_user,
                    "assistant": str(message.get("content") or ""),
                    "references": message.get("references") if isinstance(message.get("references"), list) else [],
                    "focus_document": message.get("focus_document") if isinstance(message.get("focus_document"), dict) else None,
                }
            )
            pending_user = ""
            pending_timestamp = ""
    return turns[-CHAT_MEMORY_TURNS:]


def save_session_turn(
    current_user: AuthenticatedUserContext,
    session_id: str,
    user_message: str,
    assistant_message: str,
    references: list[SearchResult],
) -> None:
    ensure_user_storage(current_user)
    clean_session_id = safe_session_id(session_id)
    now = datetime.now(UTC).isoformat()
    focus_reference = choose_focus_reference(user_message, references, persistent_history=load_session_memory(current_user, clean_session_id))
    serialized_references = [
        {
            "document_id": reference.document_id,
            "source_kind": reference.source_kind,
            "title": reference.metadata.get("title") or reference.suggested_name,
            "original_name": reference.metadata.get("original_name") or "",
            "markdown_path": reference.markdown_path,
            "pdf_path": reference.pdf_path,
            "folder_path": reference.metadata.get("folder_path") or "",
            "classification": reference.classification,
            "document_type": reference.metadata.get("document_type") or reference.classification,
            "domain": reference.metadata.get("domain") or "",
            "author": reference.metadata.get("author") or "",
            "updated_at": reference.metadata.get("updated_at") or "",
            "suggested_name": reference.suggested_name,
            "chunk_id": reference.chunk_id,
            "chunk_index": reference.metadata.get("chunk_index"),
            "page": reference.metadata.get("page"),
            "snippet": reference.snippet,
            "aliases": parse_reference_aliases(reference),
        }
        for reference in references
    ]
    chat_sessions_data_dir(current_user).mkdir(parents=True, exist_ok=True)
    with session_memory_path(current_user, clean_session_id).open("a", encoding="utf-8") as output:
        output.write(
            json.dumps(
                {
                    "role": "user",
                    "content": user_message,
                    "timestamp": now,
                    "references": [],
                },
                ensure_ascii=False,
            )
            + "\n"
        )
        output.write(
            json.dumps(
                {
                    "role": "assistant",
                    "content": assistant_message,
                    "timestamp": now,
                    "references": serialized_references,
                    "focus_document": focus_reference,
                },
                ensure_ascii=False,
            )
            + "\n"
        )

    summary = get_chat_session_summary(current_user, clean_session_id)
    current_title = str(summary.get("title") or "").strip() if summary else ""
    ensure_chat_session_summary(
        current_user,
        clean_session_id,
        title=infer_chat_title(user_message) if not current_title or current_title.lower() == "novo chat" else current_title,
        messages=load_chat_messages(current_user, clean_session_id),
    )


def build_memory_summary(turns: list[dict[str, Any]]) -> str:
    if not turns:
        return ""
    snippets: list[str] = []
    for turn in turns[-8:]:
        user_message = str(turn.get("user") or "")[:500]
        assistant_message = str(turn.get("assistant") or "")[:700]
        reference_summary = summarize_turn_references(turn)
        focus_summary = summarize_focus_document(turn)
        if user_message or assistant_message:
            block = f"User: {user_message}\nAssistant: {assistant_message}"
            if reference_summary:
                block += f"\nReferences used: {reference_summary}"
            if focus_summary:
                block += f"\nCurrent focus: {focus_summary}"
            snippets.append(block)
    return "\n\n".join(snippets)


def summarize_turn_references(turn: dict[str, Any]) -> str:
    references = turn.get("references")
    if not isinstance(references, list) or not references:
        return ""
    labels: list[str] = []
    for reference in references[:4]:
        if not isinstance(reference, dict):
            continue
        label = str(reference.get("title") or reference.get("suggested_name") or reference.get("document_id") or "").strip()
        if label:
            labels.append(label[:140])
    return " | ".join(labels)


def summarize_focus_document(turn: dict[str, Any]) -> str:
    focus_document = turn.get("focus_document")
    if not isinstance(focus_document, dict):
        return ""
    return str(
        focus_document.get("title")
        or focus_document.get("suggested_name")
        or focus_document.get("original_name")
        or focus_document.get("document_id")
        or ""
    ).strip()[:180]


def get_current_focus_document(turns: list[dict[str, Any]]) -> str:
    for turn in reversed(turns[-4:]):
        summary = summarize_focus_document(turn)
        if summary:
            return summary
    return ""


def parse_reference_aliases(reference: SearchResult) -> list[str]:
    aliases = reference.metadata.get("aliases")
    if isinstance(aliases, list):
        return dedupe_text_list([str(item) for item in aliases], limit=8)
    if isinstance(aliases, str):
        try:
            parsed = json.loads(aliases)
        except json.JSONDecodeError:
            parsed = []
        if isinstance(parsed, list):
            return dedupe_text_list([str(item) for item in parsed], limit=8)
    return []


def choose_focus_reference(
    user_message: str,
    references: list[SearchResult],
    *,
    persistent_history: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not references:
        return None

    search_terms = tokenize_search_terms(user_message)
    prior_focus_label = get_current_focus_document(persistent_history)
    best_score = float("-inf")
    best_reference = references[0]
    for index, reference in enumerate(references):
        candidates = [
            str(reference.metadata.get("title") or ""),
            str(reference.metadata.get("original_name") or ""),
            str(reference.suggested_name or ""),
            *parse_reference_aliases(reference),
        ]
        normalized = normalize_search_text(" ".join(candidates))
        score = float(reference.score or 0) - (index * 0.05)
        for term in search_terms:
            if term and term in normalized:
                score += 0.8
        if prior_focus_label and normalize_search_text(prior_focus_label) in normalized:
            score += 0.6
        if score > best_score:
            best_score = score
            best_reference = reference

    return {
        "document_id": best_reference.document_id,
        "title": best_reference.metadata.get("title") or best_reference.suggested_name,
        "original_name": best_reference.metadata.get("original_name") or "",
        "markdown_path": best_reference.markdown_path,
        "pdf_path": best_reference.pdf_path,
        "folder_path": best_reference.metadata.get("folder_path") or "",
        "classification": best_reference.classification,
        "document_type": best_reference.metadata.get("document_type") or best_reference.classification,
        "domain": best_reference.metadata.get("domain") or "",
        "suggested_name": best_reference.suggested_name,
        "chunk_id": best_reference.chunk_id,
        "chunk_index": best_reference.metadata.get("chunk_index"),
        "page": best_reference.metadata.get("page"),
        "snippet": best_reference.snippet,
        "aliases": parse_reference_aliases(best_reference),
    }
