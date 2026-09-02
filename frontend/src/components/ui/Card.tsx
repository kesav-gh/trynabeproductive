import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Adds hover elevation. Use only when the whole card is clickable. */
  interactive?: boolean;
  as?: "div" | "li" | "section";
}

export function Card({ children, className, interactive = false, as = "div" }: CardProps) {
  const Tag = as;
  return (
    <Tag
      className={cn(
        "glass rounded-2xl",
        interactive &&
          "transition-all duration-200 ease-out hover:border-seam-strong hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-5 sm:p-6", className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("font-display text-lg font-semibold tracking-tight text-chalk", className)}>
      {children}
    </h2>
  );
}
