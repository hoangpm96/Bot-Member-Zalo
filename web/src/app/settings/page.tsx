import { PageHeader, EmptyState } from "@/components/ui";
import { dbExists, listActiveMemberOptions } from "@/lib/db";
import { readConfig } from "@/lib/config";
import { readVip } from "@/lib/vip";
import { ConfigForm } from "./config-form";
import { VipForm } from "./vip-form";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  if (!dbExists()) {
    return (
      <div>
        <PageHeader title="Cấu hình" />
        <EmptyState>Chưa có dữ liệu bot. Chạy bot trước rồi quay lại.</EmptyState>
      </div>
    );
  }

  const config = readConfig();
  const vip = readVip();
  const members = listActiveMemberOptions();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Cấu hình" desc="Chỉnh tham số dọn dẹp và danh sách VIP. Bot đọc lại ở kỳ kế tiếp." />
      <ConfigForm initial={config} />
      <VipForm initial={vip} members={members} />
    </div>
  );
}
