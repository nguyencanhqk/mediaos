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
import { useAuthStore } from "@mediaos/web-core";
import type {
  FeedBirthdayDto,
  FeedCommentDto,
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
 */
export function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
