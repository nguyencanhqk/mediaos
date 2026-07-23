import type { Goal } from "../db/schema/goals";

/**
 * S5-GOAL-BE-2 — payload outbox cho 2 event NOTI của GOAL (SPEC-10 §17).
 *
 * ⚠️ TÊN KHOÁ PHẢI KHỚP TỪNG KÝ TỰ với placeholder của template seed 0507 — `NotificationRendererService`
 * chỉ thay `{key}` bằng giá trị cùng tên; sai tên khoá thì message giữ nguyên placeholder CÂM (không lỗi,
 * không log) và chỉ lộ ra khi có người đọc thông báo thật. Template 0507:
 *   GOAL_ASSIGNED  : {goalId} {goal_code} {goal_name} {assigner_name} {period_label}
 *   GOAL_FINALIZED : {goalId} {goal_code} {goal_name} {period_label} {final_progress}
 *
 * BẤT BIẾN #3 + SPEC-10 §18 — payload KHÔNG chứa số liệu nội bộ/PII ngoài danh mục trên: không
 * `current_value`, không `target_value`, không tên/định danh nhân viên khác, không mô tả mục tiêu.
 * `final_progress` là NGOẠI LỆ CÓ CHỦ Ý: nó là nội dung chính của thông báo chốt kỳ và chỉ gửi cho
 * người phụ trách + trưởng đơn vị (audience đã hẹp).
 */

/** Nhãn kỳ dễ đọc cho người nhận. `quarter` ⇒ "Quý N/YYYY"; còn lại ⇒ "dd/mm/yyyy – dd/mm/yyyy". */
export function goalPeriodLabel(
  goal: Pick<Goal, "periodType" | "periodStart" | "periodEnd">,
): string {
  const start = goal.periodStart;
  if (goal.periodType === "quarter") {
    const [y, m] = start.split("-");
    const month = Number(m);
    if (y && Number.isFinite(month) && month >= 1 && month <= 12) {
      return `Quý ${Math.floor((month - 1) / 3) + 1}/${y}`;
    }
  }
  if (goal.periodType === "year") return start.slice(0, 4);
  return `${formatDate(start)} – ${formatDate(goal.periodEnd)}`;
}

/** "chưa đo" (NULL) KHÔNG được render thành "0%" — SPEC-10 §13.2 áp cho CẢ kênh thông báo. */
export function goalProgressLabel(progressPercent: string | null): string {
  if (progressPercent === null || progressPercent === undefined) return "chưa đo";
  const n = Number(progressPercent);
  if (!Number.isFinite(n)) return "chưa đo";
  return `${Number(n.toFixed(2))}%`;
}

export function goalAssignedPayload(goal: Goal, assignerName: string): Record<string, unknown> {
  return {
    goalId: goal.id,
    goal_code: goal.goalCode,
    goal_name: goal.name,
    assigner_name: assignerName,
    period_label: goalPeriodLabel(goal),
  };
}

export function goalFinalizedPayload(goal: Goal): Record<string, unknown> {
  return {
    goalId: goal.id,
    goal_code: goal.goalCode,
    goal_name: goal.name,
    period_label: goalPeriodLabel(goal),
    final_progress: goalProgressLabel(goal.progressPercent),
  };
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
