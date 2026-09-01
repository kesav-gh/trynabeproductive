import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/http";
import { profileApi, type Progression } from "@/lib/profileApi";

/** Phase 4.5 -- level/XP standing, fetched once on mount alongside the
 *  rest of the profile. A self-contained section so a failure loading
 *  it (or the database being briefly unreachable) never blocks the
 *  identity fields above it from rendering. */
function LevelProgress() {
  const [progression, setProgression] = useState<Progression | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    profileApi
      .progression()
      .then((p) => {
        if (!cancelled) setProgression(p);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your level right now.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-xs text-chalk-faint">{error}</p>;
  if (!progression) return <p className="text-xs text-chalk-faint">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-lg font-semibold text-chalk">Level {progression.level}</span>
        <span className="tabular text-sm text-chalk-dim">{progression.xp.toLocaleString()} XP</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-pitch-750"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progression.progressPercent}
        aria-label="Progress to next level"
      >
        <div
          className="h-full rounded-full bg-mint-500 transition-all duration-300"
          style={{ width: `${progression.progressPercent}%` }}
        />
      </div>
      <span className="text-xs text-chalk-faint">
        {progression.xpToNextLevel > 0
          ? `${progression.xpToNextLevel.toLocaleString()} XP to level ${progression.level + 1}`
          : "Max level reached"}
      </span>
    </div>
  );
}

/**
 * Requires authentication -- a guest landing here (a bookmark, a stale
 * link) is sent to /login rather than shown an empty or broken page.
 * Guest play itself never links here; the nav only shows "Profile" once
 * AuthContext's status is "authenticated" (see AppShell.tsx).
 */
export function Profile() {
  const { status, user, setUser, logout } = useAuth();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === "guest") navigate("/login");
  }, [status, navigate]);

  const startEditing = () => {
    setDisplayName(user?.displayName ?? "");
    setAvatarUrl(user?.avatarUrl ?? "");
    setFieldError(undefined);
    setServerError(undefined);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setFieldError(undefined);
    setServerError(undefined);
  };

  const save = async () => {
    if (!displayName.trim()) {
      setFieldError("Display name can't be empty.");
      return;
    }
    setFieldError(undefined);
    setServerError(undefined);
    setSaving(true);
    try {
      const updated = await profileApi.update({
        displayName: displayName.trim(),
        avatarUrl: avatarUrl.trim() || null,
      });
      setUser(updated);
      setEditing(false);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Couldn't save your changes. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || (status === "authenticated" && !user)) {
    return (
      <AppShell>
        <div className="flex min-h-[40dvh] items-center justify-center">
          <p className="text-sm text-chalk-faint">Loading…</p>
        </div>
      </AppShell>
    );
  }

  if (status !== "authenticated" || !user) {
    return null; // redirecting to /login via the effect above
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Your account" title="Profile" />

        <Card>
          <CardBody>
            <LevelProgress />
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-chalk-faint">
                Username
              </span>
              <span className="text-chalk">{user.username}</span>
              <span className="text-xs text-chalk-faint">Fixed — usernames can't be changed.</span>
            </div>

            <div className="flex flex-col gap-1 border-t border-seam/70 pt-4">
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-chalk-faint">
                Email
              </span>
              <span className="text-chalk">{user.email}</span>
              <span className="text-xs text-chalk-faint">
                Changing your email isn't available yet.
              </span>
            </div>

            <div className="border-t border-seam/70 pt-4">
              {editing ? (
                <div className="flex flex-col gap-4">
                  <TextField
                    label="Display name"
                    value={displayName}
                    error={fieldError}
                    disabled={saving}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      setFieldError(undefined);
                    }}
                  />
                  <TextField
                    label="Avatar URL"
                    hint="Optional — a link to an image. Leave blank to remove it."
                    value={avatarUrl}
                    disabled={saving}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-chalk-faint">
                    Display name
                  </span>
                  <span className="text-chalk">{user.displayName}</span>
                  {user.avatarUrl ? (
                    <span className="truncate text-xs text-chalk-faint">{user.avatarUrl}</span>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1 border-t border-seam/70 pt-4">
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-chalk-faint">
                Joined
              </span>
              <span className="text-chalk">
                {new Date(user.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
          </CardBody>
        </Card>

        {serverError ? <ErrorBanner message={serverError} /> : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          {editing ? (
            <>
              <Button size="lg" fullWidth onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button variant="secondary" size="lg" fullWidth onClick={cancelEditing} disabled={saving}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="lg" fullWidth onClick={startEditing}>
                Edit profile
              </Button>
              <Button variant="secondary" size="lg" fullWidth onClick={() => void logout()}>
                Log out
              </Button>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
