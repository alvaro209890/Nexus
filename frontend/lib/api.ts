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

export type UploadBatchResponse = {
  results: UploadResponse[];
  errors: Array<{
    filename: string;
    detail: string;
  }>;
  uploaded_count: number;
  failed_count: number;
};

export type SearchResult = {
  document_id: string;
  chunk_id: string;
  score: number | null;
  snippet: string;
  metadata: Record<string, string | number | boolean | null>;
  markdown_path?: string | null;
  pdf_path?: string | null;
  classification?: string | null;
  suggested_name?: string | null;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type PersistedChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  references: Array<Record<string, unknown>>;
};

export type ChatSessionSummary = {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
  message_count: number;
  last_message_preview: string;
};

export type ChatSessionDetail = ChatSessionSummary & {
  messages: PersistedChatMessage[];
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
  document_type?: string | null;
  domain?: string | null;
  suggested_name: string;
  title: string;
  author?: string | null;
  date?: string | null;
  year: string;
  technologies: string[];
  summary: string;
  folder_path: string;
  tags: string[];
  aliases?: string[];
  entities?: string[];
  project?: string | null;
  classification_confidence?: number | null;
  folder_confidence?: number | null;
  title_confidence?: number | null;
  review_status?: string | null;
  processing_status?: string | null;
  processing_progress?: number | null;
  processing_error?: string | null;
  processing_started_at?: string | null;
  processing_completed_at?: string | null;
  pdf_path: string;
  markdown_path: string;
  chunks_indexed: number;
  uploaded_at: string;
  size_bytes?: number | null;
};

export type DocumentProcessingEvent = {
  event_id: string;
  document_id: string;
  stage: string;
  status: string;
  level: string;
  message: string;
  progress?: number | null;
  timestamp: string;
};

export type DocumentProcessingDetail = {
  document: DocumentRecord;
  events: DocumentProcessingEvent[];
  can_retry: boolean;
  is_processing: boolean;
};

export type FolderRecord = {
  path: string;
  name: string;
  created_at: string;
};

const LOCAL_API_BASE = "http://127.0.0.1:18000";
const PUBLIC_API_BASE = "https://nexus-api.cursar.space";

function resolveApiBase(): string {
  const configuredBase = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();

  if (typeof window === "undefined") {
    if (!configuredBase) return PUBLIC_API_BASE;
    if (configuredBase.includes("127.0.0.1") || configuredBase.includes("localhost")) {
      return PUBLIC_API_BASE;
    }
    return configuredBase;
  }

  const hostname = window.location.hostname;
  const isLocalBrowser = hostname === "localhost" || hostname === "127.0.0.1";

  if (configuredBase) {
    if (configuredBase.includes("127.0.0.1") || configuredBase.includes("localhost")) {
      return isLocalBrowser ? configuredBase : PUBLIC_API_BASE;
    }
    return configuredBase;
  }

  return isLocalBrowser ? LOCAL_API_BASE : PUBLIC_API_BASE;
}

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
  const response = await fetch(`${resolveApiBase()}/auth/sync`, {
    method: "POST",
    headers: authHeaders(token)
  });
  return parseJsonResponse<AuthenticatedUserProfile>(response);
}

export async function uploadDocument(
  file: File,
  token: string,
  onProgress?: (progress: number) => void
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  return new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${resolveApiBase()}/upload-document`);

    const headers = authHeaders(token);
    Object.entries(headers).forEach(([key, value]) => {
      if (typeof value === "string") {
        xhr.setRequestHeader(key, value);
      }
    });

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });

    xhr.addEventListener("load", () => {
      const contentType = xhr.getResponseHeader("content-type") || "";
      const responseText = xhr.responseText || "";

      if (xhr.status < 200 || xhr.status >= 300) {
        try {
          const payload = contentType.includes("application/json") ? JSON.parse(responseText) : null;
          const detail =
            typeof payload?.detail === "string"
              ? payload.detail
              : typeof payload?.message === "string"
                ? payload.message
                : responseText;
          reject(new Error(detail || `Request failed with status ${xhr.status}`));
        } catch {
          reject(new Error(responseText || `Request failed with status ${xhr.status}`));
        }
        return;
      }

      try {
        const payload = JSON.parse(responseText) as UploadResponse;
        onProgress?.(100);
        resolve(payload);
      } catch {
        reject(new Error("Resposta inválida do servidor ao enviar documento."));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Falha de conexão durante o upload do documento."));
    });

    xhr.send(formData);
  });
}

export async function uploadDocuments(
  files: File[],
  token: string,
  onProgress?: (progress: number) => void
): Promise<UploadBatchResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  return new Promise<UploadBatchResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${resolveApiBase()}/upload-documents`);

    const headers = authHeaders(token);
    Object.entries(headers).forEach(([key, value]) => {
      if (typeof value === "string") {
        xhr.setRequestHeader(key, value);
      }
    });

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });

    xhr.addEventListener("load", () => {
      const contentType = xhr.getResponseHeader("content-type") || "";
      const responseText = xhr.responseText || "";

      if (xhr.status < 200 || xhr.status >= 300) {
        try {
          const payload = contentType.includes("application/json") ? JSON.parse(responseText) : null;
          const detail =
            typeof payload?.detail === "string"
              ? payload.detail
              : typeof payload?.message === "string"
                ? payload.message
                : responseText;
          reject(new Error(detail || `Request failed with status ${xhr.status}`));
        } catch {
          reject(new Error(responseText || `Request failed with status ${xhr.status}`));
        }
        return;
      }

      try {
        const payload = JSON.parse(responseText) as UploadBatchResponse;
        onProgress?.(100);
        resolve(payload);
      } catch {
        reject(new Error("Resposta inválida do servidor ao enviar documentos."));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Falha de conexão durante o upload dos documentos."));
    });

    xhr.send(formData);
  });
}

