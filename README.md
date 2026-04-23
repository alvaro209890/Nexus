# Nexus

Nexus is a document-management and RAG system for PDF archives. It stores
source documents in `/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/BD_NEXUS`, extracts Markdown with Docling,
classifies metadata with Groq, indexes chunks in ChromaDB, keeps a persistent
document manifest and chat memory, and exposes a Next.js dashboard protected by
Firebase Authentication.

## Project Layout

- `backend/`: FastAPI API, PDF processing, Groq integration, embeddings and ChromaDB access.
- `frontend/`: Next.js static export for Firebase Hosting.
- `docker-compose.yml`: backend plus ChromaDB orchestration.
- `cloudflared-config.yml.example`: Cloudflare Tunnel ingress example for `nexus-api.cursar.space`.
- `firebase.json`: Firebase Hosting config pointing to `frontend/out`.

Runtime document storage:

```bash
mkdir -p "/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/BD_NEXUS"
```

Nexus creates this runtime layout:

- `originals/{folder_path}/`: normalized PDF originals.
- `markdown/{folder_path}/`: extracted Markdown files.
- `manifest.jsonl`: append-only document memory with hashes, paths and metadata.
- `memory/{session_id}.jsonl`: persistent chat memory per frontend session.

`folder_path` is suggested by the AI as a relative path with up to four safe
segments, such as `juridico/cliente-x/2026/contrato`. The backend sanitizes all
segments, rejects traversal implicitly, and falls back to a deterministic
`technology/project/year/classification` layout when the AI does not provide a
useful path.

## Backend

Create the backend environment file:

```bash
cp backend/.env.example backend/.env
```

Set `GROQ_API_KEY` in `backend/.env`.

Run with Docker:

```bash
docker compose up --build
```

Backend endpoints:

- `GET http://localhost:8000/health`
- `POST http://localhost:8000/upload-document`
- `GET http://localhost:8000/documents`
- `GET http://localhost:8000/search-semantic?query=...`
- `POST http://localhost:8000/chat`
- `GET http://localhost:8000/memory/{session_id}`
- `DELETE http://localhost:8000/memory/{session_id}`

Upload behavior:

- Files are hashed with SHA-256 before indexing.
- Duplicate PDFs return the existing manifest record instead of creating a second copy.
- New PDFs are saved under classification/year folders using normalized names.
- Markdown and ChromaDB metadata include the original filename, suggested name, folder path, year, title, project, tags, technologies and full paths.

Chat behavior:

- The frontend stores a `nexus_session_id` in `localStorage`.
- `/chat` appends each turn to `/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/BD_NEXUS/memory/{session_id}.jsonl`.
- Recent memory turns are injected into future prompts alongside retrieved document context.

Local development without Docker requires ChromaDB to be available at the
configured `CHROMA_HOST` and `CHROMA_PORT`:

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Frontend

Create the frontend environment file:

```bash
cp frontend/.env.local.example frontend/.env.local
```

Fill the Firebase public variables and set:

```bash
NEXT_PUBLIC_BACKEND_URL=https://nexus-api.cursar.space
```

Install and run:

```bash
cd frontend
npm install
npm run dev
```

Build static hosting output:

```bash
npm run build
```

Deploy to Firebase Hosting:

```bash
npx firebase-tools deploy --only hosting --project nexus-98e32
```

## Firebase Authentication

In the Firebase Console for project `nexus`:

1. Open Authentication.
2. Enable Google provider.
3. Enable Email/Password provider.
4. Add authorized domains for `nexus-98e32.web.app`, `nexus-98e32.firebaseapp.com`, and `nexus.cursar.space`.
5. Copy the web app SDK config into `frontend/.env.local`.

## Cloudflare Tunnel

`cloudflared` is expected to publish only the API host:

```bash
cloudflared tunnel login
cloudflared tunnel create nexus
cloudflared tunnel route dns nexus nexus-api.cursar.space
cloudflared tunnel --config cloudflared-config.yml run nexus
```

To run as a service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Configure `nexus.cursar.space` as a custom domain in Firebase Hosting. Do not
proxy Firebase Hosting through the API tunnel unless you intentionally want a
different hosting topology.

## Validation Checklist

```bash
python3 -m compileall backend
cd frontend && npm install && npm run build
docker compose up --build
curl http://localhost:8000/health
```

Known environment note: this workstation currently has Python, Node, npm and
cloudflared installed, but Docker and Firebase CLI may need installation or use
through `npx firebase-tools`.
