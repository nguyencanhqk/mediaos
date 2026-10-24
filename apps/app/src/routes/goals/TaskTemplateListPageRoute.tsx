import { useNavigate, useRouterState } from "@tanstack/react-router";
import { TaskTemplateListPage } from "./TaskTemplateListPage";
import { sanitizeReturnTo } from "./template-return-to";

/**
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-08) — vỏ route của `/goals/templates`: đọc `?returnTo=` (đã qua
 * `validateTaskTemplateListSearch` ở router, lọc lại ở đây vì router trộn search THÔ vào kết quả) và
 * điều hướng về đó sau khi lưu mẫu mới. Tách khỏi `router.tsx` (tệp đã quá trần độ dài) và khỏi trang
 * (trang không phụ thuộc router ⇒ spec của trang không cần dựng router).
 */
export function TemplatesRoute() {
  const navigate = useNavigate();
  const returnTo = useRouterState({
    select: (s) => sanitizeReturnTo((s.location.search as Record<string, unknown>).returnTo),
  });
  return (
    <TaskTemplateListPage
      {...(returnTo ? { returnTo } : {})}
      onReturn={(href) => void navigate({ href })}
    />
  );
}
