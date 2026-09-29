import { Empty, PageHeader, Section } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { load } from "@/app/load";
import { recentJarvisCalls } from "@/lib/db/queries";
import { timeAgo } from "@/lib/format";
import { callLength } from "@/lib/jarvis/calls";

export const dynamic = "force-dynamic";

/**
 * Every call with Jarvis: which department, when, how long, what it used.
 *
 * The CEO's alone (canSee fails closed for it), because a summary can carry
 * an answer about the takings. There are no personal accounts, so a row says
 * which department's password signed the caller in, not which person.
 */

export default async function CallsPage() {
  const result = await load(() => recentJarvisCalls(100), "/calls");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const calls = result.data;
  const minutes = Math.round(calls.reduce((sum, call) => sum + call.durationSeconds, 0) / 60);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Calls with Jarvis"
        note={
          calls.length
            ? `${calls.length} most recent, ${minutes} minutes in all. LiveKit's free plan covers 1,000 a month.`
            : "Each call with Jarvis is listed here when it ends."
        }
      />

      <Section title="Recent calls" flush>
        {calls.length === 0 ? (
          <div className="px-4">
            <Empty>No calls yet. Open Jarvis from the menu and talk to it.</Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Length</TableHead>
                <TableHead>Used</TableHead>
                <TableHead className="w-1/2">Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell className="whitespace-nowrap">{timeAgo(call.startedAt)}</TableCell>
                  <TableCell>{call.callerName || call.role}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {callLength(call.durationSeconds)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {call.toolsUsed.length ? call.toolsUsed.join(", ") : "nothing"}
                  </TableCell>
                  <TableCell className="text-sm whitespace-normal">{call.summary || "No summary."}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
