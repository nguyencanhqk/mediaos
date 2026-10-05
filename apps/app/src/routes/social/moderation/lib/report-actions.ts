/**
 * S16-SOCIAL-FE-3 (L2) — hành động kèm của `029` theo loại đích (KHUNG — hiện thực ở commit kế tiếp).
 */
import type { FeedReportActionDto, FeedTargetTypeDto } from "@mediaos/contracts";
import type { ResolveFeedReportBody } from "@mediaos/web-core";

export const NO_REPORT_ACTION = "none" satisfies FeedReportActionDto;

export const REPORT_ACTION_MATRIX: Record<FeedTargetTypeDto, readonly FeedReportActionDto[]> = {
  post: [],
  comment: [],
};

export type ReportDecision = ResolveFeedReportBody["status"];

export interface ResolveDraft {
  decision: ReportDecision;
  action: FeedReportActionDto;
  note: string;
  canManagePosts: boolean;
}

export interface ReportActionOption {
  action: FeedReportActionDto;
  labelKey: string;
}

export const REPORT_ACTION_LABEL_KEYS: Record<
  FeedTargetTypeDto,
  Partial<Record<FeedReportActionDto, string>>
> = { post: {}, comment: {} };

export const REPORT_DELETE_CONFIRM_KEYS: Record<FeedTargetTypeDto, string> = {
  post: "",
  comment: "",
};

export function reportActionOptions(_targetType: FeedTargetTypeDto): readonly ReportActionOption[] {
  return [];
}

export function reportActionNeedsConfirm(_action: FeedReportActionDto): boolean {
  return false;
}

export function buildResolveBody(_draft: ResolveDraft): ResolveFeedReportBody {
  return {} as ResolveFeedReportBody;
}
