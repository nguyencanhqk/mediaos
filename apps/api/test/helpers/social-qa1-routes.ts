import { randomUUID } from "node:crypto";
import type { SocialRouteKey } from "../../src/social/social-route-pairs.const";
import type { FeedPair, Json, Qa1Res, Qa1World } from "./social-qa1-kit";

/**
 * S16-SOCIAL-QA-1 (L1) — BẢNG 59 ROUTE SOCIAL + lời gọi theo bảng (plan `docs/plans/S16-SOCIAL-QA-1.md`
 * §4-L1, D2 · D3 · D5).
 *
 * ĐÓNG BĂNG sau L1: các lát sau KHÔNG sửa file này (kể cả thêm hàm). Bộ gieo «lát dữ liệu» nằm ở
 * `social-qa1-seed.ts` (cùng đóng băng).
 *
 * Bảng viết TAY từ tài liệu (`docs/API Design/API-19_SOCIAL_API_Design.md` §5.1 + Bảng 1 của plan):
 * file này chỉ `import type` từ sản phẩm — không đọc hằng nào của sản phẩm lúc chạy. Ca «neo» trong
 * `test/integration/s16-social-qa1-pair-matrix.int-spec.ts` mới là chỗ đối chiếu bảng tay với hằng
 * sản phẩm và với metadata của route đang chạy.
 *
 * File này KHÔNG tự dựng request: mọi lời gọi đi qua `Qa1Caller` (chính là `Qa1World` của kit), nên
 * request luôn tới app đang nghe do kit dựng.
 */

/** Tên hàm gọi của `Qa1World` ứng với từng HTTP method. */
export type Qa1Verb = "get" | "post" | "put" | "patch" | "del";
export type Qa1Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Phần của `Qa1World` mà `callQa1Route` cần — truyền thẳng `world` vào. */
export type Qa1Caller = Pick<Qa1World, Qa1Verb>;

/**
 * MỘT «lát dữ liệu»: đủ id cho một người gọi (`owner`) đi hết 59 route đúng MỘT lượt.
 * Dựng bằng `seedQa1Slice` (`social-qa1-seed.ts`). Mọi id thuộc công ty của `owner`.
 *
 * Ký hiệu: [O] = do `owner` dựng / sở hữu · [P] = do `privileged` dựng (thứ `owner` có thể không
 * được phép dựng) · «một-lượt» = ca cho phép chỉ đúng mã `ok` ở lần gọi ĐẦU trên lát này (xem
 * `QA1_ONE_SHOT_CODES`).
 */
export interface Qa1Slice {
  companyId: string;
  ownerUserId: string;
  /** `employee_profiles.id` của `owner` — 025. */
  ownerEmployeeId: string;
  privilegedUserId: string;
  privilegedEmployeeId: string;
  /** Từ riêng của lát, nằm trong thân `postId` — tham số `q` của 023. */
  marker: string;
  /** Thẻ riêng của lát (không dấu `#`), nằm trong thân `postId` — tham số `q` của 024. */
  tag: string;
  /** Tham số `q` của 059 (khớp đầu từ họ tên của mọi actor do kit dựng). */
  recipientQuery: string;

  /** [O] bài `share` / `company`, có `marker` + `#tag` — 003 · 004 · 007 · 008 · 011 · 013 · 014 · 015. */
  postId: string;
  /** [O] bài `share` mà `owner` ĐÃ lưu và ĐÃ thả cảm xúc — 009 · 012. */
  auxPostId: string;
  /** [O] bài `share` để xoá — 005 (một-lượt). */
  deletePostId: string;
  /** [O] bài `share` chưa ai báo cáo — đích của 027 (một-lượt: báo cáo lặp khi còn mở bị từ chối). */
  reportTargetPostId: string;
  /** [P] bài `share` / `company` để kiểm duyệt — 006 (thân `{ commentsLocked: true }`). */
  moderatePostId: string;
  /** [P] bài `share` ĐÃ xoá mềm (đang trong thùng rác) — 058 (một-lượt). */
  trashedPostId: string;

  /** [O] bình luận trên `postId` — 016 · 018. */
  commentId: string;
  /** [O] bình luận trên `postId` mà `owner` ĐÃ thả cảm xúc — 019. */
  reactedCommentId: string;
  /** [O] bình luận trên `postId` để xoá — 017 (một-lượt). */
  deleteCommentId: string;

  /** [P] tin `news` / `company` có `requiresAck: true`, `owner` CHƯA xác nhận — 021 · 022. */
  ackNewsPostId: string;
  /** [P] báo cáo ĐANG MỞ do `privileged` gửi về `postId` — 029 (một-lượt). */
  reportId: string;