export async function searchSemantic(query: string, token: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ query, limit: "6" });
  const response = await fetch(`${resolveApiBase()}/search-semantic?${params.toString()}`, {
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
  const response = await fetch(`${resolveApiBase()}/chat`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ message, history, session_id: sessionId, limit: 5 })
  });
  return parseJsonResponse<ChatResponse>(response);
}

export async function listChatSessions(token: string): Promise<ChatSessionSummary[]> {
  const response = await fetch(`${resolveApiBase()}/chat-sessions`, {
    headers: authHeaders(token)
  });
  return parseJsonResponse<ChatSessionSummary[]>(response);
}

export async function createChatSession(token: string, title?: string): Promise<ChatSessionSummary> {
  const response = await fetch(`${resolveApiBase()}/chat-sessions`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(title ? { title } : {})
  });
  return parseJsonResponse<ChatSessionSummary>(response);
}

export async function getChatSession(sessionId: string, token: string): Promise<ChatSessionDetail> {
  const response = await fetch(`${resolveApiBase()}/chat-sessions/${sessionId}`, {
    headers: authHeaders(token)
  });
  return parseJsonResponse<ChatSessionDetail>(response);
}

export async function renameChatSession(
  sessionId: string,
  title: string,
  token: string
): Promise<ChatSessionSummary> {
  const response = await fetch(`${resolveApiBase()}/chat-sessions/${sessionId}`, {
    method: "PATCH",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ title })
  });
  return parseJsonResponse<ChatSessionSummary>(response);
}

export async function deleteChatSession(sessionId: string, token: string): Promise<{ session_id: string; status: string }> {
  const response = await fetch(`${resolveApiBase()}/chat-sessions/${sessionId}`, {
    method: "DELETE",
    headers: authHeaders(token)
  });
  return parseJsonResponse<{ session_id: string; status: string }>(response);
}

export async function listDocuments(token: string, limit = 20): Promise<DocumentRecord[]> {
  const response = await fetch(`${resolveApiBase()}/documents?limit=${limit}`, {
    headers: authHeaders(token)
  });
  return parseJsonResponse<DocumentRecord[]>(response);
}

export async function getDocumentProcessingDetail(
  documentId: string,
  token: string
): Promise<DocumentProcessingDetail> {
  const response = await fetch(`${resolveApiBase()}/documents/${documentId}/processing`, {
    headers: authHeaders(token)
  });
  return parseJsonResponse<DocumentProcessingDetail>(response);
}

export async function retryDocumentProcessing(
  documentId: string,
  token: string
): Promise<DocumentRecord> {
  const response = await fetch(`${resolveApiBase()}/documents/${documentId}/retry`, {
    method: "POST",
    headers: authHeaders(token)
  });
  return parseJsonResponse<DocumentRecord>(response);
}

export async function listFolders(token: string): Promise<FolderRecord[]> {
  const response = await fetch(`${resolveApiBase()}/folders`, {
    headers: authHeaders(token)
  });
  return parseJsonResponse<FolderRecord[]>(response);
}

export async function createFolder(name: string, parentPath: string, token: string): Promise<FolderRecord> {
  const response = await fetch(`${resolveApiBase()}/folders`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name, parent_path: parentPath })
  });
  return parseJsonResponse<FolderRecord>(response);
}

function parseDownloadFilename(contentDisposition: string | null, fallbackName: string): string {
  if (!contentDisposition) return fallbackName;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const asciiMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }
  return fallbackName;
}

async function fetchDocumentBinary(
  documentId: string,
  token: string,
  fallbackName: string
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${resolveApiBase()}/documents/${documentId}/download`, {
    headers: authHeaders(token)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Download failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const downloadName = parseDownloadFilename(response.headers.get("content-disposition"), fallbackName);
  return {
    blob,
    filename: downloadName,
  };
}

export async function createDocumentObjectUrl(
  documentId: string,
  token: string,
  fallbackName: string
): Promise<{ url: string; filename: string }> {
  const { blob, filename } = await fetchDocumentBinary(documentId, token, fallbackName);
  return {
    url: window.URL.createObjectURL(blob),
    filename,
  };
}

export async function downloadDocument(
  documentId: string,
  token: string,
  fallbackName: string
): Promise<void> {
  const { blob, filename } = await fetchDocumentBinary(documentId, token, fallbackName);
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
}

export async function deleteDocument(
  documentId: string,
  token: string
): Promise<{ document_id: string; status: string }> {
  const response = await fetch(`${resolveApiBase()}/documents/${documentId}`, {
    method: "DELETE",
    headers: authHeaders(token)
  });
  return parseJsonResponse<{ document_id: string; status: string }>(response);
}
