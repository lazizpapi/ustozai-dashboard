'use client';

import { useMemo } from 'react';
import { TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import { AgentSessionProvider } from '@/components/jarvis/agent-session-provider';
import { useCallerPrefs } from '@/components/jarvis/hooks/use-caller-prefs';
import { JarvisScreen } from '@/components/jarvis/jarvis-screen';
import { Toaster } from '@/components/jarvis/ui/sonner';
import { tokenOptions } from '@/lib/jarvis-ui/caller-prefs';
import type { MonthUsage } from '@/lib/jarvis/budget';

/**
 * Jarvis inside the dashboard.
 *
 * The call token comes from /api/jarvis-token, which reads the session cookie
 * this page was opened with. Which agent joins, and the room it joins, are set
 * inside that signed token; nothing here can choose them. The caller's chosen
 * language and first name go with the request, and are all it can ask for.
 */
export function JarvisApp({ budget }: { budget: MonthUsage | null }) {
  const tokenSource = useMemo(() => TokenSource.endpoint('/api/jarvis-token'), []);
  const [prefs, choose] = useCallerPrefs();
  const options = useMemo(() => tokenOptions(prefs), [prefs]);
  const session = useSession(tokenSource, options);

  return (
    <AgentSessionProvider session={session}>
      <JarvisScreen prefs={prefs} onPrefsChange={choose} budget={budget} />
      <Toaster position="top-center" />
    </AgentSessionProvider>
  );
}
