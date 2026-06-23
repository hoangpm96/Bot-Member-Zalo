"use client";

import { useEffect, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { Card, CardTitle, Badge, Button, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

type LoginState =
  | "ready"
  | "waiting_scan"
  | "scanned"
  | "logged_in"
  | "expired"
  | "declined"
  | "unknown";

interface QrStatus {
  state: LoginState;
  updatedAt: number | null;
  displayName: string | null;
  hasQr: boolean;
}

const STATE_META: Record<
  LoginState,
  { label: string; tone: "default" | "ok" | "warn" | "danger" | "muted" }
> = {
  ready: { label: "Sẵn sàng đăng nhập", tone: "muted" },
  waiting_scan: { label: "Chờ quét", tone: "warn" },
  scanned: { label: "Đã quét — chờ xác nhận", tone: "default" },
  logged_in: { label: "Đã đăng nhập", tone: "ok" },
  expired: { label: "Mã hết hạn", tone: "danger" },
  declined: { label: "Bị từ chối", tone: "danger" },
  unknown: { label: "Chưa có phiên đăng nhập", tone: "muted" },
};

export default function LoginPage() {
  const [status, setStatus] = useState<QrStatus | null>(null);
  const [imgTs, setImgTs] = useState(0);
  const [reloginPending, setReloginPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function checkStatus() {
    setChecking(true);
    try {
      const res = await fetch("/api/qr", { cache: "no-store" });
      if (!res.ok) throw new Error("Không đọc được trạng thái đăng nhập");
      const json = (await res.json()) as QrStatus;
      setStatus(json);
      // Đổi query timestamp để tải lại ảnh nếu Zalo vừa tạo QR mới.
      setImgTs(Date.now());
      if (json.state === "waiting_scan" || json.state === "scanned") {
        setReloginPending(false);
      }
    } catch (e) {
      setStatus(null);
      setActionMessage(e instanceof Error ? e.message : "Không đọc được trạng thái đăng nhập");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void checkStatus();
  }, []);

  const state = status?.state ?? "unknown";
  const meta = STATE_META[state];
  const loggedIn = state === "logged_in";
  const firstLogin = state === "ready" || state === "unknown";
  const expired = state === "expired";
  const showQr = !loggedIn && (status?.hasQr ?? false);

  async function requestRelogin() {
    if (
      !window.confirm(
        "Đăng xuất session Zalo hiện tại và tạo QR mới? Listener sẽ restart trong vài giây.",
      )
    ) {
      return;
    }

    setReloginPending(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/qr/relogin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "RELOGIN" }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Không gửi được yêu cầu");
      setActionMessage(
        "Đã gửi yêu cầu. Chờ vài giây rồi bấm Kiểm tra trạng thái để tải QR mới.",
      );
    } catch (e) {
      setReloginPending(false);
      setActionMessage(e instanceof Error ? e.message : "Không gửi được yêu cầu");
    }
  }

  return (
    <div>
      <PageHeader
        title="Đăng nhập"
        desc="Quét mã QR bằng app Zalo (tài khoản co-admin) để bot đăng nhập."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Mã QR</CardTitle>
          <div className="mt-4 flex flex-col items-center">
            {loggedIn ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="text-base font-semibold text-[var(--color-ok)]">
                  Đăng nhập thành công
                </div>
                {status?.displayName ? (
                  <div className="text-sm text-[var(--color-muted)]">
                    Tài khoản: {status.displayName}
                  </div>
                ) : null}
              </div>
            ) : showQr ? (
              <img
                src={`/api/qr/image?t=${imgTs}`}
                alt="Mã QR đăng nhập Zalo"
                width={260}
                height={260}
                className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-2"
              />
            ) : (
              <div className="py-16 text-center text-sm text-[var(--color-muted)]">
                {expired
                  ? "Mã QR đã hết hạn — đang tạo mã mới…"
                  : "Chưa có mã QR. Khởi động bot để bắt đầu phiên đăng nhập."}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>Trạng thái</CardTitle>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </div>

            <div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="danger"
                  disabled={reloginPending}
                  onClick={requestRelogin}
                  className="gap-2"
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  {reloginPending
                    ? "Đã gửi yêu cầu"
                    : firstLogin
                      ? "Bắt đầu đăng nhập"
                      : "Đăng nhập lại"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={checking}
                  onClick={() => void checkStatus()}
                  className="gap-2"
                >
                  <RefreshCw
                    size={16}
                    aria-hidden="true"
                    className={checking ? "animate-spin" : undefined}
                  />
                  {checking ? "Đang kiểm tra..." : "Kiểm tra trạng thái"}
                </Button>
              </div>
              {actionMessage ? (
                <p className="mt-2 text-sm text-[var(--color-muted)]">{actionMessage}</p>
              ) : null}
            </div>

            {expired ? (
              <p className="text-sm text-[var(--color-warn)]">
                Mã QR đã hết hạn. Bot đang tạo mã mới — vui lòng chờ giây lát.
              </p>
            ) : null}

            {state === "declined" ? (
              <p className="text-sm text-[var(--color-danger)]">
                Yêu cầu đăng nhập bị từ chối trên app. Thử lại bằng mã mới.
              </p>
            ) : null}

            <div className="flex flex-col gap-1 text-sm text-[var(--color-muted)]">
              <div>
                Cập nhật lần cuối:{" "}
                <span className="text-[var(--color-text)]">
                  {fmtDateTime(status?.updatedAt)}
                </span>
              </div>
            </div>

            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-muted)]">
              <div className="mb-2 font-medium text-[var(--color-text)]">Hướng dẫn</div>
              <ol className="list-inside list-decimal space-y-1">
                <li>Mở app Zalo bằng tài khoản co-admin.</li>
                <li>Vào mục quét QR, quét mã bên trái.</li>
                <li>Xác nhận đăng nhập trên điện thoại.</li>
              </ol>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
