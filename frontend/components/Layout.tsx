import React, { ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";
import { AlertCircle, LayoutDashboard, FileText, FolderTree, Search, MessageSquare, LogOut, Menu, X, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const { user, authProfile, logout, authSyncing, error: authError } = useAuth();
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const displayName = authProfile?.display_name || user?.displayName || authProfile?.email?.split("@")[0] || user?.email?.split("@")[0] || "Usuário";
  const displayEmail = authProfile?.email || user?.email || "E-mail não disponível";
  const userInitial = (displayName || displayEmail).charAt(0).toUpperCase();
  const providerLabel = formatProvider(authProfile?.provider_ids?.[0]);

  const navItems = [
    { label: "Início", path: "/", icon: <LayoutDashboard size={20} /> },
    { label: "Documentos", path: "/documents", icon: <FileText size={20} /> },
    { label: "Arquivos", path: "/files", icon: <FolderTree size={20} /> },
    { label: "Notas", path: "/notes", icon: <FileText size={20} /> },
    { label: "Busca", path: "/search", icon: <Search size={20} /> },
    { label: "Chat", path: "/chat", icon: <MessageSquare size={20} /> },
  ];

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [router.pathname]);

  if (router.pathname === "/login" || router.pathname === "/admin") {
    return <>{children}</>;
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background text-primary selection:bg-accent/20">
      
      {/* Desktop Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarCollapsed ? 80 : 256 }}
        className="hidden md:flex flex-col border-r border-border-soft bg-surface-strong/50 backdrop-blur-xl z-30 shadow-panel transition-all duration-300"
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-border-soft shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent overflow-hidden">
              <Image src="/nexus-icon.png" alt="Nexus" width={40} height={40} className="object-cover" />
            </div>
            {!isSidebarCollapsed && (
              <motion.h1 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-xl font-display font-bold tracking-tight text-white whitespace-nowrap"
              >
                Nexus
              </motion.h1>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar py-6 flex flex-col gap-2 px-3">
          {navItems.map((item) => {
            const isActive = router.pathname === item.path;
            return (
              <Link key={item.path} href={item.path} title={isSidebarCollapsed ? item.label : undefined}>
                <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-200 group relative
                  ${isActive ? "bg-accent/15 text-accent font-semibold" : "text-secondary hover:bg-white/5 hover:text-primary"}
                `}>
                  {isActive && (
                    <motion.div layoutId="sidebar-active" className="absolute left-0 w-1 h-6 bg-accent rounded-r-full" />
                  )}
                  <span className={`${isActive ? "text-accent" : "text-muted group-hover:text-primary"}`}>{item.icon}</span>
                  {!isSidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </div>
              </Link>
            );
          })}
        </div>

        <div className="p-3 border-t border-border-soft shrink-0 flex flex-col gap-3">
          <button 
            onClick={() => setSidebarCollapsed(!isSidebarCollapsed)} 
            className="flex items-center justify-center w-full py-2 rounded-xl text-muted hover:bg-white/5 transition-colors"
          >
            {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          
          <div className="flex items-center gap-3 p-2 rounded-xl bg-bg-surface border border-border-soft overflow-hidden group relative">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-sm font-bold text-accent">
              {userInitial}
            </div>
            {!isSidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-semibold text-primary leading-tight">{displayName}</p>
                <p className="truncate text-xs text-muted">{providerLabel}</p>
              </div>
            )}
            
            {/* Logout button popover */}
            <div className="absolute inset-0 bg-bg-surface-strong opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
               <button 
                 onClick={logout}
                 className="flex items-center justify-center w-full h-full text-danger hover:bg-danger/10 transition-colors rounded-xl"
                 title="Sair"
               >
                 <LogOut size={18} />
               </button>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Mobile Header */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-16 border-b border-border-soft bg-surface-strong/80 backdrop-blur-xl z-40 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent overflow-hidden">
            <Image src="/nexus-icon.png" alt="Nexus" width={32} height={32} className="object-cover" />
          </div>
          <h1 className="text-lg font-display font-bold tracking-tight text-white">Nexus</h1>
        </div>
        <button className="text-primary p-2 -mr-2" onClick={() => setMobileMenuOpen(true)}>
          <Menu size={24} />
        </button>
      </header>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.div 
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="md:hidden fixed top-0 right-0 bottom-0 w-[280px] bg-surface-strong border-l border-border-soft z-50 flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between p-4 border-b border-border-soft">
                <span className="font-bold text-lg">Menu</span>
                <button onClick={() => setMobileMenuOpen(false)} className="p-2 -mr-2 text-muted hover:text-primary">
                  <X size={24} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {navItems.map((item) => {
                  const isActive = router.pathname === item.path;
                  return (
                    <Link key={item.path} href={item.path}>
                      <div className={`flex items-center gap-3 p-3 rounded-xl font-medium transition-colors
                        ${isActive ? "bg-accent/15 text-accent" : "text-secondary hover:bg-white/5"}
                      `}>
                        {item.icon}
                        <span>{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
              
              <div className="p-4 border-t border-border-soft bg-black/20">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent font-bold">
                    {userInitial}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-primary">{displayName}</p>
                    <p className="truncate text-xs text-muted">{displayEmail}</p>
                  </div>
                </div>
                <button 
                  onClick={logout}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-danger/10 text-danger font-medium hover:bg-danger/20 transition-colors"
                >
                  <LogOut size={18} /> Sair da conta
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full min-w-0 md:pt-0 pt-16 relative">
        <div className="flex-1 overflow-y-auto custom-scrollbar relative w-full h-full">
          <div className="w-full max-w-[90rem] mx-auto p-4 md:p-8 relative min-h-full flex flex-col">
            {authError && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 rounded-xl border border-danger/30 bg-danger/10 p-4 shadow-sm backdrop-blur-md">
                <div className="flex items-start gap-3">
                  <AlertCircle size={18} className="mt-0.5 shrink-0 text-danger" />
                  <div>
                    <p className="font-bold text-danger text-sm">Problema de Sincronização</p>
                    <p className="mt-1 text-danger/80 text-sm">{authError}</p>
                  </div>
                </div>
              </motion.div>
            )}
            
            <AnimatePresence mode="wait">
              <motion.div
                key={router.pathname}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex-1 flex flex-col"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Global Syncing Overlay */}
      <AnimatePresence>
        {authSyncing && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/80 backdrop-blur-md"
          >
            <div className="relative mb-6 flex h-24 w-24 items-center justify-center">
              <motion.div 
                animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                className="absolute inset-0 rounded-full border-[3px] border-white/5 border-t-accent"
              />
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent overflow-hidden">
                <Image src="/nexus-icon.png" alt="" width={56} height={56} className="object-cover" />
              </div>
            </div>
            <p className="font-display font-semibold tracking-wider text-sm text-primary uppercase animate-pulse">Sincronizando Sistema</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatProvider(providerId?: string): string {
  if (!providerId) return "Conta Local";
  if (providerId === "password") return "E-mail";
  if (providerId === "google.com") return "Google";
  return providerId.replace(".com", "");
}
