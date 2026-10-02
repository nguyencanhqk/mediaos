/**
 * S16-SOCIAL-FE-1 — khung test dùng chung cho 5 màn `/feed*`.
 *
 * Tách ra vì cả 5 spec đều cần ĐÚNG một bộ: QueryClient không retry + i18n thật + Link/useSearch/
 * useParams giả. Để mỗi spec tự dựng là năm bản sao, và bốn trong số đó sẽ trôi khỏi bản còn lại.
 *
 * ⚠️ File này bị LOẠI khỏi phạm vi đo của `test:social-cov` (`vitest.social.config.ts`): nó là công
 * cụ test, không phải mã sản phẩm — tính nó vào mẫu số sẽ làm con số coverage nói về một thứ khác.
 * Tiền lệ: `src/components/chat/call/call-test-doubles.ts`.
 */
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { ApiError, useAuthStore } from "@mediaos/web-core";
import type {
  FeedBirthdayDto,
  FeedCommentDto,
  FeedGroupDto,
  FeedGroupMemberDto,
  FeedNewsItemDto,
  FeedPostDto,
} from "@mediaos/contracts";
import i18n from "@/i18n";

/** Đặt capabilities trên store THẬT — `useCan` đọc store qua `../stores/auth`, không qua barrel. */
export function setCaps(caps: Record<string, boolean>): void {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

export function resetCaps(): void {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

/**
 * `retry: false` là BẮT BUỘC ở test: mặc định react-query thử lại 3 lần, nên một ca kiểm trạng thái
 * LỖI sẽ chờ hết ba lượt backoff rồi mới đỏ — hoặc hết giờ trước đó và đỏ vì lý do khác.
 *
 * 🔴 `retryDelay: 0` KHÔNG thừa, và nó KHÔNG phải bản sao của dòng trên. `retry: false` ở đây chỉ là
 * **mặc định**, nên màn nào tự khai `retry` ở CẤP QUERY sẽ ĐÈ nó — `PostDetailPage` làm đúng thế để
 * bỏ retry riêng cho 404. Khi đó query vẫn thử lại thật với backoff **1s + 2s**, ca lỗi chạm trần 5s
 * của vitest và **đỏ vì HẾT GIỜ chứ không vì assert** — đọc y hệt một ca đỏ thật, nhưng dẫn người
 * sửa đi sai hướng hoàn toàn. `retryDelay` thì CHỈ đặt được ở cấp default, nên nó phải nằm ở đây.
 * Cùng họ [[mutant-red-must-match-expected-message]].
 */
export function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false, retryDelay: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

export const makePost = (over: Partial<FeedPostDto> = {}): FeedPostDto => ({
  id: "11111111-1111-4111-8111-111111111111",
  type: "share",
  audience: "company",
  orgUnitId: null,
  groupId: null,
  author: { employeeId: null, fullName: "An Nguyễn", avatarUrl: null },
  body: "nội dung bài",
  tags: [],
  attachments: [],
  pinned: false,
  commentsLocked: false,
  requiresAck: false,
  likeCount: 0,
  commentCount: 0,
  viewCount: 0,
  myReaction: null,
  savedByMe: false,
  isMine: false,
  editedAt: null,
  publishedAt: "2026-09-23T03:00:00.000Z",
  lastActivityAt: "2026-09-23T03:00:00.000Z",
  createdAt: "2026-09-23T03:00:00.000Z",
  ...over,
});

export const makeNews = (over: Partial<FeedNewsItemDto> = {}): FeedNewsItemDto => ({
  ...makePost({ type: "news" }),
  ackedByMe: false,
  ...over,
});

export const makeComment = (over: Partial<FeedCommentDto> = {}): FeedCommentDto => ({
  id: "c1",
  postId: "11111111-1111-4111-8111-111111111111",
  parentCommentId: null,
  author: { employeeId: null, fullName: "Bình", avatarUrl: null },
  body: "một bình luận",
  attachments: [],
  likeCount: 0,
  myReaction: null,
  isMine: false,
  editedAt: null,
  createdAt: "2026-09-23T03:00:00.000Z",
  ...over,
});

/** ĐÚNG 5 khoá theo SPEC-16 §3.5 — KHÔNG năm sinh, KHÔNG tuổi, KHÔNG userId. */
export const makeBirthday = (over: Partial<FeedBirthdayDto> = {}): FeedBirthdayDto => ({
  employeeId: "22222222-2222-4222-8222-222222222222",
  fullName: "An Nguyễn",
  avatar: null,
  day: 14,
  month: 3,
  ...over,
});

/** Trang keyset một trang, `nextCursor: null` = trang cuối. */
export const page = <T,>(data: T[]) => ({ data, nextCursor: null });

// ── S16-SOCIAL-FE-2B — nhóm. Hình dạng chép `toFeedGroupDto` / `toMemberDto` (social-groups.service.ts). ──

export const GROUP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export function makeGroup(over: Partial<FeedGroupDto> = {}): FeedGroupDto {
  return {
    id: GROUP_ID,
    name: "Bóng đá công ty",
    description: "Đá mỗi thứ 5",
    visibility: "public",
    memberCount: 3,
    myRole: null,
    myStatus: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

export function makeMember(over: Partial<FeedGroupMemberDto> = {}): FeedGroupMemberDto {
  return {
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    employeeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    fullName: "Trần Thị B",
    avatarUrl: null,
    role: "member",
    status: "active",
    joinedAt: "2026-09-02T00:00:00.000Z",
    ...over,
  };
}

/** Trang OFFSET `{data,page,limit,total}` của 030/037. */
export const offsetPage = <T,>(data: T[], total = data.length) => ({ data, page: 1, limit: 20, total });

/**
 * Lỗi ĐÚNG hình dạng trên dây của API MỚI (S16-SOCIAL-GROUPERR-1): `code` = `SOCIAL_ERROR_CODES[K]`,
 * `message` chép nguyên văn `social.errors.ts` (tiền tố giữ nguyên). Hình dạng API CŨ (mã chung + tiền tố)
 * được phủ riêng ở `groups/lib/group-errors.spec.ts` (nhánh LEGACY-PREFIX).
 */
export const GROUP_ERR = {
  lastOwner: () =>
    new ApiError(
      409,
      SOCIAL_ERROR_CODES.GROUP_LAST_OWNER,
      "SOCIAL-ERR-015: nhóm phải còn ít nhất một chủ nhóm đang hoạt động.",
    ),
  stateMismatch: () =>
    new ApiError(
      409,
      SOCIAL_ERROR_CODES.GROUP_MEMBER_STATE_MISMATCH,
      "SOCIAL-ERR-013: thao tác không khớp trạng thái của thành viên này (chờ duyệt cần duyệt/từ chối, đang hoạt động mới đổi được vai trò).",
    ),
  exists: () =>
    new ApiError(
      409,
      SOCIAL_ERROR_CODES.GROUP_MEMBERSHIP_EXISTS,
      "SOCIAL-ERR-013: bạn đã tham gia hoặc đã gửi yêu cầu vào nhóm này.",
    ),
  notFound: () =>
    new ApiError(404, SOCIAL_ERROR_CODES.GROUP_NOT_FOUND, "SOCIAL-ERR-012: không tìm thấy nhóm."),
  memberGone: () =>
    new ApiError(
      404,
      SOCIAL_ERROR_CODES.GROUP_MEMBER_NOT_FOUND,
      "SOCIAL-ERR: người này không phải thành viên của nhóm.",
    ),
  nameTaken: () =>
    new ApiError(
      409,
      SOCIAL_ERROR_CODES.GROUP_NAME_TAKEN,
      "SOCIAL-ERR: tên nhóm này đã được dùng trong công ty.",
    ),
  forbidden: () =>
    new ApiError(
      403,
      SOCIAL_ERROR_CODES.GROUP_ROLE_REQUIRED,
      "SOCIAL-ERR-014: bạn không có quyền thực hiện thao tác này trong nhóm.",
    ),
  server: () => new ApiError(500, "INTERNAL", "boom"),
};

/**
 * Hình dạng API CŨ (PROD chưa redeploy sau merge — owner ký O4): `code` là mã CHUNG theo status, mã SOCIAL
 * chỉ ở tiền tố `message`. Đây là thứ PROD phục vụ ĐẦU TIÊN sau khi FE lên ⇒ component spec phải có ít nhất
 * một ca chạy trên nó (FULL gate react L1). Gỡ cùng nhánh LEGACY-PREFIX (`S16-SOCIAL-GROUPERR-FEFALLBACK-1`).
 */
export const GROUP_ERR_LEGACY = {
  lastOwner: () =>
    new ApiError(409, "RESOURCE-ERR-CONFLICT", "SOCIAL-ERR-015: nhóm phải còn ít nhất một chủ nhóm đang hoạt động."),
};

/**
 * S16-SOCIAL-FEMODERRMSG-1 — lỗi của các đường ghi TRÊN BÀI (`005`/`006`/`008`/`009`/`011`/`012`), đúng
 * hình dạng trên dây. `message` chép nguyên văn `social.errors.ts`.
 *
 * `goneLegacy` = API CŨ (trước #554, PROD deploy API tay): `code` là mã CHUNG theo status, mã SOCIAL chỉ ở
 * tiền tố `message` — cùng khuôn `GROUP_ERR_LEGACY`.
 */
export const POST_ERR = {
  gone: () =>
    new ApiError(
      404,
      SOCIAL_ERROR_CODES.POST_NOT_FOUND,
      "SOCIAL-ERR-001: không tìm thấy bài viết.",
    ),
  goneLegacy: () =>
    new ApiError(404, "RESOURCE-ERR-NOT-FOUND", "SOCIAL-ERR-001: không tìm thấy bài viết."),
  fieldDenied: () =>
    new ApiError(
      403,
      SOCIAL_ERROR_CODES.MODERATION_FIELD_DENIED,
      "SOCIAL-ERR-010: bạn không có quyền thay đổi trường kiểm duyệt này.",
    ),
  server: () => new ApiError(500, "INTERNAL", "boom"),
};
