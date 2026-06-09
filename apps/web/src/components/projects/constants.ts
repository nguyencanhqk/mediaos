import type { ProjectPriority, ProjectStatus, ProjectType } from "@mediaos/contracts";

/** Nhãn tiếng Việt cho loại dự án — khớp CHECK `projects_type_check` (0023). */
export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  content_production: "Sản xuất nội dung",
  channel_operation: "Vận hành kênh",
  growth_campaign: "Chiến dịch tăng trưởng",
  recruitment: "Tuyển dụng",
  training: "Đào tạo",
  finance: "Tài chính",
  office_internal: "Nội bộ văn phòng",
  equipment: "Thiết bị",
};

export const PROJECT_TYPE_OPTIONS: ProjectType[] = [
  "content_production",
  "channel_operation",
  "growth_campaign",
  "recruitment",
  "training",
  "finance",
  "office_internal",
  "equipment",
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Đang chạy",
  paused: "Tạm dừng",
  archived: "Lưu trữ",
};

export const PROJECT_STATUS_OPTIONS: ProjectStatus[] = ["active", "paused", "archived"];

export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  low: "Thấp",
  medium: "Trung bình",
  high: "Cao",
  urgent: "Khẩn cấp",
};

export const PROJECT_PRIORITY_OPTIONS: ProjectPriority[] = ["low", "medium", "high", "urgent"];

/** Tailwind text-color theo độ ưu tiên (table + overview). */
export const PROJECT_PRIORITY_COLORS: Record<ProjectPriority, string> = {
  low: "text-muted-foreground",
  medium: "text-foreground",
  high: "text-orange-600",
  urgent: "text-destructive",
};

/** Trạng thái link member/channel (active/inactive). */
export const LINK_STATUS_LABELS: Record<"active" | "inactive", string> = {
  active: "Đang hoạt động",
  inactive: "Ngừng",
};
