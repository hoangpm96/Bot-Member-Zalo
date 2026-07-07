import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { LayoutDashboard, Users, History, Settings, LogIn, MessageSquare, UserRoundCheck, UserMinus, ListChecks } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot Member Zalo — Admin",
  description: "Bảng điều khiển bot dọn thành viên group Zalo",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const NAV = [
  { href: "/", label: "Tổng quan", shortLabel: "Tổng quan", icon: LayoutDashboard },
  { href: "/members", label: "Thành viên", shortLabel: "Thành viên", icon: Users },
  { href: "/candidates", label: "Ứng viên", shortLabel: "Ứng viên", icon: UserMinus },
  { href: "/cleanup-plan", label: "Duyệt DS", shortLabel: "Duyệt", icon: ListChecks },
  { href: "/events", label: "Sự kiện TV", shortLabel: "Sự kiện", icon: UserRoundCheck },
  { href: "/messages", label: "Tin nhắn", shortLabel: "Tin nhắn", icon: MessageSquare },
  { href: "/history", label: "Lịch sử dọn", shortLabel: "Lịch sử", icon: History },
  { href: "/settings", label: "Cấu hình", shortLabel: "Cấu hình", icon: Settings },
  { href: "/login", label: "Đăng nhập", shortLabel: "Đăng nhập", icon: LogIn },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <div className="flex min-h-screen">
          {/* Sidebar — desktop only */}
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

        {/* Bottom nav — mobile only */}
        <nav className="fixed bottom-0 inset-x-0 z-50 flex md:hidden border-t border-[var(--color-border)] bg-[var(--color-surface)]">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                <Icon size={20} />
                <span className="text-[10px] leading-none">{item.shortLabel}</span>
              </Link>
            );
          })}
        </nav>
      </body>
    </html>
  );
}
