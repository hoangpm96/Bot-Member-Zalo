"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star, StarOff } from "lucide-react";
import { Button, Modal } from "@/components/ui";

export function VipToggleButton({
  id,
  displayName,
  isVip,
}: {
  id: string;
  displayName: string;
  isVip: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/vip");
      const { entries } = (await res.json()) as { entries: { id: string; note?: string }[] };
      const next = isVip ? entries.filter((e) => e.id !== id) : [...entries, { id }];
      const saveRes = await fetch("/api/vip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: next }),
      });
      const json = (await saveRes.json()) as { ok?: boolean; error?: string };
      if (!saveRes.ok) {
        setError(json.error ?? "Lỗi");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={isVip ? "Bỏ VIP" : "Thêm VIP"}
        title={isVip ? "Bỏ VIP" : "Thêm VIP"}
      >
        {isVip ? <StarOff size={14} /> : <Star size={14} />}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={isVip ? "Bỏ khỏi danh sách VIP?" : "Thêm vào danh sách VIP?"}>
        <p className="text-sm text-[var(--color-text)]">
          {isVip ? (
            <>
              <strong>{displayName || "(không tên)"}</strong> sẽ không còn được miễn kick tự động (trừ khi vẫn là
              admin/owner).
            </>
          ) : (
            <>
              <strong>{displayName || "(không tên)"}</strong> sẽ được thêm vào Danh sách trắng (VIP) — không bao giờ
              bị kick.
            </>
          )}
        </p>
        {error ? <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Huỷ
          </Button>
          <Button variant={isVip ? "danger" : "primary"} onClick={() => void confirm()} disabled={saving}>
            {saving ? "Đang lưu..." : isVip ? "Bỏ VIP" : "Xác nhận thêm"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
