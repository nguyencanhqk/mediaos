import type { TemplateStatus } from "@/lib/workflow-builder/contract";
import { TEMPLATE_STATUS_BADGE_CLASSES, TEMPLATE_STATUS_LABELS } from "./constants";

interface TemplateStatusBadgeProps {
  status: TemplateStatus;
  /** Hiển thị version kèm badge (vd "v2"). */
  version?: number;
}

/** Badge draft/published/archived — dùng ở list, detail header, canvas (2d), instance view. */
export function TemplateStatusBadge({ status, version }: TemplateStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TEMPLATE_STATUS_BADGE_CLASSES[status]}`}
    >
      {TEMPLATE_STATUS_LABELS[status]}
      {version != null && <span className="opacity-70">· v{version}</span>}
    </span>
  );
}
