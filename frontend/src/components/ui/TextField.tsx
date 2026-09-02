import type { InputHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "@/lib/cn";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Visually hides the label but keeps it for screen readers. */
  hideLabel?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  hideLabel = false,
  className,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const hintId = hint ? id + "-hint" : undefined;
  const errorId = error ? id + "-error" : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className={cn(
          "font-mono text-[0.7rem] uppercase tracking-[0.12em] text-chalk-faint",
          hideLabel && "sr-only",
        )}
      >
        {label}
      </label>

      <input
        id={id}
        aria-describedby={errorId ?? hintId}
        aria-invalid={error ? true : undefined}
        className={cn(
          "min-h-[54px] w-full rounded-2xl border bg-pitch-900 px-4",
          "font-sans text-base text-chalk placeholder:text-chalk-faint",
          "transition-colors duration-200",
          error ? "border-ball/60" : "border-seam hover:border-seam-strong focus:border-mint-600",
          className,
        )}
        {...rest}
      />

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-ball">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-chalk-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
