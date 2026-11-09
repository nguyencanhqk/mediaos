/**
 * S20-TASK-DRAWER-1 (US-TASK-NV-04) — drawer chi tiết việc TOÀN ỨNG DỤNG qua `?task=<uuid>`.
 *
 * Mọi điểm mở việc (Danh sách · Việc của tôi · Quá hạn · tab việc của dự án · thông báo · việc gắn ở
 * mục tiêu · việc con) chỉ THÊM `?task=` vào URL hiện tại — trang phía sau giữ nguyên bộ lọc và vị
 * trí cuộn. Drawer mount MỘT lần ở `ProtectedShell` và đọc tham số này từ `location.search`, không
 * phụ thuộc `validateSearch` của từng route.
 *
 * Bất biến:
 * - Mở = PUSH (Back đóng drawer, việc con ⇒ Back về việc cha); đóng = REPLACE (Back sau khi đóng
 *   không mở lại drawer).
 * - Kiểm UUID TRƯỚC mọi lời gọi API: giá trị rác không bao giờ thành request.
 *
 * Chỉ dùng `useNavigate` (không `useRouter`) cho mở/đóng: các bề mặt gọi hook này (thông báo, widget…)
 * được test với router giả chỉ có `useNavigate`.
 */
import { useMemo } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";

/** Tên tham số URL của drawer việc. */
export const TASK_DRAWER_PARAM = "task";

/**
 * S20-TASK-QUICKEDIT-1 — tab mở sẵn trong drawer (`?taskTab=checklist`): lỗi «Cần hoàn tất checklist»
 * trên dòng dẫn thẳng tới tab Checklist. S20-TASK-LEAVEHANDOFF-1: `comment` = tab Bình luận, ô soạn có focus. Chỉ nhận giá trị trong danh sách trắng; đóng drawer bỏ luôn.
 */
export const TASK_DRAWER_TAB_PARAM = "taskTab";
export const TASK_DRAWER_TABS = ["checklist", "comment"] as const;
export type TaskDrawerTab = (typeof TASK_DRAWER_TABS)[number];

/** Tab hợp lệ của `?taskTab=` hoặc `null` (thiếu / giá trị lạ). */
export function readTaskDrawerTab(search: unknown): TaskDrawerTab | null {
  if (typeof search !== "object" || search === null) return null;
  const raw = (search as Record<string, unknown>)[TASK_DRAWER_TAB_PARAM];
  return (TASK_DRAWER_TABS as readonly unknown[]).includes(raw) ? (raw as TaskDrawerTab) : null;
}

/**
 * Bộ đếm «yêu cầu focus ô soạn bình luận». Bấm «Báo người giao» khi drawer ĐÃ mở đúng việc ở tab Bình
 * luận thì URL không đổi (`?taskTab=comment` y hệt) ⇒ chỉ một tín hiệu tường minh như thế này mới làm
 * ô soạn focus lại. Mỗi lần `openTask(.., {tab:"comment"})` tăng 1.
 */
let commentFocusRequests = 0;
const commentFocusListeners = new Set<() => void>();
export function subscribeCommentFocusRequests(listener: () => void): () => void {
  commentFocusListeners.add(listener);
  return () => void commentFocusListeners.delete(listener);
}
export function getCommentFocusRequests(): number {
  return commentFocusRequests;
}
function requestCommentFocus(): void {
  commentFocusRequests += 1;
  commentFocusListeners.forEach((listener) => listener());
}

/**
 * S20-NOTI-TARGETURL-1 — yêu cầu LÀM NỔI một bình luận khi mở việc từ thông báo (`/tasks/<uuid>?comment_id=<uuid>`).
 * KHÔNG đưa `comment_id` lên URL của drawer (`withTask` không đổi, `comment_id` của trang toàn màn giữ nguyên):
 * chỉ phát tín hiệu `{seq, taskId, commentId}` qua mô-đun, mỗi `TaskCommentThread` (đúng `taskId`) tự ghi nhận
 * THEO TỪNG INSTANCE (ref `handledSeq` riêng) — không có «tiêu thụ độc quyền» nên thread nền ở trang toàn màn không
 * cướp tín hiệu của thread trong drawer. Vòng đời: `openTask(id)` không `commentId` và `closeTask()` xoá yêu cầu.
 */
export interface CommentHighlightRequest {
  seq: number;
  taskId: string;
  commentId: string;
}
let commentHighlight: CommentHighlightRequest | null = null;
let commentHighlightSeq = 0;
const commentHighlightListeners = new Set<() => void>();
export function subscribeCommentHighlight(listener: () => void): () => void {
  commentHighlightListeners.add(listener);
  return () => void commentHighlightListeners.delete(listener);
}
/** Snapshot ỔN ĐỊNH (cùng tham chiếu tới khi có yêu cầu mới) cho `useSyncExternalStore`. */
export function getCommentHighlight(): CommentHighlightRequest | null {
  return commentHighlight;
}
function setCommentHighlight(next: CommentHighlightRequest | null): void {
  commentHighlight = next;
  commentHighlightListeners.forEach((listener) => listener());
}
export function requestCommentHighlight(taskId: string, commentId: string): void {
  commentHighlightSeq += 1;
  setCommentHighlight({ seq: commentHighlightSeq, taskId, commentId });
}
export function clearCommentHighlight(): void {
  if (commentHighlight !== null) setCommentHighlight(null);
}

/** Trang chi tiết mở ở tab mới (không có lịch sử trong app) ⇒ «Quay lại» về đây. */
export const TASK_DETAIL_BACK_FALLBACK = "/tasks/my-tasks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_PATH_RE = /^\/tasks\/([^/?#]+)\/?$/;

