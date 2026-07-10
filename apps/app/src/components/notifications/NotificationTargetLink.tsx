import { useNavigate } from "@tanstack/react-router";

/**
 * NotificationTargetLink — S4-FE-NOTI-1. Deep link AN TOÀN từ 1 thông báo tới nội dung liên quan
 * (`target_url` do server trả — HR/ATT/LEAVE/TASK route thật, ví dụ "/leave/me/requests/:id").
 *
 * AN TOÀN (KHÔNG bỏ route guard):
 *  - CHỈ điều hướng qua TanStack Router `navigate()` (client-side) — route đích VẪN chạy `beforeLoad`
 *    (authGuard) + `<ProtectedRoute meta>` như mọi route khác (module gốc TỰ kiểm quyền lại — WO acceptance
 *    bullet 3). KHÔNG dùng `window.location.href` (sẽ bay qua guard SPA, và có thể full-page-navigate ra
 *    ngoài app).
 *  - CHỈ chấp nhận `target_url` bắt đầu bằng "/" (đường dẫn NỘI BỘ, tương đối tới gốc app). URL tuyệt đối
 *    ("http://…", "//…" protocol-relative) hoặc rỗng/null ⇒ KHÔNG render link (tránh open-redirect nếu
 *    server/nguồn dữ liệu bị thao túng — defense-in-depth, dù server hiện tại luôn generate nội bộ).
 */
export function isSafeInternalTarget(url: string | null | undefined): url is string {
  if (!url) return false;
  // "/" hợp lệ; "//host/..." (protocol-relative) KHÔNG hợp lệ — bắt đầu bằng đúng 1 dấu "/".
  return url.startsWith("/") && !url.startsWith("//");
}

interface NotificationTargetLinkProps {
  targetUrl: string | null | undefined;
  /** Gọi TRƯỚC khi điều hướng (vd mark-read) — không chặn navigate nếu lỗi. */
  onBeforeNavigate?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function NotificationTargetLink({
  targetUrl,
  onBeforeNavigate,
  children,
  className,
}: NotificationTargetLinkProps) {
  const navigate = useNavigate();
  const safe = isSafeInternalTarget(targetUrl);

  if (!safe) {
    return <span className={className}>{children}</span>;
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onBeforeNavigate?.();
        // target_url là chuỗi động (server) — router yêu cầu literal route ở type-level; cast "as \"/\""
        // là pattern ĐÃ DÙNG khắp router.tsx cho mọi điều hướng path động (vd LEAVE_PATHS.DETAIL(id)).
        void navigate({ to: targetUrl as "/" });
      }}
    >
      {children}
    </button>
  );
}
