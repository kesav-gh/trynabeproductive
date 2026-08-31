import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { QuestionCard } from "@/components/game/QuestionCard";
import { cn } from "@/lib/cn";
import { ApiError, gameApi } from "@/lib/api";
import type { RevealResult } from "@/types/api";

export function Reveal() {
  const [result, setResult] = useState<RevealResult | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [restarting, setRestarting] = useState(false);
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
      await gameApi.playAgain();
      navigate("/handoff");
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

  const winners = result.standings.filter((s) => s.won);

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Round complete"
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
                </CardBody>
              </Card>
            ))}
        </ol>

        {error ? <ErrorBanner message={error} /> : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" fullWidth onClick={playAgain} disabled={restarting}>
            {restarting ? "Starting…" : "Play another round"}
          </Button>
          <ButtonLink to="/" variant="secondary" size="lg" fullWidth>
            New Game
          </ButtonLink>
        </div>
      </div>
    </AppShell>
  );
}
