import type {
  DagErrorCode,
  DependencyType,
  InstanceStatus,
  StepInstanceStatus,
  StepType,
  TemplateAppliesTo,
  TemplateStatus,
} from "@/lib/workflow-builder/contract";

// ─── Template status ──────────────────────────────────────────────────────────

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  draft: "Nháp",
  published: "Đã xuất bản",
  archived: "Lưu trữ",
};

/** Badge classes — tái dùng ở list, detail header, canvas (2c/2d). */
export const TEMPLATE_STATUS_BADGE_CLASSES: Record<TemplateStatus, string> = {
  draft: "bg-amber-100 text-amber-700",
  published: "bg-green-100 text-green-700",
  archived: "bg-muted text-muted-foreground",
};

export const TEMPLATE_STATUS_OPTIONS: TemplateStatus[] = ["draft", "published", "archived"];

// ─── Applies-to (mục tiêu) ────────────────────────────────────────────────────

export const TEMPLATE_APPLIES_TO_LABELS: Record<TemplateAppliesTo, string> = {
  content: "Nội dung",
  project: "Dự án",
};

export const TEMPLATE_APPLIES_TO_OPTIONS: TemplateAppliesTo[] = ["content", "project"];

// ─── Step type ────────────────────────────────────────────────────────────────

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  task: "Tác vụ",
  approval: "Phê duyệt",
  evaluation: "Đánh giá",
};

export const STEP_TYPE_OPTIONS: StepType[] = ["task", "approval", "evaluation"];

// ─── Dependency type ──────────────────────────────────────────────────────────

export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  finish_to_start: "Hoàn thành → Bắt đầu",
  start_to_start: "Bắt đầu → Bắt đầu",
  finish_to_finish: "Hoàn thành → Hoàn thành",
};

// ─── Role options cho assignee/reviewer (tới khi có endpoint roles thật) ───────
// Mã khớp seed `video_standard_v0` (scripts/seed-workflow-definition.sql) + role matrix.

export interface RoleOption {
  code: string;
  label: string;
}

export const WORKFLOW_ROLE_OPTIONS: RoleOption[] = [
  { code: "script_writer", label: "Người viết kịch bản" },
  { code: "video_editor", label: "Dựng phim" },
  { code: "qa_reviewer", label: "QA / Kiểm duyệt" },
  { code: "uploader", label: "Người đăng tải" },
  { code: "project_manager", label: "Quản lý dự án" },
  { code: "channel_manager", label: "Quản lý kênh" },
  { code: "content_lead", label: "Trưởng nhóm nội dung" },
  { code: "production_lead", label: "Trưởng nhóm sản xuất" },
];

const ROLE_LABEL_BY_CODE = new Map(WORKFLOW_ROLE_OPTIONS.map((r) => [r.code, r.label]));

/** Nhãn role thân thiện; fallback = chính mã nếu chưa nằm trong danh mục. */
export function roleLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return ROLE_LABEL_BY_CODE.get(code) ?? code;
}

// ─── DAG error code → nhãn ngắn (message chi tiết lấy từ server/validator) ─────

export const DAG_ERROR_LABELS: Record<DagErrorCode, string> = {
  CYCLE: "Chu trình phụ thuộc",
  SELF_DEP: "Bước tự phụ thuộc",
  CROSS_TEMPLATE_DEP: "Phụ thuộc khác template",
  ORPHAN: "Bước không nối với gốc",
  MISSING_DEP_TARGET: "Phụ thuộc tới bước không tồn tại",
  NO_ROOT: "Thiếu bước gốc",
  EMPTY: "Chưa có bước nào",
};

// ─── Instance step status (3d — canvas read-only tô màu) ──────────────────────

export const STEP_INSTANCE_STATUS_LABELS: Record<StepInstanceStatus, string> = {
  not_started: "Chưa bắt đầu",
  in_progress: "Đang làm",
  waiting_review: "Chờ duyệt",
  approved: "Đã duyệt",
  revision: "Đang sửa",
  blocked: "Bị khoá",
};

/** Màu nền node theo trạng thái (border + bg + text). */
export const STEP_INSTANCE_STATUS_NODE_CLASSES: Record<StepInstanceStatus, string> = {
  not_started: "border-border bg-muted/40 text-muted-foreground",
  in_progress: "border-blue-300 bg-blue-50 text-blue-800",
  waiting_review: "border-yellow-300 bg-yellow-50 text-yellow-800",
  approved: "border-green-400 bg-green-50 text-green-800",
  revision: "border-orange-300 bg-orange-50 text-orange-800",
  blocked: "border-red-300 bg-red-50 text-red-800",
};

/** Chấm màu nhỏ cạnh nhãn trạng thái (dùng ở danh sách bước instance — non-color cue đi kèm text). */
export const STEP_INSTANCE_STATUS_DOT_CLASSES: Record<StepInstanceStatus, string> = {
  not_started: "bg-muted-foreground/50",
  in_progress: "bg-blue-500",
  waiting_review: "bg-yellow-500",
  approved: "bg-green-500",
  revision: "bg-orange-500",
  blocked: "bg-red-500",
};

// ─── Instance status (active/completed/cancelled) ─────────────────────────────

export const INSTANCE_STATUS_LABELS: Record<InstanceStatus, string> = {
  active: "Đang chạy",
  completed: "Hoàn thành",
  cancelled: "Đã huỷ",
};

export const INSTANCE_STATUS_BADGE_CLASSES: Record<InstanceStatus, string> = {
  active: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-muted text-muted-foreground",
};
