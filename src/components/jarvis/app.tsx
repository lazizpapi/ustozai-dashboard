'use client';

import { useMemo } from 'react';
import { TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import { AgentSessionProvider } from '@/components/jarvis/agent-session-provider';
import { JarvisScreen } from '@/components/jarvis/jarvis-screen';
import { Toaster } from '@/components/jarvis/ui/sonner';

/**
 * Jarvis inside the dashboard.
 *
 * The call token comes from /api/jarvis-token, which reads the session cookie
 * this page was opened with. Which agent joins, and the room it joins, are set
 * inside that signed token; nothing here can choose them.
 */
export function JarvisApp() {
  const tokenSource = useMemo(() => TokenSource.endpoint('/api/jarvis-token'), []);
  const session = useSession(tokenSource);

  return (
    <AgentSessionProvider session={session}>
      <JarvisScreen />
      <Toaster position="top-center" />
    </AgentSessionProvider>
  );
}
