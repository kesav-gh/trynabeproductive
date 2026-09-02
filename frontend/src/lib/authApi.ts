/**
 * Client for the Phase 4.2 authentication API
 * (cricket-stats-game/auth_api.py). Every mutating call attaches the
 * CSRF header the backend requires for it -- see csrf.ts and
 * cricket-stats-game/csrf.py for how that round-trips.
 */

import { request } from "@/lib/http";
import { csrfHeaders } from "@/lib/csrf";
import type { AuthUser, MeResponse } from "@/types/auth";

const authPost = <T>(path: string, payload: unknown) =>
  request<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: csrfHeaders(),
  });

export const authApi = {
  register: (email: string, username: string, password: string, confirmPassword: string) =>
    authPost<{ user: AuthUser }>("/api/auth/register", { email, username, password, confirmPassword }),

  login: (login: string, password: string) =>
    authPost<{ user: AuthUser }>("/api/auth/login", { login, password }),

  logout: () => authPost<{ loggedOut: boolean }>("/api/auth/logout", {}),

  me: () => request<MeResponse>("/api/auth/me"),
};
