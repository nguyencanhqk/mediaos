/**
 * EmployeeAssignManagerDialog — gắn/đổi QUẢN LÝ TRỰC TIẾP cho 1 nhân viên (S5-HR-ORGCHART-FE-2).
 *
 * PATCH /hr/employees/:id { directManagerId } — gate update:employee ở SERVER. LƯU Ý: directManagerId là
 * UUID USER (không phải employeeId) → picker gửi `candidate.userId`. BE chặn tự-quản-lý (manager = chính
 * mình) + yêu cầu user cùng tenant; ở đây cũng loại chính nhân viên khỏi danh sách để tránh gửi vô ích.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, hrApi } from "@mediaos/web-core";
import { Button, Dialog, Select } from "@mediaos/ui";
import type { UnitMember } from "./members-by-unit";

const NO_MANAGER = "__none__";

interface EmployeeAssignManagerDialogProps {
  open: boolean;
  onClose: () => void;
  target: UnitMember;
  /** Ứng viên quản lý = toàn bộ nhân viên (đã liên kết user). */
  candidates: UnitMember[];
  onSaved: () => void;
}

export function EmployeeAssignManagerDialog({
  open,
  onClose,
  target,
  candidates,
  onSaved,
}: EmployeeAssignManagerDialogProps) {
  const { t } = useTranslation("hr");
  const [managerUserId, setManagerUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chỉ người ĐÃ liên kết user mới làm quản lý được (directManagerId = users.id); loại chính nhân viên.
  const options = candidates.filter(
    (c) => c.userId && c.employeeId !== target.employeeId && c.userId !== target.userId,
  );

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!managerUserId) {
      setError(t("orgChart.dialogs.pickManager"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await hrApi.updateEmployee(target.employeeId, {
        directManagerId: managerUserId === NO_MANAGER ? null : managerUserId,
      });
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
      title={t("orgChart.actions.assignManager")}
      description={t("orgChart.dialogs.assignManagerDesc", {
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
            data-testid="assign-manager-submit"
          >
            {submitting ? t("orgChart.dialogs.saving") : t("orgChart.dialogs.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="manager-select" className="text-sm font-medium">
            {t("orgChart.dialogs.directManager")}
          </label>
          <Select
            id="manager-select"
            value={managerUserId}
            onChange={(e) => setManagerUserId(e.target.value)}
          >
            <option value="">{t("orgChart.dialogs.pickPlaceholder")}</option>
            <option value={NO_MANAGER}>{t("orgChart.dialogs.noManager")}</option>
            {options.map((c) => (
              <option key={c.employeeId} value={c.userId ?? ""}>
                {(c.displayName ?? t("orgChart.unnamedMember")) +
                  (c.orgUnitName ? ` — ${c.orgUnitName}` : "")}
              </option>
            ))}
          </Select>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </Dialog>
  );
}
