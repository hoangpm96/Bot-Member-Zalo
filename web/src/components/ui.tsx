import * as React from "react";
import { cn } from "@/lib/utils";

/** Bộ UI primitive tối giản theo phong cách shadcn (gộp 1 file cho gọn). */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-medium text-[var(--color-muted)]", className)} {...props} />;
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <div className="mt-2 text-2xl font-semibold text-[var(--color-text)]">{value}</div>
      {sub ? <div className="mt-1 text-xs text-[var(--color-muted)]">{sub}</div> : null}
    </Card>
  );
}

type BadgeTone = "default" | "ok" | "warn" | "danger" | "muted";

export function Badge({
  tone = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    default: "bg-[var(--color-surface-2)] text-[var(--color-text)]",
    ok: "bg-[color-mix(in_srgb,var(--color-ok)_18%,transparent)] text-[var(--color-ok)]",
    warn: "bg-[color-mix(in_srgb,var(--color-warn)_18%,transparent)] text-[var(--color-warn)]",
    danger: "bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]",
    muted: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: BadgeTone; label: string }> = {
    done: { tone: "ok", label: "hoàn tất" },
    kicking: { tone: "warn", label: "đang kick" },
    pending_approval: { tone: "warn", label: "chờ duyệt" },
    planned: { tone: "default", label: "đã lập DS" },
    cancelled: { tone: "muted", label: "đã huỷ" },
    skipped: { tone: "muted", label: "bỏ qua" },
    failed: { tone: "danger", label: "lỗi" },
    collecting: { tone: "muted", label: "đang quét" },
    warned: { tone: "default", label: "đã cảnh báo" },
  };
  const m = map[status] ?? { tone: "default" as const, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function Button({
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const variants = {
    primary: "bg-[var(--color-primary)] text-white hover:opacity-90",
    ghost:
      "bg-transparent text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]",
    danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
  };
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-[var(--radius)] px-4 text-sm font-medium transition-opacity disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-border)]">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-left font-medium text-[var(--color-muted)]",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("border-b border-[var(--color-border)] px-4 py-2.5 text-[var(--color-text)]", className)}
      {...props}
    />
  );
}

export function PageHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold text-[var(--color-text)]">{title}</h1>
      {desc ? <p className="mt-1 text-sm text-[var(--color-muted)]">{desc}</p> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Card className="text-center text-sm text-[var(--color-muted)]">{children}</Card>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
