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
 * trên dòng dẫn thẳng tới tab Checklist. Chỉ nhận giá trị trong danh sách trắng; đóng drawer bỏ luôn.
 */
export const TASK_DRAWER_TAB_PARAM = "taskTab";
export const TASK_DRAWER_TABS = ["checklist"] as const;
export type TaskDrawerTab = (typeof TASK_DRAWER_TABS)[number];

/** Tab hợp lệ của `?taskTab=` hoặc `null` (thiếu / giá trị lạ). */
export function readTaskDrawerTab(search: unknown): TaskDrawerTab | null {
  if (typeof search !== "object" || search === null) return null;
  const raw = (search as Record<string, unknown>)[TASK_DRAWER_TAB_PARAM];
  return (TASK_DRAWER_TABS as readonly unknown[]).includes(raw) ? (raw as TaskDrawerTab) : null;
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

/** `/tasks/<uuid>` (đích thông báo) ⇒ id việc; đường khác (kể cả `/tasks/my-tasks`) ⇒ null. */
export function taskIdFromPath(path: string): string | null {
  const match = TASK_PATH_RE.exec(path);
  const id = match?.[1];
  return isTaskUuid(id) ? id : null;
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
  /** Thêm/đổi `?task=` trên URL hiện tại (push); `tab` mở sẵn một tab của drawer. */
  openTask: (taskId: string, opts?: { tab?: TaskDrawerTab }) => void;
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
      openTask: (taskId: string, opts?: { tab?: TaskDrawerTab }) =>
        go(taskId, false, opts?.tab ?? null),
      closeTask: () => go(null, true),
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
