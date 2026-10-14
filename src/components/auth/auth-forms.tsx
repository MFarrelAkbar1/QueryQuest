"use client";

import Link from "next/link";
import { useActionState, useSyncExternalStore } from "react";
import { login, requestPasswordReset, signUp, updatePassword } from "@/app/(auth)/actions";
import { idleState } from "@/lib/schemas/auth";
import { Field, FormMessage, SubmitButton } from "./form-parts";

const noopSubscribe = () => () => {};
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(login, idleState);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field name="email" label="Email" type="email" autoComplete="email" required state={state} />
      <div className="grid gap-2">
        <Field name="password" label="Password" type="password" autoComplete="current-password" required state={state} />
        <Link href="/forgot-password" className="justify-self-end text-sm text-primary underline-offset-4 hover:underline">
          Forgot your password?
        </Link>
      </div>
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUp, idleState);
  // The streak is counted in the learner's own timezone; default comes from the browser.
  // Empty during server rendering; the database then falls back to Asia/Jakarta.
  const timezone = useSyncExternalStore(noopSubscribe, browserTimezone, () => "");

  if (state.status === "success") return <FormMessage state={state} />;

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="timezone" value={timezone} />
      <Field name="displayName" label="Display name" autoComplete="nickname" maxLength={50} required state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" required state={state} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        hint="At least 8 characters."
        state={state}
      />
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, idleState);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" required state={state} />
      <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, action] = useActionState(updatePassword, idleState);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        hint="At least 8 characters."
        state={state}
      />
      <Field name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required state={state} />
      <SubmitButton pendingLabel="Saving…">Save new password</SubmitButton>
    </form>
  );
}
