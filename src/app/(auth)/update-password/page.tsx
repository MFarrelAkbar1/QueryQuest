import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { UpdatePasswordForm } from "@/components/auth/auth-forms";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function UpdatePasswordPage() {
  if (!(await getUser())) redirect("/login?next=/update-password");
  return (
    <AuthCard title="Choose a new password" description="You're signed in from your reset link. Pick a new password.">
      <UpdatePasswordForm />
    </AuthCard>
  );
}
