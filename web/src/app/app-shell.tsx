"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  History,
  LayoutDashboard,
  ListChecks,
  LogIn,
  MessageSquare,
  Settings,
  Trophy,
  UserMinus,
  UserRoundCheck,
  Users,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Tổng quan", shortLabel: "Tổng quan", icon: LayoutDashboard },
  { href: "/members", label: "Thành viên", shortLabel: "Thành viên", icon: Users },
  { href: "/leaderboard", label: "Xếp hạng", shortLabel: "Top", icon: Trophy },
  { href: "/candidates", label: "Ứng viên", shortLabel: "Ứng viên", icon: UserMinus },
  { href: "/cleanup-plan", label: "Duyệt DS", shortLabel: "Duyệt", icon: ListChecks },
  { href: "/events", label: "Sự kiện TV", shortLabel: "Sự kiện", icon: UserRoundCheck },
  { href: "/messages", label: "Tin nhắn", shortLabel: "Tin nhắn", icon: MessageSquare },
  { href: "/history", label: "Lịch sử dọn", shortLabel: "Lịch sử", icon: History },
  { href: "/errors", label: "Lỗi", shortLabel: "Lỗi", icon: AlertTriangle },
  { href: "/settings", label: "Cấu hình", shortLabel: "Cấu hình", icon: Settings },
  { href: "/login", label: "Đăng nhập", shortLabel: "Đăng nhập", icon: LogIn },
];

export function AppShell({
  children,
  publicMode = false,
}: {
  children: React.ReactNode;
  publicMode?: boolean;
}) {
  const pathname = usePathname();
  const isPublicLeaderboard =
    publicMode || pathname === "/leaderboard" || pathname.startsWith("/leaderboard/");

  if (isPublicLeaderboard) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <>
      <div className="flex min-h-screen">
        <aside className="hidden md:flex md:w-60 md:shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-6 px-2">
            <div className="text-sm font-semibold text-[var(--color-text)]">Bot Member Zalo</div>
            <div className="text-xs text-[var(--color-muted)]">Admin panel</div>
          </div>
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-auto p-4 pb-20 md:p-8 md:pb-8">{children}</main>
      </div>

      <nav className="fixed bottom-0 inset-x-0 z-50 flex overflow-x-auto md:hidden border-t border-[var(--color-border)] bg-[var(--color-surface)]">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-w-16 flex-1 flex-col items-center gap-1 py-2.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <Icon size={20} />
              <span className="text-[10px] leading-none">{item.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
