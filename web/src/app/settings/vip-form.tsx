"use client";

import { useMemo, useState } from "react";
import { Search, Trash2, UserPlus } from "lucide-react";
import { Card, CardTitle, Button, Input } from "@/components/ui";
import type { VipEntry } from "@/lib/vip";
import type { MemberOption } from "@/lib/db";

export function VipForm({
  initial,
  members,
}: {
  initial: VipEntry[];
  members: MemberOption[];
}) {
  const [entries, setEntries] = useState<VipEntry[]>(initial);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const selectedIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries]);
  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("vi");
    if (!q) return [];
    return members
      .filter(
        (member) =>
          !selectedIds.has(member.id) &&
          (member.displayName.toLocaleLowerCase("vi").includes(q) || member.id.includes(q)),
      )
      .slice(0, 10);
  }, [members, query, selectedIds]);

  function update(i: number, patch: Partial<VipEntry>) {
    setEntries((arr) => arr.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function remove(i: number) {
    setEntries((arr) => arr.filter((_, idx) => idx !== i));
  }
  function add(member: MemberOption) {
    if (entries.length >= 100 || selectedIds.has(member.id)) return;
    setEntries((arr) => [...arr, { id: member.id, note: "" }]);
    setQuery("");
    setMsg(null);
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
        Tìm và chọn từ thành viên đang hoạt động. Tối đa 100 người.
      </p>

      <div className="relative mb-4 max-w-xl">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-[18px] -translate-y-1/2 text-[var(--color-muted)]"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm theo tên hoặc Zalo ID"
          aria-label="Tìm thành viên để thêm VIP"
          className="pl-9"
          disabled={entries.length >= 100}
        />
        {query.trim() ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
            {matches.length ? (
              matches.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => add(member)}
                  className="flex w-full items-center gap-3 border-b border-[var(--color-border)] px-3 py-2.5 text-left last:border-b-0 hover:bg-[var(--color-surface-2)]"
                >
                  <UserPlus size={16} className="shrink-0 text-[var(--color-muted)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--color-text)]">
                      {member.displayName || "(không tên)"}
                    </span>
                    <span className="block truncate font-mono text-xs text-[var(--color-muted)]">
                      {member.id}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--color-muted)]">{member.role}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-3 text-sm text-[var(--color-muted)]">
                Không tìm thấy thành viên chưa có trong danh sách VIP.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        {entries.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Chưa có ai trong danh sách.</p>
        ) : (
          entries.map((e, i) => (
            <div key={e.id} className="grid items-center gap-2 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
              <div className="min-w-0 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
                <div className="truncate text-sm font-medium text-[var(--color-text)]">
                  {memberById.get(e.id)?.displayName || "(không còn trong danh sách thành viên)"}
                </div>
                <div className="truncate font-mono text-xs text-[var(--color-muted)]">{e.id}</div>
              </div>
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
