import { qrImageExists, readLoginStatus } from "@/lib/login-status";
import { LoginPageClient, type QrStatus } from "./login-page-client";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const status = readLoginStatus();
  const initialStatus: QrStatus = {
    state: status.state,
    updatedAt: status.updatedAt,
    displayName: status.displayName,
    hasQr: qrImageExists(),
  };

  return <LoginPageClient initialStatus={initialStatus} />;
}
