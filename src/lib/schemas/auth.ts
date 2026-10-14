import { z } from "zod";

const email = z.email("Enter a valid email address.").max(254);
// bcrypt (used by Supabase Auth) only looks at the first 72 bytes.
const password = z.string().min(8, "Use at least 8 characters.").max(72, "Use at most 72 characters.");

export const LoginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export const SignUpSchema = z.object({
  displayName: z.string().trim().min(1, "Choose a display name.").max(50, "Use at most 50 characters."),
  email,
  password,
  // Detected in the browser; invalid values fall back to Asia/Jakarta in the database.
  timezone: z.string().max(64).optional(),
});

export const ForgotPasswordSchema = z.object({ email });

export const UpdatePasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  });

export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Echo non-secret fields back so the form keeps them after an error. */
  values?: Record<string, string>;
};

export const idleState: FormState = { status: "idle" };
