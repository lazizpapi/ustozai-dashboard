/**
 * What to tell the user when starting a call fails, or null when something
 * else already told them.
 *
 * Starting a call connects to the room and turns the microphone on at the same
 * time, so a refused microphone fails the start even though the room connected.
 * A room that connected but where Jarvis never arrived is reported by
 * useAgentErrors, so it gets no second message here.
 *
 * Before any of that, the dashboard has to issue a call token. LiveKit's token
 * source reports a refusal as an Error whose message carries the status.
 */
const TOKEN_REFUSED = /from endpoint \S+: received (\d{3})/;

function tokenStatus(error: unknown): number | null {
  const match = error instanceof Error ? TOKEN_REFUSED.exec(error.message) : null;
  return match ? Number(match[1]) : null;
}

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

  const status = tokenStatus(error);
  if (status === 401) return 'Your sign-in has ended. Reload the page and sign in again.';
  if (status === 503) return 'Jarvis is not set up on this dashboard yet. Ask the dashboard owner.';
  if (status !== null) return 'The dashboard could not start a call. Try again in a moment.';
  return 'Jarvis could not connect. Check your internet connection, then try again.';
}
