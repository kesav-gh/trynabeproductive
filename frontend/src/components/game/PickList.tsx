import { cn } from "@/lib/cn";

/**
 * A committed pick, at the level of detail actually available: a name and
 * a number. `meta` is optional because the real engine's evaluate_guess()
 * doesn't return a player's country or role for a committed pick -- only
 * name_match's candidate list (used for disambiguation, before a pick is
 * committed) has that detail. See types/api.ts's LivePick.
 */
export interface SimplePick {
  name: string;
  value: number;
  meta?: string;
}

interface PickListProps {
  picks: SimplePick[];
  total: number;
  /** Hides the values, for the pass-and-play screens where totals stay secret. */
  concealValues?: boolean;
}

export function PickList({ picks, total, concealValues = false }: PickListProps) {
  const empty = Array.from({ length: Math.max(0, total - picks.length) });

  return (
    <ul className="flex flex-col gap-2">
      {picks.map((pick, i) => (
        <li
          key={pick.name + String(i)}
          className="fade-rise flex items-center justify-between gap-3 rounded-xl border border-seam bg-pitch-850 px-4 py-3"
          style={{ animationDelay: String(i * 40) + "ms" }}
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-chalk">{pick.name}</span>
            {pick.meta ? (
              <span className="truncate text-xs text-chalk-faint">{pick.meta}</span>
            ) : null}
          </div>
          <span
            className={cn(
              "tabular font-mono text-sm font-bold",
              concealValues ? "text-chalk-faint" : "text-mint-400",
            )}
          >
            {concealValues ? "•••" : pick.value.toLocaleString()}
          </span>
        </li>
      ))}

      {empty.map((_, i) => (
        <li
          key={"empty-" + String(i)}
          className="flex items-center gap-3 rounded-xl border border-dashed border-seam px-4 py-3"
        >
          <span className="tabular font-mono text-xs text-chalk-faint">
            {picks.length + i + 1}
          </span>
          <span className="text-sm text-chalk-faint">Not picked yet</span>
        </li>
      ))}
    </ul>
  );
}
