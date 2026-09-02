import { AppShell } from "@/components/layout/AppShell";
import { ButtonLink } from "@/components/ui/Button";

export function NotFound() {
  return (
    <AppShell>
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-6 text-center">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-chalk-faint">
          404
        </span>
        <h1 className="font-display text-3xl font-bold tracking-tight text-chalk">
          That page does not exist
        </h1>
        <p className="max-w-sm text-chalk-dim">
          The link may be out of date, or the round it belonged to has finished.
        </p>
        <ButtonLink to="/" size="lg">
          Back to the start
        </ButtonLink>
      </div>
    </AppShell>
  );
}
