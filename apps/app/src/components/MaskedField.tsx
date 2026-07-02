/**
 * MaskedField — hiển thị field cấu hình do SERVER mask (FRONTEND-13 §6.3, BẤT BIẾN #3).
 *
 * Masking là việc của SERVER: khi `masked === true`, server đã thay value bằng placeholder ('***') và
 * KHÔNG BAO GIỜ trả secret thật xuống client. Component này CHỈ render những gì đã nhận — KHÔNG có nút
 * "reveal" gọi lại API lấy raw (đó là client-side unmasking, cấm). secret_ref cũng không tồn tại trong
 * DTO (safeSettingViewSchema drop tận gốc).
 *
 * - masked=true  → hiển thị placeholder cố định + icon khoá (không render raw kể cả khi value có mặt).
 * - masked=false → render value công khai bình thường.
 */
import { Lock } from "lucide-react";

/** Placeholder cố định — KHÔNG suy ra độ dài secret từ value (tránh rò thông tin). */
const MASK_PLACEHOLDER = "••••••••";

export interface MaskedFieldProps {
  /** Nhãn field. */
  label: string;
  /** Giá trị đã nhận từ server (chỉ dùng khi masked=false). */
  value: string;
  /** true → server đã mask (giá trị nhạy cảm) → render placeholder, KHÔNG lộ raw. */
  masked: boolean;
  /** Ghi chú a11y/UX cho field đã mask. */
  maskedHint?: string;
  id?: string;
}

export function MaskedField({ label, value, masked, maskedHint, id }: MaskedFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {label}
        {masked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
      </label>
      {masked ? (
        <div
          id={id}
          data-testid="masked-value"
          className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm text-muted-foreground"
        >
          <span aria-label={maskedHint ?? label}>{MASK_PLACEHOLDER}</span>
        </div>
      ) : (
        <div
          id={id}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          {value || "—"}
        </div>
      )}
      {masked && maskedHint && <p className="text-xs text-muted-foreground">{maskedHint}</p>}
    </div>
  );
}
