import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AppShell } from "./app-shell";

export const metadata: Metadata = {
  title: "Bot Member Zalo — Admin",
  description: "Bảng điều khiển bot dọn thành viên group Zalo",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

function normalizeHost(raw: string | null): string {
  return (raw ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const requestHost = normalizeHost(requestHeaders.get("host"));
  const publicHost = normalizeHost(process.env.PUBLIC_LEADERBOARD_HOST ?? null);
  const publicMode = publicHost !== "" && requestHost === publicHost;

  return (
    <html lang="vi">
      <body>
        <AppShell publicMode={publicMode}>{children}</AppShell>
      </body>
    </html>
  );
}
