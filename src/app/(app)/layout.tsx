import Image from "next/image";
import Link from "next/link";

import { ChatDock } from "@/components/dashboard/chat-dock";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { currentRole } from "@/app/load";
import { signOut } from "@/app/login/actions";
import { navFor } from "@/lib/roles";

/**
 * Chrome for the browsable dashboard: header, nav, page container.
 *
 * Scoped to this route group on purpose. /login has no business showing nav
 * links that would only bounce a signed-out visitor back, and /tv is a wall
 * display where every pixel of chrome is wasted.
 */
const ROLE_LABELS = {
  ceo: "Company",
  marketing: "Marketing",
  product: "Product",
  it: "Pipeline",
} as const;

export default async function AppLayout({ children }: LayoutProps<"/"> ) {
  // The role decides the nav, so a department is never shown a link to a page
  // it cannot open. The authoritative check still lives beside the data.
  const role = await currentRole();
  const signedIn = role !== null;
  const nav = role ? navFor(role) : [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col px-5 sm:px-8">
      {/* Single line at desktop, well under the 80px cap. */}
      <header className="flex h-16 shrink-0 items-center gap-6 border-b">
        {/* The real app icon rather than a plain wordmark. Stored locally
            rather than hot-linked from Apple's CDN, which is not a contract
            they offer and would break the header if it moved. */}
        <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-tight">
          <Image
            src="/ustozai-icon.jpg"
            alt=""
            width={22}
            height={22}
            className="ring-foreground/10 rounded-[5px] ring-1"
            priority
          />
          Ustoz AI
        </Link>

        {signedIn ? (
          <nav className="flex items-center gap-4 overflow-x-auto text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground hover:text-foreground whitespace-nowrap transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {signedIn ? (
            <>
              {/* Which dashboard you are on, since there is no switcher any
                  more and every department's screen looks structurally alike. */}
              <span className="text-muted-foreground/70 hidden text-xs sm:inline">
                {ROLE_LABELS[role]}
              </span>
              {role === "ceo" ? (
                <Link
                  href="/tv"
                  className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                >
                  Wall display
                </Link>
              ) : null}
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 py-8">{children}</main>

      {/* Mounted in the layout, not on a page, so the conversation survives
          navigation. CEO only: the analyst can read every table, so giving a
          department the chat would hand it the data its dashboard withholds. */}
      {role === "ceo" ? <ChatDock /> : null}
    </div>
  );
}
