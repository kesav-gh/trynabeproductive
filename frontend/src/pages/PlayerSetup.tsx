import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { ApiError, gameApi } from "@/lib/api";
import type { ModeConfig, TimerMode } from "@/types/api";

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

const TIMER_OPTIONS: { mode: TimerMode; label: string; hint: string }[] = [
  { mode: "casual", label: "Casual", hint: "No clock" },
  { mode: "normal", label: "Normal", hint: "30s a turn" },
  { mode: "blitz", label: "Blitz", hint: "15s a turn" },
];

export function PlayerSetup() {
  const [names, setNames] = useState<string[]>(["", ""]);
  const [timerMode, setTimerMode] = useState<TimerMode>("casual");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Passed from GameModes; falls back to a fully-random Classic round if
  // this screen is reached directly (bookmark, back button, ...).
  const mode = (location.state as { mode?: ModeConfig } | null)?.mode;

  const update = (index: number, value: string) => {
    setNames((prev) => prev.map((n, i) => (i === index ? value : n)));
    setFieldError(undefined);
  };

  const add = () => setNames((prev) => [...prev, ""]);

  const remove = (index: number) =>
    setNames((prev) => prev.filter((_, i) => i !== index));

  const filled = names.map((n) => n.trim()).filter(Boolean);
  const hasDuplicates = new Set(filled.map((n) => n.toLowerCase())).size !== filled.length;

  const start = async () => {
    setServerError(undefined);

    if (filled.length < MIN_PLAYERS) {
      setFieldError("Add at least two players to start a game.");
      return;
    }
    if (hasDuplicates) {
      setFieldError("Two players have the same name. Give them something to tell them apart.");
      return;
    }
    setFieldError(undefined);
    setStarting(true);

    try {
      await gameApi.start({ playerNames: filled, mode, timerMode });
      navigate("/handoff");
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError("Something went wrong. Try again.");
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Step 2 of 2"
          title="Who is playing?"
          subtitle="Names appear on the handoff screen so everyone knows whose turn it is."
        />

        <Card>
          <CardBody className="flex flex-col gap-4">
            {names.map((name, i) => (
              <div key={i} className="flex items-end gap-2">
                {/* The wrapper carries flex-1: TextField forwards className to
                    the input itself, so growing has to happen out here. */}
                <div className="min-w-0 flex-1">
                  <TextField
                    label={"Player " + String(i + 1)}
                    placeholder={i === 0 ? "Vishal" : "Add a name"}
                    value={name}
                    autoComplete="off"
                    onChange={(e) => update(i, e.target.value)}
                  />
                </div>
                {names.length > MIN_PLAYERS ? (
                  <Button
                    variant="ghost"
                    onClick={() => remove(i)}
                    aria-label={"Remove player " + String(i + 1)}
                    className="mb-0 shrink-0"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}

            {fieldError ? (
              <p role="alert" className="text-sm text-ball">
                {fieldError}
              </p>
            ) : null}

            {names.length < MAX_PLAYERS ? (
              <Button variant="secondary" onClick={add} fullWidth>
                Add another player
              </Button>
            ) : (
              <p className="text-sm text-chalk-faint">
                That is the maximum of {MAX_PLAYERS} players.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-3">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-chalk-faint">
              Turn timer
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Turn timer">
              {TIMER_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setTimerMode(opt.mode)}
                  aria-pressed={timerMode === opt.mode}
                  className={
                    "flex min-h-[44px] flex-col items-start justify-center rounded-xl border px-4 py-1.5 text-left transition-colors duration-200 " +
                    (timerMode === opt.mode
                      ? "border-mint-500/60 bg-mint-500/12"
                      : "border-seam bg-pitch-850 hover:border-seam-strong")
                  }
                >
                  <span className={timerMode === opt.mode ? "text-sm font-semibold text-mint-400" : "text-sm font-medium text-chalk"}>
                    {opt.label}
                  </span>
                  <span className="text-xs text-chalk-faint">{opt.hint}</span>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        {serverError ? <ErrorBanner message={serverError} action={{ label: "Retry", onClick: start }} /> : null}

        <Button size="lg" fullWidth onClick={start} disabled={starting}>
          {starting ? "Starting…" : "Start the round"}
        </Button>
      </div>
    </AppShell>
  );
}
