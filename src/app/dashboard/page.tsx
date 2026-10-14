import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

// Phase 3: proves auth + RLS reads work end to end. The full dashboard (level, progress,
// achievements, Continue Learning) is built in Phase 4.
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=/dashboard");

  const [{ data: profile, error: profileError }, { data: stats, error: statsError }] = await Promise.all([
    supabase.from("profiles").select("display_name, timezone").eq("id", auth.user.id).single(),
    supabase.from("player_stats").select("total_xp, challenges_completed, current_streak").eq("user_id", auth.user.id).single(),
  ]);
  const { passwordUpdated } = await searchParams;

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Welcome{profile?.display_name ? `, ${profile.display_name}` : ""}!</h1>
      {passwordUpdated && (
        <Alert role="status">
          <AlertDescription>Your password has been updated.</AlertDescription>
        </Alert>
      )}
      {profileError || statsError ? (
        <Alert variant="destructive">
          <AlertDescription>We couldn&apos;t load your progress. Please refresh the page.</AlertDescription>
        </Alert>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-3">
          {[
            ["Total XP", stats?.total_xp ?? 0],
            ["Challenges completed", stats?.challenges_completed ?? 0],
            ["Day streak", stats?.current_streak ?? 0],
          ].map(([label, value]) => (
            <li key={label}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                </CardHeader>
                <CardContent className="text-3xl font-semibold tabular-nums">{value}</CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
