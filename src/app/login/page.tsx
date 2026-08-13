import { redirect } from "next/navigation";

import { isSignedIn } from "@/app/load";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.next;
  const requested = (Array.isArray(raw) ? raw[0] : raw) ?? "/";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  // Already signed in. Without this the page renders a password form framed by
  // the full nav and a Sign out button, which reads as though the session had
  // failed. The proxy cannot catch it: /login is deliberately public, so it
  // never checks the cookie here.
  if (await isSignedIn()) redirect(next);

  return (
    // Self-contained: this page sits outside the (app) group, so it owns its
    // own centering rather than inheriting a page container.
    <div className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <h1 className="text-lg font-medium tracking-tight">Ustoz AI store metrics</h1>
          <p className="text-muted-foreground text-sm">
            Internal dashboard. Enter the team password.
          </p>
        </div>

        <LoginForm next={next} />
      </div>
    </div>
  );
}
