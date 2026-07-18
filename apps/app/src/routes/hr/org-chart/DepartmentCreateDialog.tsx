/**
 * DepartmentCreateDialog — nút "Thêm phòng ban" trên sơ đồ tổ chức (S5-HR-ORGCHART-FE-2).
 * Gọi hrMasterDataApi.createDepartment (POST /hr/departments, gate create:department ở SERVER).
 * company_id do server resolve. Sau thành công gọi onCreated() để page invalidate lại cây + đóng dialog.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, hrMasterDataApi } from "@mediaos/web-core";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { indentLabel, type DeptOption } from "./org-chart-lookups";

interface DepartmentCreateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Phòng ban hiện có → chọn phòng cha (tùy chọn). */
  parentOptions: DeptOption[];
  /** Gọi sau khi tạo thành công (page invalidate + đóng). */
  onCreated: () => void;
}

export function DepartmentCreateDialog({
  open,
  onClose,
  parentOptions,
  onCreated,
}: DepartmentCreateDialogProps) {
  const { t } = useTranslation("hr");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [parentId, setParentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setCode("");
    setParentId("");
    setError(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("orgChart.dialogs.nameRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await hrMasterDataApi.createDepartment({
        name: trimmed,
        code: code.trim() || undefined,
        parentId: parentId || undefined,
      });
      reset();
      onCreated();
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
      title={t("orgChart.actions.addDepartment")}
      description={t("orgChart.dialogs.addDepartmentDesc")}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={submitting}>
            {t("orgChart.dialogs.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="dept-create-submit"
          >
            {submitting ? t("orgChart.dialogs.saving") : t("orgChart.dialogs.create")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="dept-name" className="text-sm font-medium">
            {t("orgChart.dialogs.deptName")} <span className="text-destructive">*</span>
          </label>
          <Input
            id="dept-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("orgChart.dialogs.deptNamePlaceholder")}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="dept-code" className="text-sm font-medium">
            {t("orgChart.dialogs.deptCode")}
          </label>
          <Input
            id="dept-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("orgChart.dialogs.deptCodePlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="dept-parent" className="text-sm font-medium">
            {t("orgChart.dialogs.parentDept")}
          </label>
          <Select id="dept-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t("orgChart.dialogs.noParent")}</option>
            {parentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {indentLabel(opt.name, opt.depth)}
              </option>
            ))}
          </Select>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </Dialog>
  );
}
