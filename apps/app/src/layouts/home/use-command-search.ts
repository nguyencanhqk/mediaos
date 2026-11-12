/**
 * S20-FE-CMDKSEARCH-1 — dữ liệu cho bảng lệnh Ctrl+K (AppSwitcher): tìm việc / dự án / đồng nghiệp.
 *
 * Bất biến:
 * - MỖI nhóm chỉ gọi API và chỉ xuất hiện khi `useCan` cho phép đọc (task / project / employee).
 *   Thiếu quyền ⇒ nhóm không tồn tại trong kết quả và KHÔNG có request nào.
 * - Dưới `COMMAND_SEARCH_MIN_CHARS` ký tự (sau trim) ⇒ không gọi API nào.
 * - Debounce `COMMAND_SEARCH_DEBOUNCE_MS`; tối đa `COMMAND_SEARCH_MAX_PER_GROUP` kết quả mỗi nhóm.
 * - Nhóm «Đồng nghiệp» chỉ giữ id · tên · ảnh · phòng ban (map ngay tại đây, bỏ phần còn lại dù
 *   endpoint trả thêm). Không ghi storage: khoá query khai cục bộ, bộ nhớ đệm chỉ sống trong phiên.
 * - Mỗi nhóm một query độc lập: một nhóm lỗi/quá hạn không làm mất nhóm khác.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { hrApi, taskCoreApi, taskProjectApi, useCan } from "@mediaos/web-core";

export const COMMAND_SEARCH_MIN_CHARS = 2;
export const COMMAND_SEARCH_DEBOUNCE_MS = 250;
export const COMMAND_SEARCH_MAX_PER_GROUP = 5;
export const COMMAND_SEARCH_TIMEOUT_MS = 8000;

export type CommandGroupKey = "tasks" | "projects" | "people";
export type CommandGroupStatus = "loading" | "error" | "success";

export interface CommandSearchItem {
  id: string;
  group: CommandGroupKey;
  label: string;
  /** Dòng phụ: tên dự án (việc) · phòng ban (người). */
  sublabel: string | null;
  /** Chỉ nhóm «Đồng nghiệp». */
  avatarUrl?: string | null;
}

export interface CommandSearchGroup {
  key: CommandGroupKey;
  status: CommandGroupStatus;
  items: CommandSearchItem[];
}

export interface CommandSearchResult {
  /** Từ khoá đã debounce + trim (rỗng khi chưa đủ ký tự). */
  term: string;
  groups: CommandSearchGroup[];
  /** Đã có kết quả cuối cho MỌI nhóm hiển thị và tất cả đều rỗng. */
  isEmpty: boolean;
}

/** Khoá query KHAI CỤC BỘ — không đụng query-keys.ts của web-core. */
const commandKey = (group: CommandGroupKey, term: string) =>
  ["command-search", group, term] as const;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("command-search-timeout")),
      COMMAND_SEARCH_TIMEOUT_MS,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error("command-search-failed"));
      },
    );
  });
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const QUERY_OPTS = { staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false } as const;

/** Có phải sự kiện phím đến từ ô soạn chat (CHAT-DEC-027: Ctrl/⌘+K trong chat thuộc về chat). */
export function isChatComposerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-testid="chat-composer"]') !== null;
}

export function useCommandSearch(rawQuery: string, open: boolean): CommandSearchResult {
  const canTasks = useCan("read", "task");
  const canProjects = useCan("read", "project");
  const canPeople = useCan("read", "employee");

  const debounced = useDebounced(rawQuery.trim(), COMMAND_SEARCH_DEBOUNCE_MS);
  const active = open && rawQuery.trim().length >= COMMAND_SEARCH_MIN_CHARS;
  // `rawQuery` ngắn lại dưới ngưỡng ⇒ tắt ngay, không đợi debounce.
  const term = active && debounced.length >= COMMAND_SEARCH_MIN_CHARS ? debounced : "";
  const on = (can: boolean) => can && term !== "";

  const tasks = useQuery({
    ...QUERY_OPTS,
    queryKey: commandKey("tasks", term),
    enabled: on(canTasks),
    queryFn: async (): Promise<CommandSearchItem[]> => {
      const rows = await withTimeout(
        taskCoreApi.listTasks({ search: term, limit: COMMAND_SEARCH_MAX_PER_GROUP }),
      );
      return rows.slice(0, COMMAND_SEARCH_MAX_PER_GROUP).map((r) => ({
        id: r.id,
        group: "tasks",
        label: r.title,
        sublabel: r.projectName ?? null,
      }));
    },
  });
  const projects = useQuery({
    ...QUERY_OPTS,
    queryKey: commandKey("projects", term),
    enabled: on(canProjects),
    queryFn: async (): Promise<CommandSearchItem[]> => {
      const rows = await withTimeout(
        taskProjectApi.listProjects({ search: term, limit: COMMAND_SEARCH_MAX_PER_GROUP }),
      );
      return rows.slice(0, COMMAND_SEARCH_MAX_PER_GROUP).map((r) => ({
        id: r.id,
        group: "projects",
        label: r.name,
        sublabel: null,
      }));
    },
  });
  const people = useQuery({
    ...QUERY_OPTS,
    queryKey: commandKey("people", term),
    enabled: on(canPeople),
    queryFn: async (): Promise<CommandSearchItem[]> => {
      const res = await withTimeout(
        hrApi.listEmployees({ search: term, page: 1, pageSize: COMMAND_SEARCH_MAX_PER_GROUP }),
      );
      // Chỉ tên / ảnh / phòng ban — mọi trường khác bị bỏ tại đây.
      return res.items.slice(0, COMMAND_SEARCH_MAX_PER_GROUP).map((r) => ({
        id: r.id,
        group: "people",
        label: r.fullName ?? r.employeeCode ?? "",
        sublabel: r.orgUnitName ?? null,
        avatarUrl: r.avatarUrl ?? null,
      }));
    },
  });

  return React.useMemo(() => {
    if (term === "") return { term: "", groups: [], isEmpty: false };
    const toGroup = (
      key: CommandGroupKey,
      can: boolean,
      q: { isError: boolean; isSuccess: boolean; data: CommandSearchItem[] | undefined },
    ): CommandSearchGroup[] => {
      if (!can) return [];
      const status: CommandGroupStatus = q.isError ? "error" : q.isSuccess ? "success" : "loading";
      return [{ key, status, items: q.data ?? [] }];
    };
    const groups = [
      ...toGroup("tasks", canTasks, tasks),
      ...toGroup("projects", canProjects, projects),
      ...toGroup("people", canPeople, people),
    ];
    const isEmpty =
      groups.length > 0 && groups.every((g) => g.status === "success" && g.items.length === 0);
    return { term, groups, isEmpty };
  }, [term, canTasks, canProjects, canPeople, tasks, projects, people]);
}
