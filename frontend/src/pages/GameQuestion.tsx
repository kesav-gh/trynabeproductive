import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { ProgressTrack } from "@/components/ui/ProgressTrack";
import { QuestionCard } from "@/components/game/QuestionCard";
import { PickList } from "@/components/game/PickList";
import { CandidateList } from "@/components/game/CandidateList";
import { cn } from "@/lib/cn";
import { ApiError, gameApi } from "@/lib/api";
import type { GameState, HintResult } from "@/types/api";

const HINT_TYPES: { type: "country" | "role" | "range"; label: string }[] = [
  { type: "country", label: "Country" },
  { type: "role", label: "Role" },
  { type: "range", label: "Range" },
];

export function GameQuestion() {
  const [state, setState] = useState<GameState | null>(null);
  const [typed, setTyped] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [hintResult, setHintResult] = useState<HintResult | null>(null);
  const [hintError, setHintError] = useState<string | undefined>();
  const [requestingHint, setRequestingHint] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    gameApi
      .state()
      .then((s) => {
        // Reaching /game directly (refresh, bookmark, back button) while
        // it isn't actually anyone's turn -- route to where the game
        // really is instead of rendering a stale question screen.
        if (s.currentPlayerName === null) {
          navigate("/handoff");
          return;
        }
        setState(s);
        setSecondsLeft(s.turnSecondsRemaining);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "NO_ACTIVE_GAME") {
          navigate("/setup");
          return;
        }
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load the game.");
      });
  }, [navigate]);

  // Shared tail for every response that can end a turn: a completed
  // pick, an ambiguous selection, or the timer's own expiry poll. The
  // one thing that must NEVER depend on whether pickError is set is
  // navigation -- TURN_EXPIRED IS a pickError, and turnComplete is true
  // on that response too. Branching on pickError first (as an earlier
  // version of this did) meant a pick that expired mid-submit silently
  // kept rendering the same screen for the next player instead of
  // routing through the handoff privacy screen, same as any other
  // completed turn.
  const handleTurnResponse = (next: GameState, clearInput?: () => void) => {
    setState(next);
    setSecondsLeft(next.turnSecondsRemaining);
    if (next.pickError) {
      setFieldError(next.pickError.message);
      setChosenId(null); // any disambiguation choice that led here is stale now
    } else {
      setFieldError(undefined);
      clearInput?.();
    }
    if (next.turnComplete) {
      setHintResult(null);
      setHintError(undefined);
      navigate("/handoff", next.pickError?.code === "TURN_EXPIRED" ? { state: { timedOut: true } } : undefined);
    }
  };

  // The countdown shown here ticks locally for a smooth display, but the
  // backend is what actually enforces expiry -- see game_state.py and
  // api.py's _expire_turn_if_needed(). Every second this just asks "does
  // the server still think there's time left?" and once it says no, that
  // response's own turnComplete flag (not this timer) is what navigates
  // away, through the exact same path a completed turn already uses.
  useEffect(() => {
    if (!state || state.timerSeconds === null || secondsLeft === null) return;
    if (secondsLeft <= 0) {
      gameApi.state().then((next) => handleTurnResponse(next)).catch(() => {
        /* a transient failure here just means the next tick retries */
      });
      return;
    }
    const id = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, state?.timerSeconds]);

  const submit = async () => {
    if (!typed.trim()) {
      setFieldError("Enter a name.");
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    try {
      const next = await gameApi.pick(typed.trim());
      handleTurnResponse(next, () => setTyped(""));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't submit that pick.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmAmbiguous = async () => {
    if (!chosenId) return;
    setSubmitting(true);
    try {
      const next = await gameApi.ambiguous(chosenId);
      handleTurnResponse(next, () => setChosenId(null));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't submit that pick.");
    } finally {
      setSubmitting(false);
    }
  };

  const requestHint = async (type: "country" | "role" | "range") => {
    setHintError(undefined);
    setRequestingHint(type);
    try {
      const next = await gameApi.hint(type);
      setState(next);
      setSecondsLeft(next.turnSecondsRemaining);
      setHintResult(next.hint);
      if (next.turnComplete) {
        // Only reachable if the turn's clock expired the instant the hint
        // request landed -- the same recovery path a timed-out pick uses.
        navigate("/handoff", { state: { timedOut: true } });
      }
    } catch (err) {
      setHintError(err instanceof ApiError ? err.message : "Couldn't get a hint.");
    } finally {
      setRequestingHint(null);
    }
  };

  if (loadError) {
    return (
      <AppShell showNav={false}>
        <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-6">
          <ErrorBanner message={loadError} action={{ label: "Back to setup", onClick: () => navigate("/setup") }} />
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

  const picks = (state.myPicks ?? []).map((p) => ({ name: p.playerName, value: p.value }));
  const remaining = state.numPlayers - picks.length;

  if (state.pendingAmbiguous) {
    const pending = state.pendingAmbiguous;
    return (
      <AppShell showNav={false}>
        <div className="flex flex-col gap-6">
          <QuestionCard question={state.question} compact />
          <Card>
            <CardBody className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h2 className="font-display text-xl font-semibold text-chalk">Which one?</h2>
                <p className="text-sm text-chalk-dim">
                  Several players match &ldquo;{pending.query}&rdquo;.
                </p>
              </div>

              <CandidateList
                candidates={pending.candidates}
                selectedId={chosenId}
                onSelect={setChosenId}
              />

              {fieldError ? (
                <p role="alert" className="text-sm text-ball">
                  {fieldError}
                </p>
              ) : null}

              <div className="flex flex-col gap-2.5">
                <Button size="lg" fullWidth disabled={!chosenId || submitting} onClick={confirmAmbiguous}>
                  Confirm
                </Button>
                <Button
                  variant="secondary"
                  fullWidth
                  disabled={submitting}
                  onClick={() => {
                    // Purely a local reset back to the text box. The next
                    // /pick call resolves fresh and replaces whatever the
                    // server still has pending -- see api.py's submit_pick.
                    setFieldError(undefined);
                    setChosenId(null);
                    setTyped("");
                    setState({ ...state, pendingAmbiguous: null });
                  }}
                >
                  None of these
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell showNav={false}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-chalk-faint">
              {state.currentPlayerName} is picking
            </span>
            <span className="tabular font-mono text-[0.65rem] uppercase tracking-[0.1em] text-chalk-faint">
              · Round {state.currentRound}
              {state.roundsTotal ? " of " + state.roundsTotal : ""}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {secondsLeft !== null ? (
              <span
                className={cn(
                  "tabular font-mono text-sm font-bold",
                  secondsLeft <= 5 ? "text-ball" : "text-chalk-dim",
                )}
                role="timer"
                aria-live="polite"
              >
                0:{String(secondsLeft).padStart(2, "0")}
              </span>
            ) : null}
            <span className="tabular font-mono text-sm text-mint-400">{remaining} left</span>
          </div>
        </div>

        <QuestionCard question={state.question} />

        <ProgressTrack label="Picks" total={state.numPlayers} completed={picks.length} />

        <PickList picks={picks} total={state.numPlayers} />

        <Card>
          <CardBody className="flex flex-col gap-4">
            <TextField
              label="Player name"
              hideLabel
              placeholder="Enter a surname..."
              value={typed}
              autoComplete="off"
              error={fieldError}
              disabled={submitting}
              onChange={(e) => {
                setTyped(e.target.value);
                setFieldError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            <Button size="lg" fullWidth onClick={submit} disabled={submitting}>
              {submitting ? "Checking…" : "Submit pick"}
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-chalk-faint">
                Hints
              </span>
              <span className="text-xs text-chalk-faint">-{state.hintPenalty} pts each</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {HINT_TYPES.map(({ type, label }) => {
                const used = (state.myHintsUsed?.[type] ?? 0) >= 1;
                return (
                  <Button
                    key={type}
                    variant="secondary"
                    disabled={used || requestingHint !== null}
                    onClick={() => requestHint(type)}
                    className="min-w-[100px] flex-1"
                  >
                    {used ? label + " ✓" : requestingHint === type ? "…" : label}
                  </Button>
                );
              })}
            </div>

            {hintError ? (
              <p role="alert" className="text-sm text-ball">
                {hintError}
              </p>
            ) : null}

            {hintResult ? (
              <p className="rounded-lg border border-seam bg-pitch-900 px-3 py-2.5 text-sm text-chalk-dim">
                {hintResult.text}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
