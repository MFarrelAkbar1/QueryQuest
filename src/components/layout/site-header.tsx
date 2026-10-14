import { Database, LogOut } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/supabase/server";

export async function SiteHeader() {
  const user = await getUser();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground">
            <Database className="size-4" aria-hidden />
          </span>
          QueryQuest
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          {user ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard">Dashboard</Link>
              </Button>
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="sm">
                  <LogOut aria-hidden />
                  <span className="sr-only sm:not-sr-only">Sign out</span>
                </Button>
              </form>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
