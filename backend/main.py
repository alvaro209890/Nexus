from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="Nexus API", version="0.1.0")

DOCUMENTS_DIR = Path(os.getenv("DOCUMENTS_DIR", "~/Downloads/BD_NEXUS")).expanduser()
ORIGINALS_DIR = DOCUMENTS_DIR / "originals"
MARKDOWN_DIR = DOCUMENTS_DIR / "markdown"
MANIFEST_PATH = DOCUMENTS_DIR / "manifest.jsonl"
MEMORY_DIR = DOCUMENTS_DIR / "memory"
for directory in (DOCUMENTS_DIR, ORIGINALS_DIR, MARKDOWN_DIR, MEMORY_DIR):
    directory.mkdir(parents=True, exist_ok=True)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
CHROMA_HOST = os.getenv("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8001"))
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "nexus_documents")
EMBEDDING_MODEL_NAME = os.getenv(
    "EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
MAX_GROQ_CHARS = int(os.getenv("MAX_GROQ_CHARS", "18000"))
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "3000"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "300"))
CHAT_MEMORY_TURNS = int(os.getenv("CHAT_MEMORY_TURNS", "20"))

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "https://nexus.web.app",
    "https://nexus.firebaseapp.com",
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
chroma_collection = None
embedding_model = None


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[ChatMessage] = Field(default_factory=list)
    limit: int = Field(default=5, ge=1, le=10)
    session_id: str = Field(default="default", min_length=1)


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


def warn_missing_groq_key() -> None:
    if not GROQ_API_KEY:
        print("GROQ_API_KEY not configured. AI classification and chat will not work.")


warn_missing_groq_key()


@app.get("/health")
async def health_check() -> dict[str, Any]:
    return {
        "status": "ok",
        "documents_dir": str(DOCUMENTS_DIR),
        "manifest_path": str(MANIFEST_PATH),
        "memory_dir": str(MEMORY_DIR),
        "groq_configured": bool(GROQ_API_KEY),
        "chroma": {"host": CHROMA_HOST, "port": CHROMA_PORT, "collection": CHROMA_COLLECTION},
    }


@app.post("/upload-document")
async def upload_document(file: UploadFile = File(...)) -> dict[str, Any]:
    if not is_pdf_upload(file):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    document_id = str(uuid.uuid4())
    original_name = safe_filename(file.filename or "document.pdf")
    staging_path = ORIGINALS_DIR / f".upload-{document_id}.pdf"
    save_upload(file, staging_path)
    file_hash = hash_file(staging_path)

    existing_record = find_document_by_hash(file_hash)
    if existing_record is not None:
        staging_path.unlink(missing_ok=True)
        return {
            **existing_record,
            "duplicate": True,
            "message": "Document already indexed. Returning existing record.",
        }

    markdown_text = extract_pdf_markdown(staging_path)
    if not markdown_text.strip():
        staging_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="Could not extract text from PDF.")

    ai_result = analyze_document_with_groq(markdown_text, original_name)
    file_plan = build_file_plan(ai_result, original_name, document_id)

    file_plan["pdf_dir"].mkdir(parents=True, exist_ok=True)
    file_plan["markdown_dir"].mkdir(parents=True, exist_ok=True)

    pdf_path = ensure_unique_path(file_plan["pdf_path"])
    markdown_path = ensure_unique_path(file_plan["markdown_path"])
    staging_path.replace(pdf_path)
    markdown_path.write_text(markdown_text, encoding="utf-8")

    chunks = split_text(markdown_text)
    embeddings = embed_texts(chunks)
    metadatas = [
        build_chroma_metadata(
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

    collection = get_chroma_collection()
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
    append_manifest_record(record)

    return {**record, "duplicate": False, "metadata": ai_result.get("metadata", {})}


@app.get("/documents", response_model=list[DocumentRecord])
async def list_documents(limit: int = Query(default=50, ge=1, le=500)) -> list[DocumentRecord]:
    records = read_manifest_records()
    return [DocumentRecord(**record) for record in records[-limit:]][::-1]


@app.get("/search-semantic", response_model=list[SearchResult])
async def search_semantic(
    query: str = Query(..., min_length=1),
    limit: int = Query(default=5, ge=1, le=20),
) -> list[SearchResult]:
    return semantic_search(query=query, limit=limit)


@app.post("/chat")
async def chat(request: ChatRequest) -> dict[str, Any]:
    ensure_groq_configured()

    references = semantic_search(query=request.message, limit=request.limit)
    context = build_rag_context(references)
    session_id = safe_session_id(request.session_id)
    persistent_history = load_session_memory(session_id)
    messages = build_chat_messages(request, context, persistent_history)

    client = get_groq_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=0.2,
    )
    answer = response.choices[0].message.content or ""
    save_session_turn(
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


@app.get("/memory/{session_id}")
async def get_memory(session_id: str) -> dict[str, Any]:
    clean_session_id = safe_session_id(session_id)
    return {
        "session_id": clean_session_id,
        "turns": load_session_memory(clean_session_id),
    }


@app.delete("/memory/{session_id}")
async def delete_memory(session_id: str) -> dict[str, str]:
    clean_session_id = safe_session_id(session_id)
    session_memory_path(clean_session_id).unlink(missing_ok=True)
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


def safe_session_id(value: str) -> str:
    return safe_slug(value, fallback="default")[:80]


def extract_pdf_markdown(pdf_path: Path) -> str:
    try:
        from docling.document_converter import DocumentConverter
    except Exception as exc:  # pragma: no cover - import depends on runtime install
        raise HTTPException(status_code=500, detail=f"Docling is not available: {exc}") from exc

    try:
        result = DocumentConverter().convert(str(pdf_path))
        return result.document.export_to_markdown()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF: {exc}") from exc


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
        "document_excerpt": markdown_text[:MAX_GROQ_CHARS],
    }

    try:
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
        parsed = json.loads(raw)
        return normalize_ai_result(parsed, original_name)
    except Exception as exc:
        print(f"Groq analysis failed, using fallback: {exc}")
        return fallback_document_analysis(markdown_text, original_name)


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


def build_file_plan(ai_result: dict[str, Any], original_name: str, document_id: str) -> dict[str, Any]:
    metadata = ai_result.get("metadata", {})
    classification = safe_slug(str(ai_result.get("classification") or "outro"), "outro")
    title = str(metadata.get("title") or Path(original_name).stem)
    year = extract_year(str(metadata.get("date") or "")) or extract_year(str(ai_result.get("suggested_name") or ""))
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
    pdf_dir = ORIGINALS_DIR.joinpath(*folder_parts)
    markdown_dir = MARKDOWN_DIR.joinpath(*folder_parts)

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
    }


