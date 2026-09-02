import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authApi } from "@/lib/authApi";
import type { AuthUser } from "@/types/auth";

/**
 * The frontend's one source of truth for "is anyone signed in right
 * now" -- "loading" only while the initial GET /api/auth/me (fired once,
 * on mount, below) hasn't resolved yet; every other action updates this
 * directly from that action's own response, so nothing here ever
 * re-fetches /me just to confirm what it was already just told.
 *
 * Guest play never touches this at all: PlayerSetup, GameQuestion and
 * every other game screen read nothing from this context and work
 * identically whether status is "guest" or "authenticated".
 */

type AuthStatus = "loading" | "authenticated" | "guest";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Called by Login/SignUp with the user their request just returned --
   *  no extra round trip to /api/auth/me needed to reflect it. */
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUserState] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then((res) => {
        if (cancelled) return;
        if (res.authenticated && res.user) {
          setUserState(res.user);
          setStatus("authenticated");
        } else {
          setStatus("guest");
        }
      })
      .catch(() => {
        // A failed /me (server unreachable, etc.) means "can't confirm
        // you're signed in" -- treat as guest rather than leaving the
        // whole app stuck on a loading state forever. Guest play still
        // works either way.
        if (!cancelled) setStatus("guest");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setUser = (nextUser: AuthUser) => {
    setUserState(nextUser);
    setStatus("authenticated");
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      // Treated as logged out locally even if the network call itself
      // failed -- there is no worse state to be stuck in than believing
      // you're signed out while the UI still shows you signed in.
      setUserState(null);
      setStatus("guest");
    }
  };

  return (
    <AuthContext.Provider value={{ status, user, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
