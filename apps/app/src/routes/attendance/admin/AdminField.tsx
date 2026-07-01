/**
 * AdminField — wrapper label + error dùng chung cho các form CRUD admin ATT (S3-FE-ATT-5).
 * Giữ style nhất quán với LeaveRequestForm (house pattern) — KHÔNG tự chế primitive mới.
 */
import type { ReactNode } from "react";

export function AdminField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Map ApiError status → thông điệp người-đọc (dùng key form.errors.* của namespace attendance). */
export function adminMapApiError(err: unknown, t: (k: string) => string): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403) return t("form.errors.forbidden");
  if (status === 409) return t("form.errors.conflict");
  if (status === 422 || status === 400) return t("form.errors.validation");
  if (typeof status === "number" && status >= 500) return t("form.errors.server");
  return t("form.errors.generic");
}