  /** [O] nhóm KÍN, `owner` là chủ nhóm — 032 · 033 · 037 · 038. */
  groupId: string;
  /** `privileged.userId` — đang `pending` trong `groupId` — 038 (thân duyệt; một-lượt). */
  pendingUserId: string;
  /** [O] nhóm công khai, `privileged` là thành viên `active` — 039. */
  memberGroupId: string;
  /** `privileged.userId` — thành viên `active` của `memberGroupId` — 039 (một-lượt). */
  memberUserId: string;
  /** [O] nhóm công khai để xoá — 034 (một-lượt). */
  deleteGroupId: string;
  /** [P] nhóm công khai mà `owner` CHƯA tham gia — 035 (một-lượt). */
  joinGroupId: string;
  /** [P] nhóm công khai mà `owner` ĐÃ là thành viên `active` (không phải chủ) — 036 (một-lượt). */
  leaveGroupId: string;

  /** [O] bình chọn một-lựa-chọn đang mở, `owner` chưa bỏ phiếu — 041 · 043. */
  pollPostId: string;
  /** Lựa chọn đầu tiên của `pollPostId` — thân 041. */
  pollOptionId: string;
  /** [O] bình chọn đang mở mà `owner` ĐÃ bỏ phiếu — 042. */
  votedPollPostId: string;
  /** [O] bình chọn đang mở để đóng tay — 044 (một-lượt). */
  closePollPostId: string;
  /** [O] sáng kiến ở trạng thái `submitted` — 046 (thân chuyển sang `under_review`; một-lượt). */
  ideaPostId: string;

  /** [P] huy hiệu đang bật — 050. */
  badgeId: string;
  /** [P] huy hiệu đang bật để tắt — 051. */
  deleteBadgeId: string;
  /** [O] tệp đăng ký qua 054 (`target: "post"`), đã ở trạng thái `Uploaded` — 055. */
  uploadedFileId: string;
}

/** Tên các trường id của lát — cột «id theo thứ tự tham số đường dẫn» của bảng. */
type SliceIdField = {
  [K in keyof Qa1Slice]: Qa1Slice[K] extends string ? K : never;
}[keyof Qa1Slice];

/** Một dòng của bảng 59 route. */
export interface Qa1Route {
  /** Mã API-19: `"001"` … `"059"`. */
  code: string;
  /** Khoá của route trong bảng hằng sản phẩm (chỉ là KIỂU ở file này). */
  key: SocialRouteKey;
  /** Hàm gọi tương ứng của `Qa1World`. */
  verb: Qa1Verb;
  method: Qa1Method;
  /** Đường dẫn mẫu KHÔNG có tiền tố `/api/v1`, tham số dạng `:ten_tham_so`. */
  template: string;
  /** Tên tham số đường dẫn theo thứ tự xuất hiện trong `template`. */
  pathParams: readonly string[];
  /** Cặp quyền của TẦNG 1 (decorator) theo API-19 §5.1 — viết tay. */
  pair: FeedPair;
  /** Mã thành công CHÍNH XÁC: POST = 201 trừ 054 · 055 · 058 = 200; còn lại 200 (plan D2). */
  ok: 200 | 201;
  /** Đường dẫn gọi thật (đã điền id của lát, kèm query nếu route cần) — KHÔNG có `/api/v1`. */
  path(slice: Qa1Slice): string;
  /** Thân HỢP LỆ theo schema của route; vắng = route không nhận thân. */
  body?(slice: Qa1Slice): Json;
}

type Row = readonly [
  code: string,
  key: SocialRouteKey,
  verb: Qa1Verb,
  template: string,
  pair: FeedPair,
  ok: 200 | 201,
  ids?: readonly SliceIdField[],
];

