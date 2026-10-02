'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useAgent, useSessionContext } from '@livekit/components-react';

interface AgentErrorOptions {
  /** Jarvis said goodbye and is leaving on purpose: end quietly, no toast. */
  expectedEnd?: boolean;
  /** Told LiveKit's reasons whenever the failure is shown, for the call log. */
  onFailure?: (reasons: readonly string[]) => void;
}

/** When Jarvis drops out of a live call, say so once and end the call. */
export function useAgentErrors({ expectedEnd = false, onFailure }: AgentErrorOptions = {}) {
  const agent = useAgent();
  const { isConnected, end } = useSessionContext();

  useEffect(() => {
    if (!isConnected || agent.state !== 'failed') return;
    if (!expectedEnd) {
      const reasons = agent.failureReasons ?? [];
      // A fixed id: this effect can run again before the call has ended, and
      // the caller should see the message once, not stacked twice.
      toast.error('Jarvis left the call', {
        id: 'jarvis-left-the-call',
        description: [reasons.join(' '), 'If this keeps happening, check that the agent is running.']
          .filter(Boolean)
          .join(' '),
        duration: 10_000,
      });
      onFailure?.(reasons);
    }
    end();
  }, [agent, isConnected, end, expectedEnd, onFailure]);
}
