import type {
  ChannelHealthStatus,
  ChannelPlatform,
  ChannelRole,
  ChannelStatus,
} from "@mediaos/contracts";

/** Nhãn tiếng Việt cho nền tảng — khớp catalog `platforms` (6 code). */
export const PLATFORM_LABELS: Record<ChannelPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
  podcast: "Podcast",
  website: "Website",
};

export const PLATFORM_OPTIONS: ChannelPlatform[] = [
  "youtube",
  "tiktok",
  "facebook",
  "instagram",
  "podcast",
  "website",
];

export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  active: "Đang chạy",
  testing: "Thử nghiệm",
  paused: "Tạm dừng",
  stopped: "Dừng",
  archived: "Lưu trữ",
};

export const CHANNEL_STATUS_OPTIONS: ChannelStatus[] = [
  "active",
  "testing",
  "paused",
  "stopped",
  "archived",
];

export const HEALTH_LABELS: Record<ChannelHealthStatus, string> = {
  healthy: "Khỏe",
  watching: "Theo dõi",
  declining: "Đi xuống",
  risk: "Rủi ro",
  paused: "Tạm dừng",
  stopped: "Dừng",
};

export const CHANNEL_ROLE_LABELS: Record<ChannelRole, string> = {
  channel_manager: "Channel Manager",
  seo: "SEO",
  uploader: "Uploader",
  content_lead: "Content Lead",
  production_lead: "Production Lead",
  finance_viewer: "Finance Viewer",
  qa: "QA",
};

export const CHANNEL_ROLE_OPTIONS: ChannelRole[] = [
  "channel_manager",
  "seo",
  "uploader",
  "content_lead",
  "production_lead",
  "finance_viewer",
  "qa",
];

/** Tailwind text-color cho từng trạng thái health (dùng ở table + tab health sau). */
export const HEALTH_COLORS: Record<ChannelHealthStatus, string> = {
  healthy: "text-green-600",
  watching: "text-amber-600",
  declining: "text-orange-600",
  risk: "text-destructive",
  paused: "text-muted-foreground",
  stopped: "text-muted-foreground",
};
