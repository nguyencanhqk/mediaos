import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DependencyDto, TemplateStepDto } from "@/lib/workflow-builder/contract";
import { workflowTemplatesApi } from "@/lib/workflow-templates-api";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

interface DependencyEditorProps {
  templateId: string;
  steps: TemplateStepDto[];
  dependencies: DependencyDto[];
  /** Khoá sửa khi template đã published. */
  disabled: boolean;
}

/**
 * Sửa cạnh DAG bằng dropdown (chưa canvas — 2c).
 * Quy ước: "fromStep" chạy trước (tiền nhiệm), "toStep" phụ thuộc (chạy sau).
 */
export function DependencyEditor({ templateId, steps, dependencies, disabled }: DependencyEditorProps) {
  const qc = useQueryClient();
  const [fromStepId, setFromStepId] = useState("");
  const [toStepId, setToStepId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const titleById = useMemo(() => new Map(steps.map((s) => [s.id, s.title])), [steps]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["workflow-template", templateId] });

  const add = useMutation({
    mutationFn: () =>
      workflowTemplatesApi.addDependency(templateId, { fromStepId, toStepId, dependencyType: "finish_to_start" }),
    onSuccess: () => {
      void invalidate();
      setFromStepId("");
      setToStepId("");
    },
  });

  const remove = useMutation({
    mutationFn: (depId: string) => workflowTemplatesApi.removeDependency(templateId, depId),
    onSuccess: () => void invalidate(),
  });

  const onAdd = () => {
    setLocalError(null);
    if (!fromStepId || !toStepId) {
      setLocalError("Chọn cả bước chạy trước và bước phụ thuộc.");
      return;
    }
    if (fromStepId === toStepId) {
      setLocalError("Một bước không thể tự phụ thuộc.");
      return;
    }
    add.mutate();
  };

  const canEdit = !disabled && steps.length >= 2;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Phụ thuộc ({dependencies.length})</h2>
      <p className="text-sm text-muted-foreground">
        Bước phụ thuộc chỉ mở khi mọi bước chạy trước đã được duyệt. Phụ thuộc rẽ nhánh = chạy song song.
      </p>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/20 p-3">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">Bước chạy trước</span>
            <Select
              className="h-9 w-52"
              value={fromStepId}
              onChange={(e) => setFromStepId(e.target.value)}
            >
              <option value="">— Chọn bước —</option>
              {steps.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
          </label>
          <span className="pb-2 text-muted-foreground">→</span>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">Bước phụ thuộc</span>
            <Select
              className="h-9 w-52"
              value={toStepId}
              onChange={(e) => setToStepId(e.target.value)}
            >
              <option value="">— Chọn bước —</option>
              {steps.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
          </label>
          <Button size="sm" onClick={onAdd} disabled={add.isPending}>
            {add.isPending ? "Đang thêm…" : "Thêm phụ thuộc"}
          </Button>
        </div>
      )}

      {localError && <p className="text-sm text-destructive">{localError}</p>}
      {add.isError && (
        <p className="text-sm text-destructive">
          {add.error instanceof Error ? add.error.message : "Thêm phụ thuộc thất bại."}
        </p>
      )}

      {dependencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có phụ thuộc nào.</p>
      ) : (
        <ul className="space-y-2">
          {dependencies.map((dep) => (
            <li
              key={dep.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-2.5 text-sm"
            >
              <span>
                <span className="font-medium">{titleById.get(dep.toStepId) ?? "—"}</span>
                <span className="text-muted-foreground"> phụ thuộc vào </span>
                <span className="font-medium">{titleById.get(dep.fromStepId) ?? "—"}</span>
              </span>
              {!disabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => remove.mutate(dep.id)}
                  disabled={remove.isPending}
                >
                  Xoá
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
