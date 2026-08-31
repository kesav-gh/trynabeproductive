import { cn } from "@/lib/cn";

interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
  className?: string;
}

/** A single figure with its caption. Digits are tabular so columns align. */
export function StatTile({ label, value, sublabel, className }: StatTileProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-chalk-faint">
        {label}
      </span>
      <span className="tabular font-display text-2xl font-semibold text-chalk sm:text-3xl">
        {value}
      </span>
      {sublabel ? <span className="text-sm text-chalk-dim">{sublabel}</span> : null}
    </div>
  );
}
