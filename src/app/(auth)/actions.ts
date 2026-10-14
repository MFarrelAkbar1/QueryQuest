"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/redirect";
import {
  ForgotPasswordSchema,
  LoginSchema,
  SignUpSchema,
  UpdatePasswordSchema,
  type FormState,
} from "@/lib/schemas/auth";
import { createClient } from "@/lib/supabase/server";

function invalid(error: z.ZodError, values?: Record<string, string>): FormState {
  return { status: "error", fieldErrors: z.flattenError(error).fieldErrors, values };
}

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
};

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = LoginSchema.safeParse({
    email: text(formData, "email"),
    password: text(formData, "password"),
    next: text(formData, "next"),
  });
  if (!parsed.success) return invalid(parsed.error, { email: text(formData, "email") ?? "" });

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // Same message for unknown email and wrong password: don't reveal which accounts exist.
    const message =
      error.code === "email_not_confirmed"
        ? "Please confirm your email address first. Check your inbox for the link."
        : "Email or password is incorrect.";
    return { status: "error", message, values: { email: parsed.data.email } };
  }
  redirect(safeNextPath(parsed.data.next));
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { displayName: text(formData, "displayName") ?? "", email: text(formData, "email") ?? "" };
  const parsed = SignUpSchema.safeParse({
    displayName: text(formData, "displayName"),
    email: text(formData, "email"),
    password: text(formData, "password"),
    timezone: text(formData, "timezone") || undefined,
  });
  if (!parsed.success) return invalid(parsed.error, values);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/dashboard`,
      // Read by the handle_new_user trigger to create the profile.
      data: { display_name: parsed.data.displayName, timezone: parsed.data.timezone },
    },
  });
  if (error) {
    const message =
      error.code === "weak_password"
        ? "That password is too weak. Try a longer one."
        : error.code === "over_email_send_rate_limit"
          ? "Too many emails sent. Please wait a minute and try again."
          : "We couldn't create your account. Please try again.";
    return { status: "error", message, values };
  }
  // With email confirmation enabled there is no session yet.
  if (!data.session) {
    return { status: "success", message: "Check your inbox: we sent you a link to confirm your email address." };
  }
  redirect("/dashboard");
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = ForgotPasswordSchema.safeParse({ email: text(formData, "email") });
  if (!parsed.success) return invalid(parsed.error, { email: text(formData, "email") ?? "" });

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/update-password`,
  });
  // Always the same answer, so the form can't be used to discover accounts.
  return { status: "success", message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = UpdatePasswordSchema.safeParse({
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return { status: "error", message: "Your reset link has expired. Request a new one." };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const message =
      error.code === "same_password"
        ? "Choose a password that is different from your current one."
        : "We couldn't update your password. Please try again.";
    return { status: "error", message };
  }
  redirect("/dashboard?passwordUpdated=1");
}
