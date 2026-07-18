/**
 * EmployeeAddToDeptDialog — thêm 1 nhân viên CÓ SẴN vào một phòng ban (S5-HR-ORGCHART-FE-3).
 *
 * Dùng cho trường hợp nhân viên CHƯA thuộc phòng nào (hoặc đang ở phòng khác) → gán vào phòng này.
 * PATCH /hr/employees/:id { orgUnitId = dept.id } — gate update:employee ở SERVER. Ứng viên = mọi nhân
 * viên KHÔNG ở sẵn trong phòng này (gồm cả người chưa phân phòng).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, hrApi } from "@mediaos/web-core";
import { Button, Dialog, Select } from "@mediaos/ui";
import type { UnitMember } from "./members-by-unit";

interface EmployeeAddToDeptDialogProps {
  open: boolean;
  onClose: () => void;
  dept: { id: string; name: string };
  /** Toàn bộ nhân viên (page truyền); dialog tự lọc ra người chưa ở phòng này. */
  employees: UnitMember[];
  onSaved: () => void;
}

export function EmployeeAddToDeptDialog({
  open,
  onClose,
  dept,
  employees,
  onSaved,
}: EmployeeAddToDeptDialogProps) {
  const { t } = useTranslation("hr");
  const [employeeId, setEmployeeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ứng viên = người KHÔNG ở sẵn trong phòng này (gồm người chưa phân phòng = orgUnitName null).
  const candidates = employees.filter((e) => e.orgUnitName !== dept.name);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) {
      setError(t("orgChart.dialogs.pickEmployee"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await hrApi.updateEmployee(employeeId, { orgUnitId: dept.id });
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
      title={t("orgChart.actions.addToDept")}
      description={t("orgChart.dialogs.addToDeptDesc", { dept: dept.name })}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={submitting}>
            {t("orgChart.dialogs.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="add-to-dept-submit"
          >
            {submitting ? t("orgChart.dialogs.saving") : t("orgChart.dialogs.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="add-employee-select" className="text-sm font-medium">
            {t("orgChart.dialogs.employeeLabel")}
          </label>
          <Select
            id="add-employee-select"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">{t("orgChart.dialogs.pickPlaceholder")}</option>
            {candidates.map((c) => (
              <option key={c.employeeId} value={c.employeeId}>
                {(c.displayName ?? t("orgChart.unnamedMember")) +
                  " — " +
                  (c.orgUnitName ?? t("orgChart.dialogs.unassignedTag"))}
              </option>
            ))}
          </Select>
          {candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("orgChart.dialogs.noCandidates")}</p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </Dialog>
  );
}
