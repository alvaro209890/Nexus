from __future__ import annotations

import json
import logging
import multiprocessing
import os
import re
import shutil
import time
import uuid
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
    manifest_path: Path
    memory_dir: Path
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


class DocumentRecord(BaseModel):
    document_id: str
    sha256: str
    original_name: str
    classification: str
    suggested_name: str
    title: str
    author: str | None = None
    date: str | None = None
    year: str
    technologies: list[str] = Field(default_factory=list)
    summary: str = ""
    folder_path: str = ""
    tags: list[str] = Field(default_factory=list)
    project: str | None = None
    pdf_path: str
    markdown_path: str
    chunks_indexed: int
    uploaded_at: str
    size_bytes: int | None = None


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
    manifest_path: str
    memory_dir: str
    collection_name: str


class LookupIntent(BaseModel):
    is_specific_document_request: bool = False
    search_terms: list[str] = Field(default_factory=list)
    title_or_filename: str | None = None
    classification: str | None = None
    year: str | None = None
    project: str | None = None
    folder_hint: str | None = None


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
    if not is_pdf_upload(file):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    ensure_user_storage(current_user)

    document_id = str(uuid.uuid4())
    original_name = safe_filename(file.filename or "document.pdf")
    staging_path = current_user.originals_dir / f".upload-{document_id}.pdf"
    pdf_path: Path | None = None
    markdown_path: Path | None = None

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

    try:
        markdown_text = extract_pdf_markdown(staging_path)
        if not markdown_text.strip():
            raise HTTPException(status_code=422, detail="Could not extract text from PDF.")

        ai_result = analyze_document_with_deepseek(markdown_text, original_name)
        file_plan = build_file_plan(current_user, ai_result, original_name, document_id)

        file_plan["pdf_dir"].mkdir(parents=True, exist_ok=True)
        file_plan["markdown_dir"].mkdir(parents=True, exist_ok=True)

        pdf_path = ensure_unique_path(file_plan["pdf_path"])
        markdown_path = ensure_unique_path(file_plan["markdown_path"])
        staging_path.replace(pdf_path)
        markdown_path.write_text(markdown_text, encoding="utf-8")

        chunks = split_text(markdown_text)
        if not chunks:
            raise HTTPException(status_code=422, detail="Could not build semantic chunks from this PDF.")

        embeddings = embed_texts(chunks)
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
            for index, _ in enumerate(chunks)
        ]
        ids = [f"{document_id}:{index}" for index in range(len(chunks))]

        collection = get_chroma_collection(current_user.collection_name)
        collection.add(ids=ids, documents=chunks, embeddings=embeddings, metadatas=metadatas)

        record = build_document_record(
            document_id=document_id,
            file_hash=file_hash,
            original_name=original_name,
            ai_result=ai_result,
            file_plan=file_plan,
            pdf_path=pdf_path,
            markdown_path=markdown_path,
            chunks_indexed=len(chunks),
        )
        append_manifest_record(current_user, record)

        logger.info(
            "Upload indexed successfully for user=%s document_id=%s chunks=%s provider=%s pdf=%s",
            current_user.uid,
            document_id,
            len(chunks),
            ai_result.get("provider", "heuristic"),
            pdf_path,
        )

        return {
            **record,
            "duplicate": False,
            "metadata": ai_result.get("metadata", {}),
            "classification_provider": ai_result.get("provider", "heuristic"),
        }
    except HTTPException:
        cleanup_failed_upload(staging_path=staging_path, pdf_path=pdf_path, markdown_path=markdown_path)
        logger.exception(
            "Upload failed for user=%s document_id=%s filename=%s",
            current_user.uid,
            document_id,
            original_name,
        )
        raise
    except Exception as exc:
        cleanup_failed_upload(staging_path=staging_path, pdf_path=pdf_path, markdown_path=markdown_path)
        logger.exception(
            "Unexpected upload failure for user=%s document_id=%s filename=%s",
            current_user.uid,
            document_id,
            original_name,
        )
        raise HTTPException(status_code=500, detail=f"Failed to process PDF upload: {exc}") from exc


