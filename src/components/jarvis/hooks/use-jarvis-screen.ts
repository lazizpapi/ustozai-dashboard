'use client';

import { useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { staleUrls } from '@/lib/jarvis-ui/picture-urls';
import { SCREEN_TOPIC, type ScreenCaption, readScreen } from '@/lib/jarvis-ui/screen';

export type JarvisPicture = ScreenCaption & { id: string; src: string };

/**
 * The latest picture of Jarvis's browser in this call, or null.
 *
 * Only the agent's pictures count. Each picture lives as an object URL, freed
 * once a newer one, or the end of the call, replaces it, including one that
 * arrived in the same render as the next and was never shown.
 */
export function useJarvisScreen(room: Room, connected: boolean): JarvisPicture | null {
  const [picture, setPicture] = useState<JarvisPicture | null>(null);
  const made = useRef(new Set<string>());
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
          const src = URL.createObjectURL(blob);
          made.current.add(src);
          setPicture({ ...caption, id, src });
        })
        .catch((error: unknown) => console.warn("Could not read Jarvis's screen:", error));
    });
    return () => {
      live = false;
      room.unregisterByteStreamHandler(SCREEN_TOPIC);
    };
  }, [room]);

  const src = picture?.src ?? null;
  useEffect(() => {
    for (const url of staleUrls([...made.current], src)) {
      URL.revokeObjectURL(url);
      made.current.delete(url);
    }
  }, [src]);

  useEffect(() => {
    const urls = made.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  return picture;
}
