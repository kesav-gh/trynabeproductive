import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { ApiError, gameApi } from "@/lib/api";
import type { GameState } from "@/types/api";

/**
 * The privacy checkpoint between turns. Deliberately almost empty: the
 * whole job of this screen is that the previous player is off it before
 * the next player looks, so it carries no picks and no totals -- those
 * never even arrive over the wire until the reveal (see api.py).
 *
 * currentPlayerName === null means every player has finished; that
 * branch shows "Show Reveal" instead of "Pass the device", exactly like
 * the equivalent state in the original /handoff HTML route.
 */
export function Handoff() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | undefined>();
  const navigate = useNavigate();

  useEffect(() => {
    gameApi
      .state()
      .then(setState)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "NO_ACTIVE_GAME") {
          navigate("/setup");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Couldn't load the game.");
      });
  }, [navigate]);

  const startTurn = async () => {
    setError(undefined);
    try {
      await gameApi.nextTurn();
      navigate("/game");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the turn.");
    }
  };

  if (error) {
    return (
      <AppShell showNav={false}>
        <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-6">
          <ErrorBanner message={error} action={{ label: "Back to setup", onClick: () => navigate("/setup") }} />
        </div>
      </AppShell>
    );
  }

  if (!state) {
    return (
      <AppShell showNav={false}>
        <div className="flex min-h-[60dvh] items-center justify-center">
          <p className="text-sm text-chalk-faint">Loading…</p>
        </div>
      </AppShell>
    );
  }

  const allDone = state.currentPlayerName === null;

  return (
    <AppShell showNav={false}>
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-10 text-center">
        {allDone ? (
          <div className="flex flex-col items-center gap-4">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-chalk-faint">
              Everyone's picks are in
            </span>
            <h1 className="max-w-sm font-display text-3xl font-bold tracking-tight text-chalk">
              Pass the device around so everyone can see the reveal together.
            </h1>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-chalk-faint">
              Turn {state.currentPlayerIndex + 1} of {state.totalPlayers}
            </span>
            <p className="text-lg text-chalk-dim">Pass the device to</p>
            <h1 className="font-display text-5xl font-extrabold tracking-tight text-mint-400 sm:text-6xl">
              {state.currentPlayerName}
            </h1>
          </div>
        )}

        <p className="max-w-sm text-sm leading-relaxed text-chalk-faint">
          {allDone
            ? "Nobody sees a total until everyone taps through."
            : "Everyone else, look away. Your picks stay hidden until the reveal."}
        </p>

        <div className="flex w-full max-w-sm flex-col gap-3">
          {allDone ? (
            <ButtonLink to="/reveal" size="lg" fullWidth>
              Show Reveal
            </ButtonLink>
          ) : (
            <>
              <Button size="lg" fullWidth onClick={startTurn}>
                It is my turn
              </Button>
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-chalk-faint">
                {state.numPlayers} picks to make
              </p>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
