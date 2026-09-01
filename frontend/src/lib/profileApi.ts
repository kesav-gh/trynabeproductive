/**
 * Client for Phase 4.3's profile endpoints
 * (cricket-stats-game/profile_api.py). Both responses share the exact
 * same shape as AuthContext's user object (see types/auth.ts) -- a
 * successful update can be handed straight to useAuth().setUser()
 * without a second GET to confirm what was just returned.
 */

import { request } from "@/lib/http";
import { csrfHeaders } from "@/lib/csrf";
import type { AuthUser } from "@/types/auth";

export interface ProfileUpdate {
  displayName?: string;
  avatarUrl?: string | null;
}

/** Phase 4.5 -- GET /api/profile/progression's response shape, exactly
 *  as profile_api.py returns it. `xp` and `level` are read fresh from
 *  Postgres on every call; nothing here is ever computed or cached
 *  client-side. */
export interface Progression {
  xp: number;
  level: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  progressPercent: number;
}

export const profileApi = {
  get: () => request<AuthUser>("/api/profile"),

  update: (updates: ProfileUpdate) =>
    request<AuthUser>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(updates),
      headers: csrfHeaders(),
    }),

  progression: () => request<Progression>("/api/profile/progression"),
};
