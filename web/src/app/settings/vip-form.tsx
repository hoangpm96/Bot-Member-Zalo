"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Card, CardTitle, Button, Input } from "@/components/ui";
import type { VipEntry } from "@/lib/vip";

export function VipForm({ initial }: { initial: VipEntry[] }) {
  const [entries, setEntries] = useState<VipEntry[]>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function update(i: number, patch: Partial<VipEntry>) {
    setEntries((arr) => arr.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function remove(i: number) {
    setEntries((arr) => arr.filter((_, idx) => idx !== i));
  }
  function add() {
    setEntries((arr) => [...arr, { id: "", note: "" }]);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const clean = entries.filter((e) => e.id.trim() !== "");
      const res = await fetch("/api/vip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: clean }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; entries?: VipEntry[] };
      if (res.ok) {
        setEntries(json.entries ?? clean);
        setMsg({ text: "Đã lưu danh sách VIP.", ok: true });
      } else {
        setMsg({ text: json.error ?? "Lỗi", ok: false });
      }
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardTitle>Danh sách trắng (VIP) — không bao giờ bị kick</CardTitle>
      <p className="mt-1 mb-4 text-xs text-[var(--color-muted)]">
        Tối đa 100 người. Lấy ID từ trang Thành viên. Lưu vào <code>vip-list.json</code> mà bot dùng.
      </p>

      <div className="flex flex-col gap-2">
        {entries.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Chưa có ai trong danh sách.</p>
        ) : (
          entries.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="zalo_user_id"
                value={e.id}
                onChange={(ev) => update(i, { id: ev.target.value })}
                className="max-w-xs font-mono text-xs"
              />
              <Input
                placeholder="ghi chú (vd: đối tác)"
                value={e.note ?? ""}
                onChange={(ev) => update(i, { note: ev.target.value })}
              />
              <Button variant="ghost" onClick={() => remove(i)} aria-label="Xoá">
                <Trash2 size={15} />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="ghost" onClick={add}>
          <Plus size={15} className="mr-1" /> Thêm dòng
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Đang lưu..." : "Lưu danh sách"}
        </Button>
        <span className="text-xs text-[var(--color-muted)]">{entries.length}/100</span>
        {msg ? (
          <span className={msg.ok ? "text-xs text-[var(--color-ok)]" : "text-xs text-[var(--color-danger)]"}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
