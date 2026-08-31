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
import { ApiError, gameApi } from "@/lib/api";
import type { GameState } from "@/types/api";

export function GameQuestion() {
  const [state, setState] = useState<GameState | null>(null);
  const [typed, setTyped] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "NO_ACTIVE_GAME") {
          navigate("/setup");
          return;
        }
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load the game.");
      });
  }, [navigate]);

  const afterResponse = (next: GameState) => {
    setState(next);
    setTyped("");
    setChosenId(null);
    if (next.turnComplete) {
      navigate("/handoff");
    }
  };

  const submit = async () => {
    if (!typed.trim()) {
      setFieldError("Enter a name.");
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    try {
      const next = await gameApi.pick(typed.trim());
      if (next.pickError) {
        setFieldError(next.pickError.message);
        setState(next); // still refresh in case pendingAmbiguous was cleared
      } else {
        afterResponse(next);
      }
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
      if (next.pickError) {
        setFieldError(next.pickError.message);
        setState(next);
        setChosenId(null);
      } else {
        afterResponse(next);
      }
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't submit that pick.");
    } finally {
      setSubmitting(false);
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
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-chalk-faint">
            {state.currentPlayerName} is picking
          </span>
          <span className="tabular font-mono text-sm text-mint-400">{remaining} left</span>
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
      </div>
    </AppShell>
  );
}
