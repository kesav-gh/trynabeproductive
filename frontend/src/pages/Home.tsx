import { AppShell } from "@/components/layout/AppShell";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { datasetSummary } from "@/mocks/data";

const HOW_IT_WORKS = [
  {
    title: "One question, one target",
    body: "The game sets a constraint and a number. Every player answers the same question.",
  },
  {
    title: "Name your players",
    body: "Three or five picks each. Type a surname; typos and ambiguous names are handled.",
  },
  {
    title: "Closest total wins",
    body: "Nobody sees anyone else's picks until every player has finished.",
  },
];

export function Home() {
  return (
    <AppShell width="wide">
      <div className="flex flex-col gap-14">
        <section className="flex flex-col gap-7 pt-4 sm:pt-10">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-mint-500">
            Pass and play &middot; One device
          </span>

          <h1 className="max-w-3xl font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-chalk sm:text-6xl">
            How well do you
            <span className="text-mint-400"> actually </span>
            know cricket?
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-chalk-dim">
            A guessing game built on real ball-by-ball data. The game names a target;
            you name the players you think add up to it. Closest wins.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/modes" size="lg" className="sm:w-auto">
              Start a game
            </ButtonLink>
            <ButtonLink to="/search" variant="secondary" size="lg" className="sm:w-auto">
              Browse players
            </ButtonLink>
          </div>
        </section>

        <section aria-label="Dataset" className="grid grid-cols-2 gap-6 border-y border-seam py-8 sm:grid-cols-4">
          <StatTile label="Matches" value={datasetSummary.matches.toLocaleString()} />
          <StatTile label="Deliveries" value={(datasetSummary.deliveries / 1e6).toFixed(1) + "M"} />
          <StatTile label="Players" value={datasetSummary.players.toLocaleString()} />
          <StatTile label="Since" value={String(datasetSummary.earliestYear)} />
        </section>

        <section className="flex flex-col gap-5">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-chalk">
            How a round works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => (
              <Card as="li" key={step.title}>
                <CardBody className="flex flex-col gap-2.5">
                  <span className="tabular font-mono text-sm font-bold text-mint-500">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-display text-base font-semibold text-chalk">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-chalk-dim">{step.body}</p>
                </CardBody>
              </Card>
            ))}
          </ol>
        </section>
      </div>
    </AppShell>
  );
}
