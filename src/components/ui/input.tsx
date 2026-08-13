import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Two deliberate departures from the stock shadcn input.
        //
        // border-input-line rather than border-input: the stock token is also
        // the dark-mode field background via dark:bg-input/30, so raising it to
        // a legible contrast would have lightened the whole field. The border
        // gets its own token; see globals.css.
        //
        // ring-ring/20 rather than ring-ring/50: the border change is the focus
        // indicator and the ring is only depth. At 50% it reads as a glow,
        // which the house rules ban outright.
        "h-8 w-full min-w-0 rounded-lg border border-input-line bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
