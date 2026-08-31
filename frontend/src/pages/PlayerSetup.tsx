import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { ApiError, gameApi } from "@/lib/api";
import type { ModeConfig } from "@/types/api";

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

export function PlayerSetup() {
  const [names, setNames] = useState<string[]>(["", ""]);
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
      await gameApi.start({ playerNames: filled, mode });
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

        {serverError ? <ErrorBanner message={serverError} action={{ label: "Retry", onClick: start }} /> : null}

        <Button size="lg" fullWidth onClick={start} disabled={starting}>
          {starting ? "Starting…" : "Start the round"}
        </Button>
      </div>
    </AppShell>
  );
}
