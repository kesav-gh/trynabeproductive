import { cn } from "@/lib/cn";

interface ProgressTrackProps {
  total: number;
  completed: number;
  label: string;
  className?: string;
}

/**
 * Segmented progress, one segment per pick. A count rather than a percentage,
 * because players think in picks remaining, not proportions.
 */
export function ProgressTrack({ total, completed, label, className }: ProgressTrackProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-chalk-faint">
          {label}
        </span>
        <span className="tabular font-mono text-sm text-chalk-dim">
          {completed} / {total}
        </span>
      </div>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-label={label}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-300",
              i < completed ? "bg-mint-500" : "bg-pitch-750",
            )}
          />
        ))}
      </div>
    </div>
  );
}
