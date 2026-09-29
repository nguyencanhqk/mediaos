/**
 * S16-SOCIAL-FE-2B — tham số URL của `/feed/groups` và `/feed/groups/$groupId` (plan D5 + §8 H1).
 *
 * ┌─ 🔴 GIÁ TRỊ TỚI ĐÂY ĐÃ QUA `JSON.parse` ───────────────────────────────────────────────────────┐
 * │ Router dùng `defaultParseSearch = parseSearchWith(JSON.parse)` (router-core `searchParams.js`), │
 * │ nên `?invite=1` tới đây là SỐ `1`, `?q=2024` là SỐ `2024`, `?page=2` là SỐ `2`. Một bộ lọc chép │
 * │ khuôn «`typeof === "string"`» sẽ âm thầm BỎ cả ba ⇒ nút mời không bao giờ hiện, trong khi test │
 * │ đưa object tay `{invite:"1"}` vẫn xanh. Spec của file này ăn ĐẦU RA của parser thật.            │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mọi trường OPTIONAL, mặc định giải ở component (khuôn `FeedRouteSearch`): `validateSearch` bắt
 * buộc trường nào thì mọi `<Link to="/feed/groups">`/`navigate` đều phải truyền `search` hoặc đỏ
 * typecheck. KHÔNG bao giờ ném — URL sửa tay thì mất bộ lọc, không mất trang.
 */
import { FEED_GROUP_NAME_MAX } from "@mediaos/contracts";

/** Trần `page` của `listFeedGroupsQuerySchema` (`FEED_PAGE_MAX`) — vượt là 400 từ server. */
const PAGE_MAX = 10_000;

export type GroupsMembership = "all" | "mine";
export type GroupTab = "posts" | "members" | "requests" | "settings";

export interface GroupsRouteSearch {
  membership?: GroupsMembership;
  q?: string;
  page?: number;
}

export interface GroupDetailRouteSearch {
  tab?: GroupTab;
  invite?: true;
}

const GROUP_TABS: readonly GroupTab[] = ["posts", "members", "requests", "settings"];

/** Chuỗi, hoặc số (JSON.parse đã biến `?q=2024` thành số) đổi lại thành chuỗi; trim, rỗng ⇒ bỏ. */
function textParam(v: unknown, max: number): string | undefined {
  const s =
    typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  const t = s.trim();
  return t.length > 0 ? t.slice(0, max) : undefined;
}

function pageParam(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 2 && n <= PAGE_MAX ? n : undefined;
}

export function validateGroupsRouteSearch(raw: Record<string, unknown>): GroupsRouteSearch {
  const q = textParam(raw.q, FEED_GROUP_NAME_MAX);
  const page = pageParam(raw.page);
  return {
    ...(raw.membership === "mine" ? { membership: "mine" as const } : {}),
    ...(q ? { q } : {}),
    ...(page ? { page } : {}),
  };
}

export function validateGroupDetailRouteSearch(
  raw: Record<string, unknown>,
): GroupDetailRouteSearch {
  const tab = GROUP_TABS.find((t) => t === raw.tab);
  const invite = raw.invite === 1 || raw.invite === "1" || raw.invite === true;
  return {
    ...(tab && tab !== "posts" ? { tab } : {}),
    ...(invite ? { invite: true as const } : {}),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `$groupId` có phải UUID không. KHÔNG phải ⇒ màn 404 NGAY, không gọi API: `ParseUUIDPipe` của `032`
 * trả 400 chứ không 404, và `035` (nút mời) cũng 400 — hai thứ đó không được lọt thành màn lỗi lạ.
 */
export function isGroupId(v: string | undefined): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Link mời (owner ký O1). Nhóm kín thêm `?invite=1` để màn 404 trung tính hiện nút «Gửi yêu cầu tham
 * gia»; nhóm public chỉ cần đường dẫn trang nhóm (ai cũng mở được và tự bấm «Tham gia»).
 */
export function groupInviteUrl(
  origin: string,
  groupId: string,
  visibility: "public" | "private",
): string {
  const base = `${origin.replace(/\/+$/, "")}/feed/groups/${groupId}`;
  return visibility === "private" ? `${base}?invite=1` : base;
}
