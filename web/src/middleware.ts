import { NextResponse, type NextRequest } from "next/server";

function normalizeHost(raw: string | null): string {
  return (raw ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function publicLeaderboardHost(): string {
  return normalizeHost(process.env.PUBLIC_LEADERBOARD_HOST ?? null);
}

function isAllowedPublicPath(pathname: string): boolean {
  return (
    pathname === "/leaderboard" ||
    pathname === "/leaderboard/" ||
    pathname === "/robots.txt" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/_next/")
  );
}

/**
 * Lớp chặn dự phòng bên trong app cho subdomain public.
 *
 * Nginx vẫn là lớp bảo vệ chính, nhưng nếu cấu hình proxy bị mở nhầm thì host
 * leaderboard cũng không thể truy cập API, QR hoặc các trang quản trị.
 */
export function middleware(request: NextRequest) {
  const publicHost = publicLeaderboardHost();
  if (!publicHost) return NextResponse.next();

  const requestHost = normalizeHost(request.headers.get("host"));
  if (requestHost !== publicHost) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === "/") {
    const destination = new URL(`https://${publicHost}/leaderboard`);
    destination.search = request.nextUrl.search;
    return NextResponse.redirect(destination, 307);
  }

  if (isAllowedPublicPath(pathname)) {
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    return response;
  }

  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    },
  });
}

export const config = {
  matcher: "/:path*",
};
