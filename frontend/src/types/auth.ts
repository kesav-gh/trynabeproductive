/**
 * Wire types for the Phase 4.2 authentication endpoints
 * (cricket-stats-game/auth_api.py). Deliberately minimal: only the
 * fields public_user() in auth_api.py ever returns -- never a password
 * hash, never anything else that might get added to the users table
 * later without both sides being revisited together.
 *
 * displayName/avatarUrl come from Phase 4.3's profiles table, folded
 * into this SAME user object rather than a second, parallel "profile"
 * shape -- see PROFILE.md for why. Every auth response (register, login,
 * me) already includes them; profileApi.ts's responses share this exact
 * type so a profile update can flow straight back into AuthContext.
 */

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  createdAt: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface MeResponse {
  authenticated: boolean;
  user: AuthUser | null;
}
