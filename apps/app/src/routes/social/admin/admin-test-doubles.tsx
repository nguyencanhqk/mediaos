/**
 * S16-SOCIAL-FE-3 (L1) — KHUNG fixture dùng chung của cụm quản trị bảng tin. Dữ liệu mặc định ở commit
 * GREEN kế tiếp (plan §4 — quy tắc stub-trước). CHỈ chứa factory/fixture (plan D19).
 */
import type { ApiError } from "@mediaos/web-core";
import type {
  FeedEngagementResponseDto,
  FeedReportDto,
  KudosBadgeAdminDto,
} from "@mediaos/contracts";

export const makeReport = (over: Partial<FeedReportDto> = {}): FeedReportDto =>
  ({ ...over }) as FeedReportDto;

export const makeEngagement = (
  over: Partial<FeedEngagementResponseDto> = {},
): FeedEngagementResponseDto => ({ ...over }) as FeedEngagementResponseDto;

export const makeBadgeAdmin = (over: Partial<KudosBadgeAdminDto> = {}): KudosBadgeAdminDto =>
  ({ ...over }) as KudosBadgeAdminDto;

export const ADMIN_ERR: Record<string, () => ApiError> = {};
