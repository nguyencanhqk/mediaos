import { useTranslation } from "react-i18next";
import type { PriorityDto } from "@mediaos/contracts";
import { Select } from "@mediaos/ui";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";

interface PrioritySelectProps {
  value: PriorityDto;
  onChange: (value: PriorityDto) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Bộ chọn mức ưu tiên (5 option, kèm icon ở nhãn hiển thị). Dùng native Select của @mediaos/ui
 * cho đồng bộ form house-style; option text mang nhãn vi (icon hiển thị riêng ở PriorityIcon nơi cần).
 */
export function PrioritySelect({
  value,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: PrioritySelectProps) {
  const { t } = useTranslation("projects");
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value as PriorityDto)}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
    >
      {PRIORITY_ORDER.map((p) => (
        <option key={p} value={p}>
          {t(PRIORITY_META[p].labelKey)}
        </option>
      ))}
    </Select>
  );
}
