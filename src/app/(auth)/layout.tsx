export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-12">{children}</div>;
}
