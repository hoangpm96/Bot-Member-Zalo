"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui";

export function SaveDraftButton() {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/draft-plans", { method: "POST" });
      const json = (await res.json()) as { id?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Không lưu được plan nháp");
      setMessage(`Đã lưu plan nháp #${json.id}. Refresh để xem so sánh mới.`);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void save()} disabled={saving} className="gap-2">
        <Save size={16} />
        {saving ? "Đang lưu..." : "Lưu plan nháp"}
      </Button>
      {message ? <span className="text-xs text-[var(--color-muted)]">{message}</span> : null}
    </div>
  );
}
