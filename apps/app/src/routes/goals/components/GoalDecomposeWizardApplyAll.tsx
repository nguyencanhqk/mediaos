import { useTranslation } from "react-i18next";
import { Input, Select } from "@mediaos/ui";
import type { BulkValues } from "./goal-decompose-rows";

/**
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-07) — hàng «Áp cho tất cả» trên bảng xem trước của wizard phân rã:
 * đổi người/hạn ở đây ⇒ mọi dòng CHƯA sửa tay ô đó nhận giá trị mới (logic ở `applyBulk`).
 *
 * Ô người chỉ có khi `showAssignee` (mục tiêu cấp nhân viên ⇒ không gán người) VÀ người dùng đọc được
 * danh sách nhân viên (`read:employee`) — thiếu quyền thì fail-soft: không có ô, vẫn tạo được việc
 * chưa giao.
 */
export function GoalDecomposeWizardApplyAll({
  bulk,
  showAssignee,
  employees,
  onChange,
}: {
  bulk: BulkValues;
  showAssignee: boolean;
  employees: ReadonlyArray<{ id: string; fullName: string | null }>;
  onChange: (patch: Partial<BulkValues>) => void;
}) {
  const { t } = useTranslation("goals");
  return (
    <div
      data-testid="goal-decompose-apply-all"
      className="space-y-2 rounded-md border border-dashed border-border bg-muted/40 p-2"
    >
      <p className="text-xs font-medium text-muted-foreground">{t("decompose.applyAll.label")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {showAssignee && (
          <Select
            aria-label={t("decompose.applyAll.assignee")}
            value={bulk.assigneeEmployeeId}
            onChange={(e) => onChange({ assigneeEmployeeId: e.target.value })}
          >
            <option value="">{t("decompose.fields.assigneePlaceholder")}</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </Select>
        )}
        <Input
          type="date"
          aria-label={t("decompose.applyAll.dueAt")}
          value={bulk.dueAt}
          onChange={(e) => onChange({ dueAt: e.target.value })}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("decompose.applyAll.hint")}</p>
    </div>
  );
}
