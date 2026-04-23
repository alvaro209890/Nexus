import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword
} from "firebase/auth";
import { firebaseAuth, isFirebaseConfigured } from "../lib/firebase";
import { syncAuthenticatedUser } from "../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, (user) => {
      if (user) void router.replace("/");
    });
  }, [router]);

  async function handleEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth) return;
    setLoading(true);
    setError("");
    try {
      const credential =
        mode === "register"
          ? await createUserWithEmailAndPassword(firebaseAuth, email, password)
          : await signInWithEmailAndPassword(firebaseAuth, email, password);

      const token = await credential.user.getIdToken();
      await syncAuthenticatedUser(token);

      await router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na autenticacao.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-8">
      <div className="login-grid mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden rounded-[2.5rem]">
        <section className="relative flex flex-col justify-between bg-ink p-8 text-white md:p-12">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amberline font-display text-xl font-bold text-ink">
                N
              </div>
              <div>
                <p className="font-display text-2xl font-bold">Nexus</p>
                <p className="text-xs uppercase tracking-[0.26em] text-white/50">Archive OS</p>
              </div>
            </div>

            <h1 className="mt-16 max-w-2xl font-display text-5xl font-bold leading-[0.95] md:text-7xl">
              Uma memoria operacional para seus documentos.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/70">
              Organize PDFs, extraia conhecimento, converse com sua base e encontre evidencias em segundos.
            </p>
          </div>

          <div className="mt-12 grid gap-3 sm:grid-cols-3">
            <LoginFeature value="PDF" label="Docling" />
            <LoginFeature value="RAG" label="ChromaDB" />
            <LoginFeature value="IA" label="Groq" />
          </div>

          <div className="login-orb login-orb-one" />
          <div className="login-orb login-orb-two" />
        </section>

        <section className="glass-panel flex items-center justify-center rounded-none p-6 md:p-12">
          <div className="w-full max-w-md">
            <p className="eyebrow">Acesso seguro</p>
            <h2 className="mt-3 font-display text-4xl font-bold">
              {mode === "login" ? "Entrar no Nexus" : "Criar acesso"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slateblue">
              Autenticacao via Firebase com e-mail e senha. Cada conta recebe uma area isolada no Nexus.
            </p>

            {!isFirebaseConfigured && (
              <div className="mt-6 rounded-2xl border border-amberline/40 bg-amberline/10 p-4 text-sm text-ink">
                Configure as variaveis `NEXT_PUBLIC_FIREBASE_*` em `frontend/.env.local`.
              </div>
            )}

            <form className="mt-8 space-y-4" onSubmit={handleEmailAuth}>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slateblue">E-mail</span>
                <input
                  className="field"
                  type="email"
                  placeholder="email@dominio.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slateblue">Senha</span>
                <input
                  className="field"
                  type="password"
                  placeholder="Minimo 6 caracteres"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={6}
                  required
                />
              </label>
              {error && (
                <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
              )}
              <button
                className="primary-button w-full disabled:cursor-not-allowed disabled:opacity-50"
                type="submit"
                disabled={loading || !isFirebaseConfigured}
              >
                {loading ? "Processando..." : mode === "login" ? "Entrar" : "Registrar"}
              </button>
            </form>

            <button
              className="mt-6 text-sm font-bold text-slateblue"
              type="button"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? "Criar uma nova conta" : "Ja tenho conta"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function LoginFeature({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
      <p className="font-display text-3xl font-bold text-amberline">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.24em] text-white/50">{label}</p>
    </div>
  );
}
