"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardTitle, Button, Input, Badge } from "@/components/ui";
import type { ModerationConfig, ModerationAction } from "@/lib/blacklist";

const MAX_WORDS = 500;

export function BlacklistForm({ initial }: { initial: ModerationConfig }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [action, setAction] = useState<ModerationAction>(initial.action);
  const [words, setWords] = useState<string[]>(initial.words);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function addDraft() {
    const w = draft.trim();
    if (!w) return;
    // Bỏ trùng không phân biệt hoa/thường (giữ dấu).
    const exists = words.some((x) => x.toLocaleLowerCase("vi") === w.toLocaleLowerCase("vi"));
    if (!exists && words.length < MAX_WORDS) setWords((arr) => [...arr, w]);
    setDraft("");
    setMsg(null);
  }

  function remove(i: number) {
    setWords((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/blacklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, action, words }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; words?: string[] };
      if (res.ok) {
        if (json.words) setWords(json.words);
        setMsg({ text: "Đã lưu. Bot áp dụng ngay cho tin nhắn mới.", ok: true });
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
      <CardTitle>Lọc từ khoá cấm — tự xoá tin & ban người gửi</CardTitle>
      <p className="mt-1 mb-4 text-xs text-[var(--color-muted)]">
        Khi một tin nhắn trong nhóm chứa từ khoá cấm, bot tự xoá tin (cho mọi người) và —
        nếu chọn — kick + chặn người đó tham gia lại. Owner/admin và danh sách VIP luôn được
        bỏ qua. Nếu bot chạy với <code>DRY_RUN=1</code> thì chỉ ghi log/báo, không xoá/kick thật.
      </p>

      {/* Bật/tắt */}
      <label className="mb-4 flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-primary)]"
        />
        <span className="text-sm text-[var(--color-text)]">Bật lọc từ khoá</span>
        <Badge tone={enabled ? "ok" : "muted"}>{enabled ? "đang bật" : "đang tắt"}</Badge>
      </label>

      {/* Hành động */}
      <div className="mb-5 flex flex-col gap-2">
        <span className="text-sm text-[var(--color-text)]">Khi dính từ khoá:</span>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
          <input
            type="radio"
            name="moderation-action"
            checked={action === "delete_and_ban"}
            onChange={() => setAction("delete_and_ban")}
            className="accent-[var(--color-primary)]"
          />
          Xoá tin + ban (kick khỏi nhóm và chặn tham gia lại)
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
          <input
            type="radio"
            name="moderation-action"
            checked={action === "delete_only"}
            onChange={() => setAction("delete_only")}
            className="accent-[var(--color-primary)]"
          />
          Chỉ xoá tin (không kick)
        </label>
      </div>

      {/* Thêm từ khoá */}
      <div className="mb-3 flex max-w-xl items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="Nhập từ/cụm từ cấm rồi Enter (vd: lừa đảo)"
          aria-label="Thêm từ khoá cấm"
          disabled={words.length >= MAX_WORDS}
        />
        <Button variant="ghost" onClick={addDraft} disabled={words.length >= MAX_WORDS} aria-label="Thêm">
          <Plus size={15} />
        </Button>
      </div>
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        Khớp <strong>nguyên từ</strong>, không phân biệt hoa/thường, có phân biệt dấu (vd “cấm”
        khác “cam”). Cụm nhiều từ vẫn khớp khi xuất hiện đầy đủ.
      </p>

      {/* Danh sách từ khoá */}
      <div className="flex flex-wrap gap-2">
        {words.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Chưa có từ khoá nào.</p>
        ) : (
          words.map((w, i) => (
            <span
              key={`${w}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1 text-sm text-[var(--color-text)]"
            >
              {w}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Xoá từ khoá ${w}`}
                className="text-[var(--color-muted)] hover:text-[var(--color-danger)]"
              >
                <Trash2 size={13} />
              </button>
            </span>
          ))
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Đang lưu..." : "Lưu cấu hình lọc"}
        </Button>
        <span className="text-xs text-[var(--color-muted)]">{words.length}/{MAX_WORDS} từ</span>
        {msg ? (
          <span className={msg.ok ? "text-xs text-[var(--color-ok)]" : "text-xs text-[var(--color-danger)]"}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
