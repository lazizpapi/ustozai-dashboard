'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ConnectionState } from 'livekit-client';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { useAgent, useSessionContext, useSessionMessages } from '@livekit/components-react';
import { StartAudioButton } from '@/components/jarvis/start-audio-button';
import { CallDock } from '@/components/jarvis/call-dock';
import { JarvisOrb } from '@/components/jarvis/jarvis-orb';
import { JarvisStage } from '@/components/jarvis/jarvis-stage';
import { ScreenPanel } from '@/components/jarvis/screen-panel';
import { StartButton } from '@/components/jarvis/start-button';
import { StatusLine } from '@/components/jarvis/status-line';
import { TranscriptPanel } from '@/components/jarvis/transcript-panel';
import { useJarvisActivity } from '@/components/jarvis/hooks/use-jarvis-activity';
import { useJarvisScreen } from '@/components/jarvis/hooks/use-jarvis-screen';
import { useMediaQuery } from '@/components/jarvis/hooks/use-media-query';
import { useOrbAmplitude } from '@/components/jarvis/hooks/use-orb-amplitude';
import { useAgentErrors } from '@/components/jarvis/hooks/useAgentErrors';
import { ORB_SIZE } from '@/lib/jarvis-ui/orb-palette';
import {
  type CallOutcome,
  GOODBYE_VIEW,
  callOutcome,
  isAgentReady,
  orbViewFor,
} from '@/lib/jarvis-ui/orb-state';
import { cn } from '@/lib/utils';
import { startErrorMessage } from '@/lib/jarvis-ui/start-error';

const ORB_SPRING = { type: 'spring', stiffness: 170, damping: 26 } as const;
/** How long the orb shows how a call ended: a goodbye, or a failure. */
const OUTCOME_SHOWN_MS = 4000;

/**
 * How the last call ended, for a few seconds afterwards. Computed during
 * render while it happens, so not even one frame shows the wrong state.
 */
