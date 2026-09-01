import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { useCan, useCanExact } from "@mediaos/web-core";
import {
  availablePeriodActions,
  PERIOD_ACTION_PAIR,
  type PayrollPeriodAction,
  type PeriodActionSubject,
} from "../payroll-actions";

/**
 * PAY-SCREEN-002 — thanh hành động theo FSM ∩ quyền ∩ four-eyes (SPEC-11 §14).
 *
 * ── LUẬT DUY NHẤT CỦA COMPONENT NÀY ───────────────────────────────────────────────────────────────
 * **Nút KHÔNG khả dụng thì KHÔNG RENDER** — không render mờ, không render kèm tooltip "bạn không được
 * phép". SPEC-11 §14 viết thẳng: «nút không hiện thay vì hiện rồi 409». Hai hệ quả cụ thể:
 *   · «Duyệt» biến mất với CHÍNH người vừa gửi duyệt (four-eyes hiện ra ở UI, không chỉ ở mã lỗi);
 *   · «Mở lại» biến mất khi kỳ đã sinh phiếu (đường đó bị chặn VĨNH VIỄN — phiếu append-only).
 *
 * ⚠️ `useCan` vs `useCanExact` KHÔNG thay thế được nhau. 7/9 hành động gác bằng cặp **SENSITIVE**
 * (`calculate`/`approve`/`reopen`/`publish`) — `/auth/me` chỉ trả chúng dưới dạng cặp LITERAL cho vai
 * được cấp, và wildcard `*:*` **không kế thừa**. Gọi `useCan` cho một cặp sensitive là mở nhầm nút cho
 * wildcard; gọi `useCanExact` cho cặp thường (`lock` = `manage:payroll-period`) là giấu nút khỏi vai
 * có wildcard hợp lệ. Vì thế phân nhánh theo `pair.isSensitive` chứ không chọn tay từng hành động.
 *
 * ⚠️ Hook gọi ở TOP-LEVEL, đủ 9 hành động, không trong vòng lặp/điều kiện — quy tắc hook của React.
 */
export function PeriodActionBar({
  period,
  currentUserId,
  pendingAction,
  onAction,
}: {
  period: PeriodActionSubject;
  currentUserId: string | null;
  pendingAction: PayrollPeriodAction | null;
  onAction: (action: PayrollPeriodAction) => void;
}) {
  const { t } = useTranslation("payroll");

  // Cặp thường (wildcard thoả được) — `useCan`.
  const canManage = useCan(PERIOD_ACTION_PAIR.lock.action, PERIOD_ACTION_PAIR.lock.resourceType);
  // Cặp SENSITIVE — `useCanExact` (literal, wildcard KHÔNG kế thừa).
  const canCalculate = useCanExact(
    PERIOD_ACTION_PAIR.calculate.action,
    PERIOD_ACTION_PAIR.calculate.resourceType,
  );
  const canApprove = useCanExact(
    PERIOD_ACTION_PAIR.approve.action,
    PERIOD_ACTION_PAIR.approve.resourceType,
  );
  const canPublish = useCanExact(
    PERIOD_ACTION_PAIR.publish.action,
    PERIOD_ACTION_PAIR.publish.resourceType,
  );
  const canReopen = useCanExact(
    PERIOD_ACTION_PAIR.reopen.action,
    PERIOD_ACTION_PAIR.reopen.resourceType,
  );

  const hasPermission = (action: PayrollPeriodAction): boolean => {
    const pair = PERIOD_ACTION_PAIR[action];
    if (!pair.isSensitive) return canManage;
    if (pair.action === "calculate") return canCalculate;
    if (pair.action === "approve") return canApprove;
    if (pair.action === "publish") return canPublish;
    return canReopen;
  };

  const actions = availablePeriodActions(period, hasPermission, currentUserId);
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" data-testid="payroll-period-actions">
      {actions.map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === "reopen" || action === "reject" ? "outline" : "default"}
          disabled={pendingAction !== null}
          onClick={() => onAction(action)}
        >
          {t(`actions.period.${action}`)}
        </Button>
      ))}
    </div>
  );
}
