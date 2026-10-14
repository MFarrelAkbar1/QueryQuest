import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/auth-forms";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to continue your quest."
      footer={
        <>
          New to QueryQuest?&nbsp;
          <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {error === "link" && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>That link is invalid or has expired. Please try again.</AlertDescription>
        </Alert>
      )}
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthCard>
  );
}
