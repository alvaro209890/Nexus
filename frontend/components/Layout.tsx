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
    { label: "Dashboard", path: "/", icon: <DashboardIcon /> },
    { label: "Documentos", path: "/documents", icon: <DocsIcon /> },
    { label: "Arquivos", path: "/files", icon: <FilesIcon /> },
    { label: "Busca Semântica", path: "/search", icon: <SearchIcon /> },
    { label: "IA Chat", path: "/chat", icon: <ChatIcon /> },
  ];

  if (router.pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-72 glass-panel border-r border-white/40 flex flex-col fixed h-full z-20">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-ink rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-amberline font-bold text-xl">N</span>
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight">NEXUS</h1>
              <p className="eyebrow !text-[0.6rem]">Archive OS v1.0</p>
            </div>
          </div>

          <nav className="space-y-2">
            {navItems.map((item) => {
              const isActive = router.pathname === item.path;
              return (
                <Link 
                  key={item.path} 
                  href={item.path}
                  className={`nav-pill ${isActive ? "nav-pill-active" : ""}`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto p-6 border-t border-white/20">
          <div className="flex items-center gap-3 mb-6 p-2">
            <div className="w-10 h-10 rounded-full bg-slateblue/20 flex items-center justify-center border border-slateblue/30">
              <span className="text-slateblue font-bold uppercase">{user?.email?.charAt(0) || "U"}</span>
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold truncate">{user?.email || "Usuário"}</p>
              <p className="eyebrow !text-[0.55rem]">Operador Online</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full secondary-button !py-2 text-xs flex items-center justify-center gap-2"
          >
            <LogoutIcon />
            Sair do Sistema
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-72 p-10 min-h-screen relative">
        <div className="max-w-6xl mx-auto relative z-10">
          {children}
        </div>
        
        {/* Decorative Orbs */}
        <div className="orb orb-one opacity-30"></div>
        <div className="orb orb-two opacity-20"></div>
      </main>

      {/* Global Syncing Overlay */}
      {authSyncing && (
        <div className="fixed inset-0 bg-porcelain/60 backdrop-blur-md z-[100] flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-ink border-t-amberline rounded-full animate-spin mb-4"></div>
          <p className="eyebrow">Sincronizando Ambiente...</p>
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
