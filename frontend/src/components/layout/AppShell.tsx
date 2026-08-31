import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

interface AppShellProps {
  children: ReactNode;
  /** Narrow suits single-focus game screens; wide suits browsing screens. */
  width?: "narrow" | "wide";
  /** Hidden during a turn, so nothing on screen invites a stray tap. */
  showNav?: boolean;
}

export function AppShell({ children, width = "narrow", showNav = true }: AppShellProps) {
  return (
    <div className="field-glow min-h-dvh bg-pitch-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-mint-500 focus:px-4 focus:py-2 focus:font-medium focus:text-pitch-950"
      >
        Skip to content
      </a>

      {showNav ? (
        <header className="border-b border-seam/70">
          <nav className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5">
            <Link to="/" className="flex items-center gap-2.5">
              <span aria-hidden="true" className="text-lg">
                &#127951;
              </span>
              <span className="font-display text-[0.95rem] font-semibold tracking-tight text-chalk">
                Stat Chase
              </span>
            </Link>
            <Link
              to="/scoreboard"
              className="rounded-lg px-3 py-2 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-chalk-dim transition-colors hover:text-chalk"
            >
              Scoreboard
            </Link>
          </nav>
        </header>
      ) : null}

      <main
        id="main"
        className={cn(
          "mx-auto w-full px-5 pb-24 pt-8 sm:pt-12",
          width === "narrow" ? "max-w-xl" : "max-w-5xl",
        )}
      >
        {children}
      </main>
    </div>
  );
}
