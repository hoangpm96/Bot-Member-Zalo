import { checkBotPermissions } from "../permissions.js";
import { setBotState } from "../db/index.js";
import { login } from "../zalo/client.js";

export async function runCheckPermissions(): Promise<void> {
  const api = await login();
  const result = await checkBotPermissions(api, Date.now());
  setBotState("permission_check", JSON.stringify(result), result.checkedAt);
  console.log(
    `[check-permissions] role=${result.role}, read=${result.canReadMembers}, ` +
      `kick=${result.likelyCanKick}, delete=${result.likelyCanDeleteMessages}, block=${result.likelyCanBlockMembers}`,
  );
  if (result.issues.length) {
    for (const issue of result.issues) console.warn(`[check-permissions] ${issue}`);
  }
}
