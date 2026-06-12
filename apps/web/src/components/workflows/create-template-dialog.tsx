import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  createTemplateSchema,
  type CreateTemplateRequest,
} from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TEMPLATE_APPLIES_TO_OPTIONS, appliesToLabel } from "./constants";

interface TemplateFormState {
  name: string;
  code: string;
  appliesTo: string;
}

const emptyForm: TemplateFormState = {
  name: "",
  code: "",
  appliesTo: "content_item",
};

/** slug code ổn định từ name khi người dùng bỏ trống (contract yêu cầu code). */
function deriveCode(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 100) || "workflow"
  );
}

/** Parse form → request qua contract Zod (nguồn DTO). Trả lỗi field đầu tiên nếu có. */
function parseForm(
  f: TemplateFormState,
): { ok: true; data: CreateTemplateRequest } | { ok: false; error: string } {
  const code = f.code.trim() || deriveCode(f.name);
  const result = createTemplateSchema.safeParse({
    name: f.name.trim(),
    code,
    appliesTo: f.appliesTo,
  });
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
}

export function CreateTemplateDialog() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TemplateFormState>(emptyForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (data: CreateTemplateRequest) => workflowTemplatesApi.create(data),
    onSuccess: (template) => {
      void qc.invalidateQueries({ queryKey: ["workflow-templates"] });
      setForm(emptyForm);
      setOpen(false);
      void navigate({ to: "/workflows/templates/$templateId", params: { templateId: template.id } });
    },
  });

  const onSubmit = () => {
    const parsed = parseForm(form);
    if (!parsed.ok) {
      setValidationError(parsed.error);
      return;
    }
    setValidationError(null);
    create.mutate(parsed.data);
  };

  const patch = (p: Partial<TemplateFormState>) => setForm((f) => ({ ...f, ...p }));

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + Tạo quy trình
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Tạo quy trình mới"
        description="Quy trình mới luôn ở trạng thái Nháp. Thêm bước và phụ thuộc trước khi xuất bản."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button size="sm" onClick={onSubmit} disabled={!form.name.trim() || create.isPending}>
              {create.isPending ? "Đang tạo…" : "Tạo & mở"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Tên quy trình *</span>
            <Input
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="VD: Sản xuất video chuẩn"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Mã (tuỳ chọn)</span>
            <Input
              value={form.code}
              onChange={(e) => patch({ code: e.target.value })}
              placeholder="VD: video_standard (bỏ trống = tạo từ tên)"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Áp dụng cho</span>
            <Select value={form.appliesTo} onChange={(e) => patch({ appliesTo: e.target.value })}>
              {TEMPLATE_APPLIES_TO_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {appliesToLabel(o)}
                </option>
              ))}
            </Select>
          </label>
          {validationError && <p className="text-sm text-destructive">{validationError}</p>}
          {create.isError && (
            <p className="text-sm text-destructive">
              Tạo thất bại: {create.error instanceof Error ? create.error.message : "Lỗi không xác định"}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
