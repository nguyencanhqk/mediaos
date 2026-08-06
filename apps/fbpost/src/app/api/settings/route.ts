import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { resolveLoginApp } from "@/lib/fb/connect";
import { countAccounts } from "@/lib/repo/account-repo";
import { countPages } from "@/lib/repo/page-repo";
import { getSettings, maskSecret, saveSettings } from "@/lib/repo/settings-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cau hinh chung cua phan mem.
 *
 * Tai khoan Facebook nam o /api/accounts, danh sach Page nam o /api/pages -
 * o day chi con nhung thu dung chung cho moi tai khoan.
 */

const patchSchema = z.object({
  appId: z.string().trim().max(64, "App ID quá dài").optional(),
  appSecret: z.string().trim().max(128, "App Secret quá dài").optional(),
  loginConfigId: z.string().trim().max(64, "Config ID quá dài").optional(),
  graphVersion: z
    .string()
    .trim()
    .regex(/^v\d+\.\d+$/, "Phiên bản Graph API phải có dạng v26.0")
    .optional(),
});

function publicView() {
  const settings = getSettings();
  const loginApp = resolveLoginApp();
  return {
    appId: settings.appId,
    appSecretMasked: maskSecret(settings.appSecret),
    hasAppSecret: Boolean(settings.appSecret),
    loginConfigId: settings.loginConfigId,
    graphVersion: settings.graphVersion,
    accountCount: countAccounts(),
    pageCount: countPages(),
    /** Da du thong tin de bam nut dang nhap hay chua. */
    loginReady: loginApp !== null,
    /** App dang duoc dung cho nut dang nhap - co the muon tu tai khoan da co. */
    loginAppId: loginApp?.appId ?? "",
    loginAppInheritedFrom: loginApp?.inherited ? loginApp.inheritedFrom : "",
  };
}

export async function GET() {
  return guard(async () => ok(publicView()));
}

export async function PATCH(request: NextRequest) {
  return guard(async () => {
    const body: unknown = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues.map((i) => i.message).join("; "));
    }

    saveSettings(parsed.data);
    return ok(publicView());
  });
}
