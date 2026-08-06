import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { connectAccount } from "@/lib/fb/connect";
import { listAccounts, toPublicAccount } from "@/lib/repo/account-repo";
import { listPages, toPublic } from "@/lib/repo/page-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tai khoan Facebook da ket noi.
 *
 * POST o day la cach ket noi thu cong: dan token lay tu Graph API Explorer.
 * Cach nhanh hon la nut "Đăng nhập bằng Facebook" (/api/auth/facebook/start),
 * ca hai deu ket thuc o `connectAccount`.
 */

const connectSchema = z.object({
  appId: z.string().trim().min(1, "Thiếu App ID"),
  appSecret: z.string().trim().min(1, "Thiếu App Secret"),
  shortLivedToken: z.string().trim().min(20, "Token không hợp lệ"),
  /** Ten tu dat de de phan biet. Bo trong thi lay ten tren Facebook. */
  name: z.string().trim().max(120, "Tên quá dài").optional(),
});

export async function GET() {
  return guard(async () => ok(listAccounts().map(toPublicAccount)));
}

export async function POST(request: NextRequest) {
  return guard(async () => {
    const body: unknown = await request.json();
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const result = await connectAccount({
      appId: parsed.data.appId,
      appSecret: parsed.data.appSecret,
      userToken: parsed.data.shortLivedToken,
      name: parsed.data.name,
    });

    return ok({ ...result, pages: listPages().map(toPublic) }, result.isNew ? 201 : 200);
  });
}
