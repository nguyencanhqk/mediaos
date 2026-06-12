import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  STEP_INSTANCE_STATUS_DOT_CLASSES,
  STEP_INSTANCE_STATUS_LABELS,
  STEP_INSTANCE_STATUS_NODE_CLASSES,
} from "../constants";
import type { InstanceStepNode } from "./instance-layout";

/**
 * Node bước ở INSTANCE (read-only): tô màu theo status, có chấm màu + nhãn text
 * (non-color cue đi kèm). Handle chỉ để vẽ cạnh, không kết nối được.
 */
export function InstanceStepNodeCard({ data }: NodeProps<InstanceStepNode>) {
  const { step } = data;
  return (
    <div
      className={`w-48 rounded-lg border-2 px-3 py-2 shadow-sm ${STEP_INSTANCE_STATUS_NODE_CLASSES[step.status]}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} aria-hidden="true" />
      <p className="truncate text-sm font-medium" title={step.stepName}>
        {step.stepName}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-xs">
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${STEP_INSTANCE_STATUS_DOT_CLASSES[step.status]}`}
          aria-hidden="true"
        />
        {STEP_INSTANCE_STATUS_LABELS[step.status]}
      </p>
      <Handle type="source" position={Position.Bottom} isConnectable={false} aria-hidden="true" />
    </div>
  );
}