@app.get("/documents", response_model=list[DocumentRecord])
async def list_documents(
    limit: int = Query(default=50, ge=1, le=500),
    current_user: AuthenticatedUserContext = Depends(require_authenticated_user),
) -> list[DocumentRecord]:
    records = read_manifest_records(current_user)
    visible_records = [hydrate_document_record(record) for record in records[-limit:]][::-1]
    return [DocumentRecord(**record) for record in visible_records]


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

    should_search_documents = should_use_document_context(request.message)
    references: list[SearchResult] = []
    if should_search_documents:
        lookup_references = lookup_specific_documents_with_groq(
            current_user=current_user,
            user_message=request.message,
            limit=request.limit,
        )
        semantic_references = semantic_search(current_user=current_user, query=request.message, limit=request.limit)
        references = merge_search_results(
            [lookup_references, semantic_references],
            limit=request.limit,
            dedupe_by_document=True,
        )

    context = build_rag_context(current_user, references)
    session_id = safe_session_id(request.session_id)
    persistent_history = load_session_memory(current_user, session_id)
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
        manifest_path=user_dir / "manifest.jsonl",
        memory_dir=user_dir / "memory",
        collection_name=collection_name_for_user(uid),
    )


def ensure_user_storage(current_user: AuthenticatedUserContext) -> None:
    for directory in (
        current_user.user_dir,
        current_user.originals_dir,
        current_user.markdown_dir,
        current_user.memory_dir,
        chat_sessions_data_dir(current_user),
    ):
        directory.mkdir(parents=True, exist_ok=True)
    current_user.manifest_path.touch(exist_ok=True)


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
        "manifest_path": str(current_user.manifest_path),
        "memory_dir": str(current_user.memory_dir),
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

    return {
        "classification": str(parsed.get("classification") or "outro"),
        "suggested_name": str(parsed.get("suggested_name") or original_name),
        "folder_path": str(parsed.get("folder_path") or ""),
        "metadata": {
            "title": metadata.get("title") or Path(original_name).stem,
            "author": metadata.get("author"),
            "date": metadata.get("date"),
            "project": metadata.get("project"),
            "technologies": [str(item) for item in technologies if str(item).strip()],
            "tags": normalize_string_list(metadata.get("tags")),
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
    classification = safe_slug(str(ai_result.get("classification") or "outro"), "outro")
    title = str(metadata.get("title") or Path(original_name).stem)
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

    folder_parts = resolve_folder_parts(ai_result, classification, year)
    relative_folder = "/".join(folder_parts)
    pdf_dir = current_user.originals_dir.joinpath(*folder_parts)
    markdown_dir = current_user.markdown_dir.joinpath(*folder_parts)

    return {
        "classification": classification,
        "title": title,
        "year": year,
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


def resolve_folder_parts(ai_result: dict[str, Any], classification: str, year: str) -> list[str]:
    metadata = ai_result.get("metadata", {})
    requested_path = str(ai_result.get("folder_path") or "")
    parts = sanitize_relative_folder(requested_path)
    if parts:
        return parts

    project = safe_slug(str(metadata.get("project") or ""), "")
    technologies = normalize_string_list(metadata.get("technologies"))
    area = safe_slug(technologies[0], "") if technologies else ""
    fallback_parts = [part for part in [area, project, year, classification] if part]
    return fallback_parts or [classification, year]


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


def ensure_unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 10000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise HTTPException(status_code=500, detail=f"Could not create unique path for {path.name}.")


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
        "sha256": file_hash,
        "original_name": original_name,
        "classification": file_plan["classification"],
        "suggested_name": file_plan["suggested_name"],
        "title": str(metadata.get("title") or file_plan["title"]),
        "author": metadata.get("author"),
        "date": metadata.get("date"),
        "year": file_plan["year"],
        "technologies": [str(item) for item in technologies if str(item).strip()],
        "tags": normalize_string_list(metadata.get("tags")),
        "project": metadata.get("project"),
        "summary": str(metadata.get("summary") or ""),
        "folder_path": file_plan["folder_path"],
        "pdf_path": str(pdf_path),
        "markdown_path": str(markdown_path),
        "chunks_indexed": chunks_indexed,
        "uploaded_at": datetime.now(UTC).isoformat(),
        "size_bytes": pdf_path.stat().st_size if pdf_path.exists() else None,
    }


def append_manifest_record(current_user: AuthenticatedUserContext, record: dict[str, Any]) -> None:
    ensure_user_storage(current_user)
    with current_user.manifest_path.open("a", encoding="utf-8") as output:
        output.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_manifest_records(current_user: AuthenticatedUserContext) -> list[dict[str, Any]]:
    if not current_user.manifest_path.exists():
        return []
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
    return records


def hydrate_document_record(record: dict[str, Any]) -> dict[str, Any]:
    hydrated = dict(record)
    if hydrated.get("size_bytes") is None:
        pdf_path_value = str(hydrated.get("pdf_path") or "").strip()
        if pdf_path_value:
            pdf_path = Path(pdf_path_value)
            if pdf_path.exists() and pdf_path.is_file():
                hydrated["size_bytes"] = pdf_path.stat().st_size
    return hydrated


def find_document_by_hash(current_user: AuthenticatedUserContext, file_hash: str) -> dict[str, Any] | None:
    for record in reversed(read_manifest_records(current_user)):
        if record.get("sha256") == file_hash:
            return record
    return None


def find_document_by_id(current_user: AuthenticatedUserContext, document_id: str) -> dict[str, Any] | None:
    clean_id = document_id.strip()
    if not clean_id:
        return None
    for record in reversed(read_manifest_records(current_user)):
        if str(record.get("document_id") or "").strip() == clean_id:
            return record
    return None


def fallback_document_analysis(markdown_text: str, original_name: str) -> dict[str, Any]:
    title = first_heading(markdown_text) or Path(original_name).stem
    year_match = re.search(r"\b(19|20)\d{2}\b", markdown_text[:3000])
    year = year_match.group(0) if year_match else "0000"
    return {
        "classification": "outro",
        "suggested_name": f"[{year}] Documento - {title}.md",
        "folder_path": "",
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

    return {
        "owner_uid": current_user.uid,
        "document_id": document_id,
        "sha256": file_hash,
        "chunk_index": chunk_index,
        "original_name": original_name,
        "classification": str(ai_result.get("classification") or "outro"),
        "suggested_name": suggested_name,
        "title": str(metadata.get("title") or Path(original_name).stem),
        "author": str(metadata.get("author") or ""),
        "date": str(metadata.get("date") or ""),
        "year": year,
        "technologies": json.dumps(technologies, ensure_ascii=False),
        "tags": json.dumps(normalize_string_list(metadata.get("tags")), ensure_ascii=False),
        "project": str(metadata.get("project") or ""),
        "summary": str(metadata.get("summary") or ""),
        "folder_path": "/".join(markdown_path.relative_to(current_user.markdown_dir).parts[:-1]),
        "pdf_path": str(pdf_path),
        "markdown_path": str(markdown_path),
    }


def record_metadata_payload(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "document_id": str(record.get("document_id") or ""),
        "title": str(record.get("title") or ""),
        "original_name": str(record.get("original_name") or ""),
        "suggested_name": str(record.get("suggested_name") or ""),
        "classification": str(record.get("classification") or ""),
        "year": str(record.get("year") or ""),
        "project": str(record.get("project") or ""),
        "folder_path": str(record.get("folder_path") or ""),
        "tags": json.dumps(record.get("tags") or [], ensure_ascii=False),
        "summary": str(record.get("summary") or ""),
        "markdown_path": str(record.get("markdown_path") or ""),
        "pdf_path": str(record.get("pdf_path") or ""),
    }


def manifest_search_result(record: dict[str, Any], score: float) -> SearchResult:
    metadata = record_metadata_payload(record)
    return SearchResult(
        document_id=str(record.get("document_id") or ""),
        chunk_id=f"{record.get('document_id')}:manifest",
        score=score,
        snippet=str(record.get("summary") or record.get("suggested_name") or record.get("original_name") or "")[:800],
        metadata=metadata,
        markdown_path=record.get("markdown_path"),
        pdf_path=record.get("pdf_path"),
        classification=record.get("classification"),
        suggested_name=record.get("suggested_name"),
    )


def metadata_search(
    current_user: AuthenticatedUserContext,
    query: str,
    limit: int = 5,
    lookup_intent: LookupIntent | None = None,
) -> list[SearchResult]:
    records = read_manifest_records(current_user)
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

    results: list[tuple[float, dict[str, Any]]] = []
    for record in records:
        title = normalize_search_text(str(record.get("title") or ""))
        original_name = normalize_search_text(str(record.get("original_name") or ""))
        suggested_name = normalize_search_text(str(record.get("suggested_name") or ""))
        project = normalize_search_text(str(record.get("project") or ""))
        folder_path = normalize_search_text(str(record.get("folder_path") or ""))
        classification = normalize_search_text(str(record.get("classification") or ""))
        year = str(record.get("year") or "").strip()
        tags = " ".join(str(item) for item in record.get("tags") or [])
        tags_normalized = normalize_search_text(tags)
        summary = normalize_search_text(str(record.get("summary") or ""))

        score = 0.0
        for term in normalized_terms:
            if term and term in original_name:
                score += 5.0
            if term and term in suggested_name:
                score += 4.5
            if term and term in title:
                score += 4.0
            if term and term in project:
                score += 2.5
            if term and term in folder_path:
                score += 2.0
            if term and term in tags_normalized:
                score += 1.8
            if term and term in classification:
                score += 1.5
            if term and term in summary:
                score += 1.0

        if lookup_intent:
            if lookup_intent.classification:
                requested_classification = normalize_search_text(lookup_intent.classification)
                if requested_classification and requested_classification == classification:
                    score += 3.0
            if lookup_intent.year and lookup_intent.year == year:
                score += 3.0
            if lookup_intent.project:
                requested_project = normalize_search_text(lookup_intent.project)
                if requested_project and requested_project in project:
                    score += 2.5
            if lookup_intent.folder_hint:
                requested_folder = normalize_search_text(lookup_intent.folder_hint)
                if requested_folder and requested_folder in folder_path:
                    score += 2.0

        if score > 0:
            results.append((score, record))

    results.sort(key=lambda item: (item[0], str(item[1].get("uploaded_at") or "")), reverse=True)
    return [manifest_search_result(record, score) for score, record in results[:limit]]


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
    semantic_results = semantic_search(current_user=current_user, query=query, limit=limit)
    return merge_search_results([metadata_results, semantic_results], limit=limit)


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
                    "You extract document lookup intent for a private document archive. "
                    "Return only valid JSON. Decide whether the user is asking for a specific file/document/PDF. "
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


def should_use_document_context(user_message: str) -> bool:
    normalized = normalize_search_text(user_message)
    if not normalized:
        return False

    tokens = set(normalized.split("-"))
    document_terms = {
        "arquivo",
        "arquivos",
        "documento",
        "documentos",
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
        "segundo-o",
        "com-base-no",
    )

    if tokens & document_terms:
        return True
    if (tokens & action_terms) and any(phrase in normalized for phrase in archive_phrases):
        return True
    return any(phrase in normalized for phrase in archive_phrases)


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
        title = reference.metadata.get("title") or reference.suggested_name or reference.document_id
        markdown_path = reference.markdown_path
        source_text = reference.snippet
        if markdown_path:
            source_text = read_relevant_markdown(current_user, Path(markdown_path), reference.snippet)
        blocks.append(f"[Fonte {index}] {title}\n{source_text[:4000]}")
    return "\n\n".join(blocks)


def read_relevant_markdown(current_user: AuthenticatedUserContext, path: Path, fallback: str) -> str:
    try:
        if not path.exists() or not path.is_file():
            return fallback
        if not is_path_within(current_user.user_dir, path):
            return fallback
        text = path.read_text(encoding="utf-8")
        return text[:4000] if text else fallback
    except Exception:
        return fallback


def build_chat_messages(
    request: ChatRequest,
    context: str,
    persistent_history: list[dict[str, Any]],
    searched_documents: bool,
) -> list[dict[str, str]]:
    system_prompt = (
        "Your name is Nexus. You are a precise, pragmatic and careful AI assistant for a private document archive. "
        "Each authenticated user has a fully isolated workspace with isolated documents and memory. "
        "DeepSeek organizes incoming files, while you help reason, locate the right document and answer quickly. "
        "Do not search or imply that you searched user files unless document context was supplied. "
        "For general questions, answer directly from reasoning and persistent memory. "
        "For document questions, use only supplied context when citing documents; if it is insufficient, say what is missing. "
        "Prefer concise, actionable answers, ask a clarifying question when the request is ambiguous, and never invent references. "
        "Answer in the user's language and use persistent session memory to preserve user preferences and prior conclusions."
    )
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

    memory_summary = build_memory_summary(persistent_history)
    if memory_summary:
        messages.append({"role": "system", "content": f"Persistent session memory:\n{memory_summary}"})

    for item in request.history[-10:]:
        messages.append({"role": item.role, "content": item.content})

    if searched_documents:
        context_block = context or "Busca em documentos executada, mas nenhum documento relevante foi encontrado."
    else:
        context_block = "Busca em documentos nao executada porque a mensagem nao pediu arquivos ou acervo."

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
                    }
                )
                continue

            user_content = str(payload.get("user") or "").strip()
            assistant_content = str(payload.get("assistant") or "").strip()
            references = payload.get("references") if isinstance(payload.get("references"), list) else []
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
    serialized_references = [
        {
            "document_id": reference.document_id,
            "title": reference.metadata.get("title") or reference.suggested_name,
            "markdown_path": reference.markdown_path,
            "pdf_path": reference.pdf_path,
            "classification": reference.classification,
            "suggested_name": reference.suggested_name,
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
        if user_message or assistant_message:
            snippets.append(f"User: {user_message}\nAssistant: {assistant_message}")
    return "\n\n".join(snippets)
