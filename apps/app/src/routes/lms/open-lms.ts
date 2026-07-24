import { z } from "zod";
import { apiFetch } from "@mediaos/web-core";

const ssoLinkSchema = z.object({ url: z.string().url() });

/**
 * openLms — mở hệ Đào tạo (LMS) "vào thẳng", KHÔNG qua trang trung chuyển `/lms`.
 *
 * Trước đây mọi nút/tile "Đào tạo" điều hướng tới route `/lms` (LmsRedirectPage) — trang này mount,
 * hiện màn "Đang chuyển…", rồi mới fetch token SSO + chuyển trang. Owner muốn bỏ màn trung gian đó.
 *
 * Ở đây lấy token SSO NGAY trong lúc bấm rồi `assign` thẳng sang LMS. Token SSO vẫn BẮT BUỘC (thiếu nó
 * thì vào LMS chưa có phiên → SSO-only đá về /login) — ta chỉ bỏ *trang* trung gian, không bỏ *cầu* SSO.
 *
 * Lỗi (mạng / 503 cầu SSO chưa cấu hình / thiếu quyền) → gọi `onFallback` để rơi về route `/lms`
 * (LmsRedirectPage vẫn giữ, tự thử lại + hiện thông báo lỗi). Nhờ vậy đường lỗi không mất UX cũ.
 */
export async function openLms(onFallback: () => void): Promise<void> {
  try {
    const { url } = await apiFetch("/integrations/lms/sso-link", ssoLinkSchema);
    window.location.assign(url);
  } catch {
    onFallback();
  }
}
