import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword
} from "firebase/auth";
import { firebaseAuth, isFirebaseConfigured } from "../lib/firebase";
import { syncAuthenticatedUser } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

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
      setError(err instanceof Error ? err.message : "Falha na autenticação.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-8 bg-porcelain">
      <div className="login-grid mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden rounded-[2.5rem] shadow-2xl">
        <section className="relative flex flex-col justify-between bg-ink p-8 text-white md:p-12 overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amberline font-display text-xl font-bold text-ink shadow-lg">
                N
              </div>
              <div>
                <p className="font-display text-2xl font-bold">Nexus</p>
                <p className="text-xs uppercase tracking-[0.26em] text-white/50">Archive OS v1.0</p>
              </div>
            </div>

            <h1 className="mt-16 max-w-2xl font-display text-5xl font-bold leading-[0.95] md:text-7xl tracking-tighter">
              Uma memória operacional para seus documentos.
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-white/70">
              Organize PDFs, extraia conhecimento, converse com sua base e encontre evidências em segundos com IA avançada.
            </p>
          </div>

          <div className="relative z-10 mt-12 grid gap-3 sm:grid-cols-3">
            <LoginFeature value="PDF" label="Docling" />
            <LoginFeature value="AI" label="DeepSeek" />
            <LoginFeature value="RAG" label="Groq" />
          </div>

          {/* Decorative Orbs inside the dark section */}
          <div className="absolute right-[-10%] top-[20%] w-64 h-64 bg-amberline/20 rounded-full blur-[100px]" />
          <div className="absolute left-[10%] bottom-[-5%] w-80 h-80 bg-slateblue/20 rounded-full blur-[100px]" />
        </section>

        <section className="glass-panel flex items-center justify-center rounded-none p-6 md:p-12 relative">
          <div className="w-full max-w-md relative z-10">
            <p className="eyebrow">Acesso Restrito</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-tight">
              {mode === "login" ? "Entrar no Nexus" : "Criar Nova Conta"}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slateblue font-medium">
              Utilize suas credenciais para acessar o ambiente de análise vetorial.
            </p>

            {!isFirebaseConfigured && (
              <div className="mt-6 rounded-2xl border border-amberline/40 bg-amberline/10 p-4 text-sm text-ink font-bold">
                Atenção: Firebase não configurado no ambiente.
              </div>
            )}

            <form className="mt-10 space-y-5" onSubmit={handleEmailAuth}>
              <Input 
                label="E-mail Corporativo"
                type="email"
                placeholder="nome@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input 
                label="Senha de Acesso"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
              
              {error && (
                <p className="rounded-2xl bg-red-50 p-4 text-xs font-bold text-red-700 border border-red-100">{error}</p>
              )}
              
              <Button
                type="submit"
                className="w-full !py-4"
                isLoading={loading}
                disabled={!isFirebaseConfigured}
              >
                {mode === "login" ? "Autenticar Sistema" : "Registrar Operador"}
              </Button>
            </form>

            <div className="mt-8 pt-6 border-t border-white/40 flex justify-between items-center">
              <button
                className="text-xs font-bold text-slateblue hover:text-ink transition-colors uppercase tracking-widest"
                type="button"
                onClick={() => setMode(mode === "login" ? "register" : "login")}
              >
                {mode === "login" ? "Solicitar Novo Acesso" : "Voltar para Login"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function LoginFeature({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm group hover:bg-white/10 transition-colors">
      <p className="font-display text-3xl font-bold text-amberline">{value}</p>
      <p className="mt-1 text-[0.6rem] uppercase tracking-[0.24em] text-white/50 font-bold">{label}</p>
    </div>
  );
}
