import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { mockGameModes } from "@/mocks/data";
import type { GameMode } from "@/types/game";

const DIFFICULTY_TONE = {
  Casual: "mint",
  Standard: "neutral",
  Hard: "ball",
} as const;

export function GameModes() {
  const [selected, setSelected] = useState<GameMode | null>(mockGameModes[0] ?? null);
  const navigate = useNavigate();

  return (
    <AppShell width="wide">
      <div className="flex flex-col gap-9">
        <PageHeader
          eyebrow="Step 1 of 2"
          title="Choose a mode"
          subtitle="Every mode uses the same question engine. What changes is how many players you name and which questions can come up."
        />

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mockGameModes.map((mode) => {
            const isSelected = selected?.id === mode.id;
            return (
              <li key={mode.id}>
                <button
                  type="button"
                  disabled={!mode.available}
                  onClick={() => setSelected(mode)}
                  aria-pressed={isSelected}
                  className={cn(
                    "glass flex h-full w-full flex-col gap-3 rounded-2xl p-5 text-left",
                    "transition-all duration-200 ease-out",
                    mode.available
                      ? "cursor-pointer hover:-translate-y-0.5 hover:border-seam-strong"
                      : "cursor-not-allowed opacity-45",
                    isSelected && mode.available && "border-mint-500/60 bg-mint-500/[0.06]",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <h2 className="font-display text-lg font-semibold tracking-tight text-chalk">
                        {mode.name}
                      </h2>
                      <span className="text-xs text-chalk-faint">{mode.tagline}</span>
                    </div>
                    <Badge tone={DIFFICULTY_TONE[mode.difficulty]}>{mode.difficulty}</Badge>
                  </div>

                  <p className="flex-1 text-sm leading-relaxed text-chalk-dim">{mode.description}</p>

                  <div className="flex items-center gap-3 border-t border-seam/70 pt-3 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-chalk-faint">
                    <span>{mode.numPlayers} picks</span>
                    <span aria-hidden="true">&middot;</span>
                    <span>~{mode.estimatedMinutes} min</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <Card>
          <CardBody className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <p className="text-sm text-chalk-dim">
              {selected ? (
                <>
                  Selected <span className="font-semibold text-chalk">{selected.name}</span> &mdash;{" "}
                  {selected.numPlayers} picks per player.
                </>
              ) : (
                "Pick a mode to continue."
              )}
            </p>
            <Button
              size="lg"
              disabled={!selected}
              onClick={() =>
                navigate("/setup", {
                  state: selected
                    ? {
                        mode: {
                          numPlayers: selected.numPlayers,
                          stat: selected.stat ?? undefined,
                          format: selected.format ?? undefined,
                        },
                      }
                    : undefined,
                })
              }
              className="w-full sm:w-auto"
            >
              Continue
            </Button>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
