'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { AIState } from '@/components/smoothui/ai-core';

/** How strongly the orb lights the room in each state. */
const GLOW: Record<AIState, { opacity: number; scale: number }> = {
  idle: { opacity: 0.45, scale: 0.92 },
  listening: { opacity: 0.85, scale: 1.04 },
  thinking: { opacity: 0.7, scale: 1 },
  streaming: { opacity: 1, scale: 1.08 },
  done: { opacity: 0.8, scale: 1 },
  error: { opacity: 0.2, scale: 0.9 },
};

interface JarvisStageProps {
  orb: AIState;
  /** The orb sits at the top while the transcript is open, so the light follows it up. */
  docked: boolean;
  children: React.ReactNode;
}

/**
 * The room Jarvis lives in: a near-black field lit only by the orb. One soft
 * glow, a vignette and a fixed grain layer; no lines, no particles.
 */
export function JarvisStage({ orb, docked, children }: JarvisStageProps) {
  const reduceMotion = useReducedMotion();
  const glow = GLOW[orb];
  const spring = reduceMotion
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 60, damping: 20 } as const);

  return (
    <div className="relative isolate min-h-[100dvh] overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        <motion.div
          className="absolute inset-x-0 top-[42%]"
          initial={false}
          animate={{ y: docked ? '-36vh' : '0vh' }}
          transition={spring}
        >
          <motion.div
            className="jarvis-glow absolute left-1/2 size-[min(150vw,1200px)] rounded-full"
            initial={false}
            animate={{
              opacity: docked ? glow.opacity * 0.55 : glow.opacity,
              scale: reduceMotion ? 1 : glow.scale,
            }}
            transition={spring}
            style={{ x: '-50%', y: '-50%' }}
          />
        </motion.div>
        <div className="jarvis-vignette absolute inset-0" />
        <div className="jarvis-grain absolute inset-0" />
      </div>
      {children}
    </div>
  );
}
