import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { ApiError, playerApi } from "@/lib/api";
import type { PlayerCandidate } from "@/types/api";

const ROLE_FILTERS = ["All", "Bowler", "Allrounder", "Batter", "Wicketkeeper"] as const;
const DEBOUNCE_MS = 250;

export function PlayerSearch() {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<(typeof ROLE_FILTERS)[number]>("All");
  const [rawResults, setRawResults] = useState<PlayerCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setRawResults([]);
      setError(undefined);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      playerApi
        .search(trimmed)
        .then((res) => {
          if (!cancelled) {
            setRawResults(res.results);
            setError(undefined);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Search failed.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const results = useMemo(() => {
    if (role === "All") return rawResults;
    return rawResults.filter((c) => c.playingRole.toLowerCase().includes(role.toLowerCase()));
  }, [rawResults, role]);

  const hasQuery = query.trim().length > 0;

  return (
    <AppShell width="wide">
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Reference"
          title="Player search"
          subtitle="Look up who is in the dataset before a round. Searching here does not affect a game in progress."
        />

        <div className="flex flex-col gap-4">
          <TextField
            label="Search players"
            hideLabel
            placeholder="Search by surname..."
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by role">
            {ROLE_FILTERS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-pressed={role === r}
                className={
                  "min-h-[38px] rounded-full border px-4 text-sm transition-colors duration-200 " +
                  (role === r
                    ? "border-mint-500/60 bg-mint-500/12 text-mint-400"
                    : "border-seam bg-pitch-850 text-chalk-dim hover:border-seam-strong hover:text-chalk")
                }
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {error ? <ErrorBanner message={error} /> : null}

        {!hasQuery ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="font-display text-lg font-semibold text-chalk">Type a surname to search</p>
              <p className="max-w-sm text-sm text-chalk-dim">
                The dataset holds 15,091 players, so search doesn't list everyone at once --
                try "kohli" or "sharma".
              </p>
            </CardBody>
          </Card>
        ) : (
          <>
            <p className="tabular font-mono text-xs uppercase tracking-[0.12em] text-chalk-faint">
              {loading ? "Searching…" : results.length + " " + (results.length === 1 ? "player" : "players")}
            </p>

            {!loading && results.length === 0 ? (
              <Card>
                <CardBody className="flex flex-col items-center gap-2 py-12 text-center">
                  <p className="font-display text-lg font-semibold text-chalk">No players found</p>
                  <p className="max-w-sm text-sm text-chalk-dim">
                    Try a surname on its own. Remember the data only goes back to 2002.
                  </p>
                </CardBody>
              </Card>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {results.map((c) => (
                  <Card as="li" key={c.playerId} interactive>
                    <CardBody className="flex flex-col gap-2.5">
                      <h2 className="font-display text-base font-semibold text-chalk">
                        {c.playerName}
                      </h2>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone="gold">{c.country}</Badge>
                        <Badge>{c.playingRole}</Badge>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
