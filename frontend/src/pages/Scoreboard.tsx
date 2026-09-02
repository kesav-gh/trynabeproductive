import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { mockRounds } from "@/mocks/data";

/** Wins across every round played so far, best first. */
function tallyWins() {
  const wins = new Map<string, { name: string; wins: number; played: number }>();
  for (const round of mockRounds) {
    for (const s of round.standings) {
      const entry = wins.get(s.participantId) ?? {
        name: s.participantName,
        wins: 0,
        played: 0,
      };
      entry.played += 1;
      if (s.won) entry.wins += 1;
      wins.set(s.participantId, entry);
    }
  }
  return [...wins.values()].sort((a, b) => b.wins - a.wins);
}

export function Scoreboard() {
  const table = tallyWins();
  const leaders = table.filter((t) => t.wins === table[0]?.wins);

  return (
    <AppShell width="wide">
      <div className="flex flex-col gap-9">
        <PageHeader
          eyebrow={mockRounds.length + " rounds played"}
          title="Scoreboard"
          subtitle="Running totals for this session. Nothing is saved once everyone goes home."
        />

        <Card>
          <CardBody className="p-0 sm:p-0">
            <table className="w-full">
              <caption className="sr-only">Wins by player across all rounds</caption>
              <thead>
                <tr className="border-b border-seam">
                  <th
                    scope="col"
                    className="px-5 py-3 text-left font-mono text-[0.65rem] uppercase tracking-[0.12em] text-chalk-faint"
                  >
                    Player
                  </th>
                  <th
                    scope="col"
                    className="px-5 py-3 text-right font-mono text-[0.65rem] uppercase tracking-[0.12em] text-chalk-faint"
                  >
                    Rounds
                  </th>
                  <th
                    scope="col"
                    className="px-5 py-3 text-right font-mono text-[0.65rem] uppercase tracking-[0.12em] text-chalk-faint"
                  >
                    Wins
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.map((row) => {
                  const leading = leaders.some((l) => l.name === row.name) && row.wins > 0;
                  return (
                    <tr key={row.name} className="border-b border-seam/60 last:border-0">
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-2.5">
                          <span className="font-display font-semibold text-chalk">{row.name}</span>
                          {leading ? <Badge tone="mint">Leading</Badge> : null}
                        </span>
                      </td>
                      <td className="tabular px-5 py-4 text-right text-chalk-dim">{row.played}</td>
                      <td
                        className={cn(
                          "tabular px-5 py-4 text-right font-display text-xl font-bold",
                          leading ? "text-mint-400" : "text-chalk-dim",
                        )}
                      >
                        {row.wins}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-semibold tracking-tight text-chalk">
            Round history
          </h2>
          <ul className="flex flex-col gap-3">
            {mockRounds.map((round) => {
              const winner = round.standings.find((s) => s.won);
              return (
                <Card as="li" key={round.roundNumber}>
                  <CardBody className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-chalk-faint">
                        Round {round.roundNumber}
                      </span>
                      <Badge tone="mint">{winner?.participantName}</Badge>
                    </div>
                    <p className="text-sm leading-relaxed text-chalk-dim">
                      {round.question.questionText}
                    </p>
                  </CardBody>
                </Card>
              );
            })}
          </ul>
        </section>

        <ButtonLink to="/modes" size="lg" className="sm:self-start">
          Start a new game
        </ButtonLink>
      </div>
    </AppShell>
  );
}
