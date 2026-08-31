import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      {eyebrow ? (
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-mint-500">
          {eyebrow}
        </span>
      ) : null}
      <h1 className="font-display text-3xl font-bold tracking-tight text-chalk sm:text-4xl">
        {title}
      </h1>
      {subtitle ? (
        <p className="max-w-prose text-[1.02rem] leading-relaxed text-chalk-dim">{subtitle}</p>
      ) : null}
    </div>
  );
}