def append_manifest_record(record: dict[str, Any]) -> None:
    with MANIFEST_PATH.open("a", encoding="utf-8") as output:
        output.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_manifest_records() -> list[dict[str, Any]]:
    if not MANIFEST_PATH.exists():
        return []
    records: list[dict[str, Any]] = []
    with MANIFEST_PATH.open("r", encoding="utf-8") as input_file:
        for line in input_file:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def find_document_by_hash(file_hash: str) -> dict[str, Any] | None:
    for record in reversed(read_manifest_records()):
        if record.get("sha256") == file_hash:
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


def get_chroma_collection():
    global chroma_collection
    if chroma_collection is None:
        import chromadb

        client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
        chroma_collection = client.get_or_create_collection(
            name=CHROMA_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )
    return chroma_collection


def build_chroma_metadata(
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
        "folder_path": "/".join(markdown_path.relative_to(MARKDOWN_DIR).parts[:-1]),
        "pdf_path": str(pdf_path),
        "markdown_path": str(markdown_path),
    }


def semantic_search(query: str, limit: int = 5) -> list[SearchResult]:
    collection = get_chroma_collection()
    query_embedding = embed_texts([query])[0]
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=limit,
        include=["documents", "metadatas", "distances"],
    )

    ids = results.get("ids", [[]])[0]
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    output: list[SearchResult] = []
    for index, chunk_id in enumerate(ids):
        metadata = dict(metadatas[index] or {})
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


def build_rag_context(references: list[SearchResult]) -> str:
    blocks: list[str] = []
    for index, reference in enumerate(references, start=1):
        title = reference.metadata.get("title") or reference.suggested_name or reference.document_id
        markdown_path = reference.markdown_path
        source_text = reference.snippet
        if markdown_path:
            source_text = read_relevant_markdown(Path(markdown_path), reference.snippet)
        blocks.append(f"[Fonte {index}] {title}\n{source_text[:4000]}")
    return "\n\n".join(blocks)


def read_relevant_markdown(path: Path, fallback: str) -> str:
    try:
        if not path.exists() or not path.is_file():
            return fallback
        text = path.read_text(encoding="utf-8")
        return text[:4000] if text else fallback
    except Exception:
        return fallback


def build_chat_messages(
    request: ChatRequest,
    context: str,
    persistent_history: list[dict[str, Any]],
) -> list[dict[str, str]]:
    system_prompt = (
        "You are Nexus, a precise assistant for a private document archive. "
        "Answer in the user's language. Use only the supplied context when citing documents. "
        "If the context is insufficient, say what is missing. Include concise references. "
        "Use the persistent session memory to preserve user preferences and prior conclusions."
    )
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

    memory_summary = build_memory_summary(persistent_history)
    if memory_summary:
        messages.append({"role": "system", "content": f"Persistent session memory:\n{memory_summary}"})

    for item in request.history[-10:]:
        messages.append({"role": item.role, "content": item.content})

    user_prompt = (
        f"Contexto recuperado:\n{context or 'Nenhum documento relevante encontrado.'}\n\n"
        f"Pergunta do usuario:\n{request.message}"
    )
    messages.append({"role": "user", "content": user_prompt})
    return messages


def session_memory_path(session_id: str) -> Path:
    return MEMORY_DIR / f"{session_id}.jsonl"


def load_session_memory(session_id: str) -> list[dict[str, Any]]:
    path = session_memory_path(session_id)
    if not path.exists():
        return []
    turns: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as input_file:
        for line in input_file:
            line = line.strip()
            if not line:
                continue
            try:
                turns.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return turns[-CHAT_MEMORY_TURNS:]


def save_session_turn(
    session_id: str,
    user_message: str,
    assistant_message: str,
    references: list[SearchResult],
) -> None:
    record = {
        "timestamp": datetime.now(UTC).isoformat(),
        "user": user_message,
        "assistant": assistant_message,
        "references": [
            {
                "document_id": reference.document_id,
                "title": reference.metadata.get("title") or reference.suggested_name,
                "markdown_path": reference.markdown_path,
            }
            for reference in references
        ],
    }
    with session_memory_path(session_id).open("a", encoding="utf-8") as output:
        output.write(json.dumps(record, ensure_ascii=False) + "\n")


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
