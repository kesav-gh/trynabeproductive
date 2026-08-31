import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "mint" | "ball" | "gold";

const TONES: Record<Tone, string> = {
  neutral: "bg-pitch-750 text-chalk-dim border-seam-strong",
  mint: "bg-mint-500/12 text-mint-400 border-mint-500/30",
  ball: "bg-ball/12 text-ball border-ball/30",
  gold: "bg-gold/12 text-gold border-gold/30",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1",
        "font-mono text-[0.68rem] font-medium tracking-wide uppercase",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
