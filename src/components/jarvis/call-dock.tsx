'use client';

import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Track } from 'livekit-client';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { useChat } from '@livekit/components-react';
import {
  LoaderCircle,
  type LucideIcon,
  MessageSquareText,
  MonitorUp,
  PhoneOff,
  SendHorizontal,
  Video,
  VideoOff,
} from 'lucide-react';
import { AgentTrackControl } from '@/components/jarvis/agent-track-control';
import { Toggle } from '@/components/jarvis/ui/toggle';
import { useInputControls, usePublishPermissions } from '@/components/jarvis/hooks/use-agent-control-bar';
import { canShareScreen } from '@/lib/jarvis-ui/screen-share';
import { cn } from '@/lib/utils';

const QUIET_TOGGLE = [
  'size-10 min-w-10 rounded-full p-0 text-foreground/70 transition-[color,background-color,scale]',
  'hover:bg-white/8 hover:text-foreground active:scale-95',
  'data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:hover:bg-primary/20',
  '[&_svg]:size-5',
];

interface DockToggleProps {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  pending?: boolean;
  icon: LucideIcon;
  pressedIcon?: LucideIcon;
  onPressedChange: (pressed: boolean) => void;
}

/** A control that is simply off when off: neutral, never red. */
function DockToggle({
  label,
  pressed,
  disabled,
  pending,
  icon: OffIcon,
  pressedIcon: OnIcon = OffIcon,
  onPressedChange,
}: DockToggleProps) {
  const Shown = pending ? LoaderCircle : pressed ? OnIcon : OffIcon;
  return (
    <Toggle
      aria-label={label}
      title={label}
      pressed={pressed}
      disabled={disabled}
      onPressedChange={onPressedChange}
      className={cn(QUIET_TOGGLE)}
    >
      <Shown className={cn(pending && 'animate-spin')} />
    </Toggle>
  );
}

