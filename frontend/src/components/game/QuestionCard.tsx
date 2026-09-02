import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { Question } from "@/types/game";

const STAT_LABEL: Record<Question["stat"], string> = {
  runs: "Runs",
  wickets: "Wickets",
  centuries: "Centuries",
  five_fers: "Five-fers",
};

interface QuestionCardProps {
  question: Question;
  /** Compact drops the target figure, for screens where it is repeated. */
  compact?: boolean;
}

export function QuestionCard({ question, compact = false }: QuestionCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-seam/70 bg-pitch-900/40 px-5 py-3.5">
        <Badge tone="mint">{question.format}</Badge>
        <Badge>{STAT_LABEL[question.stat]}</Badge>
        <Badge>{question.roleBucket}</Badge>
        {question.country ? <Badge tone="gold">{question.country}</Badge> : <Badge>Any country</Badge>}
      </div>

      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <p className="text-[1.05rem] leading-relaxed text-chalk">{question.questionText}</p>

        {compact ? null : (
          <div className="flex items-end justify-between gap-4 rounded-xl border border-mint-500/25 bg-mint-500/[0.06] px-5 py-4">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-chalk-faint">
                Target
              </span>
              <span className="tabular font-display text-4xl font-bold leading-none text-mint-400">
                {question.target.toLocaleString()}
              </span>
            </div>
            <span className="pb-1 text-right text-sm text-chalk-dim">
              {question.numPlayers} players
              <br />
              to name
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
