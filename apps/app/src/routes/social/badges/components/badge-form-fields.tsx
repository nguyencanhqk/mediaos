/**
 * S16-SOCIAL-FE-3B (L4) — các Ô của form huy hiệu (`BadgeFormDialog`). Chỉ TRÌNH BÀY: không state, không lời
 * gọi. Nháp, tập ô sai và lỗi của server do hộp thoại giữ và truyền xuống.
 *
 * ┌─ LỖI GẮN VỚI Ô ─────────────────────────────────────────────────────────────────────────────────────┐
 * │ Ô sai mang `aria-invalid="true"` và `aria-describedby` trỏ câu lỗi TRƯỚC rồi mới tới gợi ý — trình    │
 * │ đọc màn hình đọc «vì sao sai» trước «nhập thế nào». Câu lỗi nằm trong một khối có id cố định           │
 * │ (`<id ô>-error`), dù đó là câu kiểm tra tại chỗ hay dải lỗi của server (`codeNotice`).                 │
 * │ Id của ô suy từ `badgeInputId` — hộp thoại dùng CÙNG hàm đó để đưa focus về ô sai đầu tiên.            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Input, Select } from "@mediaos/ui";
import {
  KUDOS_BADGE_DESCRIPTION_MAX,
  KUDOS_BADGE_ICON_MAX,
  KUDOS_BADGE_NAME_MAX,
  KUDOS_BADGE_POSITION_MAX,
} from "@mediaos/contracts";
import { KUDOS_BADGE_ICON_NAMES, KudosBadgeIcon } from "../../kudos/components/KudosBadgeIcon";
import { draftIcon, type BadgeDraft, type BadgeField } from "../lib/badge-form";

/** Id của Ô NHẬN FOCUS cho một trường. `icon` = cặp ô chọn + ô emoji; lỗi (quá dài) chỉ sinh ở ô emoji. */
export function badgeInputId(formId: string, field: BadgeField): string {
  return `${formId}-${field === "icon" ? "emoji" : field}`;
}

/** Trần của từng ô có trần — cũng là con số nội suy vào câu lỗi / gợi ý. Ô mã không có hằng (khuôn regex). */
const FIELD_MAX: Readonly<Record<Exclude<BadgeField, "code">, number>> = {
  name: KUDOS_BADGE_NAME_MAX,
  description: KUDOS_BADGE_DESCRIPTION_MAX,
  icon: KUDOS_BADGE_ICON_MAX,
  position: KUDOS_BADGE_POSITION_MAX,
};

interface FieldAria {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  /** Có ⇒ ô bị đánh dấu sai và khối này là mô tả trợ năng ĐẦU TIÊN của ô. */
  error?: React.ReactNode;
  children: (aria: FieldAria) => React.ReactNode;
}

/** Nhãn + ô + khối lỗi + gợi ý. Ô do nơi dùng vẽ (Input / textarea / Select) và nhận bộ thuộc tính `aria`. */
function Field({ id, label, hint, error, children }: FieldProps): React.ReactElement {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const hasError = error !== undefined && error !== null && error !== false;
  const describedBy = [hasError ? errorId : null, hint === undefined ? null : hintId]
    .filter((part): part is string => part !== null)
    .join(" ");
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium text-foreground">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": hasError ? true : undefined,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
      })}
      {hasError && <div id={errorId}>{error}</div>}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

const TEXTAREA_CLASS =
  "w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive";

export interface BadgeFormFieldsProps {
  /** Tiền tố id (từ `useId`) — duy nhất trong trang. */
  formId: string;
  /** Chế độ sửa: mã BẤT BIẾN ⇒ ô mã `readOnly` (vẫn đọc / sao chép được, không gửi đi). */
  isCodeLocked: boolean;
  draft: BadgeDraft;
  /** Các ô vừa trượt kiểm tra tại chỗ. */
  invalid: readonly BadgeField[];
  /** Dải lỗi của SERVER thuộc về ô mã (409 mã đã dùng). Thắng câu kiểm tra tại chỗ của ô đó. */
  codeNotice?: React.ReactNode;
  onChange: (key: keyof BadgeDraft, value: string) => void;
}

export function BadgeFormFields({
  formId,
  isCodeLocked,
  draft,
  invalid,
  codeNotice,
  onChange,
}: BadgeFormFieldsProps): React.ReactElement {
  const { t } = useTranslation("social");

  /** Câu kiểm tra tại chỗ của một ô, hoặc `undefined` khi ô đó không sai. */
  const invalidText = (field: BadgeField): React.ReactNode =>
    invalid.includes(field) ? (
      <p className="text-xs text-destructive" data-testid={`badge-field-error-${field}`}>
        {t(`admin.badges.form.invalid.${field}`, field === "code" ? {} : { max: FIELD_MAX[field] })}
      </p>
    ) : undefined;
  const text =
    (key: keyof BadgeDraft) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>): void =>
      onChange(key, event.target.value);

  return (
    <>
      <Field
        id={badgeInputId(formId, "code")}
        label={t("admin.badges.form.code.label")}
        hint={t(`admin.badges.form.code.${isCodeLocked ? "lockedHint" : "hint"}`)}
        error={codeNotice ?? invalidText("code")}
      >
        {(aria) => (
          <Input
            {...aria}
            value={draft.code}
            onChange={text("code")}
            readOnly={isCodeLocked}
            aria-required="true"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </Field>

      <Field
        id={badgeInputId(formId, "name")}
        label={t("admin.badges.form.name.label")}
        hint={t("admin.badges.form.name.hint", { max: FIELD_MAX.name })}
        error={invalidText("name")}
      >
        {(aria) => (
          <Input
            {...aria}
            value={draft.name}
            onChange={text("name")}
            aria-required="true"
            autoComplete="off"
          />
        )}
      </Field>

      <Field
        id={badgeInputId(formId, "description")}
        label={t("admin.badges.form.description.label")}
        hint={t("admin.badges.form.description.hint", { max: FIELD_MAX.description })}
        error={invalidText("description")}
      >
        {(aria) => (
          <textarea
            {...aria}
            value={draft.description}
            onChange={text("description")}
            rows={2}
            className={TEXTAREA_CLASS}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${formId}-icon-name`} label={t("admin.badges.form.icon.label")}>
          {(aria) => (
            <Select {...aria} value={draft.iconName} onChange={text("iconName")}>
              <option value="">{t("admin.badges.form.icon.none")}</option>
              {KUDOS_BADGE_ICON_NAMES.map((name) => (
                <option key={name} value={name}>
                  {t(`admin.badges.icon.${name}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id={badgeInputId(formId, "icon")}
          label={t("admin.badges.form.emoji.label")}
          hint={t("admin.badges.form.emoji.hint")}
          error={invalidText("icon")}
        >
          {(aria) => (
            <Input {...aria} value={draft.emoji} onChange={text("emoji")} autoComplete="off" />
          )}
        </Field>
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {t("admin.badges.form.preview")}
        <KudosBadgeIcon icon={draftIcon(draft)} className="text-foreground" />
      </p>

      <Field
        id={badgeInputId(formId, "position")}
        label={t("admin.badges.form.position.label")}
        hint={t("admin.badges.form.position.hint", { max: FIELD_MAX.position })}
        error={invalidText("position")}
      >
        {(aria) => (
          <Input
            {...aria}
            value={draft.position}
            onChange={text("position")}
            inputMode="numeric"
            aria-required="true"
            autoComplete="off"
            className="sm:max-w-40"
          />
        )}
      </Field>
    </>
  );
}
