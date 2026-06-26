/**
 * Thành phần UI dùng chung cho 2 trang viewer nhật ký bảo mật (S2-AUTH-BE-5):
 *   - FilterShell      : khung lưới các ô lọc + nút Lọc / Xóa lọc.
 *   - LabeledField     : nhãn + control.
 *   - DateField        : input type=date.
 *   - TextField        : input text (vd user_id, event_type).
 *   - AuthLogPagination: footer phân trang server-side (prev/next + số trang).
 *
 * Tái dùng primitives @mediaos/ui (Input/Select/Button) — DRY, không tự vẽ control.
 */
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { Button, Input } from "@mediaos/ui";

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------
export function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function DateField({ label, value, onChange }: DateFieldProps) {
  return (
    <LabeledField label={label}>
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </LabeledField>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

export function TextField({ label, value, placeholder, onChange }: TextFieldProps) {
  return (
    <LabeledField label={label}>
      <Input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </LabeledField>
  );
}

// ---------------------------------------------------------------------------
// Filter shell — grid of fields + apply/reset buttons
// ---------------------------------------------------------------------------
interface FilterShellProps {
  children: ReactNode;
  onApply: () => void;
  onReset: () => void;
}

export function FilterShell({ children, onApply, onReset }: FilterShellProps) {
  const { t } = useTranslation("system");
  return (
    <form
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" size="sm">
          <Filter className="mr-2 h-4 w-4" />
          {t("authLogFilters.apply")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          <X className="mr-2 h-4 w-4" />
          {t("authLogFilters.reset")}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Server-side pagination footer
// ---------------------------------------------------------------------------
interface AuthLogPaginationProps {
  page: number;
  /** Số dòng của trang hiện tại (suy ra hasNext: === pageSize ⇒ còn trang sau). */
  currentCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/**
 * Phân trang offset prev/next (server-side). Total tổng KHÔNG khả dụng ở client
 * (apiFetch/unwrapEnvelope chỉ trả `data`), nên dùng heuristic: trang đầy (count === pageSize)
 * ⇒ còn trang sau. page > 1 ⇒ có trang trước. UX rõ ràng, không phụ thuộc total.
 */
export function AuthLogPagination({
  page,
  currentCount,
  pageSize,
  onPageChange,
}: AuthLogPaginationProps) {
  const { t } = useTranslation("common");
  const { t: ts } = useTranslation("system");
  const hasPrev = page > 1;
  const hasNext = currentCount === pageSize;

  // Trang 1 mà chưa đầy → không cần phân trang.
  if (!hasPrev && !hasNext) return null;

  return (
    <div className="flex items-center justify-end gap-3">
      <span className="text-xs text-muted-foreground">{ts("authLogFilters.page", { page })}</span>
      <div className="flex items-center gap-1">
        <PageButton
          label={t("pagination.prev")}
          disabled={!hasPrev}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </PageButton>
        <PageButton
          label={t("pagination.next")}
          disabled={!hasNext}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
