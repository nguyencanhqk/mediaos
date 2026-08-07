import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { ApiError, apiFetch } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";

const ssoLinkSchema = z.object({ url: z.string().url() });

/**
 * /social — trang trung chuyển SSO sang ứng dụng Đăng bài (fbpost).
 *
 * Đường THƯỜNG không đi qua đây: ô "Đăng bài" gọi `openSocial()` và nhảy thẳng. Trang này là ĐƯỜNG
 * LỖI — nơi người dùng rơi xuống khi cầu SSO trục trặc, để họ đọc được lý do và bấm thử lại thay vì
 * nhìn một màn trắng.
 *
 * Phân biệt 3 lỗi vì mỗi lỗi cần một hành động khác nhau: 503 = gọi người quản trị cấu hình máy chủ;
 * 403 = công ty chưa được bật; còn lại = thử lại.
 */
export function SocialRedirectPage() {
  const [error, setError] = useState<string | null>(null);

  const go = useCallback(() => {
    setError(null);
    apiFetch("/integrations/social/sso-link", ssoLinkSchema)
      .then(({ url }) => {
        window.location.assign(url);
      })
      .catch((err: unknown) => {
        // Đọc `status` của ApiError, KHÔNG dò chuỗi trong `message`.
        // Bản đầu dùng `err.message.includes("503")` và đã hỏng thật ngày 06/08/2026: máy chủ trả
        // ĐÚNG 503 (thiếu SOCIAL_* trong .env) nhưng thông điệp của ApiError không chứa chuỗi "503",
        // nên người dùng nhận câu chung chung "Vui lòng thử lại" — vô nghĩa, vì thử lại bao nhiêu
        // lần cũng vậy. Chẩn đoán sai ở đây khiến người ta đi mò nhầm chỗ.
        const status = err instanceof ApiError ? err.status : 0;
        const message =
          status === 503
            ? "Cầu SSO sang ứng dụng Đăng bài chưa được cấu hình trên máy chủ. Báo quản trị hệ thống — thử lại sẽ không hết."
            : status === 403
              ? "Công ty của bạn chưa được bật ứng dụng Đăng bài."
              : status === 401
                ? "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại."
                : "Không lấy được liên kết mở ứng dụng Đăng bài. Vui lòng thử lại.";
        setError(message);
      });
  }, []);

  useEffect(() => {
    go();
  }, [go]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      {error ? (
        <>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={go}>Thử lại</Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Đang chuyển sang ứng dụng Đăng bài…</p>
      )}
    </div>
  );
}
