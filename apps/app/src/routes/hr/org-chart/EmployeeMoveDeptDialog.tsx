/**
 * EmployeeMoveDeptDialog — chuyển 1 nhân viên sang PHÒNG BAN khác (S5-HR-ORGCHART-FE-2).
 * PATCH /hr/employees/:id { orgUnitId } — gate update:employee ở SERVER. Preselect phòng hiện tại (khớp
 * theo tên đơn vị), người dùng chọn phòng đích rồi lưu.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, hrApi } from "@mediaos/web-core";
import { Button, Dialog, Select } from "@mediaos/ui";
import type { UnitMember } from "./members-by-unit";
import { indentLabel, type DeptOption } from "./org-chart-lookups";

interface EmployeeMoveDeptDialogProps {
  open: boolean;
  onClose: () => void;
  target: UnitMember;
  departments: DeptOption[];
  onSaved: () => void;
}

export function EmployeeMoveDeptDialog({
  open,
  onClose,
  target,
  departments,
  onSaved,
}: EmployeeMoveDeptDialogProps) {
  const { t } = useTranslation("hr");
  // Preselect phòng hiện tại của nhân viên (khớp theo tên — node nhân sự chỉ mang orgUnitName).
  const currentId = departments.find((d) => d.name === target.orgUnitName)?.id ?? "";
  const [orgUnitId, setOrgUnitId] = useState(currentId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgUnitId) {
      setError(t("orgChart.dialogs.pickDept"));
      return;
    }
    if (orgUnitId === currentId) {
      setError(t("orgChart.dialogs.sameDept"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await hrApi.updateEmployee(target.employeeId, { orgUnitId });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("orgChart.dialogs.genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("orgChart.actions.moveDept")}
      description={t("orgChart.dialogs.moveDeptDesc", {
        name: target.displayName ?? t("orgChart.unnamedMember"),
      })}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={submitting}>
            {t("orgChart.dialogs.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="move-dept-submit"
          >
            {submitting ? t("orgChart.dialogs.saving") : t("orgChart.dialogs.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="dept-select" className="text-sm font-medium">
            {t("orgChart.dialogs.targetDept")}
          </label>
          <Select id="dept-select" value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
            <option value="">{t("orgChart.dialogs.pickPlaceholder")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {indentLabel(d.name, d.depth)}
              </option>
            ))}
          </Select>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </Dialog>
  );
}
