import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  hrApi,
  hrKeys,
  taskTemplateApi,
  taskTemplateInvalidation,
} from "@mediaos/web-core";
import type { TaskTemplateResponseDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";

/**
 * GOAL-SCREEN-006 (S5-GOAL-TPL-1) — tạo/sửa HEADER danh mục việc mẫu (GOAL-API-012).
 *
 * `departmentId` rỗng = danh mục DÙNG CHUNG toàn công ty. Server chỉ cho quản trị cấp công ty
 * (`manage:task-template` @Company) tạo/sửa loại dùng-chung; trưởng đơn vị @Department gửi rỗng ⇒ 403
 * `GOAL-ERR-TPL-FORBIDDEN`. FE KHÔNG tự đoán scope của người dùng (capabilities không mang data_scope) —
 * để server trả lỗi có mã thay vì ẩn tuỳ chọn dựa trên phỏng đoán.
 *
 * Việc mẫu (items) KHÔNG sửa ở đây — có hộp thoại riêng (`TaskTemplateItemsDialog`), khớp BE: PATCH
 * header và CRUD item là các endpoint tách biệt (không replace cả mảng ⇒ không mất item do đua sửa).
 */
export function TaskTemplateFormDialog({
  template,
  onClose,
}: {
  /** undefined = tạo mới. */
  template?: TaskTemplateResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const isEdit = template !== undefined;

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [departmentId, setDepartmentId] = useState(template?.departmentId ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);

  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    staleTime: 300_000,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        departmentId: departmentId === "" ? null : departmentId,
        isActive,
      };
      return isEdit
        ? taskTemplateApi.updateTemplate(template.id, body)
        : taskTemplateApi.createTemplate(body);
    },
    onSuccess: async (saved) => {
      const keys = isEdit
        ? taskTemplateInvalidation.update(saved.id)
        : taskTemplateInvalidation.create();
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onClose();
    },
  });

  const errorMessage =
    mutation.error instanceof ApiError && mutation.error.message
      ? mutation.error.message
      : mutation.isError
        ? t("templates.form.error")
        : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? t("templates.form.editTitle") : t("templates.form.createTitle")}
      description={t("templates.form.description")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button
            size="sm"
            data-testid="task-template-form-submit"
            disabled={name.trim() === "" || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? t("templates.form.saving") : t("templates.form.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={t("templates.fields.name")} htmlFor="task-template-name">
          <Input
            id="task-template-name"
            data-testid="task-template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("templates.fields.namePlaceholder")}
          />
        </Field>
        <Field label={t("templates.fields.description")} htmlFor="task-template-description">
          <textarea
            id="task-template-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>
        <Field label={t("templates.fields.department")} htmlFor="task-template-department">
          <Select
            id="task-template-department"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">{t("templates.fields.departmentShared")}</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            data-testid="task-template-active"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          {t("templates.fields.isActive")}
        </label>

        {errorMessage && (
          <p
            data-testid="task-template-form-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
