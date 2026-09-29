'use client';

import { useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import { SCREEN_TOPIC, type ScreenCaption, readScreen } from '@/lib/jarvis-ui/screen';

export type JarvisPicture = ScreenCaption & { id: string; src: string };

/**
 * The latest picture of Jarvis's browser in this call, or null.
 *
 * Only the agent's pictures count. Each picture lives as an object URL, freed
 * once a newer one, or the end of the call, replaces it.
 */
export function useJarvisScreen(room: Room, connected: boolean): JarvisPicture | null {
  const [picture, setPicture] = useState<JarvisPicture | null>(null);
  // A call's pictures end with it. Adjusted during render, not in an effect.
  if (!connected && picture !== null) setPicture(null);

  useEffect(() => {
    let live = true;
    room.registerByteStreamHandler(SCREEN_TOPIC, (reader, from) => {
      if (!room.remoteParticipants.get(from.identity)?.isAgent) return;
      const { id, mimeType, attributes } = reader.info;
      const caption = readScreen(mimeType, attributes);
      if (!caption) return;
      reader
        .readAll()
        .then((chunks) => {
          if (!live) return;
          const blob = new Blob(chunks as BlobPart[], { type: mimeType });
          setPicture({ ...caption, id, src: URL.createObjectURL(blob) });
        })
        .catch((error: unknown) => console.warn("Could not read Jarvis's screen:", error));
    });
    return () => {
      live = false;
      room.unregisterByteStreamHandler(SCREEN_TOPIC);
    };
  }, [room]);

  const src = picture?.src;
  useEffect(() => {
    if (!src) return;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  return picture;
}
