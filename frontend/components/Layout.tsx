import React, { ReactNode, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";
import { LayoutDashboard, FileText, FolderTree, Search, MessageSquare, LogOut, Menu, X, User } from "lucide-react";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const { user, logout, authSyncing } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { label: "Início", path: "/", icon: <LayoutDashboard size={18} /> },
    { label: "Documentos", path: "/documents", icon: <FileText size={18} /> },
    { label: "Arquivos", path: "/files", icon: <FolderTree size={18} /> },
    { label: "Busca", path: "/search", icon: <Search size={18} /> },
    { label: "Chat", path: "/chat", icon: <MessageSquare size={18} /> },
  ];

  if (router.pathname === "/login") {
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
            <div className="hidden md:flex items-center gap-3 rounded-full bg-surface-strong px-4 py-1.5 border border-border-soft">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-bold uppercase text-accent">
                {user?.email?.charAt(0) || "U"}
              </div>
              <div className="overflow-hidden">
                <p className="truncate text-sm font-medium m-0">{user?.email || "Usuário"}</p>
              </div>
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
                <div className="flex items-center gap-3 truncate">
                  <User size={18} />
                  <span className="truncate">{user?.email || "Usuário"}</span>
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

