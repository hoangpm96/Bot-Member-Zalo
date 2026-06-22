"use client";

import { useState } from "react";
import { Card, CardTitle, Button, Input } from "@/components/ui";
import { CONFIG_META, CONFIG_DEFAULTS, type ConfigField, type ConfigValues } from "@/lib/config-meta";

const FIELDS: ConfigField[] = [
  "targetMemberCount",
  "warmupDays",
  "maxKicksPerRun",
  "kickThrottleMs",
  "zaloThrottleMs",
  "approvalTimeoutHours",
];

export function ConfigForm({ initial }: { initial: ConfigValues }) {
  const [values, setValues] = useState<Record<ConfigField, string>>(() => {
    const out = {} as Record<ConfigField, string>;
    for (const f of FIELDS) out[f] = initial[f] !== null ? String(initial[f]) : "";
    return out;
  });
  const [saving, setSaving] = useState<ConfigField | null>(null);
  const [msg, setMsg] = useState<{ field: ConfigField; text: string; ok: boolean } | null>(null);

  async function save(field: ConfigField) {
    setSaving(field);
    setMsg(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field, value: Number(values[field]) }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      setMsg(
        res.ok
          ? { field, text: "Đã lưu.", ok: true }
          : { field, text: json.error ?? "Lỗi không xác định", ok: false },
      );
    } catch (e) {
      setMsg({ field, text: String(e), ok: false });
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardTitle>Tham số dọn dẹp</CardTitle>
      <p className="mt-1 mb-4 text-xs text-[var(--color-muted)]">
        Lưu vào DB; bot ưu tiên đọc giá trị ở đây (fallback .env nếu để trống).
      </p>
      <div className="flex flex-col gap-4">
        {FIELDS.map((f) => {
          const meta = CONFIG_META[f];
          return (
            <div key={f} className="flex flex-col gap-1.5">
              <label className="text-sm text-[var(--color-text)]">
                {meta.label} <span className="text-[var(--color-muted)]">({meta.unit})</span>
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={values[f]}
                  placeholder={`mặc định ${CONFIG_DEFAULTS[f]}`}
                  min={meta.min}
                  max={meta.max}
                  onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                  className="max-w-xs"
                />
                <Button onClick={() => void save(f)} disabled={saving === f}>
                  {saving === f ? "Đang lưu..." : "Lưu"}
                </Button>
                {msg?.field === f ? (
                  <span className={msg.ok ? "text-xs text-[var(--color-ok)]" : "text-xs text-[var(--color-danger)]"}>
                    {msg.text}
                  </span>
                ) : null}
              </div>
              <span className="text-xs text-[var(--color-muted)]">{meta.hint}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
