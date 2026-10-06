/** S16-SOCIAL-FE-3B (L5a) — KHUNG cho lượt RED: mọi hàm trả giá trị rỗng đúng kiểu, chưa có luật nào. */
import type { FeedEngagementResponseDto, FeedEngagementWeekDto } from "@mediaos/contracts";

export interface EngagementTotals {
  posts: number;
  comments: number;
  reactions: number;
}

export type UnitTotalKind = "unit" | "unassigned" | "unknown";

export interface UnitTotalRow extends EngagementTotals {
  key: string;
  kind: UnitTotalKind;
  name: string | null;
  isDeleted: boolean;
}

export function sumWeekTotals(_weekTotals: readonly FeedEngagementWeekDto[]): EngagementTotals {
  return { posts: 0, comments: 0, reactions: 0 };
}

export function latestWeek(
  _weekTotals: readonly FeedEngagementWeekDto[],
): FeedEngagementWeekDto | null {
  return null;
}

export function weekInteractions(_week: EngagementTotals): number {
  return 0;
}

export function unitTotals(
  _data: Pick<FeedEngagementResponseDto, "units" | "rows">,
  _onlyOrgUnitId?: string,
): UnitTotalRow[] {
  return [];
}

export function isEngagementEmpty(
  _data: Pick<FeedEngagementResponseDto, "units" | "rows">,
): boolean {
  return false;
}

export function formatCount(_value: number): string {
  return "";
}
