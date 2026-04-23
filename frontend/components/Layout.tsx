import React, { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const { user, logout, authSyncing } = useAuth();

  const navItems = [
    { label: "Início", path: "/", icon: <DashboardIcon /> },
    { label: "Documentos", path: "/documents", icon: <DocsIcon /> },
    { label: "Arquivos", path: "/files", icon: <FilesIcon /> },
    { label: "Busca", path: "/search", icon: <SearchIcon /> },
    { label: "Chat", path: "/chat", icon: <ChatIcon /> },
  ];

  if (router.pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="page-shell">
      <header className="nav-surface">
        <div className="page-container">
          <div className="mobile-stack md:flex md:items-center md:justify-between md:gap-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-[rgba(126,178,214,0.14)] text-sm font-bold text-white">
                  N
                </div>
                <div>
                  <h1 className="font-display text-lg font-bold tracking-tight">Nexus</h1>
                  <p className="eyebrow !text-[0.55rem]">Archive OS</p>
                </div>
              </div>

              <button
                onClick={logout}
                className="secondary-button !min-h-[2.4rem] !px-3 !py-2 text-xs md:hidden"
              >
                <LogoutIcon />
                Sair
              </button>
            </div>

            <div className="flex flex-col gap-3 md:flex-1 md:items-end">
              <nav className="nav-list" aria-label="Navegação principal">
                {navItems.map((item) => {
                  const isActive = router.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      aria-current={isActive ? "page" : undefined}
                      className={`nav-pill ${isActive ? "nav-pill-active" : ""}`}
                    >
                      {React.cloneElement(item.icon as React.ReactElement, { className: "w-4 h-4" })}
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              <div className="hidden md:flex md:items-center md:gap-3">
                <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-[rgba(26,31,39,0.72)] px-3 py-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(126,178,214,0.14)] text-xs font-bold uppercase text-white">
                    {user?.email?.charAt(0) || "U"}
                  </div>
                  <div className="overflow-hidden">
                    <p className="truncate text-xs font-bold">{user?.email || "Usuário"}</p>
                    <p className="text-[0.68rem] text-slateblue/60">Sessão ativa</p>
                  </div>
                </div>
                <button onClick={logout} className="secondary-button !min-h-[2.4rem] !px-3 !py-2 text-xs">
                  <LogoutIcon />
                  Sair
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="page-container page-stack relative">
        {children}
      </main>

      {/* Global Syncing Overlay */}
      {authSyncing && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[rgba(19,23,29,0.78)] backdrop-blur-md">
          <div className="mb-4 h-16 w-16 rounded-full border-4 border-white/15 border-t-[var(--accent)] animate-spin"></div>
          <p className="eyebrow">Sincronizando ambiente...</p>
        </div>
      )}
    </div>
  );
}

function DashboardIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function DocsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}
