/**
 * S20-GOAL-QUICKSTART-1 (US-GOAL-NV-01) — «Đơn vị đo» chọn MỘT chạm.
 *
 * Ba kiểu đo (percent · number · boolean) hiện sẵn thành nhóm nút radio gốc của trình duyệt thay cho
 * dropdown: đổi kiểu đo = 1 thao tác (dropdown tính 2 — mở + chọn — theo luật đếm của story). Radio gốc
 * giữ hành vi bàn phím chuẩn (Tab vào nhóm, mũi tên đổi lựa chọn) và nối thẳng `register` của
 * react-hook-form; `fieldset` + `legend` đặt tên cho nhóm.
 */
import { useTranslation } from "react-i18next";
import type { UseFormRegisterReturn } from "react-hook-form";
import { cn } from "@mediaos/ui";
import { GOAL_MEASURE_TYPE_OPTIONS } from "../constants";

type GoalMeasureType = (typeof GOAL_MEASURE_TYPE_OPTIONS)[number];

export function GoalMeasureTypeChoice({
  registration,
  value,
  disabled,
}: {
  /** `register("measureType")` của form. */
  registration: UseFormRegisterReturn;
  /** Giá trị đang chọn (`watch("measureType")`) — để tô nút đang bật. */
  value: GoalMeasureType;
  disabled?: boolean;
}) {
  const { t } = useTranslation("goals");
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium text-foreground">
        {t("form.fields.measureType")}
      </legend>
      <div className="flex flex-wrap gap-1 rounded-md border border-input p-1">
        {GOAL_MEASURE_TYPE_OPTIONS.map((m) => (
          <label
            key={m}
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded px-3 py-1.5 text-sm transition-colors",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
              value === m
                ? "bg-brand-muted font-medium text-brand"
                : "text-foreground hover:bg-accent",
            )}
          >
            <input type="radio" value={m} className="sr-only" {...registration} />
            {t(`measureType.${m}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
