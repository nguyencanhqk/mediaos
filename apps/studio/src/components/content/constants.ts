import type {
  AssetType,
  ContentPriority,
  ContentStatus,
  ProductionStatus,
  PublishStatus,
} from "@mediaos/contracts";

/** Workflow-lite status (0007) — nhãn VI. */
export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  draft: "Nháp",
  in_production: "Đang làm",
  review: "Chờ duyệt",
  approved: "Đã duyệt",
  published: "Đã đăng",
};

export const CONTENT_STATUS_OPTIONS: ContentStatus[] = [
  "draft",
  "in_production",
  "review",
  "approved",
  "published",
];

/** Production status (10-value) — khớp content_items_production_status_check (0025). */
export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  idea: "Ý tưởng",
  planning: "Lên kế hoạch",
  in_production: "Đang sản xuất",
  waiting_review: "Chờ duyệt",
  revision: "Chỉnh sửa",
  approved: "Đã duyệt",
  scheduled: "Đã lên lịch",
  published: "Đã đăng",
  analyzed: "Đã phân tích",
  cancelled: "Đã huỷ",
};

export const PRODUCTION_STATUS_OPTIONS: ProductionStatus[] = [
  "idea",
  "planning",
  "in_production",
  "waiting_review",
  "revision",
  "approved",
  "scheduled",
  "published",
  "analyzed",
  "cancelled",
];

/** Publish status per-kênh (content_channels) — nhãn VI. */
export const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  not_scheduled: "Chưa lên lịch",
  scheduled: "Đã lên lịch",
  publishing: "Đang đăng",
  published: "Đã đăng",
  failed: "Lỗi",
  removed: "Đã gỡ",
};

export const PUBLISH_STATUS_OPTIONS: PublishStatus[] = [
  "not_scheduled",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "removed",
];

/** Loại asset (content_assets) — nhãn VI. */
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  script: "Kịch bản",
  voice: "Giọng đọc",
  raw_video: "Video thô",
  edited_video: "Video dựng",
  thumbnail: "Thumbnail",
  seo_document: "Tài liệu SEO",
  reference: "Tham khảo",
  final_output: "Bản hoàn chỉnh",
};

export const ASSET_TYPE_OPTIONS: AssetType[] = [
  "script",
  "voice",
  "raw_video",
  "edited_video",
  "thumbnail",
  "seo_document",
  "reference",
  "final_output",
];

export const CONTENT_PRIORITY_LABELS: Record<ContentPriority, string> = {
  low: "Thấp",
  medium: "Trung bình",
  high: "Cao",
  urgent: "Khẩn cấp",
};

export const CONTENT_PRIORITY_OPTIONS: ContentPriority[] = ["low", "medium", "high", "urgent"];
