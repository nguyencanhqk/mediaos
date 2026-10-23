import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  taskCoreApi,
  taskKeys,
  taskProjectApi,
  hrApi,
  hrKeys,
  meApi,
  meKeys,
  useAuthStore,
  useCan,
} from "@mediaos/web-core";
import { TASK_CORE_ENGINE_PAIRS, TASK_ENGINE_PAIRS } from "./constants";

/**
 * Nguồn gợi ý @ của bình luận việc (S20-TASK-QUICKENTRY-1, US-TASK-NV-11, SPEC-06 §14.14).
 *
 * Nguồn CHÍNH là hợp các employee id ĐÃ có trong chi tiết việc — người phụ trách, người giao, người
 * theo dõi, cộng thành viên dự án nếu actor đọc được dự án — nên nhân viên KHÔNG có `read:employee`
 * vẫn nhắc được đúng người đang cùng làm việc. Danh bạ HR (`read:employee`) chỉ là nguồn BỔ SUNG,
 * xếp SAU người tham gia. Mọi nguồn đều là dữ liệu actor đã được phép đọc trên màn chi tiết việc;
 * KHÔNG gọi thêm API nhạy cảm. Server vẫn là cổng thật của mention (TASK-ERR-MENTION-*).
 *
 * Bỏ chính mình theo employee id đã biết từ dữ liệu sẵn có (dòng người theo dõi / danh bạ khớp
 * `userId`, hoặc /me/overview nếu đã nằm trong cache — KHÔNG tự gọi /me/overview).
 */

/** Số gợi ý tối đa hiện trong popover. */
export const MENTION_SUGGESTION_LIMIT = 8;

export interface MentionCandidate {
  id: string;
  fullName: string;
}

export interface MentionPersonRef {
  employeeId: string | null | undefined;
  name: string | null | undefined;
}

export interface MentionCandidateSources {
  /** Người tham gia việc, theo thứ tự ưu tiên hiển thị. */
  participants: readonly MentionPersonRef[];
  /** Danh bạ HR (chỉ có khi `read:employee`) — luôn xếp sau người tham gia. */
  directory: readonly MentionPersonRef[];
  /** Employee id của chính actor (đã biết) — bị loại khỏi gợi ý. */
  selfEmployeeIds: ReadonlySet<string>;
}

/** Hợp các nguồn, giữ thứ tự, bỏ trùng theo employee id, bỏ chính mình và mục không tên/không id. */
export function buildMentionCandidates(sources: MentionCandidateSources): MentionCandidate[] {
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const person of [...sources.participants, ...sources.directory]) {
    const id = person.employeeId;
    const fullName = person.name?.trim();
    if (!id || !fullName || seen.has(id) || sources.selfEmployeeIds.has(id)) continue;
    seen.add(id);
    out.push({ id, fullName });
  }
  return out;
}

/** Bỏ dấu tiếng Việt + hạ chữ thường để «cuong» khớp «Cường», «dang» khớp «Đặng». */
function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/đ/g, "d");
}

export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit: number = MENTION_SUGGESTION_LIMIT,
): MentionCandidate[] {
  const needle = foldForSearch(query.trim());
  return candidates.filter((c) => foldForSearch(c.fullName).includes(needle)).slice(0, limit);
}

const DIRECTORY_QUERY = { pageSize: 100, status: "active" } as const;

/**
 * Gợi ý @ cho bình luận của một việc. `enabled=false` (actor không bình luận được) ⇒ không tải gì.
 * Chi tiết việc + người theo dõi dùng CHÍNH khoá cache mà màn chi tiết việc đã tải (cache-hit).
 */
export function useMentionCandidates(taskId: string, enabled: boolean): MentionCandidate[] {
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const canWatch = useCan(
    TASK_CORE_ENGINE_PAIRS.WATCH.action,
    TASK_CORE_ENGINE_PAIRS.WATCH.resourceType,
  );
  const canReadProject = useCan(
    TASK_ENGINE_PAIRS.READ_PROJECT.action,
    TASK_ENGINE_PAIRS.READ_PROJECT.resourceType,
  );
  const canReadEmployees = useCan("read", "employee");

  const { data: task } = useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => taskCoreApi.getTask(taskId),
    enabled,
    staleTime: 30_000,
  });
  const { data: watchers } = useQuery({
    queryKey: taskKeys.watchers(taskId),
    queryFn: () => taskCoreApi.listWatchers(taskId),
    enabled: enabled && canWatch,
    staleTime: 30_000,
  });
  const projectId = task?.projectId ?? null;
  const { data: members } = useQuery({
    queryKey: taskKeys.projects.members(projectId ?? ""),
    queryFn: () => taskProjectApi.listMembers(projectId ?? ""),
    // Nguồn tuỳ chọn: ngoài phạm vi đọc dự án ⇒ coi như rỗng, không thử lại.
    enabled: enabled && canReadProject && projectId !== null,
    staleTime: 30_000,
    retry: false,
  });
  const { data: directoryPage } = useQuery({
    queryKey: hrKeys.employees.list(DIRECTORY_QUERY),
    queryFn: () => hrApi.listEmployees(DIRECTORY_QUERY),
    enabled: enabled && canReadEmployees,
    staleTime: 60_000,
  });
  // Chỉ ĐỌC cache (enabled:false) — không phát sinh lời gọi /me/overview mới.
  const { data: me } = useQuery({
    queryKey: meKeys.overview(),
    queryFn: () => meApi.getOverview(),
    enabled: false,
  });

  return useMemo(() => {
    const selfEmployeeIds = new Set<string>();
    const meEmployeeId = me?.identity.employee?.employeeId;
    if (meEmployeeId) selfEmployeeIds.add(meEmployeeId);
    for (const row of [...(watchers ?? []), ...(directoryPage?.items ?? [])]) {
      const employeeId = "employeeId" in row ? row.employeeId : row.id;
      if (myUserId && row.userId === myUserId) selfEmployeeIds.add(employeeId);
    }

    const participants: MentionPersonRef[] = [
      { employeeId: task?.mainAssigneeEmployeeId, name: task?.assigneeName },
      { employeeId: task?.reporterEmployeeId, name: task?.reporterName },
      ...(watchers ?? []).map((w) => ({ employeeId: w.employeeId, name: w.employeeName })),
      ...(members ?? []).map((m) => ({ employeeId: m.employeeId, name: m.employeeName })),
    ];
    const directory: MentionPersonRef[] = (directoryPage?.items ?? []).map((e) => ({
      employeeId: e.id,
      name: e.fullName,
    }));
    return buildMentionCandidates({ participants, directory, selfEmployeeIds });
  }, [task, watchers, members, directoryPage, me, myUserId]);
}