// ── Bảng tay: mã · khoá · method · đường dẫn · cặp tầng 1 · mã thành công · id của lát ──
const TABLE: readonly Row[] = [
  // Bảng tin & bài
  ["001", "feedList", "get", "/social/feed", "view:feed", 200],
  ["002", "postCreate", "post", "/social/posts", "create:feed-post", 201],
  ["003", "postDetail", "get", "/social/posts/:post_id", "view:feed", 200, ["postId"]],
  ["004", "postUpdate", "patch", "/social/posts/:post_id", "view:feed", 200, ["postId"]],
  ["005", "postDelete", "del", "/social/posts/:post_id", "view:feed", 200, ["deletePostId"]],
  [
    "006",
    "postModerate",
    "patch",
    "/social/posts/:post_id/moderation",
    "manage:feed-post",
    200,
    ["moderatePostId"],
  ],
  ["007", "postView", "post", "/social/posts/:post_id/view", "view:feed", 201, ["postId"]],
  ["008", "postSave", "post", "/social/posts/:post_id/save", "view:feed", 201, ["postId"]],
  ["009", "postUnsave", "del", "/social/posts/:post_id/save", "view:feed", 200, ["auxPostId"]],
  ["010", "savedList", "get", "/social/saved", "view:feed", 200],
  [
    "011",
    "postReactionPut",
    "put",
    "/social/posts/:post_id/reaction",
    "view:feed",
    200,
    ["postId"],
  ],
  [
    "012",
    "postReactionDelete",
    "del",
    "/social/posts/:post_id/reaction",
    "view:feed",
    200,
    ["auxPostId"],
  ],
  [
    "013",
    "postReactionList",
    "get",
    "/social/posts/:post_id/reactions",
    "view:feed",
    200,
    ["postId"],
  ],
  // Bình luận
  ["014", "commentList", "get", "/social/posts/:post_id/comments", "view:feed", 200, ["postId"]],
  [
    "015",
    "commentCreate",
    "post",
    "/social/posts/:post_id/comments",
    "create:feed-comment",
    201,
    ["postId"],
  ],
  [
    "016",
    "commentUpdate",
    "patch",
    "/social/comments/:comment_id",
    "view:feed",
    200,
    ["commentId"],
  ],
  [
    "017",
    "commentDelete",
    "del",
    "/social/comments/:comment_id",
    "view:feed",
    200,
    ["deleteCommentId"],
  ],
  [
    "018",
    "commentReactionPut",
    "put",
    "/social/comments/:comment_id/reaction",
    "view:feed",
    200,
    ["commentId"],
  ],
  [
    "019",
    "commentReactionDelete",
    "del",
    "/social/comments/:comment_id/reaction",
    "view:feed",
    200,
    ["reactedCommentId"],
  ],
  // Tin tức
  ["020", "newsList", "get", "/social/news", "view:feed", 200],
  ["021", "postAck", "post", "/social/posts/:post_id/ack", "view:feed", 201, ["ackNewsPostId"]],
  [
    "022",
    "postAcksList",
    "get",
    "/social/posts/:post_id/acks",
    "manage:feed-news",
    200,
    ["ackNewsPostId"],
  ],
  // Tìm kiếm · thẻ · trang cá nhân · sinh nhật
  ["023", "search", "get", "/social/search", "view:feed", 200],
  ["024", "tagsList", "get", "/social/tags", "view:feed", 200],
  [
    "025",
    "profilePosts",
    "get",
    "/social/profiles/:employee_id/posts",
    "view:feed",
    200,
    ["ownerEmployeeId"],
  ],
  ["026", "birthdays", "get", "/social/birthdays", "view:feed", 200],
  // Báo cáo vi phạm
  ["027", "reportCreate", "post", "/social/reports", "view:feed", 201],
  ["028", "reportsList", "get", "/social/reports", "view:feed-report", 200],
  [
    "029",
    "reportResolve",
    "patch",
    "/social/reports/:report_id",
    "manage:feed-report",
    200,
    ["reportId"],
  ],
  // Nhóm
  ["030", "groupsList", "get", "/social/groups", "view:feed", 200],
  ["031", "groupCreate", "post", "/social/groups", "create:feed-group", 201],
  ["032", "groupGet", "get", "/social/groups/:group_id", "view:feed", 200, ["groupId"]],
  ["033", "groupUpdate", "patch", "/social/groups/:group_id", "view:feed", 200, ["groupId"]],
  ["034", "groupDelete", "del", "/social/groups/:group_id", "view:feed", 200, ["deleteGroupId"]],
  ["035", "groupJoin", "post", "/social/groups/:group_id/join", "view:feed", 201, ["joinGroupId"]],
  [
    "036",
    "groupLeave",
    "post",
    "/social/groups/:group_id/leave",
    "view:feed",
    201,
    ["leaveGroupId"],
  ],
  [
    "037",
    "groupMembersList",
    "get",
    "/social/groups/:group_id/members",
    "view:feed",
    200,
    ["groupId"],
  ],
  [
    "038",
    "groupMemberDecide",
    "patch",
    "/social/groups/:group_id/members/:user_id",
    "view:feed",
    200,
    ["groupId", "pendingUserId"],
  ],
  [
    "039",
    "groupMemberRemove",
    "del",
    "/social/groups/:group_id/members/:user_id",
    "view:feed",
    200,
    ["memberGroupId", "memberUserId"],
  ],
  // Bình chọn
  ["040", "pollList", "get", "/social/polls", "view:feed", 200],
  ["041", "pollVote", "put", "/social/posts/:post_id/poll/vote", "view:feed", 200, ["pollPostId"]],
  [
    "042",
    "pollVoteWithdraw",
    "del",
    "/social/posts/:post_id/poll/vote",
    "view:feed",
    200,
    ["votedPollPostId"],
  ],
  [
    "043",
    "pollResults",
    "get",
    "/social/posts/:post_id/poll/results",
    "view:feed",
    200,
    ["pollPostId"],
  ],
  [
    "044",
    "pollClose",
    "post",
    "/social/posts/:post_id/poll/close",
    "view:feed",
    201,
    ["closePollPostId"],
  ],
  // Sáng kiến · vinh danh · huy hiệu
  ["045", "ideaList", "get", "/social/ideas", "view:feed", 200],
  [
    "046",
    "ideaReview",
    "patch",
    "/social/posts/:post_id/idea/review",
    "approve:feed-idea",
    200,
    ["ideaPostId"],
  ],
  ["047", "kudosList", "get", "/social/kudos", "view:feed", 200],
  ["048", "kudosBadgeList", "get", "/social/kudos-badges", "view:feed", 200],
  ["049", "kudosBadgeCreate", "post", "/social/kudos-badges", "manage:feed-kudos", 201],
  [
    "050",
    "kudosBadgeUpdate",
    "patch",
    "/social/kudos-badges/:badge_id",
    "manage:feed-kudos",
    200,
    ["badgeId"],
  ],
  [
    "051",
    "kudosBadgeDelete",
    "del",
    "/social/kudos-badges/:badge_id",
    "manage:feed-kudos",
    200,
    ["deleteBadgeId"],
  ],
  // Thống kê
  ["052", "statsEngagement", "get", "/social/stats/engagement", "view:feed-report", 200],
  ["053", "statsExport", "get", "/social/stats/engagement/export", "view:feed-report", 200],
  // Cửa đăng ký tệp
  ["054", "fileUploadUrl", "post", "/social/files/upload-url", "view:feed", 200],
  ["055", "fileConfirm", "post", "/social/files/:id/confirm", "view:feed", 200, ["uploadedFileId"]],
  // Quản trị huy hiệu · thùng rác · danh bạ người nhận
  ["056", "kudosBadgeAdminList", "get", "/social/kudos-badges/manage", "manage:feed-kudos", 200],
  ["057", "recycleFeedPostList", "get", "/recycle-bin/feed-posts", "restore:feed-post", 200],
  [
    "058",
    "recycleFeedPostRestore",
    "post",
    "/recycle-bin/feed-posts/:post_id/restore",
    "restore:feed-post",
    200,
    ["trashedPostId"],
  ],
  ["059", "kudosRecipientSearch", "get", "/social/kudos/recipients", "create:feed-kudos", 200],
];

