import { NextResponse } from "next/server";
import { buildOverTargetCandidatePlan, dbExists, getLatestCleanupDraftComparison, saveCleanupDraftPlan } from "@/lib/db";
import { readConfig } from "@/lib/config";
import { CONFIG_DEFAULTS } from "@/lib/config-meta";
import { readVip } from "@/lib/vip";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!dbExists()) return NextResponse.json({ error: "Bot chưa tạo DB." }, { status: 503 });
  return NextResponse.json({ latest: getLatestCleanupDraftComparison() });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
    }
  }

  if (!dbExists()) return NextResponse.json({ error: "Bot chưa tạo DB." }, { status: 503 });
  const cfg = readConfig();
  const target = cfg.targetMemberCount ?? CONFIG_DEFAULTS.targetMemberCount;
  const maxKicks = cfg.maxKicksPerRun ?? CONFIG_DEFAULTS.maxKicksPerRun;
  const vipIds = readVip().map((entry) => entry.id);
  const plan = buildOverTargetCandidatePlan({ target, maxKicks, vipIds });
  const id = saveCleanupDraftPlan(plan, "Lưu từ dashboard /candidates.");
  return NextResponse.json({ ok: true, id, latest: getLatestCleanupDraftComparison() });
}
