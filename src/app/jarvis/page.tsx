import { requireAccess } from "@/app/load";
import { JarvisApp } from "@/components/jarvis/app";

export const dynamic = "force-dynamic";

/**
 * Talk to Jarvis, the company's voice assistant.
 *
 * Open to every department. Jarvis learns who is calling from the token that
 * /api/jarvis-token signs for this session, and answers each department only
 * within its own pages (src/lib/jarvis/authority.ts).
 */
export default async function JarvisPage() {
  await requireAccess("/jarvis");
  return <JarvisApp />;
}
