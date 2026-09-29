'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Globe, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { JarvisPicture } from '@/components/jarvis/hooks/use-jarvis-screen';
import { cn } from '@/lib/utils';

const ICON_BUTTON =
  'text-foreground/70 hover:text-foreground focus-visible:ring-ring/60 grid size-9 shrink-0 place-items-center rounded-full outline-none transition-colors hover:bg-white/8 focus-visible:ring-[3px] [&_svg]:size-4';

interface ScreenPanelProps {
  picture: JarvisPicture;
  onHide: () => void;
  className?: string;
}

/**
 * The picture at full size, for reading on a phone: the page is desktop width,
 * so it scrolls in both directions. Escape or the close button ends it.
 * Rendered on the body, because the panel's frosted glass would otherwise
 * hold a fixed overlay inside the panel.
 */
function FullSize({ picture, onClose }: { picture: JarvisPicture; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Jarvis's browser at full size: ${picture.title}`}
      // The call screen's colours and glass are scoped to .jarvis.dark.
      className="jarvis dark text-foreground fixed inset-0 z-50 overflow-auto overscroll-contain bg-black/95"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture held in memory, not a file to optimise */}
      <img src={picture.src} alt={`Jarvis's browser: ${picture.title}`} className="block max-w-none" />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close the full-size picture"
        className="jarvis-glass focus-visible:ring-ring/60 fixed top-[max(1rem,env(safe-area-inset-top))] right-4 grid size-11 place-items-center rounded-full text-foreground outline-none focus-visible:ring-[3px] [&_svg]:size-5"
      >
        <X aria-hidden="true" />
      </button>
    </div>,
    document.body
  );
}

/** What Jarvis's browser is showing: the latest picture, the site and page title. */
export function ScreenPanel({ picture, onHide, className }: ScreenPanelProps) {
  const reduceMotion = useReducedMotion();
  const [enlarged, setEnlarged] = useState(false);
  const shrink = useCallback(() => setEnlarged(false), []);
  const subtitle = picture.title !== picture.host ? picture.title : '';

  return (
    <figure className={cn('jarvis-glass overflow-hidden rounded-[22px]', className)}>
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        aria-label="Show Jarvis's browser at full size"
        className="focus-visible:ring-ring/60 block w-full cursor-zoom-in bg-black/35 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        <motion.img
          key={picture.id}
          src={picture.src}
          alt={`Jarvis's browser: ${picture.title || 'a page'}`}
          initial={reduceMotion ? false : { opacity: 0.4 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="mx-auto block aspect-video max-h-[40dvh] w-full object-contain"
        />
      </button>
      {enlarged && <FullSize picture={picture} onClose={shrink} />}
      <figcaption className="flex items-center gap-2 py-1.5 pr-1.5 pl-3.5">
        <Globe className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="text-foreground/90 font-medium">{picture.host || "Jarvis's browser"}</span>
          {subtitle && <span className="text-muted-foreground"> · {subtitle}</span>}
        </p>
        {picture.href && (
          <a
            href={picture.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${picture.host} on this device`}
            title="Open on this device"
            className={ICON_BUTTON}
          >
            <ExternalLink aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide Jarvis's screen"
          title="Hide"
          className={ICON_BUTTON}
        >
          <X aria-hidden="true" />
        </button>
      </figcaption>
    </figure>
  );
}
