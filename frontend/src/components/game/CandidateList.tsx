import { cn } from "@/lib/cn";
import type { Cricketer } from "@/types/game";

interface CandidateListProps {
  candidates: Cricketer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  name?: string;
}

/**
 * Disambiguation picker. Native radios keep arrow-key navigation and screen
 * reader semantics for free; the visible styling sits on top of them.
 */
export function CandidateList({
  candidates,
  selectedId,
  onSelect,
  name = "candidate",
}: CandidateListProps) {
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="Matching players">
      {candidates.map((c) => {
        const checked = selectedId === c.playerId;
        return (
          <label
            key={c.playerId}
            className={cn(
              "flex cursor-pointer items-center gap-3.5 rounded-xl border px-4 py-3.5",
              "transition-all duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-sky",
              checked
                ? "border-mint-500/60 bg-mint-500/[0.08]"
                : "border-seam bg-pitch-850 hover:border-seam-strong",
            )}
          >
            <input
              type="radio"
              name={name}
              value={c.playerId}
              checked={checked}
              onChange={() => onSelect(c.playerId)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                checked ? "border-mint-500" : "border-seam-strong",
              )}
            >
              {checked ? <span className="h-2.5 w-2.5 rounded-full bg-mint-500" /> : null}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-chalk">{c.playerName}</span>
              <span className="truncate text-xs text-chalk-faint">
                {c.country} &middot; {c.playingRole}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
