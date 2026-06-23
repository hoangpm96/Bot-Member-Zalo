import type { Metadata } from "next";
import Link from "next/link";
import { LayoutDashboard, Users, History, Settings, LogIn, MessageSquare } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot Member Zalo — Admin",
  description: "Bảng điều khiển bot dọn thành viên group Zalo",
};

const NAV = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/members", label: "Thành viên", icon: Users },
  { href: "/messages", label: "Tin nhắn", icon: MessageSquare },
  { href: "/history", label: "Lịch sử dọn", icon: History },
  { href: "/settings", label: "Cấu hình", icon: Settings },
  { href: "/login", label: "Đăng nhập", icon: LogIn },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
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
          <main className="flex-1 overflow-auto p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
