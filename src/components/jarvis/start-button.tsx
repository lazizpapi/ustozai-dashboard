'use client';

import { useEffect, useRef } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StartButtonProps {
  connecting: boolean;
  /** No calls can start, such as when the month's free minutes are spent. */
  disabled?: boolean;
  /** Take keyboard focus when shown, e.g. after a call ends. */
  focusOnMount?: boolean;
  onStart: () => void;
  className?: string;
}

/** The one thing to do on the welcome screen. */
export function StartButton({
  connecting,
  disabled = false,
  focusOnMount = false,
  onStart,
  className,
}: StartButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onStart}
      disabled={connecting || disabled}
      className={cn(
        'bg-primary text-primary-foreground focus-visible:ring-ring/60 shadow-primary/25 inline-flex h-12 items-center justify-center gap-2 rounded-full px-8 text-[15px] font-semibold shadow-[0_8px_40px_-8px] transition-[filter,scale,opacity] outline-none hover:brightness-110 focus-visible:ring-[3px] active:scale-[0.98] disabled:opacity-60',
        className
      )}
    >
      {connecting && <LoaderCircle className="size-5 animate-spin" />}
      {connecting ? 'Connecting' : 'Talk to Jarvis'}
    </button>
  );
}
