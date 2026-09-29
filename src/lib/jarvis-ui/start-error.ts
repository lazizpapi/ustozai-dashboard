/**
 * What to tell the user when starting a call fails, or null when something
 * else already told them.
 *
 * Starting a call connects to the room and turns the microphone on at the same
 * time, so a refused microphone fails the start even though the room connected.
 * A room that connected but where Jarvis never arrived is reported by
 * useAgentErrors, so it gets no second message here.
 */
export function startErrorMessage(error: unknown, roomConnected: boolean): string | null {
  const name = error instanceof Error ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
      return 'Jarvis needs to hear you. Allow the microphone for this page, then try again.';
    case 'NotFoundError':
      return 'No microphone found. Connect one, then try again.';
    case 'NotReadableError':
      return 'Another app is using the microphone. Close it, then try again.';
    case 'AbortError':
      return null;
  }
  if (roomConnected) return null;
  return 'Jarvis could not connect. Check that the agent is running, then try again.';
}
