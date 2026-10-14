import { ArrowRight, Database, Gauge, Lightbulb, ShieldCheck, Trophy } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getChallengeContext } from "@/lib/content";
import { getUser } from "@/lib/supabase/server";

const FEATURES = [
  { icon: Database, title: "Real MySQL 8.0", text: "Every query runs on a real MySQL server in its own sandbox. No simulations." },
  { icon: ShieldCheck, title: "Graded by results", text: "Answers are checked by comparing result sets, so any correct query passes." },
  { icon: Lightbulb, title: "Hints, not spoilers", text: "Up to three progressive hints, and helpful feedback when a result is off." },
  { icon: Trophy, title: "XP and achievements", text: "Earn XP, level up, keep a daily streak and unlock achievements." },
  { icon: Gauge, title: "Step by step", text: "Short chapters from your first SELECT to multi-table JOINs." },
];

// A real challenge from the course, shown as a preview.
const PREVIEW_ID = "t1-c3-01";

export default async function LandingPage() {
  if (await getUser()) redirect("/dashboard");
  const preview = getChallengeContext(PREVIEW_ID)?.challenge;

  return (
    <div className="grid gap-16 py-4 sm:py-10">
      <section className="grid gap-6 text-center">
        <Badge variant="outline" className="mx-auto border-primary/40 text-primary">
          Learn MySQL by playing
        </Badge>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Level up your SQL, one{" "}
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">query</span> at a time
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-pretty text-muted-foreground">
          QueryQuest turns SQL practice into a game: solve real challenges on a live MySQL database, get instant feedback,
          earn XP and unlock new chapters as you go.
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/signup">
              Start your quest <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">I already have an account</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="features-heading" className="grid gap-6">
        <h2 id="features-heading" className="text-center text-2xl font-semibold">
          Why QueryQuest
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Card className="h-full">
                <CardHeader>
                  <Icon className="size-5 text-primary" aria-hidden />
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{text}</CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {preview && (
        <section aria-labelledby="preview-heading" className="grid gap-6">
          <h2 id="preview-heading" className="text-center text-2xl font-semibold">
            A taste of a challenge
          </h2>
          <Card className="mx-auto w-full max-w-3xl">
            <CardHeader className="gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Tier 1 · Combining Conditions</Badge>
                <Badge variant="outline" className="border-accent/50 text-accent">
                  +{preview.xp} XP
                </Badge>
              </div>
              <CardTitle className="text-lg">{preview.title}</CardTitle>
              <p className="text-muted-foreground">{preview.problem.replaceAll("**", "").replaceAll("`", "")}</p>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm font-medium">The result your query should produce:</p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full font-mono text-sm">
                  <thead className="bg-muted/60 text-left">
                    <tr>
                      {preview.expected.columns.map((c) => (
                        <th key={c} scope="col" className="px-3 py-2 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.expected.rows.map((row, i) => (
                      <tr key={i} className="border-t">
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-2">
                            {cell ?? <span className="text-muted-foreground italic">NULL</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