const fresh = (n = 10): string => randomUUID().replace(/-/g, "").slice(0, n);

/** Query của route đọc cần tham số bắt buộc (hoặc cần lọc về đúng dữ liệu của lát). */
const QUERIES: Readonly<Partial<Record<string, (s: Qa1Slice) => string>>> = {
  "023": (s) => `q=${encodeURIComponent(s.marker)}`,
  "024": (s) => `q=${encodeURIComponent(s.tag)}`,
  "059": (s) => `q=${encodeURIComponent(s.recipientQuery)}`,
};

/** Thân hợp lệ của từng route nhận thân. Giá trị phải duy nhất (tên nhóm, mã huy hiệu) sinh MỚI mỗi lần gọi. */
const BODIES: Readonly<Partial<Record<string, (s: Qa1Slice) => Json>>> = {
  "002": () => ({ type: "share", audience: "company", body: `Bài của ma trận ${fresh()}` }),
  "004": () => ({ body: `Bài đã sửa ${fresh()}` }),
  "006": () => ({ commentsLocked: true }),
  "011": () => ({ emoji: "like" }),
  "015": () => ({ body: `Bình luận của ma trận ${fresh()}` }),
  "016": () => ({ body: `Bình luận đã sửa ${fresh()}` }),
  "018": () => ({ emoji: "like" }),
  "027": (s) => ({ targetType: "post", targetId: s.reportTargetPostId, reason: "spam" }),
  "029": () => ({ status: "resolved" }),
  "031": () => ({ name: `Nhóm ma trận ${fresh()}`, visibility: "public" }),
  "033": () => ({ description: `Mô tả ${fresh()}` }),
  "038": () => ({ decision: "approve" }),
  "041": (s) => ({ optionIds: [s.pollOptionId] }),
  "046": () => ({ status: "under_review" }),
  "049": () => ({ code: `qa1-${fresh(12)}`, name: `Huy hiệu ${fresh(6)}` }),
  "050": () => ({ name: `Huy hiệu đã sửa ${fresh(6)}` }),
  "054": () => ({ ...QA1_FILE_UPLOAD_BODY }),
  "055": () => ({ target: "post" }),
};

