import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  payrollTemplateScopeEnum,
  type PayrollTemplateDto,
  type PayrollTemplateScope,
  type UpdatePayrollTemplateRequest,
} from "@mediaos/contracts";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import { Button, Checkbox, Dialog, Input, Select } from "@mediaos/ui";
import { parsePayrollError, payrollErrorText } from "../payroll-errors";
import { UnitSelector } from "./UnitSelector";

/**
 * PAY-SCREEN-010 — tạo (050) / sửa thông tin (052) một mẫu bảng lương. Danh sách thành phần sửa ở màn
 * chi tiết (053), không ở đây.
 *
 * `code` BẤT BIẾN sau khi tạo (052 không nhận). Phạm vi `org_unit` tạo được nhưng CHƯA gắn vào kỳ được
 * (409 `template-scope-unsupported`) — gợi ý nói rõ để người dùng không bất ngờ ở bước tạo kỳ.
 */
export function TemplateFormDialog({
  open,
  onClose,
  template,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` = tạo mới. */
  template: PayrollTemplateDto | null;
  onCreated?: (id: string) => void;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const isEdit = template !== null;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<PayrollTemplateScope>("company");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode(template?.code ?? "");
    setName(template?.name ?? "");
    setScope(template?.scope ?? "company");
    setOrgUnitId(template?.orgUnitId ?? "");
    setIsActive(template?.isActive ?? true);
    setError(null);
  }, [open, template]);

  const scopeValid = scope === "company" || orgUnitId !== "";
  const canSubmit = code.trim() !== "" && name.trim() !== "" && scopeValid;

  const mutation = useMutation({
    mutationFn: () => {
      const orgUnit = scope === "org_unit" ? orgUnitId : null;
      if (template) {
        const body: UpdatePayrollTemplateRequest = {};
        if (name.trim() !== template.name) body.name = name.trim();
        if (scope !== template.scope) body.scope = scope;
        if (orgUnit !== template.orgUnitId) body.orgUnitId = orgUnit;
        if (isActive !== template.isActive) body.isActive = isActive;
        if (Object.keys(body).length === 0) return Promise.resolve({ id: template.id });
        return payrollApi.updatePayrollTemplate(template.id, body);
      }
      return payrollApi.createPayrollTemplate({
        code: code.trim(),
        name: name.trim(),
        scope,
        orgUnitId: orgUnit,
        isActive,
      });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: payrollKeys.catalog.allOf() });
      onClose();
      if (!isEdit) onCreated?.(res.id);
    },
    onError: (e) => setError(payrollErrorText(t, parsePayrollError(e))),
  });

  return (
    <Dialog
      open={open}
      onClose={mutation.isPending ? () => {} : onClose}
      title={isEdit ? t("templateForm.editTitle") : t("templateForm.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {t("templateForm.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("templateForm.codeLabel")}</span>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isEdit}
            maxLength={64}
            className="font-mono"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("templateForm.nameLabel")}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("templateForm.scopeLabel")}</span>
          <Select value={scope} onChange={(e) => setScope(e.target.value as PayrollTemplateScope)}>
            {payrollTemplateScopeEnum.options.map((s) => (
              <option key={s} value={s}>
                {t(`templateScope.${s}`)}
              </option>
            ))}
          </Select>
        </label>
        {scope === "org_unit" && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("templateForm.unitLabel")}</span>
            <UnitSelector value={orgUnitId} onChange={setOrgUnitId} />
            <span className="mt-1 block text-xs text-warning">{t("templateForm.orgUnitHint")}</span>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("templateForm.isActiveLabel")}
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
