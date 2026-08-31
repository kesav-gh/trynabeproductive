import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-mint-500 text-pitch-950 hover:bg-mint-400 active:bg-mint-600 font-semibold shadow-lg shadow-mint-500/20",
  secondary: "bg-pitch-750 text-chalk hover:bg-pitch-700 border border-seam-strong",
  ghost: "bg-transparent text-chalk-dim hover:text-chalk hover:bg-pitch-800 border border-transparent",
  danger: "bg-ball/15 text-ball hover:bg-ball/25 border border-ball/40",
};

// Both sizes clear the 44px minimum that touch targets need.
const SIZES: Record<Size, string> = {
  md: "min-h-[44px] px-5 text-[0.95rem] rounded-xl",
  lg: "min-h-[54px] px-6 text-base rounded-2xl",
};

const BASE =
  "inline-flex items-center justify-center gap-2 font-sans font-medium " +
  "transition-all duration-200 ease-out select-none " +
  "disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.985]";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

interface ButtonLinkProps {
  to: string;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

/** Same treatment as Button, but renders a router link. */
export function ButtonLink({
  to,
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  children,
}: ButtonLinkProps) {
  return (
    <Link
      to={to}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className)}
    >
      {children}
    </Link>
  );
}