/** Thân của 054 (đăng ký tệp cho BÀI) — bộ gieo dùng lại đúng thân này để dựng `uploadedFileId`. */
export const QA1_FILE_UPLOAD_BODY = {
  target: "post",
  originalName: "anh-ma-tran.png",
  declaredMimeType: "image/png",
  sizeBytes: 2048,
} as const;

const METHOD_OF: Readonly<Record<Qa1Verb, Qa1Method>> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  del: "DELETE",
};

const PARAM_RE = /:([a-z_]+)/g;

function buildRoute([code, key, verb, template, pair, ok, ids = []]: Row): Qa1Route {
  const pathParams = [...template.matchAll(PARAM_RE)].map((m) => m[1]);
  if (pathParams.length !== ids.length) {
    throw new Error(
      `[social-qa1-routes] ${code}: ${pathParams.length} tham số đường dẫn nhưng ${ids.length} id của lát`,
    );
  }
  const query = QUERIES[code];
  const body = BODIES[code];
  return {
    code,
    key,
    verb,
    method: METHOD_OF[verb],
    template,
    pathParams,
    pair,
    ok,
    path: (slice) => {
      let i = 0;
      const filled = template.replace(PARAM_RE, () => {
        const value = slice[ids[i++]];
        if (typeof value !== "string" || value.length === 0) {
          throw new Error(`[social-qa1-routes] ${code}: lát thiếu ${String(ids[i - 1])}`);
        }
        return value;
      });
      return query ? `${filled}?${query(slice)}` : filled;
    },
    ...(body ? { body } : {}),
  };
}

/**
 * 59 route SOCIAL theo thứ tự mã API-19 (57 dưới `/social`, 2 dưới `/recycle-bin/feed-posts`).
 * Mỗi dòng: xem `Qa1Route`. Gọi qua `callQa1Route`.
 */
export const QA1_ROUTES: readonly Qa1Route[] = TABLE.map(buildRoute);

/**
 * Mã các route «một-lượt»: trên CÙNG một lát, chỉ lần gọi cho phép ĐẦU TIÊN trả đúng `ok` (lần sau
 * đối tượng đã bị tiêu: đã xoá · đã duyệt · đã xử lý · đã tham gia / rời · đã đóng · đã khôi phục).
 * Mỗi người được CHO PHÉP cần một lát riêng; lời gọi bị từ chối ở tầng quyền thì không tiêu gì.
 */
export const QA1_ONE_SHOT_CODES: readonly string[] = [
  "005",
  "017",
  "027",
  "029",
  "034",
  "035",
  "036",
  "038",
  "039",
  "044",
  "046",
  "058",
];

/** Dòng của bảng theo mã (`"001"` … `"059"`); mã lạ ⇒ ném. */
export function qa1Route(code: string): Qa1Route {
  const route = QA1_ROUTES.find((r) => r.code === code);
  if (!route) throw new Error(`[social-qa1-routes] không có route mã ${code}`);
  return route;
}

/**
 * Gọi MỘT route của bảng với id của `slice`.
 *
 * @param caller `Qa1World` của kit (chỉ dùng `get/post/put/patch/del`).
 * @param token  access token; `null` ⇒ không gửi `Authorization` (ca 401).
 * @returns `{ status, body }` — KHÔNG tự assert; ca gọi tự kiểm mã (`route.ok` hoặc hàm expect của kit).
 * Bẫy: `slice` có thể là lát của công ty KHÁC với `token` (ca chéo công ty) — hàm không kiểm điều đó.
 */
export async function callQa1Route(
  caller: Qa1Caller,
  route: Qa1Route,
  slice: Qa1Slice,
  token: string | null,
): Promise<Qa1Res> {
  const req = caller[route.verb](token, route.path(slice));
  const res = await (route.body ? req.send(route.body(slice)) : req);
  return { status: res.status, body: res.body as Qa1Res["body"] };
}
