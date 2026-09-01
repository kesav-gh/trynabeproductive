/**
 * Shared fetch wrapper for both lib/api.ts (the game) and lib/authApi.ts
 * (Phase 4.2's auth endpoints). Requests go to relative /api/... paths;
 * Vite's dev server proxies those to the Flask backend on :5000 (see
 * vite.config.ts), so from the browser's point of view every request is
 * same-origin -- no CORS headers, no cross-site cookie handling, and
 * the Flask session cookie (game state, and now who's logged in) just
 * works, the same way it already does for the original HTML pages.
 */

import { ApiError } from "@/types/api";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Merged explicitly rather than via `{...defaults, ...init}`: a naive
  // spread would let a caller's own `headers` object silently replace
  // the default Content-Type instead of adding to it, which is exactly
  // what auth requests need (Content-Type AND a CSRF header together).
  const headers: Record<string, string> = {};
  if (init?.body) headers["Content-Type"] = "application/json";
  Object.assign(headers, init?.headers as Record<string, string> | undefined);

  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Is it running?");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, "SERVER_ERROR", "The server sent back something unexpected.");
  }

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? "Something went wrong.");
  }

  return (body as { data: T }).data;
}

export { ApiError };
