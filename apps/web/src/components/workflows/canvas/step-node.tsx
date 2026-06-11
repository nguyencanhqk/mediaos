import { Handle, Position, type NodeProps } from "@xyflow/react";
import { STEP_TYPE_LABELS, roleLabel } from "../constants";
import type { StepNode } from "./layout";

/**
 * Node bước trên canvas: handle target (trên) + source (dưới) để kéo-thả tạo phụ thuộc.
 * Khi `disabled` (template published) → ẩn handle để không vẽ cạnh được (2d).
 */
export function StepNodeCard({ data }: NodeProps<StepNode>) {
  const { step, hasError, disabled } = data;

  return (
    <div
      className={`w-48 rounded-lg border-2 bg-background px-3 py-2 shadow-sm ${
        hasError ? "border-destructive ring-2 ring-destructive/30" : "border-border"
      }`}
    >
      {!disabled && <Handle type="target" position={Position.Top} className="!bg-primary" />}
      <p className="flex items-center gap-1 truncate text-sm font-medium" title={step.title}>
        {hasError && (
          <span className="text-destructive" aria-label="Bước có lỗi DAG" title="Bước có lỗi DAG">
            ⚠
          </span>
        )}
        <span className="truncate">{step.title}</span>
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {STEP_TYPE_LABELS[step.stepType]} · {roleLabel(step.assigneeRoleCode)}
      </p>
      {!step.isRequired && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">(không bắt buộc)</p>
      )}
      {!disabled && <Handle type="source" position={Position.Bottom} className="!bg-primary" />}
    </div>
  );
}
