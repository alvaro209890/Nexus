export type UploadResponse = {
  document_id: string;
  classification: string;
  suggested_name: string;
  metadata: Record<string, unknown>;
  pdf_path: string;
  markdown_path: string;
  chunks_indexed: number;
  duplicate?: boolean;
  message?: string;
};

export type SearchResult = {
  document_id: string;
  chunk_id: string;
  score: number | null;
  snippet: string;
  metadata: Record<string, string>;
  markdown_path?: string | null;
  pdf_path?: string | null;
  classification?: string | null;
  suggested_name?: string | null;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResponse = {
  answer: string;
  references: SearchResult[];
  session_id: string;
};

export type AuthenticatedUserProfile = {
  uid: string;
  email?: string | null;
  display_name?: string | null;
  provider_ids: string[];
  status: string;
  created_at: string;
  last_login_at: string;
  user_root: string;
  profile_path: string;
  originals_dir: string;
  markdown_dir: string;
  manifest_path: string;
  memory_dir: string;
  collection_name: string;
};

export type DocumentRecord = {
  document_id: string;
  sha256: string;
  original_name: string;
  classification: string;
  suggested_name: string;
  title: string;
  author?: string | null;
  date?: string | null;
  year: string;
  technologies: string[];
  summary: string;
  folder_path: string;
  tags: string[];
  project?: string | null;
  pdf_path: string;
  markdown_path: string;
  chunks_indexed: number;
  uploaded_at: string;
};

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:18000";

function authHeaders(token: string, headers: HeadersInit = {}): HeadersInit {
  return {
    ...headers,
    Authorization: `Bearer ${token}`
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      const detail =
        typeof payload?.detail === "string"
          ? payload.detail
          : typeof payload?.message === "string"
            ? payload.message
            : JSON.stringify(payload);
      throw new Error(detail || `Request failed with status ${response.status}`);
    }

    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function syncAuthenticatedUser(token: string): Promise<AuthenticatedUserProfile> {
  const response = await fetch(`${API_BASE}/auth/sync`, {
    method: "POST",
    headers: authHeaders(token)
  });
  return parseJsonResponse<AuthenticatedUserProfile>(response);
}

export async function uploadDocument(file: File, token: string): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/upload-document`, {
    method: "POST",
    headers: authHeaders(token),
    body: formData
  });
  return parseJsonResponse<UploadResponse>(response);
}

export async function searchSemantic(query: string, token: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ query, limit: "6" });
  const response = await fetch(`${API_BASE}/search-semantic?${params.toString()}`, {
    headers: authHeaders(token)
  });
  return parseJsonResponse<SearchResult[]>(response);
}

export async function sendChatMessage(
  message: string,
  history: ChatTurn[],
  sessionId: string,
  token: string
): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ message, history, session_id: sessionId, limit: 5 })
  });
  return parseJsonResponse<ChatResponse>(response);
}

export async function listDocuments(token: string): Promise<DocumentRecord[]> {
  const response = await fetch(`${API_BASE}/documents?limit=20`, {
    headers: authHeaders(token)
  });
  return parseJsonResponse<DocumentRecord[]>(response);
}
