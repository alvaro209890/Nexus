import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
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
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-[rgba(19,23,29,0.88)] shadow-2xl lg:grid-cols-[1.2fr_0.95fr]">
        <section className="relative flex flex-col justify-between border-b border-white/10 bg-[rgba(22,27,35,0.92)] p-7 text-white md:p-10 lg:border-b-0 lg:border-r">
          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <Image
                src="/nexus-icon.png"
                alt="Icone Nexus"
                width={48}
                height={48}
                className="rounded-2xl border border-white/10 object-cover shadow-lg"
              />
              <div>
                <p className="font-display text-2xl font-bold">Nexus</p>
                <p className="text-xs uppercase tracking-[0.16em] text-white/55">Archive OS v1.0</p>
              </div>
            </div>

            <Image
              src="/nexus-logo.png"
              alt="Nexus Gestao de Dados"
              width={420}
              height={120}
              className="mt-12 h-auto w-full max-w-[420px] object-contain"
            />

            <h1 className="mt-8 max-w-2xl font-display text-4xl font-bold leading-tight md:text-6xl">
              Uma memória operacional para seus documentos.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/72 md:text-lg">
              Organize PDFs, extraia conhecimento, converse com sua base e encontre evidências com menos atrito.
            </p>
          </div>

          <div className="relative z-10 mt-10 grid gap-3 sm:grid-cols-3">
            <LoginFeature value="PDF" label="Biblioteca central" />
            <LoginFeature value="IA" label="Respostas guiadas" />
            <LoginFeature value="RAG" label="Busca contextual" />
          </div>
        </section>

        <section className="glass-panel flex items-center justify-center rounded-none p-6 md:p-10 relative">
          <div className="w-full max-w-md relative z-10">
            <p className="eyebrow">Acesso Restrito</p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-4xl">
              {mode === "login" ? "Entrar no Nexus" : "Criar Nova Conta"}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slateblue font-medium">
              Use seu e-mail e senha para acessar o ambiente privado.
            </p>

            {!isFirebaseConfigured && (
              <div className="mt-6 rounded-2xl border border-[rgba(215,177,106,0.35)] bg-[rgba(215,177,106,0.12)] p-4 text-sm text-white">
                O login ainda nao esta configurado neste ambiente. Revise as variaveis do Firebase antes de tentar entrar.
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
                <p className="rounded-2xl border border-[rgba(228,149,149,0.3)] bg-[rgba(228,149,149,0.12)] p-4 text-sm font-medium text-white">{error}</p>
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

            <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-6">
              <button
                className="text-xs font-bold text-slateblue hover:text-white transition-colors uppercase tracking-[0.08em]"
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
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm transition-colors">
      <p className="font-display text-3xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[0.68rem] uppercase tracking-[0.08em] text-white/60 font-bold">{label}</p>
    </div>
  );
}

function mapAuthError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Nao foi possivel concluir a autenticacao. Tente novamente.";
  }

  const message = error.message.toLowerCase();

  if (message.includes("invalid-credential") || message.includes("wrong-password") || message.includes("user-not-found")) {
    return "Usuario ou senha incorretos. Revise os dados e tente novamente.";
  }

  if (message.includes("email-already-in-use")) {
    return "Este e-mail ja esta em uso. Entre com a conta existente ou use outro endereco.";
  }

  if (message.includes("weak-password")) {
    return "A senha precisa ter pelo menos 6 caracteres.";
  }

  if (message.includes("too-many-requests")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }

  if (message.includes("network")) {
    return "Nao foi possivel conectar ao servico de login. Verifique sua conexao e tente novamente.";
  }

  return "Nao foi possivel concluir a autenticacao. Tente novamente em instantes.";
}
