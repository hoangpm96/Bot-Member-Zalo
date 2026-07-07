"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardTitle } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

interface PermissionStatus {
  checkedAt?: number;
  role?: string;
  canReadMembers?: boolean;
  likelyCanKick?: boolean;
  likelyCanDeleteMessages?: boolean;
  likelyCanBlockMembers?: boolean;
  issues?: string[];
  error?: string;
}

interface PermissionResponse {
  latest: PermissionStatus | null;
  pending: boolean;
  error?: string;
}

export function PermissionCheckCard({
  initialLatest,
  initialPending,
}: {
  initialLatest: PermissionStatus | null;
  initialPending: boolean;
}) {
  const [latest, setLatest] = useState(initialLatest);
  const [pending, setPending] = useState(initialPending);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/permission-check", { cache: "no-store" });
    const json = (await res.json()) as PermissionResponse;
    if (!res.ok) throw new Error(json.error ?? "Không đọc được trạng thái quyền");
    setLatest(json.latest);
    setPending(json.pending);
  }

  async function requestCheck() {
    setMessage(null);
    const res = await fetch("/api/permission-check", { method: "POST" });
    const json = (await res.json()) as PermissionResponse;
    if (!res.ok) {
      setMessage(json.error ?? "Không gửi được yêu cầu");
      return;
    }
    setPending(true);
    setLatest(json.latest);
    setMessage("Đã gửi yêu cầu check quyền.");
  }

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      void refresh().catch((e) => setMessage(String(e)));
    }, 2500);
    return () => clearInterval(timer);
  }, [pending]);

  const ok =
    latest?.canReadMembers &&
    latest?.likelyCanKick &&
    latest?.likelyCanDeleteMessages &&
    latest?.likelyCanBlockMembers &&
    !latest.error;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Quyền bot</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {latest ? (
              <>
                <Badge tone={ok ? "ok" : "warn"}>{latest.role ?? "unknown"}</Badge>
                <span className="text-[var(--color-muted)]">{fmtDateTime(latest.checkedAt)}</span>
              </>
            ) : (
              <span className="text-[var(--color-muted)]">chưa check</span>
            )}
          </div>
        </div>
        <Button onClick={() => void requestCheck()} disabled={pending} className="gap-2">
          <ShieldCheck size={16} />
          Check quyền
        </Button>
      </div>
      {latest ? (
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
          <Perm label="Đọc member" ok={latest.canReadMembers} />
          <Perm label="Kick" ok={latest.likelyCanKick} />
          <Perm label="Xoá tin" ok={latest.likelyCanDeleteMessages} />
          <Perm label="Chặn lại" ok={latest.likelyCanBlockMembers} />
        </div>
      ) : null}
      {latest?.issues?.length ? (
        <ul className="mt-3 list-disc pl-5 text-xs text-[var(--color-warn)]">
          {latest.issues.slice(0, 4).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {latest?.error ? <p className="mt-3 text-xs text-[var(--color-danger)]">{latest.error}</p> : null}
      {message ? <p className="mt-3 text-xs text-[var(--color-muted)]">{message}</p> : null}
    </Card>
  );
}

function Perm({ label, ok }: { label: string; ok: boolean | undefined }) {
  return (
    <div className="rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2">
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className={ok ? "mt-1 font-semibold text-[var(--color-ok)]" : "mt-1 font-semibold text-[var(--color-danger)]"}>
        {ok ? "OK" : "Chưa OK"}
      </div>
    </div>
  );
}