export function isTaskUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Giá trị THÔ của `?task=` trong search đã parse (router parse bằng JSON.parse nên `?task=123` tới
 * đây là số). `null` = không có tham số; có mà rác vẫn trả chuỗi để drawer báo «Không mở được».
 */
export function readTaskDrawerParam(search: unknown): string | null {
  if (typeof search !== "object" || search === null) return null;
  const raw = (search as Record<string, unknown>)[TASK_DRAWER_PARAM];
  if (raw === undefined || raw === null || raw === "") return null;
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

/** Đích thông báo của một việc: id việc + (tuỳ chọn) bình luận cần làm nổi. */
export interface TaskTarget {
  taskId: string;
  commentId: string | null;
}

/**
 * `/tasks/<uuid>[?comment_id=<uuid>]` ⇒ đích việc; đường khác (kể cả `/tasks/my-tasks`, `/tasks/<uuid>/x`, có
 * `#`) ⇒ null. QUY TẮC DƯƠNG: path phải đúng `/tasks/<uuid>`; query chỉ xét `comment_id` và chỉ nhận khi là
 * UUID (rác ⇒ `commentId = null` nhưng vẫn mở drawer).
 */
export function taskTargetFromUrl(url: string): TaskTarget | null {
  const queryAt = url.indexOf("?");
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const query = queryAt === -1 ? "" : url.slice(queryAt + 1);
  const match = TASK_PATH_RE.exec(path);
  const id = match?.[1];
  if (!isTaskUuid(id) || query.includes("#")) return null;
  const raw = new URLSearchParams(query).get("comment_id");
  return { taskId: id, commentId: isTaskUuid(raw) ? raw : null };
}

/** `/tasks/<uuid>` (đích thông báo) ⇒ id việc; đường khác (kể cả `/tasks/my-tasks`) ⇒ null. */
export function taskIdFromPath(path: string): string | null {
  return taskTargetFromUrl(path)?.taskId ?? null;
}

type SearchRecord = Record<string, unknown>;

function withTask(
  prev: SearchRecord,
  taskId: string | null,
  tab: TaskDrawerTab | null = null,
): SearchRecord {
  const rest = Object.fromEntries(
    Object.entries(prev ?? {}).filter(
      ([key]) => key !== TASK_DRAWER_PARAM && key !== TASK_DRAWER_TAB_PARAM,
    ),
  );
  if (!taskId) return rest;
  return tab
    ? { ...rest, [TASK_DRAWER_PARAM]: taskId, [TASK_DRAWER_TAB_PARAM]: tab }
    : { ...rest, [TASK_DRAWER_PARAM]: taskId };
}

export interface TaskDrawerControls {
  /**
   * Thêm/đổi `?task=` trên URL hiện tại (push); `tab` mở sẵn một tab của drawer; `commentId` (UUID) ⇒ phát yêu
   * cầu làm nổi bình luận đó (KHÔNG thêm gì vào URL).
   */
  openTask: (taskId: string, opts?: { tab?: TaskDrawerTab; commentId?: string }) => void;
  /** Bỏ `?task=` khỏi URL hiện tại (replace). */
  closeTask: () => void;
}

export function useTaskDrawer(): TaskDrawerControls {
  const navigate = useNavigate();
  return useMemo(() => {
    const go = (taskId: string | null, replace: boolean, tab: TaskDrawerTab | null = null) =>
      void navigate({
        to: ".",
        search: ((prev: SearchRecord) => withTask(prev, taskId, tab)) as never,
        replace,
        // Trang phía sau giữ nguyên vị trí cuộn khi mở/đóng drawer.
        resetScroll: false,
      });
    return {
      openTask: (taskId: string, opts?: { tab?: TaskDrawerTab; commentId?: string }) => {
        if (isTaskUuid(opts?.commentId)) requestCommentHighlight(taskId, opts.commentId);
        else clearCommentHighlight();
        if (opts?.tab === "comment") requestCommentFocus();
        go(taskId, false, opts?.tab ?? null);
      },
      closeTask: () => {
        clearCommentHighlight();
        go(null, true);
      },
    };
  }, [navigate]);
}

/**
 * «Quay lại» của trang `/tasks/:id`: có lịch sử trong app ⇒ về trang trước (giữ bộ lọc của nó);
 * mở thẳng từ tab mới ⇒ `/tasks/my-tasks`.
 */
export function useTaskDetailBack(): () => void {
  const router = useRouter();
  const navigate = useNavigate();
  return () => {
    if (router.history.canGoBack()) {
      router.history.back();
      return;
    }
    void navigate({ to: TASK_DETAIL_BACK_FALLBACK as "/" });
  };
}

export interface TaskDetailNav {
  /** «Quay lại» — xem {@link useTaskDetailBack}. */
  onBack: () => void;
  /**
   * Sau khi xoá việc ⇒ về THẲNG `/tasks/my-tasks` (replace). Không dùng «Quay lại»: trang trước có thể
   * là URL còn `?task=<việc vừa xoá>` ⇒ drawer mở lại việc đã xoá và báo lỗi.
   */
  onDeleted: () => void;
}

/** Điều hướng của trang `/tasks/:id`: «Quay lại» và đích sau khi xoá việc. */
export function useTaskDetailNav(): TaskDetailNav {
  const onBack = useTaskDetailBack();
  const navigate = useNavigate();
  return {
    onBack,
    onDeleted: () => void navigate({ to: TASK_DETAIL_BACK_FALLBACK as "/", replace: true }),
  };
}
