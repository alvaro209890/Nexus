# Nexus Agent Notes

This folder documents the live architecture and operating assumptions for the
Nexus repository.

## Current Architecture

- Frontend: Next.js static site hosted on Firebase Hosting.
- Auth: Firebase Email/Password on the frontend plus Firebase ID token validation on the backend.
- Backend: FastAPI running locally on `127.0.0.1:18000`.
- Vector DB: ChromaDB running locally on `127.0.0.1:8001`.

## AI Provider Split

- DeepSeek
  - Model: `deepseek-chat`
  - Responsibility: classify uploaded files, summarize metadata, suggest folder structure.
- Groq
  - Model: `openai/gpt-oss-20b`
  - Responsibility: chat generation and extraction of lookup intent when the user asks for a specific file.

## Isolation Model

Each user is isolated under:

```text
BD_NEXUS/users/{uid}/
```

The backend never trusts a `uid` from the client. It derives the user only from
the verified Firebase token.

Per user:

- `profile.json`
- `originals/`
- `markdown/`
- `manifest.jsonl`
- `memory/`
- dedicated Chroma collection

## Search Behavior

- `/search-semantic` is hybrid even though the route name stayed the same.
- It now merges:
  - metadata/manifest lookup
  - semantic vector lookup
- `/chat` first tries Groq-based lookup intent extraction for specific document requests, then merges those hits with semantic context.

## Runtime Files on This PC

- Backend service env: `~/.config/nexus/backend.env`
- Runtime service env: `~/.config/nexus/runtime.env`
- Local systemd user units:
  - `nexus-backend.service`
  - `nexus-chromadb.service`
  - `nexus-cloudflared.service`

## Required Secrets

- `DEEPSEEK_API_KEY`
- `GROQ_API_KEY`
- Firebase public web config in `frontend/.env.local`

## Deploy Flow

1. Update code in repo.
2. Validate:
   - `python3 -m py_compile backend/main.py`
   - `cd frontend && npm run build`
3. Restart local backend if backend code or env changed:
   - `systemctl --user restart nexus-backend.service`
4. Deploy hosting:
   - `firebase deploy --only hosting --project nexus-98e32`
5. Push `main` to GitHub.

## Important Constraints

- Do not store passwords locally in `BD_NEXUS`.
- Do not expose provider secrets in frontend files.
- Do not reuse global manifest/memory paths for authenticated operations.
- Do not mix user vectors in the same Chroma collection.
