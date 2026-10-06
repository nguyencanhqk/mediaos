/**
 * S16-SOCIAL-FE-3B (L4) — NHÁP của form huy hiệu và phép dựng body cho 049 (tạo) / 050 (sửa). Hàm thuần:
 * hộp thoại chỉ giữ nháp (chuỗi của các ô) và làm theo kết quả `BadgeSubmission` — không tự dựng body.
 *
 * ┌─ BA LUẬT ──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ 1. 050 CHỈ mang trường ĐÃ ĐỔI và KHÔNG BAO GIỜ mang `code` (bất biến; body `.strict()` ⇒ gửi là 400). │
 * │    «Đã đổi» = khác với nháp dựng từ CHÍNH huy hiệu đó sau khi chuẩn hoá (cắt khoảng trắng) — so nháp │
 * │    với nháp, không so nháp với DTO: huy hiệu cũ mang giá trị mà form không biểu diễn được y nguyên   │
 * │    vẫn ra «không đổi». Không đổi gì ⇒ `unchanged`, không có body để gửi.                             │
 * │ 2. Trần / khuôn của từng trường KHÔNG chép ở đây: body đi qua CHÍNH schema contracts, lỗi ánh xạ về  │
 * │    ô theo `path` của issue. Ô nào sai được trả theo thứ tự `BADGE_FIELDS` (ô sai đầu tiên nhận focus).│
 * │ 3. Icon là MỘT trường của server nhưng HAI ô ở form: ô chọn tên icon trong danh mục và ô emoji. Ô    │
 * │    emoji có chữ thì THẮNG. Giá trị cũ không thuộc danh mục (emoji, tên lạ, chữ hoa) nằm NGUYÊN VĂN ở │
 * │    ô emoji — form không tự «sửa hộ» thành một giá trị khác rồi gửi đi như thể người dùng đã đổi.     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import {
  createKudosBadgeSchema,
  updateKudosBadgeSchema,
  type CreateKudosBadgeDto,
  type KudosBadgeAdminDto,
  type UpdateKudosBadgeDto,
} from "@mediaos/contracts";
import { KUDOS_BADGE_ICON_NAMES } from "../../kudos/components/KudosBadgeIcon";

/** Các Ô có thể mang lỗi, theo thứ tự vẽ. `icon` = cặp ô chọn + ô emoji (lỗi gắn ở ô emoji). */
export const BADGE_FIELDS = ["code", "name", "description", "icon", "position"] as const;
export type BadgeField = (typeof BADGE_FIELDS)[number];

/** Giá trị THÔ của các ô — mọi thứ là chuỗi, kể cả thứ tự (ô chữ, để «x» / rỗng là lỗi chứ không phải 0). */
export interface BadgeDraft {
  code: string;
  name: string;
  description: string;
  /** Giá trị ô chọn: một tên của `KUDOS_BADGE_ICON_NAMES`, hoặc rỗng = không chọn. */
  iconName: string;
  emoji: string;
  position: string;
}

export type BadgeSubmission<TBody> =
  | { kind: "ready"; body: TBody }
  /** Chỉ ở chế độ sửa: không trường nào khác với lúc mở. */
  | { kind: "unchanged" }
  /** `fields` rỗng = body hỏng mà không quy được về ô nào (không xảy ra với schema hiện tại). */
  | { kind: "invalid"; fields: readonly BadgeField[] };

const DEFAULT_POSITION = "0";
const UNSIGNED_INTEGER = /^\d+$/;

export function emptyBadgeDraft(): BadgeDraft {
  return {
    code: "",
    name: "",
    description: "",
    iconName: "",
    emoji: "",
    position: DEFAULT_POSITION,
  };
}

export function draftFromBadge(badge: KudosBadgeAdminDto): BadgeDraft {
  const icon = badge.icon ?? "";
  const isCatalogIcon = KUDOS_BADGE_ICON_NAMES.includes(icon);
  return {
    code: badge.code,
    name: badge.name,
    description: badge.description ?? "",
    iconName: isCatalogIcon ? icon : "",
    emoji: isCatalogIcon ? "" : icon,
    position: String(badge.position),
  };
}

/** Icon mà nháp đang biểu diễn — cũng là thứ ô xem trước vẽ. `null` = không có icon. */
export function draftIcon(draft: BadgeDraft): string | null {
  const emoji = draft.emoji.trim();
  if (emoji !== "") return emoji;
  return draft.iconName === "" ? null : draft.iconName;
}

/** Các trường server của nháp, đã chuẩn hoá. `position` là `NaN` khi ô không phải số nguyên không dấu. */
interface NormalizedBadge {
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
}

function normalize(draft: BadgeDraft): NormalizedBadge {
  const description = draft.description.trim();
  const position = draft.position.trim();
  return {
    name: draft.name.trim(),
    description: description === "" ? null : description,
    icon: draftIcon(draft),
    position: UNSIGNED_INTEGER.test(position) ? Number(position) : Number.NaN,
  };
}

function isBadgeField(value: unknown): value is BadgeField {
  return BADGE_FIELDS.some((field) => field === value);
}

/** Các ô mà issue của schema chỉ tới, không lặp, theo thứ tự `BADGE_FIELDS`. */
function invalidFields(paths: readonly (readonly (string | number)[])[]): readonly BadgeField[] {
  const hit = new Set(paths.map((path) => path[0]).filter(isBadgeField));
  return BADGE_FIELDS.filter((field) => hit.has(field));
}

/**
 * Body 049. `description` / `icon` rỗng ⇒ VẮNG khoá (server coi vắng = không có). Gửi `body` tự dựng, không
 * gửi đầu ra của `parse`: hai thứ bằng nhau (nháp đã cắt khoảng trắng), và body tự dựng là thứ ca test ghim.
 */
export function buildCreateBadgeBody(draft: BadgeDraft): BadgeSubmission<CreateKudosBadgeDto> {
  const { name, description, icon, position } = normalize(draft);
  const body: CreateKudosBadgeDto = {
    code: draft.code.trim(),
    name,
    ...(description === null ? {} : { description }),
    ...(icon === null ? {} : { icon }),
    position,
  };
  const parsed = createKudosBadgeSchema.safeParse(body);
  if (parsed.success) return { kind: "ready", body };
  return { kind: "invalid", fields: invalidFields(parsed.error.issues.map((issue) => issue.path)) };
}

/**
 * Body 050 — chỉ trường khác với nháp dựng từ `badge` (luật 1). Xoá trắng mô tả / bỏ icon ⇒ `null` TƯỜNG
 * MINH (vắng khoá nghĩa là «giữ nguyên»). `draft.code` bị BỎ QUA.
 */
export function buildUpdateBadgeBody(
  badge: KudosBadgeAdminDto,
  draft: BadgeDraft,
): BadgeSubmission<UpdateKudosBadgeDto> {
  const before = normalize(draftFromBadge(badge));
  const after = normalize(draft);
  const body: UpdateKudosBadgeDto = {
    ...(after.name === before.name ? {} : { name: after.name }),
    ...(after.description === before.description ? {} : { description: after.description }),
    ...(after.icon === before.icon ? {} : { icon: after.icon }),
    ...(Object.is(after.position, before.position) ? {} : { position: after.position }),
  };
  if (Object.keys(body).length === 0) return { kind: "unchanged" };
  const parsed = updateKudosBadgeSchema.safeParse(body);
  if (parsed.success) return { kind: "ready", body };
  return { kind: "invalid", fields: invalidFields(parsed.error.issues.map((issue) => issue.path)) };
}
