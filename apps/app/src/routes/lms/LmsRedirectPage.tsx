import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { apiFetch } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";

const ssoLinkSchema = z.object({ url: z.string().url() });

/**
 * /lms — trang trung chuyển SSO sang LMS (Giai đoạn A tích hợp).
 * Fetch /integrations/lms/sso-link (token HMAC 60s cho chính user) rồi chuyển trang.
 * Không render dữ liệu LMS — chỉ loading/error + thử lại.
 */
export function LmsRedirectPage() {
  const [error, setError] = useState<string | null>(null);

  const go = useCallback(() => {
    setError(null);
    apiFetch("/integrations/lms/sso-link", ssoLinkSchema)
      .then(({ url }) => {
        window.location.assign(url);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error && err.message.includes("503")
            ? "Cầu SSO sang LMS chưa được cấu hình trên máy chủ."
            : "Không lấy được liên kết đăng nhập LMS. Vui lòng thử lại.";
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
        <p className="text-sm text-muted-foreground">Đang chuyển sang hệ thống Đào tạo (LMS)…</p>
      )}
    </div>
  );
}
