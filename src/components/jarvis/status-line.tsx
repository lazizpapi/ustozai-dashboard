'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

interface StatusLineProps {
  text: string | null;
  /**
   * Read the line out to screen readers. On for what Jarvis is doing; off for
   * plain states like Listening, which would be chatty during a voice call.
   */
  announce?: boolean;
  className?: string;
}

/** One quiet line under the orb. Crossfades when it changes, and says nothing when there is nothing to say. */
export function StatusLine({ text, announce = false, className }: StatusLineProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      data-slot="status-line"
      aria-live={announce ? 'polite' : 'off'}
      aria-atomic="true"
      className={cn('relative flex h-6 items-center justify-center', className)}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {text && (
          <motion.p
            key={text}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="text-muted-foreground text-sm font-medium tracking-tight whitespace-nowrap"
          >
            {text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