function useCallOutcome(current: CallOutcome | null): CallOutcome | null {
  const [held, setHeld] = useState<CallOutcome | null>(null);
  // Adjusted during render rather than in an effect: remember the outcome as
  // soon as it appears, so the frame after the call ends still has it.
  if (current !== null && current !== held) setHeld(current);

  useEffect(() => {
    if (held === null || current !== null) return;
    const timer = window.setTimeout(() => setHeld(null), OUTCOME_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [held, current]);

  return current ?? held;
}

/**
 * The whole app: one stage where the orb stays put while the call starts and
 * ends, and moves to the top when the transcript or Jarvis's screen opens.
 */
export function JarvisScreen() {
  const session = useSessionContext();
  const agent = useAgent();
  const { messages } = useSessionMessages(session);
  const activity = useJarvisActivity(session.isConnected);
  useAgentErrors({ expectedEnd: activity.ending });
  const narrow = useMediaQuery('(max-width: 639px)');
  const reduceMotion = useReducedMotion();
  const [chatOpen, setChatOpen] = useState(false);
  // The latest picture of Jarvis's browser. Hiding one hides only that
  // picture: the next page Jarvis opens shows again.
  const picture = useJarvisScreen(session.room, session.isConnected);
  const [hiddenPicture, setHiddenPicture] = useState<string | null>(null);
  const screenShown = session.isConnected && picture !== null && picture.id !== hiddenPicture;
  // When a call ends the transcript closes and focus goes back to the start
  // button instead of the page. Adjusted during render, not in an effect.
  const [wasConnected, setWasConnected] = useState(session.isConnected);
  const [returnFocus, setReturnFocus] = useState(false);
  if (wasConnected !== session.isConnected) {
    setWasConnected(session.isConnected);
    if (!session.isConnected) {
      setChatOpen(false);
      setReturnFocus(true);
    }
  }

  const connecting = session.connectionState === ConnectionState.Connecting;
  const liveOutcome = callOutcome(agent.state, session.isConnected, activity.ending);
  const lastOutcome = useCallOutcome(liveOutcome);
  // In a call only its own outcome counts. Afterwards the last one shows for a
  // moment, until the next call starts, and a stale `failed` from LiveKit never
  // reaches the welcome screen.
  const disconnected = session.connectionState === ConnectionState.Disconnected;
  const shownOutcome = session.isConnected ? liveOutcome : disconnected ? lastOutcome : null;
  const liveState = session.isConnected || connecting ? agent.state : 'disconnected';
  const view =
    shownOutcome === 'goodbye'
      ? GOODBYE_VIEW
      : orbViewFor(shownOutcome === 'failed' ? 'failed' : liveState);
  const amplitude = useOrbAmplitude(view.amplitude);
  const docked = session.isConnected && (chatOpen || screenShown);

  // The orb is always drawn at stage size and scaled down when docked, so the
  // move is a pure transform and never upscales a small render.
  const stage = narrow ? ORB_SIZE.stageNarrow : ORB_SIZE.stage;
  const box = docked ? ORB_SIZE.docked : stage;

  const start = () => {
    session.start().catch((error: unknown) => {
      console.error('Could not start the call:', error);
      const message = startErrorMessage(error, session.room.state === ConnectionState.Connected);
      if (message) toast.error(message);
      // A refused microphone still leaves the room connected; do not keep it.
      void session.end();
    });
  };

  return (
    <JarvisStage orb={view.orb} docked={docked}>
      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center px-5 md:h-16 md:px-8">
        <Link
          href="/"
          aria-label="Jarvis. Back to the dashboard"
          className="text-foreground/85 hover:text-foreground focus-visible:ring-ring/60 flex items-center gap-1.5 rounded-full text-[15px] font-semibold tracking-tight outline-none focus-visible:ring-[3px]"
        >
          <ChevronLeft className="text-muted-foreground size-4" aria-hidden="true" />
          Jarvis
        </Link>
      </header>

      <main
        data-agent-state={agent.state}
        className="relative z-10 mx-auto flex h-[100dvh] w-full max-w-2xl flex-col px-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] md:pt-16 md:pb-8"
      >
        <section
          className={cn(
            'flex shrink-0 flex-col items-center',
            docked ? 'gap-1 pt-1' : 'flex-1 justify-center gap-8'
          )}
        >
          <motion.div
            layout={!reduceMotion}
            transition={ORB_SPRING}
            className="relative"
            style={{ width: box, height: box }}
          >
            <motion.div
              className="absolute top-1/2 left-1/2"
              style={{ x: '-50%', y: '-50%', scale: box / stage, width: stage, height: stage }}
            >
              <JarvisOrb state={view.orb} size={stage} amplitude={amplitude} />
            </motion.div>
          </motion.div>
          <motion.div layout={reduceMotion ? false : 'position'} transition={ORB_SPRING}>
            <StatusLine text={activity.label ?? view.status} announce={activity.label !== null} />
          </motion.div>
        </section>

        <AnimatePresence>
          {docked && (
            <motion.div
              key="panels"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.25 } }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              className={cn('flex min-h-0 flex-1 flex-col gap-3 pt-3', !chatOpen && 'justify-center')}
            >
              {screenShown && picture && (
                <ScreenPanel
                  className="shrink-0"
                  picture={picture}
                  onHide={() => setHiddenPicture(picture.id)}
                />
              )}
              {chatOpen && <TranscriptPanel className="min-h-0 flex-1" messages={messages} />}
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="flex shrink-0 flex-col items-center gap-3 pt-4">
          <StartAudioButton
            label="Tap to hear Jarvis"
            className="bg-primary/15 text-primary hover:bg-primary/25 h-9 rounded-full px-4"
          />
          {session.isConnected ? (
            <CallDock
              agentReady={isAgentReady(agent.state)}
              isChatOpen={chatOpen}
              onChatOpenChange={setChatOpen}
              onEnd={session.end}
            />
          ) : (
            <StartButton connecting={connecting} onStart={start} focusOnMount={returnFocus} />
          )}
        </footer>
      </main>
    </JarvisStage>
  );
}
