interface ErrorBannerProps {
  message: string;
  /** An optional action, e.g. "Try again" or "Back to setup". */
  action?: { label: string; onClick: () => void };
}

/**
 * For errors that aren't about one field -- a dead backend, a session
 * that no longer has a game in it, a fair question the engine couldn't
 * generate. Field-level problems (a rejected pick, a bad name) stay on
 * TextField's own `error` prop instead.
 */
export function ErrorBanner({ message, action }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-xl border border-ball/40 bg-ball/[0.08] px-4 py-3.5"
    >
      <p className="text-sm leading-relaxed text-chalk">{message}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 whitespace-nowrap font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ball underline-offset-4 hover:underline"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
