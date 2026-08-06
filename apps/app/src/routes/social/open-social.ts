import { z } from "zod";
import { apiFetch } from "@mediaos/web-core";

const ssoLinkSchema = z.object({ url: z.string().url() });

/**
 * openSocial — mở ứng dụng Đăng bài (fbpost) "vào thẳng", KHÔNG qua trang trung chuyển.
 *
 * Sao khuôn `openLms`: lấy token SSO NGAY trong lúc bấm rồi `assign` sang fbpost. Token SSO là BẮT
 * BUỘC — fbpost không có màn đăng nhập riêng, thiếu token thì middleware bên đó đá về /login.
 *
 * Lỗi (mạng · 503 cầu SSO chưa cấu hình · 403 công ty chưa được bật · thiếu quyền) → gọi
 * `onFallback` để rơi về route `/social`, nơi hiện thông báo lỗi đọc được thay vì im lặng.
 */
export async function openSocial(onFallback: () => void): Promise<void> {
  try {
    const { url } = await apiFetch("/integrations/social/sso-link", ssoLinkSchema);
    window.location.assign(url);
  } catch {
    onFallback();
  }
}
