'use client';

import type { MotionValue } from 'motion/react';
import type { AIState } from '@/components/smoothui/ai-core';
import SiriOrb from '@/components/smoothui/siri-orb';
import { ORB_COLORS } from '@/lib/jarvis-ui/orb-palette';

interface JarvisOrbProps {
  state: AIState;
  size: number;
  amplitude?: MotionValue<number>;
  className?: string;
}

/** Jarvis's presence on screen: smoothui's Siri Orb in Jarvis's colours. */
export function JarvisOrb({ state, size, amplitude, className }: JarvisOrbProps) {
  return (
    <div role="img" aria-label={`Jarvis is ${ORB_LABEL[state]}`} className={className}>
      <SiriOrb
        state={state}
        size={`${size}px`}
        amplitude={amplitude}
        colors={ORB_COLORS}
        animationDuration={18}
      />
    </div>
  );
}

const ORB_LABEL: Record<AIState, string> = {
  idle: 'resting',
  listening: 'listening',
  thinking: 'thinking',
  streaming: 'speaking',
  done: 'done',
  error: 'unavailable',
};
