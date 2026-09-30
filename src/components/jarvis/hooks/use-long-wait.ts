'use client';

import { useEffect, useState } from 'react';

/** True once `waiting` has lasted `afterMs`, until it stops. */
export function useLongWait(waiting: boolean, afterMs: number): boolean {
  const [overdue, setOverdue] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setOverdue(true), afterMs);
    return () => {
      window.clearTimeout(timer);
      setOverdue(false);
    };
  }, [waiting, afterMs]);

  return waiting && overdue;
}
