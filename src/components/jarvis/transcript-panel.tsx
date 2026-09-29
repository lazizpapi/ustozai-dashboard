'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { ReceivedMessage } from '@livekit/components-react';
import { cn } from '@/lib/utils';

interface TranscriptPanelProps {
  messages: ReceivedMessage[];
  className?: string;
}

/** Near the bottom, the list follows new lines; scrolled up to read, it stays put. */
const FOLLOW_WITHIN_PX = 64;

/**
 * Everything said in this call, spoken or typed. Plain text: Jarvis is told to
 * speak without formatting, so there is nothing to render but words.
 */
export function TranscriptPanel({ messages, className }: TranscriptPanelProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const el = scroller.current;
    if (el && following.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }, [messages, reduceMotion]);

  if (messages.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-1 text-center', className)}>
        <p className="text-foreground/80 text-[15px] font-medium">Nothing said yet</p>
        <p className="text-muted-foreground max-w-[34ch] text-sm">
          Talk to Jarvis, or type below. Both land here.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        const el = event.currentTarget;
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_WITHIN_PX;
      }}
      className={cn('overflow-y-auto overscroll-contain mask-y-from-[92%] px-1 py-6', className)}
    >
      <ol className="flex flex-col gap-4">
        {messages.map((entry) => {
          const mine = entry.from?.isLocal === true;
          return (
            <li key={entry.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <p
                className={cn(
                  'max-w-[85%] text-[15px] leading-relaxed break-words whitespace-pre-wrap',
                  mine ? 'bg-primary/15 text-foreground rounded-2xl px-3.5 py-2' : 'text-foreground/90'
                )}
              >
                {entry.message}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
