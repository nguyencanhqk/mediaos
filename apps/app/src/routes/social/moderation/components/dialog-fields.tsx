/**
 * S16-SOCIAL-FE-3 — các mảnh FORM dùng chung của hai hộp thoại của cụm Kiểm duyệt: kết thúc báo cáo (029,
 * `ResolveReportDialog`) và soạn báo cáo (027, `ReportDialog`). Trước đây mỗi hộp thoại tự chép nhóm
 * radio, ô ghi chú, hai nút chân và kiểu lỗi «giữ hộp thoại» — hai bản lệch nhau là hai hộp thoại trông
 * và đọc (trình đọc màn hình) khác nhau cho cùng một việc.
 *
 * Chỉ TRÌNH BÀY: không state, không lời gọi, không quyền. Chữ do nơi dùng truyền vào (đã qua `t`).
 */
import * as React from "react";
import { Button } from "@mediaos/ui";
import { FEED_NOTE_MAX } from "@mediaos/contracts";
import type { AdminErrorReason } from "../../admin/lib/admin-errors";

/** Lỗi «giữ hộp thoại» đang hiển thị trong hộp thoại. `retryable` ⇒ vẽ «Thử lại». */
export interface KeptError {
  reason: AdminErrorReason;
  retryable: boolean;
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

interface ChoiceFieldsetProps<T extends string> {
  legend: string;
  /** `name` của nhóm radio — duy nhất trong trang (dựng từ `useId`). */
  name: string;
  options: readonly ChoiceOption<T>[];
  /** `null` = chưa chọn. */
  value: T | null;
  onChange: (value: T) => void;
  /** Phần đi kèm nằm TRONG nhóm (gợi ý, ô tick xác nhận). */
  children?: React.ReactNode;
}

/** Một nhóm radio có nhãn nhóm (`fieldset` + `legend`). */
export function ChoiceFieldset<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  children,
}: ChoiceFieldsetProps<T>): React.ReactElement {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
      {children}
    </fieldset>
  );
}

interface NoteFieldProps {
  /** Tiền tố id (từ `useId`) — ô, cảnh báo và gợi ý suy id từ đây. */
  id: string;
  label: string;
  hint: string;
  /** Có ⇒ vẽ TRƯỚC ô và là mô tả trợ năng ĐẦU TIÊN của ô (đọc trước khi người dùng gõ). */
  warning?: string;
  value: string;
  onChange: (value: string) => void;
}

/** Ô ghi chú tự do, trần `FEED_NOTE_MAX` (cùng trần với schema contracts của 027 / 029). */
export function NoteField({
  id,
  label,
  hint,
  warning,
  value,
  onChange,
}: NoteFieldProps): React.ReactElement {
  const noteId = `${id}-note`;
  const hintId = `${id}-note-hint`;
  const warningId = `${id}-warning`;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={noteId} className="font-medium text-foreground">
        {label}
      </label>
      {warning !== undefined && (
        <p
          id={warningId}
          role="note"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
        >
          {warning}
        </p>
      )}
      <textarea
        id={noteId}
        aria-describedby={warning === undefined ? hintId : `${warningId} ${hintId}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={FEED_NOTE_MAX}
        rows={3}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

interface DialogActionsProps {
  cancelLabel: string;
  submitLabel: string;
  /** Đang gửi ⇒ «Huỷ» khoá (không đóng được giữa chừng), nút gửi `aria-busy`. */
  isPending: boolean;
  canSubmit: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  /**
   * Có ⇒ nút gửi là nút SUBMIT của `<form id>` đó (chân hộp thoại nằm ngoài form nên gắn qua thuộc tính
   * `form`): Enter trong một ô của form là gửi, và mọi lối gửi đi qua `onSubmit` của FORM — nút không tự gọi
   * `onSubmit` nữa (một cú bấm không được thành hai lượt gửi).
   */
  submitFormId?: string;
}

/** Hai nút chân của hộp thoại ghi: «Huỷ» + nút gửi. */
export function DialogActions({
  cancelLabel,
  submitLabel,
  isPending,
  canSubmit,
  onCancel,
  onSubmit,
  submitFormId,
}: DialogActionsProps): React.ReactElement {
  const submitProps =
    submitFormId === undefined
      ? ({ type: "button", onClick: onSubmit } as const)
      : ({ type: "submit", form: submitFormId } as const);
  return (
    <>
      <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button {...submitProps} disabled={!canSubmit} aria-busy={isPending}>
        {submitLabel}
      </Button>
    </>
  );
}
