"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle, Badge, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

type LoginState =
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

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch("/api/qr", { cache: "no-store" });
        const json = (await res.json()) as QrStatus;
        if (active) {
          setStatus(json);
          // Đổi query timestamp để buộc trình duyệt tải lại ảnh QR mới.
          setImgTs(Date.now());
        }
      } catch {
        if (active) setStatus(null);
      }
    }

    poll();
    const id = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const state = status?.state ?? "unknown";
  const meta = STATE_META[state];
  const loggedIn = state === "logged_in";
  const expired = state === "expired";
  const showQr = !loggedIn && (status?.hasQr ?? false);

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
