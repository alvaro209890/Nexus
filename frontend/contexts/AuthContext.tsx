import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/router";
import { onIdTokenChanged, type User } from "firebase/auth";
import { firebaseAuth } from "../lib/firebase";
import { AuthenticatedUserProfile, syncAuthenticatedUser } from "../lib/api";

interface AuthContextType {
  user: User | null;
  authProfile: AuthenticatedUserProfile | null;
  authChecked: boolean;
  authSyncing: boolean;
  error: string;
  getCurrentToken: () => Promise<string>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authProfile, setAuthProfile] = useState<AuthenticatedUserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authSyncing, setAuthSyncing] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseAuth) {
      setAuthChecked(true);
      setAuthSyncing(false);
      return;
    }

    return onIdTokenChanged(firebaseAuth, async (currentUser) => {
      setAuthChecked(true);

      if (!currentUser) {
        setUser(null);
        setAuthProfile(null);
        setAuthSyncing(false);
        // Only redirect to login if we are not already on the login page
        if (router.pathname !== "/login") {
          void router.replace("/login");
        }
        return;
      }

      setUser(currentUser);
      setAuthSyncing(true);
      try {
        const token = await currentUser.getIdToken();
        const profile = await syncAuthenticatedUser(token);
        setAuthProfile(profile);
        setError("");
      } catch (err) {
        setAuthProfile(null);
        setError(err instanceof Error ? err.message : "Falha ao sincronizar o usuário.");
      } finally {
        setAuthSyncing(false);
      }
    });
  }, [router]);

  async function getCurrentToken(): Promise<string> {
    const currentUser = firebaseAuth?.currentUser;
    if (!currentUser) throw new Error("Sessão expirada. Entre novamente.");
    return currentUser.getIdToken();
  }

  async function logout() {
    if (firebaseAuth) {
      await firebaseAuth.signOut();
      router.push("/login");
    }
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      authProfile, 
      authChecked, 
      authSyncing, 
      error, 
      getCurrentToken,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
