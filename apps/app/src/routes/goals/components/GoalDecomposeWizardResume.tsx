/**
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-08) — quay lại wizard phân rã sau khi tạo mẫu mới.
 *
 * Wizard rỗng mẫu ⇒ «Tạo mẫu mới» đi `/goals/templates?returnTo=/goals/<id>?decompose=resume`; lưu mẫu
 * xong trang mẫu điều hướng về đó và trang chi tiết mục tiêu mở lại wizard. Cờ `decompose` KHÔNG nằm
 * trong `validateSearch` của chi tiết: nó chỉ sống một nhịp — hook đọc từ `location.search` thô (như
 * drawer `?task=`) rồi GỠ khỏi URL bằng replace, nên F5/Back không mở lại wizard ngoài ý muốn.
 *
 * Hook chỉ nói «người dùng muốn mở»; trang vẫn tự gate quyền + trạng thái mục tiêu trước khi dựng
 * wizard (URL ai cũng gõ được).
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

export const DECOMPOSE_RESUME_PARAM = "decompose";
export const DECOMPOSE_RESUME_VALUE = "resume";

type SearchRecord = Record<string, unknown>;

/** Đích `returnTo` của «Tạo mẫu mới»: chi tiết mục tiêu + cờ mở lại wizard. */
export function decomposeReturnPath(goalId: string): string {
  return `/goals/${encodeURIComponent(goalId)}?${DECOMPOSE_RESUME_PARAM}=${DECOMPOSE_RESUME_VALUE}`;
}

export function isDecomposeResume(search: unknown): boolean {
  if (typeof search !== "object" || search === null) return false;
  return (search as SearchRecord)[DECOMPOSE_RESUME_PARAM] === DECOMPOSE_RESUME_VALUE;
}

function withoutResume(prev: SearchRecord): SearchRecord {
  return Object.fromEntries(
    Object.entries(prev ?? {}).filter(([key]) => key !== DECOMPOSE_RESUME_PARAM),
  );
}

/** Trạng thái mở wizard của trang chi tiết; `?decompose=resume` ⇒ mở sẵn một lần rồi gỡ cờ. */
export function useDecomposeWizardOpen(): [boolean, (open: boolean) => void] {
  const navigate = useNavigate();
  const resume = useRouterState({ select: (s) => isDecomposeResume(s.location.search) });
  const [open, setOpenState] = useState(resume);

  useEffect(() => {
    if (!resume) return;
    setOpenState(true);
    void navigate({
      to: ".",
      search: withoutResume as never,
      replace: true,
      resetScroll: false,
    });
  }, [resume, navigate]);

  const setOpen = useCallback((next: boolean) => setOpenState(next), []);
  return [open, setOpen];
}
