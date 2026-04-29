import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";
import {
  assistNote,
  createNote,
  deleteNote,
  listNotes,
  listNoteVersions,
  NoteAssistResponse,
  NoteRecord,
  NoteVersionRecord,
  updateNote,
} from "../lib/api";
import { GlassCard } from "../components/ui/GlassCard";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import {
  Bot,
  CheckCircle2,
  Clock,
  Edit2,
  FileText,
  History,
  Plus,
  RefreshCw,
  Tags,
  Trash2,
} from "lucide-react";

type EditorMode = "edit" | "preview";
type AssistAction = "structure" | "autosave" | "refine" | "";

export default function NotesPage() {
  const router = useRouter();
  const { user, authProfile, getCurrentToken } = useAuth();
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [assistAction, setAssistAction] = useState<AssistAction>("");
  const [error, setError] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [versions, setVersions] = useState<NoteVersionRecord[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<NoteVersionRecord | null>(null);
  const [captureInput, setCaptureInput] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [form, setForm] = useState({
    title: "",
    tags: "",
    content: "",
  });
  const [draftMode, setDraftMode] = useState<"new" | "edit">("new");

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getCurrentToken();
      const noteList = await listNotes(token);
      setNotes(noteList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar as notas.");
    } finally {
      setLoading(false);
    }
  }, [getCurrentToken]);

  useEffect(() => {
    if (user && authProfile) {
      void loadNotes();
    }
  }, [user, authProfile, loadNotes]);

  useEffect(() => {
    if (!router.isReady || loading || isCreatingNew) return;
    const requestedNoteId = typeof router.query.note === "string" ? router.query.note : "";
    if (requestedNoteId && notes.some((note) => note.note_id === requestedNoteId)) {
      selectNote(notes.find((note) => note.note_id === requestedNoteId) || null);
      return;
    }

    if (!selectedNoteId && notes.length > 0) {
      selectNote(notes[0]);
    }
  }, [isCreatingNew, loading, notes, router.isReady, router.query.note, selectedNoteId]);

  const selectedNote = useMemo(
    () => notes.find((note) => note.note_id === selectedNoteId) || null,
    [notes, selectedNoteId]
  );

  const filteredNotes = useMemo(() => {
    const text = query.trim().toLowerCase();
    const tag = tagFilter.trim().toLowerCase();

    return notes.filter((note) => {
      const matchesText = !text || [note.title, note.summary, note.content, note.author || "", note.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(text);

      const matchesTag = !tag || note.tags.some((item) => item.toLowerCase().includes(tag));
      const updatedDate = note.updated_at.slice(0, 10);
      const matchesFrom = !dateFrom || updatedDate >= dateFrom;
      const matchesTo = !dateTo || updatedDate <= dateTo;

      return matchesText && matchesTag && matchesFrom && matchesTo;
    });
  }, [dateFrom, dateTo, notes, query, tagFilter]);

  function selectNote(note: NoteRecord | null) {
    if (!note) {
      setSelectedNoteId("");
      setDraftMode("new");
      setCaptureInput("");
      setAiSummary("");
      setForm({ title: "", tags: "", content: "" });
      return;
    }

    setSelectedNoteId(note.note_id);
    setIsCreatingNew(false);
    setDraftMode("edit");
    setAiSummary(note.summary || "");
    setCaptureInput(note.content);
    setForm({
      title: note.title,
      tags: note.tags.join(", "),
      content: note.content,
    });
    setEditorMode("edit");
  }

  function handleStartNew() {
    setIsCreatingNew(true);
    setSelectedNoteId("");
    setDraftMode("new");
    setCaptureInput("");
    setAiSummary("");
    setForm({ title: "", tags: "", content: "" });
    setEditorMode("edit");
    setError("");
    void router.replace("/notes", undefined, { shallow: true });
  }

  async function saveResolvedNote(nextNote: { title: string; content: string; tags: string[] }) {
    const token = await getCurrentToken();
    let saved: NoteRecord;

    if (draftMode === "edit" && selectedNoteId) {
      saved = await updateNote(selectedNoteId, nextNote, token);
      setNotes((current) =>
        current
          .map((note) => (note.note_id === saved.note_id ? saved : note))
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      );
    } else {
      saved = await createNote(nextNote, token);
      setNotes((current) => [saved, ...current].sort((left, right) => right.updated_at.localeCompare(left.updated_at)));
    }

    selectNote(saved);
    setIsCreatingNew(false);
    void router.replace(
      { pathname: "/notes", query: { note: saved.note_id } },
      undefined,
      { shallow: true }
    );
  }

  async function handleSave() {
    const title = form.title.trim();
    const content = form.content.trim();
    const tags = parseTags(form.tags);

    if (!title || !content) {
      setError("Título e conteúdo são obrigatórios. Use a IA para estruturar automaticamente se preferir.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await saveResolvedNote({ title, content, tags });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar a nota.");
    } finally {
      setSaving(false);
    }
  }

  async function runAssist(action: Exclude<AssistAction, "">) {
    const rawInput = captureInput.trim() || form.content.trim();
    if (!rawInput) {
      setError("Escreva um rascunho ou cole ideias na captura rápida para usar a IA.");
      return;
    }

    setAssistAction(action);
    setError("");
    try {
      const token = await getCurrentToken();
      const response = await assistNote(
        {
          raw_input: rawInput,
          current_title: form.title.trim() || undefined,
          current_content: form.content.trim() || undefined,
          current_tags: parseTags(form.tags),
          mode: action === "refine" ? "refine" : "create",
        },
        token
      );

      applyAssistResponse(response);
      if (action === "autosave") {
        setSaving(true);
        try {
          await saveResolvedNote({
            title: response.title.trim(),
            content: response.content.trim(),
            tags: response.tags,
          });
        } finally {
          setSaving(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar a nota com IA.");
    } finally {
      setAssistAction("");
    }
  }

  function applyAssistResponse(response: NoteAssistResponse) {
    setAiSummary(response.summary || summarizeContent(response.content));
    setForm({
      title: response.title,
      tags: response.tags.join(", "),
      content: response.content,
    });
    setEditorMode("edit");
  }

  async function handleDelete() {
    if (!selectedNote) return;
    setDeleting(true);
    setError("");
    try {
      const token = await getCurrentToken();
      await deleteNote(selectedNote.note_id, token);
      const remaining = notes.filter((note) => note.note_id !== selectedNote.note_id);
      setNotes(remaining);
      setDeleteDialogOpen(false);
      if (remaining.length > 0) {
        selectNote(remaining[0]);
      } else {
        handleStartNew();
      }
      void router.replace("/notes", undefined, { shallow: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir a nota.");
    } finally {
      setDeleting(false);
    }
  }

  async function openHistory() {
    if (!selectedNote) return;
    setHistoryDialogOpen(true);
    setLoadingHistory(true);
    setError("");
    try {
      const token = await getCurrentToken();
      const history = await listNoteVersions(selectedNote.note_id, token);
      setVersions(history);
      setSelectedVersion(history[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o histórico da nota.");
    } finally {
      setLoadingHistory(false);
    }
  }

  const currentTags = parseTags(form.tags);
  const captureReady = Boolean((captureInput.trim() || form.content.trim()) && !assistAction);

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="rounded-[1.75rem] border border-border-soft bg-[linear-gradient(135deg,rgba(99,102,241,0.18),rgba(24,24,27,0.75)_45%,rgba(24,24,27,0.88))] p-6 shadow-panel">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow mb-2">Studio IA</p>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Notas automáticas</h1>
            <p className="mt-3 text-secondary">
              Cole ideias soltas, atas, resumos ou comandos. A IA organiza título, estrutura Markdown e tags para deixar a nota pronta para busca, chat e versionamento.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={() => void loadNotes()}>
              <RefreshCw size={16} className="mr-2" />
              Atualizar base
            </Button>
            <Button type="button" onClick={handleStartNew}>
              <Plus size={16} className="mr-2" />
              Nova sessão de nota
            </Button>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm font-medium text-white">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <GlassCard className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <Bot size={22} />
              </div>
              <div>
                <p className="text-sm font-bold text-primary">Captura rápida com IA</p>
                <p className="text-xs text-secondary">Escreva do jeito que vier. O Nexus organiza depois.</p>
              </div>
            </div>

            <textarea
              className="field min-h-[12rem] resize-y"
              placeholder="Ex.: reunião com cliente Atlas, decisão de adiar rollout para terça, riscos: SLA e acesso ao banco..."
              value={captureInput}
              onChange={(event) => setCaptureInput(event.target.value)}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button
                type="button"
                variant="secondary"
                isLoading={assistAction === "structure"}
                disabled={!captureReady}
                onClick={() => void runAssist("structure")}
              >
                <Bot size={16} className="mr-2" />
                Estruturar com IA
              </Button>
              <Button
                type="button"
                isLoading={assistAction === "autosave" || saving}
                disabled={!captureReady}
                onClick={() => void runAssist("autosave")}
              >
                <CheckCircle2 size={16} className="mr-2" />
                Gerar e salvar
              </Button>
            </div>

            <div className="rounded-2xl border border-border-soft bg-black/10 p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-muted">Como funciona</p>
              <p className="text-sm leading-relaxed text-secondary">
                A IA gera título, tags e uma nota em Markdown pronta para indexação. Se você estiver editando uma nota existente, também pode pedir uma reescrita mais limpa usando o conteúdo atual.
              </p>
            </div>
          </GlassCard>

          <GlassCard className="flex min-h-[34rem] flex-col gap-5">
            <div className="space-y-4">
              <Input
                label="Pesquisar notas"
                placeholder="Título, conteúdo, autor..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Input
                label="Filtrar por tag"
                placeholder="Ex.: sprint, cliente, reunião"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="date"
                  label="De"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
                <Input
                  type="date"
                  label="Até"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border-soft pt-4">
              <p className="text-sm font-semibold text-primary">
                {loading ? "Carregando..." : `${filteredNotes.length} notas`}
              </p>
              <span className="text-xs text-secondary">Biblioteca privada</span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {!loading && filteredNotes.length === 0 && (
                <div className="empty-state !min-h-[14rem]">
                  <FileText size={32} className="mb-2 text-muted" />
                  <p className="text-base font-semibold">Nenhuma nota encontrada.</p>
                  <p className="text-sm text-secondary">Use a captura rápida acima para criar a primeira nota com IA.</p>
                </div>
              )}

              {filteredNotes.map((note) => {
                const isSelected = note.note_id === selectedNoteId;
                return (
                  <button
                    key={note.note_id}
                    type="button"
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      isSelected
                        ? "border-accent/40 bg-accent/10"
                        : "border-border-soft bg-black/10 hover:border-border-strong hover:bg-white/5"
                    }`}
                    onClick={() => {
                      selectNote(note);
                      void router.replace(
                        { pathname: "/notes", query: { note: note.note_id } },
                        undefined,
                        { shallow: true }
                      );
                    }}
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <p className="font-semibold text-primary">{note.title}</p>
                      <span className="rounded-full border border-border-soft px-2 py-0.5 text-[0.68rem] font-bold uppercase text-accent-strong">
                        v{note.current_version}
                      </span>
                    </div>
                    <p className="line-clamp-3 text-sm text-secondary">{note.summary || "Sem resumo disponível."}</p>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted">
                      <span>{formatDate(note.updated_at)}</span>
                      <span>{note.tags.length} tags</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </GlassCard>
        </div>

        <GlassCard className="min-h-[42rem] !p-0 overflow-hidden">
          <div className="border-b border-border-soft bg-bg-surface-strong/70 px-6 py-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="eyebrow mb-1">{draftMode === "edit" && selectedNote ? "Reescrevendo nota" : "Nova nota guiada por IA"}</p>
                <h2 className="text-2xl font-bold text-primary">
                  {selectedNote?.title || "Mesa de edição"}
                </h2>
                <p className="mt-1 text-sm text-secondary">
                  {selectedNote
                    ? "Você pode editar manualmente, pedir refinamento automático ou salvar uma nova versão."
                    : "A IA pode criar toda a nota a partir do rascunho bruto ou você pode ajustar o texto antes de salvar."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  isLoading={assistAction === "refine"}
                  disabled={!form.content.trim() && !captureInput.trim()}
                  onClick={() => void runAssist("refine")}
                >
                  <Bot size={16} className="mr-2" />
                  Refinar nota
                </Button>
                {selectedNote && (
                  <Button variant="ghost" type="button" onClick={() => void openHistory()}>
                    <History size={16} className="mr-2" />
                    Histórico
                  </Button>
                )}
                {selectedNote && (
                  <Button
                    variant="ghost"
                    type="button"
                    className="!text-danger hover:!bg-danger/10"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 size={16} className="mr-2" />
                    Excluir
                  </Button>
                )}
                <Button type="button" isLoading={saving} onClick={() => void handleSave()}>
                  <Edit2 size={16} className="mr-2" />
                  Salvar nota
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-6 xl:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <Input
                  label="Título sugerido"
                  placeholder="A IA pode preencher automaticamente"
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                />

                <Input
                  label="Tags"
                  placeholder="Separadas por vírgula"
                  value={form.tags}
                  onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`secondary-button !min-h-0 !px-4 !py-2 ${editorMode === "edit" ? "!border-accent/40 !bg-accent/10" : ""}`}
                  onClick={() => setEditorMode("edit")}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className={`secondary-button !min-h-0 !px-4 !py-2 ${editorMode === "preview" ? "!border-accent/40 !bg-accent/10" : ""}`}
                  onClick={() => setEditorMode("preview")}
                >
                  Preview
                </button>
              </div>

              {editorMode === "edit" ? (
                <div className="space-y-1.5">
                  <label className="field-label">Nota final em Markdown</label>
                  <textarea
                    className="field min-h-[29rem] resize-y"
                    placeholder="A IA ou você pode escrever a nota final aqui..."
                    value={form.content}
                    onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-border-soft bg-black/10 p-5 min-h-[29rem]">
                  {form.content.trim() ? (
                    <MarkdownPreview content={form.content} />
                  ) : (
                    <p className="text-sm text-secondary">Nada para visualizar ainda.</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border-soft bg-[linear-gradient(180deg,rgba(99,102,241,0.12),rgba(0,0,0,0.12))] p-4">
                <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-accent-strong">
                  <Bot size={14} />
                  Leitura da IA
                </p>
                <p className="text-sm leading-relaxed text-secondary">
                  {aiSummary || summarizeContent(form.content) || "A IA vai resumir o contexto da nota aqui após estruturar ou refinar o conteúdo."}
                </p>
              </div>

              <div className="rounded-2xl border border-border-soft bg-black/10 p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-muted">Metadados</p>
                <div className="space-y-3 text-sm text-secondary">
                  <MetaRow label="Autor" value={selectedNote?.author || user?.email || "--"} />
                  <MetaRow label="Criada em" value={selectedNote ? formatDateTime(selectedNote.created_at) : "--"} />
                  <MetaRow label="Atualizada em" value={selectedNote ? formatDateTime(selectedNote.updated_at) : "--"} />
                  <MetaRow label="Versão atual" value={selectedNote ? `v${selectedNote.current_version}` : "v1"} />
                </div>
              </div>

              <div className="rounded-2xl border border-border-soft bg-black/10 p-4">
                <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-muted">
                  <Tags size={14} />
                  Tags sugeridas
                </p>
                <div className="flex flex-wrap gap-2">
                  {currentTags.length > 0 ? currentTags.map((tag) => (
                    <span key={tag} className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent-strong">
                      #{tag}
                    </span>
                  )) : (
                    <p className="text-sm text-secondary">A IA vai sugerir tags com base no rascunho.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border-soft bg-black/10 p-4">
                <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-muted">
                  <Clock size={14} />
                  Pipeline
                </p>
                <div className="space-y-3 text-sm text-secondary">
                  <WorkflowStep label="1. Captura bruta" active={Boolean(captureInput.trim())}>
                    Você escreve ideias, atas, tarefas ou contexto solto.
                  </WorkflowStep>
                  <WorkflowStep label="2. Estruturação por IA" active={Boolean(aiSummary)}>
                    O Nexus organiza título, Markdown e tags.
                  </WorkflowStep>
                  <WorkflowStep label="3. Salvamento e busca" active={Boolean(selectedNote || draftMode === "edit")}>
                    Ao salvar, a nota entra no índice e fica disponível na busca e no chat.
                  </WorkflowStep>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>

      <Dialog
        open={deleteDialogOpen}
        title="Excluir nota"
        description="Essa ação remove a nota, o histórico de versões e os vetores indexados."
        onClose={() => {
          if (deleting) return;
          setDeleteDialogOpen(false);
        }}
        footer={(
          <>
            <Button variant="ghost" type="button" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button type="button" isLoading={deleting} onClick={() => void handleDelete()} disabled={!selectedNote}>
              Excluir definitivamente
            </Button>
          </>
        )}
      >
        <p className="text-sm text-secondary">
          {selectedNote
            ? `A nota “${selectedNote.title}” deixará de aparecer na busca e no chat.`
            : "Selecione uma nota antes de excluir."}
        </p>
      </Dialog>

      <Dialog
        open={historyDialogOpen}
        title="Histórico da nota"
        description="Snapshots completos gerados a cada salvamento."
        onClose={() => setHistoryDialogOpen(false)}
        panelClassName="!w-[min(96vw,72rem)]"
      >
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
            {loadingHistory && <p className="text-sm text-secondary">Carregando histórico...</p>}
            {!loadingHistory && versions.length === 0 && (
              <p className="text-sm text-secondary">Nenhuma versão encontrada.</p>
            )}
            {versions.map((version) => (
              <button
                key={version.version}
                type="button"
                className={`w-full rounded-xl border p-3 text-left ${
                  selectedVersion?.version === version.version
                    ? "border-accent/40 bg-accent/10"
                    : "border-border-soft bg-black/10 hover:border-border-strong"
                }`}
                onClick={() => setSelectedVersion(version)}
              >
                <p className="font-semibold text-primary">Versão {version.version}</p>
                <p className="text-xs text-secondary">{formatDateTime(version.snapshot_at)}</p>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-border-soft bg-black/10 p-4 min-h-[26rem]">
            {selectedVersion ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Título</p>
                  <p className="mt-1 text-lg font-semibold text-primary">{selectedVersion.title}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedVersion.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent-strong">
                      #{tag}
                    </span>
                  ))}
                </div>
                <div className="rounded-xl border border-border-soft bg-bg-surface p-4">
                  <MarkdownPreview content={selectedVersion.content} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-secondary">Selecione uma versão para visualizar.</p>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function WorkflowStep({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: string;
}) {
  return (
    <div className="rounded-xl border border-border-soft bg-bg-surface px-3 py-3">
      <div className="mb-1 flex items-center gap-2">
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${active ? "bg-success" : "bg-border-strong"}`} />
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">{label}</p>
      </div>
      <p className="text-sm text-secondary">{children}</p>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right text-primary">{value}</span>
    </div>
  );
}

function parseTags(rawValue: string): string[] {
  return Array.from(
    new Set(
      rawValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function summarizeContent(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= 180) return cleaned;
  return `${cleaned.slice(0, 177).trimEnd()}...`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-primary">
      {content.split("\n").map((line, index) => {
        const cleanLine = line.trim();
        if (!cleanLine) {
          return <div key={index} className="h-2" />;
        }
        if (cleanLine.startsWith("### ")) {
          return <h4 key={index} className="text-lg font-semibold">{cleanLine.replace(/^###\s+/, "")}</h4>;
        }
        if (cleanLine.startsWith("## ")) {
          return <h3 key={index} className="text-xl font-semibold">{cleanLine.replace(/^##\s+/, "")}</h3>;
        }
        if (cleanLine.startsWith("# ")) {
          return <h2 key={index} className="text-2xl font-bold">{cleanLine.replace(/^#\s+/, "")}</h2>;
        }
        if (cleanLine.startsWith("- ")) {
          return (
            <div key={index} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
              <p>{cleanLine.replace(/^-+\s*/, "")}</p>
            </div>
          );
        }
        return <p key={index} className="whitespace-pre-wrap">{cleanLine}</p>;
      })}
    </div>
  );
}
