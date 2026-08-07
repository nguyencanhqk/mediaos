import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guard, ok } from "@/lib/api";
import { exchangeCodeForUserToken } from "@/lib/fb/auth";
import { connectAccount, resolveLoginApp } from "@/lib/fb/connect";
import { DESKTOP_REDIRECT_URI, extractAuthorizationCode } from "@/lib/fb/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Duong lui khi app khong nhan dia chi tra ve localhost.
 *
 * Nguoi dung dang nhap qua dia chi danh cho ung dung desktop, roi copy URL
 * tra ve dan vao day. Van khong phai tu tick quyen hay copy token dai.
 */

const schema = z.object({
  /** URL day du tren thanh dia chi sau khi bam Dong y, hoac chuoi code tran. */
  redirectedUrl: z.string().trim().min(6, "Chưa dán đường dẫn trả về"),
  name: z.string().trim().max(120, "Tên quá dài").optional(),
});

export async function POST(request: NextRequest) {
  return guard(async () => {
    const body: unknown = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const app = resolveLoginApp();
    if (!app) {
      return fail("Chưa lưu App ID và App Secret. Điền hai ô đó rồi bấm Lưu trước.");
    }

    let code: string | null;
    try {
      code = extractAuthorizationCode(parsed.data.redirectedUrl);
    } catch (error) {
      // Chuoi dan vao co san tham so error cua Facebook.
      return fail(
        `Facebook từ chối yêu cầu đăng nhập: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!code) {
      return fail(
        'Không tìm thấy mã trong đường dẫn vừa dán. Copy nguyên URL trên thanh địa chỉ sau khi bấm Đồng ý — chuỗi đó phải chứa "code=".',
      );
    }

    const userToken = await exchangeCodeForUserToken(
      app.appId,
      app.appSecret,
      DESKTOP_REDIRECT_URI,
      code,
    );

    const result = await connectAccount({
      appId: app.appId,
      appSecret: app.appSecret,
      userToken,
      name: parsed.data.name,
    });

    return ok(result, result.isNew ? 201 : 200);
  });
}
