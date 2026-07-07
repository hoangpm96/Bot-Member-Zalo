import { Badge, Card, CardTitle } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import type { BotHealth } from "@/lib/db";

export function BotHealthCard({ health }: { health: BotHealth | null }) {
  const heartbeatAge = health?.heartbeatAt ? Date.now() - health.heartbeatAt : null;
  const fresh = heartbeatAge !== null && heartbeatAge < 2 * 60 * 1000;
  const socketOk = health?.socketState === "connected";

  return (
    <Card>
      <CardTitle>Bot health</CardTitle>
      {!health ? (
        <p className="mt-3 text-sm text-[var(--color-muted)]">Chưa có heartbeat từ bot.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={fresh && socketOk ? "ok" : "warn"}>{health.socketState ?? "unknown"}</Badge>
            <span className="text-[var(--color-muted)]">heartbeat {fmtDateTime(health.heartbeatAt)}</span>
          </div>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
            <Metric label="PID" value={health.pid ?? "—"} />
            <Metric label="Events" value={health.totalEvents ?? 0} />
            <Metric label="Message" value={health.messageEvents ?? 0} />
            <Metric label="Reaction" value={health.reactionEvents ?? 0} />
          </div>
          {health.lastSocketError ? <p className="mt-3 text-xs text-[var(--color-danger)]">{health.lastSocketError}</p> : null}
        </>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2">
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 font-semibold text-[var(--color-text)]">{value}</div>
    </div>
  );
}
