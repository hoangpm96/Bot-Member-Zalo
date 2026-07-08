"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserX } from "lucide-react";
import { Button, Modal } from "@/components/ui";

type Phase = "idle" | "confirming" | "sending" | "polling" | "done" | "error";

interface KickNowResult {
  requestId: string;
  ok: boolean;
  error?: string;
  blocked?: boolean;
  blockError?: string | null;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

export function KickNowButton({
  id,
  displayName,
  role,
  isVip,
}: {
  id: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  isVip: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [block, setBlock] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function confirm() {
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/kick-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zaloUserId: id, displayName, block }),
      });
      const json = (await res.json()) as { ok?: boolean; requestId?: string; error?: string };
      if (!res.ok || !json.ok || !json.requestId) {
        setError(json.error ?? "Lỗi gửi yêu cầu kick");
        setPhase("error");
        return;
      }
      setPhase("polling");
      const requestId = json.requestId;
      const startedAt = Date.now();
      pollTimer.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling();
          setError("Quá thời gian chờ bot xử lý. Kiểm tra lại trạng thái bot / thử lại.");
          setPhase("error");
          return;
        }
        try {
          const pollRes = await fetch(`/api/kick-now?requestId=${encodeURIComponent(requestId)}`);
          const pollJson = (await pollRes.json()) as { pending?: boolean; result?: KickNowResult };
          if (pollJson.pending || !pollJson.result) return;
          stopPolling();
          if (pollJson.result.ok) {
            setPhase("done");
            router.refresh();
          } else {
            setError(pollJson.result.error ?? "Kick thất bại");
            setPhase("error");
          }
        } catch {
          // lỗi mạng tạm thời khi poll — thử lại ở lần interval kế tiếp
        }
      }, POLL_INTERVAL_MS);
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }

  function close() {
    stopPolling();
    setOpen(false);
    setPhase("idle");
    setBlock(false);
    setError(null);
  }

  const busy = phase === "sending" || phase === "polling";

  return (
    <>
      <Button
        variant="ghost"
        className="h-7 px-2 text-xs text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)]"
        onClick={() => {
          setOpen(true);
          setPhase("confirming");
        }}
        aria-label="Kick khỏi nhóm"
        title="Kick khỏi nhóm"
      >
        <UserX size={14} />
      </Button>

      <Modal open={open} onClose={busy ? () => {} : close} title="Kick khỏi nhóm ngay?">
        <p className="text-sm text-[var(--color-text)]">
          Sẽ kick <strong>{displayName || "(không tên)"}</strong> khỏi nhóm{" "}
          <strong>ngay lập tức</strong>, không qua duyệt Telegram. Hành động này khó hoàn tác.
        </p>
        {isVip ? (
          <p className="mt-2 rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
            Người này đang trong <strong>Danh sách trắng (VIP)</strong> — theo quy tắc thì không bao giờ bị
            kick. Bấm xác nhận vẫn sẽ kick ngay, hãy chắc chắn đây là ý muốn của bạn.
          </p>
        ) : null}
        {role !== "member" ? (
          <p className="mt-2 rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--color-warn)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-warn)]">
            Người này đang có vai trò <strong>{role}</strong> trong nhóm — cân nhắc kỹ trước khi kick.
          </p>
        ) : null}

        <label className="mt-3 flex items-center gap-2 text-sm text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={block}
            onChange={(e) => setBlock(e.target.checked)}
            disabled={busy || phase === "done"}
          />
          Chặn luôn, không cho tham gia lại nhóm
        </label>

        {phase === "polling" ? (
          <p className="mt-3 text-xs text-[var(--color-muted)]">Đang chờ bot xử lý...</p>
        ) : null}
        {phase === "done" ? (
          <p className="mt-3 text-xs text-[var(--color-ok)]">Đã kick thành công.</p>
        ) : null}
        {error ? <p className="mt-3 text-xs text-[var(--color-danger)]">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={busy}>
            {phase === "done" ? "Đóng" : "Huỷ"}
          </Button>
          {phase !== "done" ? (
            <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
              {phase === "sending" ? "Đang gửi..." : phase === "polling" ? "Đang xử lý..." : "Xác nhận kick"}
            </Button>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
