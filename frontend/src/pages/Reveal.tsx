import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { QuestionCard } from "@/components/game/QuestionCard";
import { cn } from "@/lib/cn";
import { ApiError, gameApi } from "@/lib/api";
import type { RevealResult, XpAward } from "@/types/api";

export function Reveal() {
  const [result, setResult] = useState<RevealResult | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [restarting, setRestarting] = useState(false);
  // Set only once Play Again reports the game has used up all its
  // configured rounds -- null means "still playable" (including the
  // default, unlimited-rounds game, which never reaches this at all).
  const [finalScores, setFinalScores] = useState<Record<string, number> | null>(null);
  // Phase 4.5 -- only ever set for a signed-in user's game; a guest's
  // play-again response always carries xp: null (see api.py), so this
  // simply never gets set for one.
  const [xpAward, setXpAward] = useState<XpAward | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    gameApi
      .reveal()
      .then(setResult)
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          // Both guards mirror the security fix in app.py's /reveal route:
          // no totals exist to show until every player has finished.
          if (err.code === "NO_ACTIVE_GAME") {
            navigate("/setup");
            return;
          }
          if (err.code === "GAME_IN_PROGRESS") {
            navigate("/handoff");
            return;
          }
          setError(err.message);
          return;
        }
        setError("Couldn't load the reveal.");
      });
  }, [navigate]);

  const playAgain = async () => {
    setRestarting(true);
    setError(undefined);
    try {
      const next = await gameApi.playAgain();
      if (next.status === "finished") {
        // The round just committed was the last one this game allows --
        // stay on this screen and show the overall result instead of
        // bouncing through a handoff screen for a turn that doesn't exist.
        setFinalScores(next.cumulativeScores);
        setXpAward(next.xp);
      } else {
        navigate("/handoff");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start another round.");
    } finally {
      setRestarting(false);
    }
  };

  if (error) {
    return (
      <AppShell>
        <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-6">
          <ErrorBanner message={error} action={{ label: "Back to setup", onClick: () => navigate("/setup") }} />
        </div>
      </AppShell>
    );
  }

  if (!result) {
    return (
      <AppShell>
        <div className="flex min-h-[60dvh] items-center justify-center">
          <p className="text-sm text-chalk-faint">Loading…</p>
        </div>
      </AppShell>
    );
  }

  if (finalScores) {
    const ranked = Object.entries(finalScores).sort((a, b) => b[1] - a[1]);
    const topScore = ranked[0]?.[1] ?? 0;
    const overallWinners = ranked.filter(([, score]) => score === topScore);

    return (
      <AppShell>
        <div className="flex flex-col gap-8">
          <PageHeader
            eyebrow={"Game complete · " + result.currentRound + " round" + (result.currentRound === 1 ? "" : "s")}
            title={
              overallWinners.length === 1
                ? overallWinners[0]![0] + " wins the game"
                : "Joint winners overall"
            }
            subtitle="Total score across every round played."
          />

          <ol className="flex flex-col gap-3">
            {ranked.map(([name, score], i) => {
              const isWinner = score === topScore;
              return (
                <Card as="li" key={name} className={cn(isWinner && "border-mint-500/50")}>
                  <CardBody className="flex items-center gap-4">
                    <span
                      className={cn(
                        "tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold",
                        isWinner ? "bg-mint-500 text-pitch-950" : "bg-pitch-750 text-chalk-dim",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate font-display font-semibold text-chalk">{name}</span>
                    <span
                      className={cn(
                        "tabular font-display text-2xl font-bold",
                        isWinner ? "text-mint-400" : "text-chalk-dim",
                      )}
                    >
                      {score.toLocaleString()}
                    </span>
                  </CardBody>
                </Card>
              );
            })}
          </ol>

          {xpAward ? (
            <Card className={cn(xpAward.leveledUp && "border-mint-500/50")}>
              <CardBody className="flex flex-col items-center gap-2 text-center">
                <span className="tabular font-display text-2xl font-bold text-mint-400">
                  +{xpAward.xpAwarded.toLocaleString()} XP
                </span>
                {xpAward.leveledUp ? (
                  <>
                    <Badge tone="mint">Level up!</Badge>
                    <span className="font-display text-lg font-semibold text-chalk">
                      Level {xpAward.newLevel}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-chalk-faint">
                    {xpAward.newXp.toLocaleString()} XP total
                  </span>
                )}
              </CardBody>
            </Card>
          ) : null}

          <ButtonLink to="/" size="lg" fullWidth>
            New Game
          </ButtonLink>
        </div>
      </AppShell>
    );
  }

  const winners = result.standings.filter((s) => s.won);

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow={
            "Round " + result.currentRound + (result.roundsTotal ? " of " + result.roundsTotal : "") + " complete"
          }
          title={winners.length === 1 ? winners[0]!.participantName + " wins" : "Joint winners"}
          subtitle={
            <>
              The target was{" "}
              <span className="tabular font-semibold text-chalk">{result.target.toLocaleString()}</span>.
            </>
          }
        />

        <QuestionCard question={result.question} compact />

        <ol className="flex flex-col gap-3">
          {[...result.standings]
            .sort((a, b) => a.difference - b.difference)
            .map((s, i) => (
              <Card as="li" key={s.participantName} className={cn("fade-rise", s.won && "border-mint-500/50")}>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-center gap-4">
                    <span
                      className={cn(
                        "tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold",
                        s.won ? "bg-mint-500 text-pitch-950" : "bg-pitch-750 text-chalk-dim",
                      )}
                    >
                      {i + 1}
                    </span>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-display font-semibold text-chalk">
                        {s.participantName}
                      </span>
                      <span className="tabular text-xs text-chalk-faint">
                        off by {s.difference.toLocaleString()}
                      </span>
                    </div>

                    <span
                      className={cn(
                        "tabular font-display text-2xl font-bold",
                        s.won ? "text-mint-400" : "text-chalk-dim",
                      )}
                    >
                      {s.total.toLocaleString()}
                    </span>
                  </div>

                  <p className="border-t border-seam/70 pt-3 text-sm text-chalk-dim">
                    {s.picks.map((p) => p.playerName + " (" + p.value.toLocaleString() + ")").join(", ")}
                  </p>

                  <div className="flex items-center gap-2 text-xs text-chalk-faint">
                    <Badge tone={s.won ? "mint" : "neutral"}>{s.score.toLocaleString()} pts</Badge>
                    {s.hintsUsed > 0 ? <span>{s.hintsUsed} hint{s.hintsUsed === 1 ? "" : "s"} used</span> : null}
                  </div>
                </CardBody>
              </Card>
            ))}
        </ol>

        {result.roundsTotal ? (
          <p className="text-center text-xs text-chalk-faint">
            {result.isFinalRound
              ? "This is the last round -- Play Again will show the final result."
              : "Cumulative score carries over to the next round."}
          </p>
        ) : null}

        {error ? <ErrorBanner message={error} /> : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" fullWidth onClick={playAgain} disabled={restarting}>
            {restarting ? "Starting…" : result.isFinalRound ? "See Final Result" : "Play another round"}
          </Button>
          <ButtonLink to="/" variant="secondary" size="lg" fullWidth>
            New Game
          </ButtonLink>
        </div>
      </div>
    </AppShell>
  );
}
