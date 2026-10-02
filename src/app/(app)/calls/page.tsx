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
import { FREE_MINUTES, type MonthUsage } from "@/lib/jarvis/budget";
import {
  callLength,
  isFailedStart,
  tokenCount,
  unusualEnding,
  withoutShadowedFailures,
} from "@/lib/jarvis/calls";
import { readMonthUsage } from "@/lib/jarvis/month-budget";

export const dynamic = "force-dynamic";

/**
 * Every call with Jarvis: which department, when, how long, what it used.
 *
 * The CEO's alone (canSee fails closed for it), because a summary can carry
 * an answer about the takings. There are no personal accounts, so a row says
 * which department's password signed the caller in, not which person.
 *
 * A call that never got going (Jarvis never joined, the caller gave up
 * waiting, the microphone was blocked) is reported by the call screen and
 * listed too, so a colleague's failed first try is not invisible.
 */

/** "2 calls in this list did not start.", or nothing when all of them did. */
function failedLine(failed: number): string {
  if (failed === 0) return "";
  return failed === 1 ? " 1 call in this list did not start." : ` ${failed} calls in this list did not start.`;
}

/** This month against the free plan's cap, which stops every call once reached. */
function monthLine(usage: MonthUsage | null): string {
  if (!usage) return "This month's minutes could not be counted.";
  const used = `${usage.used.toLocaleString("en-US")} of ${FREE_MINUTES.toLocaleString("en-US")} free minutes used this month`;
  if (usage.spent) return `${used}. Calls are paused until the 1st.`;
  if (usage.low) return `${used}. Only ${usage.left} left: calls stop when they run out.`;
  return `${used}.`;
}

export default async function CallsPage() {
  const [result, usage] = await Promise.all([
    load(() => recentJarvisCalls(100), "/calls"),
    readMonthUsage(),
  ]);

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const calls = withoutShadowedFailures(result.data);
  const failed = calls.filter((call) => isFailedStart(call.closeReason)).length;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Calls with Jarvis"
        note={
          calls.length
            ? `${monthLine(usage)} Each call lasts at most twenty minutes.${failedLine(failed)}`
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
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="w-1/2">Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell className="whitespace-nowrap">{timeAgo(call.startedAt)}</TableCell>
                  <TableCell>{call.callerName || call.role}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {isFailedStart(call.closeReason) ? (
                      <span className="text-destructive font-medium">Did not start</span>
                    ) : (
                      callLength(call.durationSeconds)
                    )}
                    {unusualEnding(call.closeReason) && (
                      <span className="text-muted-foreground block text-xs">
                        {unusualEnding(call.closeReason)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {call.toolsUsed.length ? call.toolsUsed.join(", ") : "nothing"}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground text-right text-xs whitespace-nowrap tabular-nums"
                    title={`${call.inputTokens.toLocaleString("en-US")} in, ${call.outputTokens.toLocaleString("en-US")} out`}
                  >
                    {tokenCount(call.inputTokens + call.outputTokens)}
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
