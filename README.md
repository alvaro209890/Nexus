# Nexus

Nexus is a private multi-user document archive with RAG chat. Each authenticated
Firebase user gets a fully isolated workspace under
`/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/BD_NEXUS/users/{uid}`.

Provider split:

- DeepSeek (`deepseek-chat`) organizes uploaded files by classifying metadata and
  suggesting folder structure.
- Groq (`openai/gpt-oss-20b`) powers chat answers and document lookup intent.
- ChromaDB stores vectors per user collection.

## Project Layout

- `backend/`: FastAPI API, Firebase token verification, file ingest, DeepSeek/Groq integration, embeddings and ChromaDB access.
- `frontend/`: Next.js dashboard and Firebase Auth login.
- `deploy/local/`: local service install scripts for this workstation.
- `firebase.json`: Firebase Hosting config pointing to `frontend/out`.
- `.agents/`: operational documentation for agents and maintainers.

## Runtime Storage

Create the base runtime path:

```bash
mkdir -p "/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/BD_NEXUS"
```

Per user, Nexus creates:

- `users/{uid}/profile.json`
- `users/{uid}/originals/{folder_path}/`
- `users/{uid}/markdown/{folder_path}/`
- `users/{uid}/manifest.jsonl`
- `users/{uid}/memory/{session_id}.jsonl`

Isolation rules:

- documents do not mix between users
- manifests do not mix between users
- vectors use one Chroma collection per user
- chat memory is stored per user and per session

## Backend

Create local backend env:

```bash
cp backend/.env.example backend/.env
```

Set these keys:

```bash
DEEPSEEK_API_KEY=...
GROQ_API_KEY=...
FIREBASE_PROJECT_ID=nexus-98e32
```

Recommended defaults already shipped:

- `DEEPSEEK_MODEL=deepseek-chat`
- `GROQ_MODEL=openai/gpt-oss-20b`

Local manual run:

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 18000
```

API endpoints:

- `GET http://127.0.0.1:18000/health`
- `POST http://127.0.0.1:18000/auth/sync`
- `POST http://127.0.0.1:18000/upload-document`
- `GET http://127.0.0.1:18000/documents`
- `GET http://127.0.0.1:18000/search-semantic?query=...`
- `POST http://127.0.0.1:18000/chat`
- `GET http://127.0.0.1:18000/memory/{session_id}`
- `DELETE http://127.0.0.1:18000/memory/{session_id}`

Auth rules:

- `health` is public
- all other routes require `Authorization: Bearer <Firebase ID token>`

## Frontend

Create local frontend env:

```bash
cp frontend/.env.local.example frontend/.env.local
```

Set:

```bash
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:18000
```

Run:

```bash
cd frontend
npm install
npm run dev
```

Build static hosting output:

```bash
npm run build
```

## Firebase Hosting

Deploy:

```bash
firebase deploy --only hosting --project nexus-98e32
```

Current hosting target:

- `https://nexus-98e32.web.app`

## Local Service Install

For this workstation, use:

```bash
deploy/local/install-local-services.sh
```

It installs:

- `nexus-chromadb.service`
- `nexus-backend.service`
- optional `nexus-cloudflared.service`

Active service env file:

- `~/.config/nexus/backend.env`

## Validation

```bash
python3 -m py_compile backend/main.py
cd frontend && npm run build
curl http://127.0.0.1:18000/health
curl -H "Authorization: Bearer invalid-token" http://127.0.0.1:18000/documents
```
