/**
 * S16-SOCIAL-FE-2B — chọn chế độ nhóm (Công khai / Riêng tư) + câu giải thích hệ quả. Dùng chung cho
 * hộp tạo nhóm và tab Cài đặt để hai nơi mô tả CÙNG một luật.
 */
import { useTranslation } from "react-i18next";
import { GROUP_VISIBILITY_LABEL_KEY, type GroupVisibilityValue } from "../lib/group-labels";

interface GroupVisibilityFieldProps {
  value: GroupVisibilityValue;
  onChange: (v: GroupVisibilityValue) => void;
  /** `name` của nhóm radio — phải duy nhất trên trang. */
  name: string;
  disabled?: boolean;
}

const OPTIONS: readonly GroupVisibilityValue[] = ["public", "private"];

export function GroupVisibilityField({
  value,
  onChange,
  name,
  disabled,
}: GroupVisibilityFieldProps): React.ReactElement {
  const { t } = useTranslation("social");
  return (
    <fieldset className="flex flex-col gap-2 text-sm" disabled={disabled}>
      <legend className="mb-1 font-medium text-foreground">{t("groups.create.visibility")}</legend>
      {OPTIONS.map((v) => (
        <label key={v} className="flex items-start gap-2">
          <input
            type="radio"
            name={name}
            value={v}
            data-testid={`${name}-${v}`}
            checked={value === v}
            onChange={() => onChange(v)}
            className="mt-1"
          />
          <span>
            <span className="block text-foreground">{t(GROUP_VISIBILITY_LABEL_KEY[v])}</span>
            <span className="block text-xs text-muted-foreground">
              {v === "public"
                ? t("groups.create.visibilityPublicHint")
                : t("groups.create.visibilityPrivateHint")}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
