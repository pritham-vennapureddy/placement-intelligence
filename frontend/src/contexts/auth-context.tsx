import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authApi, setAccessToken, setSessionExpiredHandler } from "../services/api";
import type { AuthUser } from "../types/api";

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retrySession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retrySession = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const session = await authApi.refresh();
      setUser(session?.user ?? null);
      setStatus(session ? "authenticated" : "unauthenticated");
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Could not restore your session.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setUser(null);
      setStatus("unauthenticated");
    });
    void retrySession();
  }, [retrySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const session = await authApi.login(email, password);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, error, signIn, signOut, retrySession }),
    [status, user, error, signIn, signOut, retrySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return context;
}
