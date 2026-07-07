"use client";

import { useState } from "react";
import { Badge, Button, Table, Td, Th } from "@/components/ui";
import { fmtAgo, fmtDateTime } from "@/lib/utils";
import type { CleanupPlanItemRow } from "@/lib/db";

export function CleanupPlanTable({
  initialItems,
  canEdit,
}: {
  initialItems: CleanupPlanItemRow[];
  canEdit: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function setStatus(id: number, status: "planned" | "skipped") {
    setBusyId(id);
    try {
      const res = await fetch("/api/cleanup-plan/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error("Không cập nhật được item");
      setItems((rows) =>
        rows.map((row) =>
          row.id === id
            ? { ...row, status, error: status === "skipped" ? "Admin bỏ chọn trên dashboard." : null }
            : row,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-12">#</Th>
          <Th>Tên</Th>
          <Th>Trạng thái</Th>
          <Th className="text-right">Tương tác</Th>
          <Th>Lần cuối</Th>
          <Th>ID</Th>
          <Th className="text-right">Thao tác</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <Td className="text-[var(--color-muted)]">{item.rank}</Td>
            <Td className="font-medium">{item.display_name || "(không tên)"}</Td>
            <Td>
              <Badge tone={item.status === "planned" ? "danger" : item.status === "skipped" ? "muted" : "warn"}>
                {item.status === "planned" ? "sẽ xoá" : item.status === "skipped" ? "bỏ qua" : item.status}
              </Badge>
            </Td>
            <Td className="text-right">{item.interaction_count}</Td>
            <Td title={fmtDateTime(item.last_interaction)} className="text-[var(--color-muted)]">
              {fmtAgo(item.last_interaction)}
            </Td>
            <Td className="font-mono text-xs text-[var(--color-muted)]">{item.zalo_user_id}</Td>
            <Td className="text-right">
              {item.status === "planned" || item.status === "failed" ? (
                <Button
                  variant="ghost"
                  onClick={() => void setStatus(item.id, "skipped")}
                  disabled={!canEdit || busyId === item.id}
                >
                  Bỏ chọn
                </Button>
              ) : item.status === "skipped" ? (
                <Button
                  variant="ghost"
                  onClick={() => void setStatus(item.id, "planned")}
                  disabled={!canEdit || busyId === item.id}
                >
                  Khôi phục
                </Button>
              ) : (
                <span className="text-xs text-[var(--color-muted)]">—</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
