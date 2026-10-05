/**
 * S16-SOCIAL-FE-3 — fixture dùng chung cho spec của cụm quản trị bảng tin (Kiểm duyệt · Báo cáo; PR sau:
 * Thống kê · Huy hiệu). Khung render/`setCaps` vẫn lấy ở `feed/social-test-doubles.tsx` — file này KHÔNG
 * lặp lại chúng.
 *
 * ⚠️ CHỈ chứa factory/fixture — không logic sản phẩm. File được loại khỏi mẫu số coverage ở
 * `vitest.social.config.ts` (plan D19) đúng vì lý do đó; thêm mã sản phẩm vào đây là giấu nó khỏi cổng.
 *
 * Dữ liệu mặc định của MỖI factory đi qua chính schema contracts (`admin-test-doubles.spec.ts`): fixture
 * lệch hợp đồng làm mọi spec màn xanh trên một hình dạng server không bao giờ trả.
 */
import { useSyncExternalStore } from "react";
import { IDEMPOTENCY_ERROR_CODES, SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import type {
  FeedEngagementResponseDto,
  FeedReportDto,
  FeedReportPageDto,
  KudosBadgeAdminDto,
} from "@mediaos/contracts";

export const REPORT_ID = "66666666-6666-4666-8666-666666666666";
export const REPORTED_POST_ID = "11111111-1111-4111-8111-111111111111";
export const REPORTER_EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
export const AUTHOR_EMPLOYEE_ID = "44444444-4444-4444-8444-444444444444";
export const UNIT_ID = "77777777-7777-4777-8777-777777777777";
export const DELETED_UNIT_ID = "88888888-8888-4888-8888-888888888888";
export const BADGE_ID = "55555555-5555-4555-8555-555555555555";

const ISO = "2026-10-01T02:03:04.000Z";

/**
 * Báo cáo ĐANG MỞ về một BÀI, đọc ở phạm vi Company (thấy người báo cáo).
 *
 * 🔴 `avatarUrl` mang URL KHÁC rỗng có chủ ý: bề mặt FE-3 không được vẽ `<img>` từ trường này (plan D8),
 * và ca «không có `<img>`» chỉ có răng khi fixture THẬT SỰ mang URL (plan B7).
 *
 * Báo cáo BÌNH LUẬN: ghi đè `targetType`/`targetId`, GIỮ `targetSnapshot.postId` — snapshot mang bài
 * CHA chứ không phải bình luận (plan M2b). Bị che theo scope: `reporter: null`.
 */
export const makeReport = (over: Partial<FeedReportDto> = {}): FeedReportDto => ({
  id: REPORT_ID,
  targetType: "post",
  targetId: REPORTED_POST_ID,
  targetSnapshot: {
    postId: REPORTED_POST_ID,
    authorEmployeeId: AUTHOR_EMPLOYEE_ID,
    authorFullName: "Trần Thị Bình",
    avatarUrl: "https://cdn.example.test/avatars/author.png",
    bodyExcerpt: "Nội dung bài viết bị báo cáo",
    status: "published",
    deletedAt: null,
  },
  reporter: {
    employeeId: REPORTER_EMPLOYEE_ID,
    fullName: "Nguyễn Văn An",
    avatarUrl: "https://cdn.example.test/avatars/reporter.png",
  },
  reason: "spam",
  note: "Đăng lặp lại nhiều lần trong ngày",
  status: "open",
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  createdAt: ISO,
  updatedAt: ISO,
  ...over,
});

/** Trang 028 (`{data,page,limit,total}`); `total` mặc định = số hàng ⇒ một trang, không có bộ chuyển trang. */
export const makeReportPage = (
  data: FeedReportDto[],
  over: Partial<Omit<FeedReportPageDto, "data">> = {},
): FeedReportPageDto => ({ data, page: 1, limit: 20, total: data.length, ...over });

/**
 * Search của route GIẢ nhưng CÓ PHẢN ỨNG: `navigate({ search })` đổi giá trị và màn đang đọc
 * `useRouteSearchDouble()` vẽ lại — như router thật. Spec của màn nối nó vào mock `@tanstack/react-router`
 * (`useSearch` → `useRouteSearchDouble`, `useNavigate` → hàm gọi `routeSearchDouble.navigate`).
 *
 * Nhờ vậy ca «đổi bộ lọc ⇒ gọi lại với trang 1» đo được HẾT vòng (bấm → navigate → search mới → tham số
 * gửi đi), không dừng ở «navigate được gọi với gì». Nhớ `routeSearchDouble.reset()` giữa các ca.
 */
type RouteSearchValue = Record<string, unknown>;
let routeSearchValue: RouteSearchValue = {};
const routeSearchListeners = new Set<() => void>();
const subscribeRouteSearch = (listener: () => void): (() => void) => {
  routeSearchListeners.add(listener);
  return () => {
    routeSearchListeners.delete(listener);
  };
};
const readRouteSearch = (): RouteSearchValue => routeSearchValue;

export const routeSearchDouble = {
  get: readRouteSearch,
  set(next: RouteSearchValue): void {
    routeSearchValue = next;
    routeSearchListeners.forEach((listener) => listener());
  },
  /** Thế chỗ hàm `navigate` của router: chỉ áp `search` (object), bỏ qua `to`. */
  navigate(options: { search?: unknown }): void {
    const next = options.search;
    routeSearchDouble.set(typeof next === "object" && next !== null ? { ...next } : {});
  },
  reset(): void {
    routeSearchDouble.set({});
  },
};

export function useRouteSearchDouble(): RouteSearchValue {
  return useSyncExternalStore(subscribeRouteSearch, readRouteSearch);
}

/**
 * Thống kê 2 tuần, 2 đơn vị (một đã xoá) + một hàng «chưa gán đơn vị» (`orgUnitId: null`). `rows` THƯA
 * có chủ ý (không phải tuần × đơn vị nào cũng có hàng) — server chỉ trả ô có hoạt động.
 */
export const makeEngagement = (
  over: Partial<FeedEngagementResponseDto> = {},
): FeedEngagementResponseDto => ({
  range: { from: "2026-09-21", to: "2026-10-04", weeks: 2 },
  units: [
    { orgUnitId: UNIT_ID, name: "Phòng Kỹ thuật", isDeleted: false },
    { orgUnitId: DELETED_UNIT_ID, name: "Phòng Dự án cũ", isDeleted: true },
  ],
  rows: [
    {
      weekStart: "2026-09-21",
      orgUnitId: UNIT_ID,
      posts: 2,
      comments: 4,
      reactions: 7,
      activeMembers: 3,
    },
    {
      weekStart: "2026-09-28",
      orgUnitId: UNIT_ID,
      posts: 3,
      comments: 5,
      reactions: 9,
      activeMembers: 4,
    },
    {
      weekStart: "2026-09-28",
      orgUnitId: DELETED_UNIT_ID,
      posts: 1,
      comments: 0,
      reactions: 1,
      activeMembers: 1,
    },
    {
      weekStart: "2026-09-28",
      orgUnitId: null,
      posts: 1,
      comments: 1,
      reactions: 2,
      activeMembers: 1,
    },
  ],
  weekTotals: [
    { weekStart: "2026-09-21", posts: 2, comments: 4, reactions: 7, activeMembers: 3 },
    { weekStart: "2026-09-28", posts: 5, comments: 6, reactions: 12, activeMembers: 5 },
  ],
  ...over,
});

/** Huy hiệu ở góc nhìn quản trị (056/049/050/051) — mặc định ĐANG BẬT. */
export const makeBadgeAdmin = (over: Partial<KudosBadgeAdminDto> = {}): KudosBadgeAdminDto => ({
  id: BADGE_ID,
  code: "team-player",
  name: "Đồng đội",
  description: "Luôn hỗ trợ đồng nghiệp",
  icon: "users-round",
  position: 1,
  isActive: true,
  createdAt: ISO,
  updatedAt: ISO,
  ...over,
});

const C = SOCIAL_ERROR_CODES;

/**
 * Lỗi ĐÚNG hình dạng trên dây của các lời gọi PR-A (029 · 006 · 001/028 · 027): `code` lấy từ
 * `SOCIAL_ERROR_CODES`/`IDEMPOTENCY_ERROR_CODES`, `message` chép nguyên văn `social.errors.ts`. Mỗi lần
 * gọi trả MỘT instance mới (khuôn `GROUP_ERR`).
 *
 * `message` cố ý là chữ của SERVER: ca «không lộ thông điệp server» assert chuỗi này KHÔNG có trên màn.
 */
export const ADMIN_ERR = {
  reportAlreadyDecided: () =>
    new ApiError(409, C.REPORT_ALREADY_DECIDED, "SOCIAL-ERR-021: báo cáo này đã được xử lý."),
  reportBusy: () =>
    new ApiError(
      409,
      C.REPORT_BUSY,
      "SOCIAL-ERR: báo cáo này đang được người khác xử lý, vui lòng thử lại.",
    ),
  reportActionDenied: () =>
    new ApiError(
      403,
      C.REPORT_ACTION_DENIED,
      "SOCIAL-ERR: bạn không có quyền thực hiện hành động kiểm duyệt này.",
    ),
  reportActionInvalid: () =>
    new ApiError(
      422,
      C.REPORT_ACTION_INVALID_FOR_TARGET,
      "SOCIAL-ERR: hành động này không áp dụng được cho loại nội dung bị báo cáo.",
    ),
  reportTargetUnavailable: () =>
    new ApiError(
      422,
      C.REPORT_ACTION_TARGET_UNAVAILABLE,
      "SOCIAL-ERR: nội dung bị báo cáo không còn thao tác được; hãy xử lý báo cáo mà không kèm hành động.",
    ),
  reportGone: () =>
    new ApiError(404, C.REPORT_NOT_FOUND, "SOCIAL-ERR-001: không tìm thấy báo cáo."),
  postGone: () => new ApiError(404, C.POST_NOT_FOUND, "SOCIAL-ERR-001: không tìm thấy bài viết."),
  reportDuplicate: () =>
    new ApiError(
      409,
      C.REPORT_DUPLICATE_OPEN,
      "SOCIAL-ERR: bạn đã báo cáo nội dung này và báo cáo đó đang chờ xử lý.",
    ),
  idempotencyInProgress: () =>
    new ApiError(
      409,
      IDEMPOTENCY_ERROR_CODES.IN_PROGRESS,
      "Yêu cầu cùng khoá idempotency đang được xử lý.",
    ),
  /** 001 `status=hidden` thiếu `manage:feed-post` (tầng 2). */
  moderationDenied: () =>
    new ApiError(
      403,
      C.MODERATION_FIELD_DENIED,
      "SOCIAL-ERR-010: bạn không có quyền thay đổi trường kiểm duyệt này.",
    ),
  /** 403 tầng 1/2 của `PermissionGuard` — không mang mã SOCIAL. */
  forbidden: () => new ApiError(403, "AUTH-ERR-FORBIDDEN", "Forbidden resource"),
  badRequest: () => new ApiError(400, "VALIDATION-ERR-001", "Validation failed"),
  server: () => new ApiError(500, "INTERNAL", "boom"),
} satisfies Record<string, () => ApiError>;
