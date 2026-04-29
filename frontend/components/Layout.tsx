import React, { ReactNode, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";
import { AlertCircle, LayoutDashboard, FileText, FolderTree, Search, MessageSquare, LogOut, Menu, X, User } from "lucide-react";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const { user, authProfile, logout, authSyncing, error: authError } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const displayName = authProfile?.display_name || user?.displayName || authProfile?.email?.split("@")[0] || user?.email?.split("@")[0] || "Usuário";
  const displayEmail = authProfile?.email || user?.email || "E-mail não disponível";
  const userInitial = (displayName || displayEmail).charAt(0).toUpperCase();
  const providerLabel = formatProvider(authProfile?.provider_ids?.[0]);
  const shortUid = authProfile?.uid ? `${authProfile.uid.slice(0, 8)}...${authProfile.uid.slice(-4)}` : "";

  const navItems = [
    { label: "Início", path: "/", icon: <LayoutDashboard size={18} /> },
    { label: "Documentos", path: "/documents", icon: <FileText size={18} /> },
    { label: "Arquivos", path: "/files", icon: <FolderTree size={18} /> },
    { label: "Notas", path: "/notes", icon: <FileText size={18} /> },
    { label: "Busca", path: "/search", icon: <Search size={18} /> },
    { label: "Chat", path: "/chat", icon: <MessageSquare size={18} /> },
  ];

  if (router.pathname === "/login" || router.pathname === "/admin") {
    return <>{children}</>;
  }

  return (
    <div className="page-shell">
      <header className="nav-surface">
        <div className="page-container flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Image
                  src="/nexus-icon.png"
                  alt="Nexus"
                  width={40}
                  height={40}
                  className="rounded-xl object-cover"
                />
              </div>
              <div className="hidden md:block">
                <h1 className="text-xl font-bold tracking-tight text-white m-0">Nexus</h1>
              </div>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex nav-list" aria-label="Navegação principal">
              {navItems.map((item) => {
                const isActive = router.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    aria-current={isActive ? "page" : undefined}
                    className={`nav-pill ${isActive ? "nav-pill-active" : ""}`}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* User Profile & Actions */}
          <div className="flex items-center gap-3">
            <div className="hidden min-w-0 items-center gap-3 rounded-full border border-border-soft bg-[var(--bg-surface-strong)] px-4 py-1.5 md:flex">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold uppercase text-accent">
                {userInitial}
              </div>
              <div className="min-w-0 max-w-[16rem] overflow-hidden">
                <p className="m-0 truncate text-sm font-semibold text-primary">{displayName}</p>
                <p className="m-0 truncate text-[0.68rem] font-medium text-secondary">
                  {displayEmail}
                </p>
              </div>
              <span className="rounded-full border border-border-soft px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.08em] text-accent-strong">
                {authSyncing ? "sync" : providerLabel}
              </span>
            </div>
            
            <button 
              onClick={logout} 
              className="hidden md:flex ghost-button text-muted hover:text-danger hover:bg-danger/10"
              title="Sair da conta"
            >
              <LogOut size={18} />
              <span className="sr-only">Sair</span>
            </button>

            {/* Mobile Menu Toggle */}
            <button 
              className="md:hidden ghost-button px-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-surface-strong border-b border-border-soft shadow-panel backdrop-blur-xl animate-slide-up">
            <nav className="flex flex-col p-4 gap-2">
              {navItems.map((item) => {
                const isActive = router.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={`flex items-center gap-3 p-3 rounded-lg font-medium ${isActive ? "bg-accent-soft text-primary" : "text-secondary hover:bg-white/5"}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
              <div className="h-px bg-border-soft my-2" />
              <div className="flex items-center justify-between p-3 rounded-lg text-secondary">
                <div className="flex min-w-0 items-center gap-3">
                  <User size={18} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-primary">{displayName}</p>
                    <p className="truncate text-xs text-secondary">{displayEmail}</p>
                    {shortUid && <p className="truncate text-[0.68rem] text-muted">UID {shortUid}</p>}
                  </div>
                </div>
                <button 
                  onClick={logout} 
                  className="flex items-center gap-2 text-danger hover:bg-danger/10 px-3 py-1.5 rounded-md"
                >
                  <LogOut size={16} />
                  Sair
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="page-container page-stack relative">
        {authError && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm font-medium text-danger">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">Dados do usuário não sincronizados</p>
                <p className="mt-1 text-danger/90">{authError}</p>
              </div>
            </div>
          </div>
        )}
        {children}
      </main>

      {/* Global Syncing Overlay */}
      {authSyncing && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-white/10 border-t-accent animate-spin"></div>
            <Image src="/nexus-icon.png" alt="" width={48} height={48} className="rounded-xl object-cover" />
          </div>
          <p className="eyebrow text-primary">Sincronizando ambiente...</p>
        </div>
      )}
    </div>
  );
}

function formatProvider(providerId?: string): string {
  if (!providerId) return "conta";
  if (providerId === "password") return "senha";
  if (providerId === "google.com") return "google";
  return providerId.replace(".com", "");
}