function ChatInput({ ready, onSend }: { ready: boolean; onSend: (text: string) => Promise<void> }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const empty = text.trim().length === 0;

  // Back into the box after each send, and as soon as Jarvis arrives.
  useEffect(() => {
    if (ready && !sending) inputRef.current?.focus();
  }, [ready, sending]);

  const send = async () => {
    if (empty || sending || !ready) return;
    setSending(true);
    try {
      await onSend(text.trim());
      setText('');
    } catch (error) {
      console.error('Could not send the message:', error);
      toast.error('That message did not reach Jarvis. Try sending it again.');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="focus-within:ring-ring/50 m-1 flex items-end gap-2 rounded-[22px] py-1 pr-1 pl-1 transition-shadow focus-within:ring-2">
      <label htmlFor="jarvis-chat" className="sr-only">
        Message to Jarvis
      </label>
      <textarea
        id="jarvis-chat"
        ref={inputRef}
        rows={1}
        value={text}
        // Read-only while sending, not disabled: a disabled field drops focus.
        readOnly={sending}
        aria-busy={sending}
        disabled={!ready}
        placeholder={ready ? 'Type to Jarvis' : 'Jarvis is joining'}
        onKeyDown={onKeyDown}
        onChange={(event) => setText(event.target.value)}
        className="text-foreground placeholder:text-foreground/45 field-sizing-content max-h-28 min-h-10 flex-1 resize-none [scrollbar-width:thin] bg-transparent px-2 py-2.5 text-[15px] leading-5 focus:outline-none disabled:opacity-60"
      />
      <button
        type="button"
        aria-label="Send"
        title="Send"
        disabled={empty || sending || !ready}
        onClick={() => void send()}
        className="bg-primary text-primary-foreground focus-visible:ring-ring/60 grid size-10 shrink-0 place-items-center rounded-full transition-[opacity,scale] outline-none focus-visible:ring-[3px] active:scale-95 disabled:opacity-30"
      >
        {sending ? (
          <LoaderCircle className="size-5 animate-spin" />
        ) : (
          <SendHorizontal className="size-5" />
        )}
      </button>
    </div>
  );
}

const DEVICE_NAMES: Partial<Record<Track.Source, string>> = {
  [Track.Source.Microphone]: 'microphone',
  [Track.Source.Camera]: 'camera',
  [Track.Source.ScreenShare]: 'screen',
};

/** A refused or missing device would otherwise just flip its toggle back. */
function reportDeviceError({ source, error }: { source: Track.Source; error: Error }) {
  console.error(`Could not use the ${source}:`, error);
  // Closing the screen picker is a choice, not a failure, though it raises the same error.
  const cancelled =
    error.name === 'AbortError' ||
    (source === Track.Source.ScreenShare && error.name === 'NotAllowedError');
  if (cancelled) return;
  const device = DEVICE_NAMES[source] ?? 'device';
  toast.error(
    error.name === 'NotAllowedError'
      ? `The browser blocked your ${device}. Allow it for this page to use it.`
      : `Jarvis could not use your ${device}.`
  );
}

const noChanges = () => () => {};

/** False on a phone, whose browser cannot share its screen with a page. */
function useCanShareScreen(): boolean {
  return useSyncExternalStore(noChanges, () => canShareScreen(navigator.mediaDevices), () => false);
}

interface CallDockProps {
  /** False until Jarvis has joined; typed text sent before that would be lost. */
  agentReady: boolean;
  isChatOpen: boolean;
  onChatOpenChange: (open: boolean) => void;
  onEnd: () => void;
}

/** The controls for a call: microphone, camera, screen, transcript, and End call. */
export function CallDock({ agentReady, isChatOpen, onChatOpenChange, onEnd }: CallDockProps) {
  const { send } = useChat();
  const permissions = usePublishPermissions();
  const canShare = useCanShareScreen();
  const reduceMotion = useReducedMotion();
  const {
    microphoneTrack,
    cameraToggle,
    microphoneToggle,
    screenShareToggle,
    handleAudioDeviceChange,
    handleMicrophoneDeviceSelectError,
  } = useInputControls({ saveUserChoices: true, onDeviceError: reportDeviceError });

  // The start button that had focus is gone; hand focus to the first control.
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) dockRef.current?.querySelector('button')?.focus();
  }, []);

  const sendText = async (text: string) => {
    await send(text);
  };

  return (
    <motion.div
      layout={!reduceMotion}
      ref={dockRef}
      role="group"
      aria-label="Call controls"
      className={cn(
        'jarvis-glass mx-auto rounded-[28px] p-1.5',
        isChatOpen ? 'w-full max-w-2xl' : 'w-fit max-w-full max-sm:w-full'
      )}
      transition={{ type: 'spring', stiffness: 380, damping: 36 }}
    >
      <AnimatePresence initial={false}>
        {isChatOpen && permissions.data && (
          <motion.div
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="border-b border-white/8"
          >
            <ChatInput ready={agentReady} onSend={sendText} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        layout={reduceMotion ? false : 'position'}
        className="flex items-center gap-1 p-0.5"
      >
        {permissions.microphone && (
          <AgentTrackControl
            kind="audioinput"
            source={Track.Source.Microphone}
            pressed={microphoneToggle.enabled}
            disabled={microphoneToggle.pending}
            audioTrack={microphoneTrack}
            onPressedChange={microphoneToggle.toggle}
            onActiveDeviceChange={handleAudioDeviceChange}
            onMediaDeviceError={handleMicrophoneDeviceSelectError}
            className="jarvis-mic rounded-full [&_button]:h-10 [&_button:first-child]:rounded-l-full [&_button:last-child]:rounded-r-full"
          />
        )}
        {permissions.camera && (
          <DockToggle
            label="Camera"
            icon={VideoOff}
            pressedIcon={Video}
            pressed={cameraToggle.enabled}
            pending={cameraToggle.pending}
            disabled={cameraToggle.pending}
            onPressedChange={cameraToggle.toggle}
          />
        )}
        {permissions.screenShare && canShare && (
          <DockToggle
            label="Share screen"
            icon={MonitorUp}
            pressed={screenShareToggle.enabled}
            pending={screenShareToggle.pending}
            disabled={screenShareToggle.pending}
            onPressedChange={screenShareToggle.toggle}
          />
        )}
        {permissions.data && (
          <DockToggle
            label="Transcript and typing"
            icon={MessageSquareText}
            pressed={isChatOpen}
            onPressedChange={onChatOpenChange}
          />
        )}
        <div className={cn(isChatOpen ? 'flex-1' : 'w-3 max-sm:flex-1')} />
        <button
          type="button"
          onClick={onEnd}
          className="bg-destructive/15 text-destructive hover:bg-destructive/25 focus-visible:ring-destructive/40 flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-[background-color,scale] outline-none focus-visible:ring-[3px] active:scale-[0.97]"
        >
          <PhoneOff className="size-5" />
          <span className="max-sm:sr-only">End call</span>
        </button>
      </motion.div>
    </motion.div>
  );
}
