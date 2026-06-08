/** Trạng thái tài khoản nền tảng — khớp `platform_accounts_status_check` (0022). */
export type PlatformAccountStatus = "active" | "inactive" | "suspended";

export const PLATFORM_ACCOUNT_STATUS_LABELS: Record<PlatformAccountStatus, string> = {
  active: "Đang dùng",
  inactive: "Ngừng dùng",
  suspended: "Bị khoá",
};

export const PLATFORM_ACCOUNT_STATUS_OPTIONS: PlatformAccountStatus[] = [
  "active",
  "inactive",
  "suspended",
];

export const PLATFORM_ACCOUNT_STATUS_COLORS: Record<PlatformAccountStatus, string> = {
  active: "text-green-600",
  inactive: "text-muted-foreground",
  suspended: "text-destructive",
};

/** Mức bảo mật (free text ở DB, max 40). Gợi ý các mức chuẩn; render thô nếu ngoài danh sách. */
export const SECURITY_LEVEL_LABELS: Record<string, string> = {
  low: "Thấp",
  medium: "Trung bình",
  high: "Cao",
  critical: "Nghiêm trọng",
};

export const SECURITY_LEVEL_OPTIONS = ["low", "medium", "high", "critical"] as const;

export function securityLevelLabel(level: string | null): string {
  if (!level) return "—";
  return SECURITY_LEVEL_LABELS[level] ?? level;
}

export function platformAccountStatusLabel(status: string): string {
  return (PLATFORM_ACCOUNT_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export function platformAccountStatusColor(status: string): string {
  return (
    (PLATFORM_ACCOUNT_STATUS_COLORS as Record<string, string>)[status] ?? "text-muted-foreground"
  );
}
