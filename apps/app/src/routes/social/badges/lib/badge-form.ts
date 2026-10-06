/**
 * S16-SOCIAL-FE-3B (L4) — KHUNG (lượt RED): nháp + body của form huy hiệu. Thân thật ở commit GREEN.
 */
import type {
  CreateKudosBadgeDto,
  KudosBadgeAdminDto,
  UpdateKudosBadgeDto,
} from "@mediaos/contracts";

export const BADGE_FIELDS = ["code", "name", "description", "icon", "position"] as const;
export type BadgeField = (typeof BADGE_FIELDS)[number];

export interface BadgeDraft {
  code: string;
  name: string;
  description: string;
  iconName: string;
  emoji: string;
  position: string;
}

export type BadgeSubmission<TBody> =
  | { kind: "ready"; body: TBody }
  | { kind: "unchanged" }
  | { kind: "invalid"; fields: readonly BadgeField[] };

const EMPTY_DRAFT: BadgeDraft = {
  code: "",
  name: "",
  description: "",
  iconName: "",
  emoji: "",
  position: "",
};

export function emptyBadgeDraft(): BadgeDraft {
  return EMPTY_DRAFT;
}

export function draftFromBadge(_badge: KudosBadgeAdminDto): BadgeDraft {
  return EMPTY_DRAFT;
}

export function draftIcon(_draft: BadgeDraft): string | null {
  return null;
}

export function buildCreateBadgeBody(_draft: BadgeDraft): BadgeSubmission<CreateKudosBadgeDto> {
  return { kind: "invalid", fields: [] };
}

export function buildUpdateBadgeBody(
  _badge: KudosBadgeAdminDto,
  _draft: BadgeDraft,
): BadgeSubmission<UpdateKudosBadgeDto> {
  return { kind: "invalid", fields: [] };
}
