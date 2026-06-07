import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateContentItemRequest } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { contentApi } from "@/lib/content-api";
import { projectsApi } from "@/lib/projects-api";

interface CreateContentDialogProps {
  /** Khi mở từ trang project: cố định project (ẩn dropdown). */
  fixedProjectId?: string;
}

export function CreateContentDialog({ fixedProjectId }: CreateContentDialogProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(fixedProjectId ?? "");
  const [contentTypeId, setContentTypeId] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", {}],
    queryFn: () => projectsApi.listProjects(),
    enabled: open && !fixedProjectId,
  });
  const { data: types = [] } = useQuery({
    queryKey: ["content-types"],
    queryFn: () => contentApi.listContentTypes(),
    enabled: open,
  });

  /** Gợi ý workflow theo content type (CNT-001) — đọc default_workflow_template_id của type. */
  const suggestedWorkflow = useMemo(
    () => types.find((t) => t.id === contentTypeId)?.defaultWorkflowTemplateId ?? null,
    [types, contentTypeId],
  );

  const create = useMutation({
    mutationFn: () => {
      const req: CreateContentItemRequest = { projectId, title: title.trim() };
      if (contentTypeId) req.contentTypeId = contentTypeId;
      return contentApi.createContent(req);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["content"] });
      setTitle("");
      setContentTypeId("");
      if (!fixedProjectId) setProjectId("");
      setOpen(false);
    },
  });

  const canSubmit = Boolean(title.trim() && projectId);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + Thêm nội dung
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Thêm nội dung mới"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button size="sm" onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
              {create.isPending ? "Đang tạo…" : "Tạo nội dung"}
            </Button>
          </>
        }
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium">Tiêu đề</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiêu đề nội dung…" />
        </label>

        {!fixedProjectId && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">Dự án</span>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Chọn dự án —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-sm font-medium">Loại nội dung</span>
          <Select value={contentTypeId} onChange={(e) => setContentTypeId(e.target.value)}>
            <option value="">— Không chọn —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>

        {contentTypeId && (
          <p className="text-xs text-muted-foreground">
            {suggestedWorkflow
              ? `Workflow gợi ý: ${suggestedWorkflow}`
              : "Loại nội dung này chưa gắn workflow mặc định."}
          </p>
        )}

        {create.isError && (
          <p className="text-sm text-destructive">
            Tạo nội dung thất bại:{" "}
            {create.error instanceof Error ? create.error.message : "Lỗi không xác định"}
          </p>
        )}
      </Dialog>
    </>
  );
}
