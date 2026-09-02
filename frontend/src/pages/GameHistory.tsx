import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { cn } from "@/lib/cn";
import { ApiError } from "@/types/api";
import { gamesApi, type GameDetail, type GameHistoryEntry } from "@/lib/gamesApi";
import { useAuth } from "@/context/AuthContext";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Details for one expanded row -- fetched once, on first expand, and
 *  cached here so re-collapsing and re-expanding the same row doesn't
 *  re-fetch it. */
function GameDetailPanel({ gameId }: { gameId: number }) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    gamesApi
      .get(gameId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load this game.");
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (error) return <p className="px-1 text-sm text-ball">{error}</p>;
  if (!detail) return <p className="px-1 text-sm text-chalk-faint">Loading…</p>;

  return (
    <div className="flex flex-col gap-3 border-t border-seam/70 pt-4">
      {[...detail.players]
        .sort((a, b) => a.playerOrder - b.playerOrder)
        .map((p) => (
          <div key={p.gamePlayerId} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-chalk">
              {p.name}
              {p.userId ? <span className="ml-1.5 text-chalk-faint">(you)</span> : null}
            </span>
            <span className="tabular flex items-center gap-2 text-chalk-dim">
              {p.placement ? <Badge tone={p.placement === 1 ? "mint" : "neutral"}>#{p.placement}</Badge> : null}
              {p.finalScore?.toLocaleString() ?? "—"}
            </span>
          </div>
        ))}

      <div className="flex flex-col gap-2 border-t border-seam/70 pt-3">
        {detail.rounds.map((r) => (
          <p key={r.roundNumber} className="text-xs leading-relaxed text-chalk-faint">
            Round {r.roundNumber} · target {r.target.toLocaleString()}
            {r.question.questionText ? " · " + r.question.questionText : ""}
          </p>
        ))}
      </div>
    </div>
  );
}

function HistoryRow({ game }: { game: GameHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card as="li">
      <CardBody className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-4 text-left"
          aria-expanded={expanded}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-display font-semibold text-chalk">
              {formatDate(game.finishedAt ?? game.createdAt)}
            </span>
            <span className="text-xs text-chalk-faint">
              {game.difficulty} · {game.roundsTotal ? game.roundsTotal + " round" + (game.roundsTotal === 1 ? "" : "s") : "Unlimited rounds"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {game.placement ? <Badge tone={game.placement === 1 ? "mint" : "neutral"}>#{game.placement}</Badge> : null}
            <span
              className={cn(
                "tabular font-display text-xl font-bold",
                game.placement === 1 ? "text-mint-400" : "text-chalk-dim",
              )}
            >
              {game.finalScore?.toLocaleString() ?? "—"}
            </span>
          </div>
        </button>

        {expanded ? <GameDetailPanel gameId={game.gameId} /> : null}
      </CardBody>
    </Card>
  );
}

export function GameHistory() {
  const { status } = useAuth();
  const navigate = useNavigate();

  const [games, setGames] = useState<GameHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (status === "guest") {
      navigate("/login");
    }
  }, [status, navigate]);

  useEffect(() => {
    if (status !== "authenticated") return;
    gamesApi
      .history()
      .then((res) => setGames(res.games))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load your game history.");
      });
  }, [status]);

  if (status === "loading" || status === "guest") {
    return (
      <AppShell>
        <div className="flex min-h-[60dvh] items-center justify-center">
          <p className="text-sm text-chalk-faint">Loading…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Your account" title="Game history" subtitle="Completed games you've played while signed in." />

        {error ? <ErrorBanner message={error} /> : null}

        {!error && games === null ? <p className="text-sm text-chalk-faint">Loading…</p> : null}

        {!error && games !== null && games.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-sm text-chalk-dim">No games played yet.</p>
              <ButtonLink to="/modes">Start a game</ButtonLink>
            </CardBody>
          </Card>
        ) : null}

        {!error && games !== null && games.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {games.map((g) => (
              <HistoryRow key={g.gameId} game={g} />
            ))}
          </ul>
        ) : null}
      </div>
    </AppShell>
  );
}
