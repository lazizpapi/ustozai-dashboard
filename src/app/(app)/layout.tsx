import Image from "next/image";
import Link from "next/link";

import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { isSignedIn } from "@/app/load";
import { signOut } from "@/app/login/actions";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/analyst", label: "Analyst" },
  { href: "/growth", label: "Growth" },
  { href: "/rankings", label: "Rankings" },
  { href: "/market", label: "Market" },
  { href: "/downloads", label: "Downloads" },
  { href: "/keywords", label: "Keywords" },
  { href: "/reviews", label: "Reviews" },
];

/**
 * Chrome for the browsable dashboard: header, nav, page container.
 *
 * Scoped to this route group on purpose. /login has no business showing nav
 * links that would only bounce a signed-out visitor back, and /tv is a wall
 * display where every pixel of chrome is wasted.
 */
export default async function AppLayout({ children }: LayoutProps<"/"> ) {
  const signedIn = await isSignedIn();

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
            {NAV.map((item) => (
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
              <Link
                href="/tv"
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                Wall display
              </Link>
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
    </div>
  );
}
