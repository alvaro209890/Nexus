from __future__ import annotations

import json
import os
import re
import shutil
import uuid
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
for directory in (DOCUMENTS_DIR, ORIGINALS_DIR, MARKDOWN_DIR):
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


def warn_missing_groq_key() -> None:
    if not GROQ_API_KEY:
        print("GROQ_API_KEY not configured. AI classification and chat will not work.")


warn_missing_groq_key()


@app.get("/health")
async def health_check() -> dict[str, Any]:
    return {
        "status": "ok",
        "documents_dir": str(DOCUMENTS_DIR),
        "groq_configured": bool(GROQ_API_KEY),
        "chroma": {"host": CHROMA_HOST, "port": CHROMA_PORT, "collection": CHROMA_COLLECTION},
    }


@app.post("/upload-document")
async def upload_document(file: UploadFile = File(...)) -> dict[str, Any]:
    if not is_pdf_upload(file):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    document_id = str(uuid.uuid4())
    original_name = safe_filename(file.filename or "document.pdf")
    pdf_path = ORIGINALS_DIR / f"{document_id}-{original_name}"
    save_upload(file, pdf_path)

    markdown_text = extract_pdf_markdown(pdf_path)
    if not markdown_text.strip():
        raise HTTPException(status_code=422, detail="Could not extract text from PDF.")

    ai_result = analyze_document_with_groq(markdown_text, original_name)
    suggested_name = safe_filename(ai_result.get("suggested_name") or original_name)
    if not suggested_name.lower().endswith(".md"):
        suggested_name = f"{Path(suggested_name).stem}.md"

    markdown_path = MARKDOWN_DIR / f"{Path(suggested_name).stem}-{document_id}.md"
    markdown_path.write_text(markdown_text, encoding="utf-8")

    chunks = split_text(markdown_text)
    embeddings = embed_texts(chunks)
    metadatas = [
        build_chroma_metadata(
            document_id=document_id,
            chunk_index=index,
            pdf_path=pdf_path,
            markdown_path=markdown_path,
            original_name=original_name,
            ai_result=ai_result,
        )
        for index, _ in enumerate(chunks)
    ]
    ids = [f"{document_id}:{index}" for index in range(len(chunks))]

    collection = get_chroma_collection()
    collection.add(ids=ids, documents=chunks, embeddings=embeddings, metadatas=metadatas)

    return {
        "document_id": document_id,
        "classification": ai_result.get("classification"),
        "suggested_name": suggested_name,
        "metadata": ai_result.get("metadata", {}),
        "pdf_path": str(pdf_path),
        "markdown_path": str(markdown_path),
        "chunks_indexed": len(chunks),
    }


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
    messages = build_chat_messages(request, context)

    client = get_groq_client()
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=0.2,
    )
    answer = response.choices[0].message.content or ""

    return {
        "answer": answer,
        "references": [result.model_dump() for result in references],
    }


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


def safe_filename(value: str) -> str:
    value = value.strip().replace("\\", "/").split("/")[-1]
    value = re.sub(r"[^A-Za-z0-9._ -]+", "-", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value or "document.pdf"


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
            "metadata": {
                "title": "string",
                "author": "string or null",
                "date": "YYYY-MM-DD or YYYY or null",
                "technologies": ["string"],
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
        "metadata": {
            "title": metadata.get("title") or Path(original_name).stem,
            "author": metadata.get("author"),
            "date": metadata.get("date"),
            "technologies": [str(item) for item in technologies if str(item).strip()],
            "summary": metadata.get("summary") or "",
        },
    }


def fallback_document_analysis(markdown_text: str, original_name: str) -> dict[str, Any]:
    title = first_heading(markdown_text) or Path(original_name).stem
    year_match = re.search(r"\b(19|20)\d{2}\b", markdown_text[:3000])
    year = year_match.group(0) if year_match else "0000"
    return {
        "classification": "outro",
        "suggested_name": f"[{year}] Documento - {title}.md",
        "metadata": {
            "title": title,
            "author": None,
            "date": year if year != "0000" else None,
            "technologies": [],
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
    chunk_index: int,
    pdf_path: Path,
    markdown_path: Path,
    original_name: str,
    ai_result: dict[str, Any],
) -> dict[str, str | int | float | bool]:
    metadata = ai_result.get("metadata", {})
    technologies = metadata.get("technologies") if isinstance(metadata, dict) else []
    if not isinstance(technologies, list):
        technologies = []

    return {
        "document_id": document_id,
        "chunk_index": chunk_index,
        "original_name": original_name,
        "classification": str(ai_result.get("classification") or "outro"),
        "suggested_name": str(ai_result.get("suggested_name") or original_name),
        "title": str(metadata.get("title") or Path(original_name).stem),
        "author": str(metadata.get("author") or ""),
        "date": str(metadata.get("date") or ""),
        "technologies": json.dumps(technologies, ensure_ascii=False),
        "summary": str(metadata.get("summary") or ""),
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


def build_chat_messages(request: ChatRequest, context: str) -> list[dict[str, str]]:
    system_prompt = (
        "You are Nexus, a precise assistant for a private document archive. "
        "Answer in the user's language. Use only the supplied context when citing documents. "
        "If the context is insufficient, say what is missing. Include concise references."
    )
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

    for item in request.history[-10:]:
        messages.append({"role": item.role, "content": item.content})

    user_prompt = (
        f"Contexto recuperado:\n{context or 'Nenhum documento relevante encontrado.'}\n\n"
        f"Pergunta do usuario:\n{request.message}"
    )
    messages.append({"role": "user", "content": user_prompt})
    return messages
