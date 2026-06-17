import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  applyTemplateSchema,
  type ApplyTemplateRequest,
} from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { Button } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";

type TargetType = "content" | "project";

interface RunWorkflowDialogProps {
  templateId: string;
}

/** Dựng request apply qua contract Zod (exactly-one target). */
function buildRequest(
  targetType: TargetType,
  targetId: string,
): { ok: true; data: ApplyTemplateRequest } | { ok: false } {
  const id = targetId.trim();
  const candidate =
    targetType === "content"
      ? { contentItemId: id, projectId: null }
      : { contentItemId: null, projectId: id };
  const result = applyTemplateSchema.safeParse(candidate);
  return result.success ? { ok: true, data: result.data } : { ok: false };
}

/**
 * Nút + dialog "Chạy quy trình" — khởi tạo một lượt chạy mới từ template đã xuất bản.
 * Chỉ dùng UI; gọi thẳng `apply()` đã có (không đổi data/permission logic).
 */
export function RunWorkflowDialog({ templateId }: RunWorkflowDialogProps) {
  const { t } = useTranslation("workflows");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [targetType, setTargetType] = useState<TargetType>("content");
  const [targetId, setTargetId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (data: ApplyTemplateRequest) => workflowTemplatesApi.apply(templateId, data),
    onSuccess: ({ instanceId }) => {
      void qc.invalidateQueries({ queryKey: ["workflow-instances"] });
      setOpen(false);
      setTargetType("content");
      setTargetId("");
      setValidationError(null);
      void navigate({ to: "/workflows/instances/$instanceId", params: { instanceId } });
    },
  });

  const onSubmit = () => {
    const built = buildRequest(targetType, targetId);
    if (!built.ok) {
      setValidationError(t("detail.runDialog.validationError"));
      return;
    }
    setValidationError(null);
    run.mutate(built.data);
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {t("detail.runBtn")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("detail.runDialog.title")}
        description={t("detail.runDialog.description")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("detail.runDialog.cancel")}
            </Button>
            <Button size="sm" onClick={onSubmit} disabled={!targetId.trim() || run.isPending}>
              {run.isPending ? t("detail.runDialog.submitting") : t("detail.runDialog.submit")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("detail.runDialog.fieldTargetType")}</span>
            <Select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as TargetType)}
            >
              <option value="content">{t("detail.runDialog.targetContent")}</option>
              <option value="project">{t("detail.runDialog.targetProject")}</option>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("detail.runDialog.fieldTargetId")}</span>
            <Input
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder={t("detail.runDialog.fieldTargetIdPlaceholder")}
            />
          </label>
          {validationError && <p className="text-sm text-destructive">{validationError}</p>}
          {run.isError && <p className="text-sm text-destructive">{t("detail.runError")}</p>}
        </div>
      </Dialog>
    </>
  );
}
