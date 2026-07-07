"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardTitle } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

interface MemberSyncRun {
  id: number;
  requested_by: string;
  started_at: number;
  finished_at: number | null;
  status: "running" | "done" | "failed";
  group_name: string | null;
  member_count: number | null;
  snapshot_count: number | null;
  upserted: number | null;
  marked_left: number | null;
  error: string | null;
}

interface MemberSyncResponse {
  latest: MemberSyncRun | null;
  pending: boolean;
  error?: string;
}

function statusTone(status: MemberSyncRun["status"]): "ok" | "warn" | "danger" {
  if (status === "done") return "ok";
  if (status === "failed") return "danger";
  return "warn";
}

function statusLabel(status: MemberSyncRun["status"]): string {
  if (status === "done") return "hoàn tất";
  if (status === "failed") return "lỗi";
  return "đang chạy";
}

export function SyncMembersCard({
  initialLatest,
  initialPending,
}: {
  initialLatest: MemberSyncRun | null;
  initialPending: boolean;
}) {
  const [latest, setLatest] = useState<MemberSyncRun | null>(initialLatest);
  const [pending, setPending] = useState(initialPending);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshStatus() {
    const res = await fetch("/api/member-sync", { cache: "no-store" });
    const json = (await res.json()) as MemberSyncResponse;
    if (!res.ok) throw new Error(json.error ?? "Không đọc được trạng thái sync");
    setLatest(json.latest);
    setPending(json.pending);
  }

  async function requestSync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/member-sync", { method: "POST" });
      const json = (await res.json()) as MemberSyncResponse;
      if (!res.ok) throw new Error(json.error ?? "Không gửi được yêu cầu sync");
      setLatest(json.latest);
      setPending(true);
      setMessage("Đã gửi yêu cầu sync.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!pending && latest?.status !== "running") return;
    const timer = setInterval(() => {
      void refreshStatus().catch((e) => setMessage(String(e)));
    }, 2500);
    return () => clearInterval(timer);
  }, [pending, latest?.status]);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Đồng bộ thành viên</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {latest ? (
              <>
                <Badge tone={statusTone(latest.status)}>{statusLabel(latest.status)}</Badge>
                <span className="text-[var(--color-muted)]">{fmtDateTime(latest.finished_at ?? latest.started_at)}</span>
              </>
            ) : (
              <span className="text-[var(--color-muted)]">chưa có lần sync nào</span>
            )}
          </div>
        </div>
        <Button onClick={() => void requestSync()} disabled={busy || pending || latest?.status === "running"} className="gap-2">
          <RefreshCw size={16} className={busy || pending || latest?.status === "running" ? "animate-spin" : ""} />
          Sync ngay
        </Button>
      </div>

      {latest ? (
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
          <SyncMetric label="Zalo báo" value={latest.member_count ?? "—"} />
          <SyncMetric label="Snapshot" value={latest.snapshot_count ?? "—"} />
          <SyncMetric label="Upsert" value={latest.upserted ?? "—"} />
          <SyncMetric label="Inactive" value={latest.marked_left ?? "—"} />
        </div>
      ) : null}

      {message ? <p className="mt-3 text-xs text-[var(--color-muted)]">{message}</p> : null}
      {latest?.error ? <p className="mt-3 text-xs text-[var(--color-danger)]">{latest.error}</p> : null}
    </Card>
  );
}

function SyncMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2">
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 font-semibold text-[var(--color-text)]">{value}</div>
    </div>
  );
}
