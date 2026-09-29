'use client';

import { type RefObject, useEffect, useRef } from 'react';
import {
  type LocalAudioTrack,
  type RemoteAudioTrack,
  TrackEvent,
  createAudioAnalyser,
} from 'livekit-client';
import {
  type MotionValue,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import { useLocalParticipant, useVoiceAssistant } from '@livekit/components-react';
import { scaleVolume, smoothLevel } from '@/lib/jarvis-ui/amplitude';
import type { AmplitudeSource } from '@/lib/jarvis-ui/orb-state';

type AudioTrack = LocalAudioTrack | RemoteAudioTrack;

/** Wider than LiveKit's default -100..-80 dB, which saturates on normal speech. */
const ANALYSER_OPTIONS = {
  cloneTrack: false,
  fftSize: 512,
  smoothingTimeConstant: 0.6,
  minDecibels: -90,
  maxDecibels: -25,
};

/** A function reading the track's loudness now, or null while there is no track. */
function useVolumeReader(track: AudioTrack | undefined): RefObject<(() => number) | null> {
  const reader = useRef<(() => number) | null>(null);

  useEffect(() => {
    if (!track) return;
    let analyser: ReturnType<typeof createAudioAnalyser> | null = null;

    const release = () => {
      reader.current = null;
      void analyser?.cleanup();
      analyser = null;
    };
    const build = () => {
      release();
      if (!track.mediaStreamTrack) return;
      try {
        analyser = createAudioAnalyser(track, ANALYSER_OPTIONS);
        reader.current = analyser.calculateVolume;
      } catch (error) {
        // No Web Audio: the orb keeps its ambient motion and ignores loudness.
        console.warn('Orb amplitude unavailable:', error);
      }
    };

    build();
    // Switching microphones, or a headset connecting, restarts the same
    // LiveKit track with a new MediaStreamTrack: listen on the new one.
    track.on(TrackEvent.Restarted, build);
    return () => {
      track.off(TrackEvent.Restarted, build);
      release();
    };
  }, [track]);

  return reader;
}

/**
 * The loudness the orb should react to, 0..1, as a MotionValue so a 60 fps
 * signal never re-renders React. It follows the user's microphone while Jarvis
 * listens and Jarvis's own voice while it speaks, and eases to zero otherwise.
 */
export function useOrbAmplitude(source: AmplitudeSource): MotionValue<number> {
  const { audioTrack } = useVoiceAssistant();
  const { microphoneTrack } = useLocalParticipant();
  const readAgent = useVolumeReader(audioTrack?.publication?.track as RemoteAudioTrack | undefined);
  const readMicrophone = useVolumeReader(microphoneTrack?.track as LocalAudioTrack | undefined);
  const reduceMotion = useReducedMotion();
  const level = useMotionValue(0);

  useAnimationFrame(() => {
    const read =
      source === 'agent'
        ? readAgent.current
        : source === 'microphone'
          ? readMicrophone.current
          : null;
    const target = read && !reduceMotion ? scaleVolume(read()) : 0;
    const previous = level.get();
    const next = smoothLevel(previous, target);
    if (next !== previous) level.set(next);
  });

  return level;
}
