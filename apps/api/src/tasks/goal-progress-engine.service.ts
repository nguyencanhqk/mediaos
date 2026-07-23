import { Injectable, Logger } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { ProjectsRepository } from "./projects.repository";
import {
  GoalProgressEngineRepository,
  type GoalChildRow,
  type GoalProgressRow,
} from "./goal-progress-engine.repository";

/**
 * S5-GOAL-BE-2 — GoalProgressEngineService: TÍNH + GHI `goals.progress_percent` (SPEC-10 §13).
 *
 * ╔══ HAI ĐIỀU KHÔNG BAO GIỜ ĐƯỢC PHÁ ═════════════════════════════════════════════════════════════╗
 * ║ 1. `null` = "CHƯA ĐO", KHÁC 0% (§13.2). 0 task gắn / 0 con đo được / thiếu chỉ tiêu ⇒ **null**. ║
 * ║    Suy về 0 là NÓI DỐI: "chưa bắt đầu đo" và "đo rồi, được 0%" dẫn tới hai quyết định khác nhau.║
 * ║ 2. Goal đã chốt kỳ (`finalized_at`) BỊ BỎ QUA hoàn toàn (§13.4) — kể cả khi task con vừa đổi     ║
 * ║    trạng thái. Chốt kỳ là ĐÓNG BĂNG số liệu, không phải "tạm dừng".                              ║
 * ╚═════════════════════════════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ KHÔNG TỰ GATE QUYỀN — và đó là ĐIỀU KIỆN SỬ DỤNG (bài học `reused-method-must-be-actor-scoped`,
 * mirror `ProjectsRepository.countsByStatusLeafTx`): engine chỉ được gọi TỪ TRONG một writer đã tự
 * authorize request của nó (đổi trạng thái task · sửa task · gắn/tháo · check-in · chốt kỳ), hoặc từ
 * job nền chạy dưới `withPlatformContext` → `withTenant`. TUYỆT ĐỐI KHÔNG mở một route HTTP gọi thẳng
 * `recomputeGoalTx` — người không có quyền nào trên goal vẫn ép được server ghi cột của goal đó.
 *
 * ⚠️ Engine KHÔNG ghi `goal_updates`: sổ đó là NGƯỜI làm gì (check-in/finalize/reopen — DB-11 §6.2),
 * recompute tự động ghi vào đó sẽ làm phình bảng append-only bằng nhiễu máy sinh.
 */

/** Trần số bậc bubble lên cha. Cây MVP tối đa 3 tầng (SPEC-10 §3.1) ⇒ 3 bậc phủ trọn, không hơn. */
const MAX_BUBBLE_HOPS = 3;
/** Số vòng quét của job đối soát để rollup `children` hội tụ (cây ≤3 tầng ⇒ 3 vòng là đủ; +1 để kiểm). */
const RECONCILE_PASSES = 4;
/** Ngưỡng "lệch đáng kể" của job đối soát (SPEC-10 §13.3). */
const DRIFT_WARN_THRESHOLD = 0.01;

export interface ReconcileSummary {
  scanned: number;
  fixed: number;
  drifted: number;
}

// ── Công thức thuần (KHÔNG chạm DB — unit-test phủ trực tiếp) ────────────────────

const clampPercent = (n: number): number => Math.min(100, Math.max(0, n));

/** Làm tròn về đúng scale của cột `numeric(5,2)` — so sánh "đã đổi chưa" phải cùng độ chính xác với DB. */
export const roundPercent = (n: number): number => Math.round(n * 100) / 100;

/**
 * mode='manual' (§13.1): `percent` → chính giá trị check-in gần nhất · `number` → clamp(current/target
 * ×100) · `boolean` → 0 hoặc 100. Chưa check-in lần nào (`currentValue` null) ⇒ **null**, KHÔNG 0.
 * `number` thiếu/`target ≤ 0` ⇒ null (chia cho 0 không phải "0%").
 */
export function computeManualProgress(
  measureType: string,
  currentValue: number | null,
  targetValue: number | null,
): number | null {
  if (currentValue === null) return null;
  if (measureType === "boolean") return currentValue === 0 ? 0 : 100;
  if (measureType === "number") {
    if (targetValue === null || targetValue <= 0) return null;
    return roundPercent(clampPercent((currentValue / targetValue) * 100));
  }
  // 'percent' — giá trị check-in CHÍNH LÀ phần trăm.
  return roundPercent(clampPercent(currentValue));
}

/** mode='tasks'/'project': done/total×100. total = 0 ⇒ **null** ("chưa gắn việc", không phải 0%). */
export function computeRatioProgress(done: number, total: number): number | null {
  if (total <= 0) return null;
  return roundPercent(clampPercent((done / total) * 100));
}

/**
 * mode='children': Σ(progress_con × weight_con) / Σ(weight_con). Con **chưa đo được (null) bị loại khỏi
 * CẢ tử VÀ mẫu** — không có con nào đo được ⇒ null. (Con `Cancelled`/đã xoá đã bị loại từ truy vấn.)
 */
export function computeChildrenProgress(
  children: ReadonlyArray<{ progress: number | null; weight: number }>,
): number | null {
  let sumWeighted = 0;
  let sumWeight = 0;
  for (const c of children) {
    if (c.progress === null) continue;
    const w = Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 1;
    sumWeighted += c.progress * w;
    sumWeight += w;
  }
  if (sumWeight <= 0) return null;
  return roundPercent(clampPercent(sumWeighted / sumWeight));
}

const num = (v: string | null): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

@Injectable()
export class GoalProgressEngineService {
  private readonly logger = new Logger(GoalProgressEngineService.name);

  constructor(
    private readonly repo: GoalProgressEngineRepository,
    private readonly projects: ProjectsRepository,
  ) {}

  /**
   * Tính lại tiến độ của MỘT goal + bubble lên cha `children` (≤ `MAX_BUBBLE_HOPS` bậc), TRONG CÙNG tx
   * của caller (SPEC-10 §13.3 "sync cùng transaction"). Không tự mở tx: mở tx lồng trên PgBouncer
   * transaction-mode = treo.
   *
   * Điều kiện DỪNG bubble — HAI thứ RIÊNG BIỆT, đừng gộp:
   *   (a) cha không tồn tại HOẶC `progress_mode` của cha ≠ 'children' (cha đo bằng nguồn khác thì con
   *       không nói gì được);
   *   (b) hết trần `MAX_BUBBLE_HOPS`.
   * "Con `Cancelled`" KHÔNG phải điều kiện dừng — đó là điều kiện LOẠI con khỏi rollup của chính cha.
   */
  async recomputeGoalTx(tx: TenantTx, companyId: string, goalId: string, hop = 0): Promise<void> {
    const row = await this.repo.findProgressRowTx(tx, companyId, goalId);
    if (!row) return;
    if (row.finalizedAt) return; // §13.4 — đóng băng tuyệt đối.

    const next = await this.computeForRowTx(tx, companyId, row);
    const changed = await this.applyIfChangedTx(tx, companyId, row, next);
    if (!changed) return;

    if (!row.parentGoalId || hop >= MAX_BUBBLE_HOPS) return;
    const parent = await this.repo.findProgressRowTx(tx, companyId, row.parentGoalId);
    if (!parent || parent.progressMode !== "children") return;
    await this.recomputeGoalTx(tx, companyId, parent.id, hop + 1);
  }

  /**
   * MỘT GOAL CON vừa đổi thứ gì đó làm ĐỔI ĐẦU VÀO ROLLUP CỦA CHA mà KHÔNG đổi tiến độ của chính nó:
   * tạo mới · xoá mềm · đổi `weight` · đổi `status` sang/khỏi `Cancelled` · đổi `parent_goal_id`.
   *
   * ⚠️ VÌ SAO PHẢI CÓ HÀM RIÊNG (bug thật, bắt được ở int-spec P4): `recomputeGoalTx` chỉ bubble khi
   * tiến độ CỦA CHÍNH NÓ đổi. Huỷ một mục tiêu con 100% không làm tiến độ con đổi (vẫn 100%) nhưng làm
   * cha phải bỏ nó khỏi rollup ⇒ nếu chỉ gọi `recomputeGoalTx(con)` thì cha giữ số cũ, âm thầm sai.
   * `parentGoalId` null (mục tiêu gốc) ⇒ no-op.
   */
  async recomputeParentTx(
    tx: TenantTx,
    companyId: string,
    parentGoalId: string | null | undefined,
  ): Promise<void> {
    if (!parentGoalId) return;
    await this.recomputeGoalTx(tx, companyId, parentGoalId);
  }

  /**
   * Task của một dự án vừa đổi (trạng thái/gắn-tháo/đổi dự án/xoá) ⇒ tính lại MỌI goal
   * `progress_mode='project'` neo vào dự án đó. Gọi cùng lượt với `recomputeGoalTx(task.goalId)` —
   * hai nguồn đo ĐỘC LẬP: một task có thể vừa được gắn goal cấp nhân viên (mode='tasks') vừa nằm trong
   * dự án có goal mode='project'.
   */
  async recomputeProjectGoalsTx(
    tx: TenantTx,
    companyId: string,
    projectId: string | null,
  ): Promise<void> {
    if (!projectId) return;
    const ids = await this.repo.listProjectModeGoalIdsTx(tx, companyId, projectId);
    for (const id of ids) await this.recomputeGoalTx(tx, companyId, id);
  }

  /** Đường tắt cho writer của TASK: gắn-goal-của-task + goal mode='project' của dự án, một lời gọi. */
  async recomputeForTaskTx(
    tx: TenantTx,
    companyId: string,
    goalId: string | null | undefined,
    projectId: string | null | undefined,
  ): Promise<void> {
    if (goalId) await this.recomputeGoalTx(tx, companyId, goalId);
    await this.recomputeProjectGoalsTx(tx, companyId, projectId ?? null);
  }

  /**
   * Job đối soát đêm (SPEC-10 §13.3) cho MỘT tenant — TOÀN BỘ vòng lặp chạy trong ĐÚNG MỘT tx do
   * caller (`GoalReconciliationJobHandler`) mở. Idempotent: chạy lại trên dữ liệu không đổi ⇒ 0 sửa.
   *
   * Quét nhiều vòng vì rollup `children` phụ thuộc con: vòng 1 sửa lá, vòng 2 sửa cha, … Dừng SỚM khi
   * một vòng không sửa gì (hội tụ). KHÔNG bubble trong job — bubble sẽ tính lại chính những nút mà vòng
   * sau vẫn quét, nhân đôi công việc mà không thêm tính đúng.
   */
  async reconcileCompanyTx(
    tx: TenantTx,
    companyId: string,
    today: string,
  ): Promise<ReconcileSummary> {
    let scanned = 0;
    let fixed = 0;
    let drifted = 0;

    for (let pass = 0; pass < RECONCILE_PASSES; pass += 1) {
      const rows = await this.repo.listReconcileTargetsTx(tx, companyId, today);
      let fixedThisPass = 0;
      for (const row of rows) {
        scanned += 1;
        const next = await this.computeForRowTx(tx, companyId, row);
        const before = num(row.progressPercent);
        const delta =
          before === null || next === null
            ? before === next
              ? 0
              : Number.POSITIVE_INFINITY
            : Math.abs(before - next);
        const changed = await this.applyIfChangedTx(tx, companyId, row, next);
        if (!changed) continue;
        fixedThisPass += 1;
        fixed += 1;
        if (delta > DRIFT_WARN_THRESHOLD) {
          drifted += 1;
          this.logger.warn(
            `GOAL_PROGRESS_RECONCILE company=${companyId} goal=${row.id} mode=${row.progressMode} ` +
              `lệch cache ${row.progressPercent ?? "null"} → ${next ?? "null"} (đã sửa)`,
          );
        }
      }
      if (fixedThisPass === 0) break;
    }

    return { scanned, fixed, drifted };
  }

  // ── Nội bộ ───────────────────────────────────────────────────────────────────

  /** Dispatch theo `progress_mode` (§13.1). Mode lạ (dữ liệu lệch) ⇒ giữ nguyên cache, KHÔNG đoán. */
  private async computeForRowTx(
    tx: TenantTx,
    companyId: string,
    row: GoalProgressRow,
  ): Promise<number | null> {
    switch (row.progressMode) {
      case "manual":
        return computeManualProgress(row.measureType, num(row.currentValue), num(row.targetValue));
      case "tasks": {
        const c = await this.repo.countTasksForGoalTx(tx, companyId, row.id);
        return computeRatioProgress(c.done, c.total);
      }
      case "project":
        return this.computeProjectProgressTx(tx, companyId, row.projectId);
      case "children": {
        const children = await this.repo.listChildrenForRollupTx(tx, companyId, row.id);
        return computeChildrenProgress(children.map(toRollupChild));
      }
      default:
        return num(row.progressPercent);
    }
  }

  /**
   * mode='project' — MỘT NGUỒN SỐ DUY NHẤT với widget dashboard `project-progress`:
   * `ProjectsRepository.countsByStatusLeafTx` (đếm-lá DECISIONS-05 D-35), gọi TRONG CÙNG tx.
   *
   * ⚠️ CẤM đọc cột `projects.progress_percent` — cột CHẾT, không writer nào ghi (SPEC-10 §3.3/§13.1).
   * ⚠️ CẤM đổi sang `aggregateReportTx`: nó nằm sau cặp SENSITIVE `view-report:project` và trả kèm PII.
   * 'Cancelled' loại khỏi mẫu số (việc đã huỷ không còn là việc) — cùng luật với mode='tasks'.
   */
  private async computeProjectProgressTx(
    tx: TenantTx,
    companyId: string,
    projectId: string | null,
  ): Promise<number | null> {
    if (!projectId) return null;
    const byStatus = await this.projects.countsByStatusLeafTx(tx, companyId, projectId);
    let total = 0;
    for (const [status, n] of Object.entries(byStatus)) {
      if (status === "Cancelled") continue;
      total += Number(n) || 0;
    }
    return computeRatioProgress(Number(byStatus.Done ?? 0), total);
  }

  /** Ghi khi và chỉ khi giá trị ĐỔI (so ở đúng scale numeric(5,2)) — tránh UPDATE rỗng mỗi lần tick task. */
  private async applyIfChangedTx(
    tx: TenantTx,
    companyId: string,
    row: GoalProgressRow,
    next: number | null,
  ): Promise<boolean> {
    const before = num(row.progressPercent);
    const rounded = next === null ? null : roundPercent(next);
    if (before === null && rounded === null) return false;
    if (before !== null && rounded !== null && Math.abs(before - rounded) < 0.005) return false;
    return this.repo.updateProgressTx(
      tx,
      companyId,
      row.id,
      rounded === null ? null : rounded.toFixed(2),
    );
  }
}

function toRollupChild(child: GoalChildRow): { progress: number | null; weight: number } {
  const w = Number(child.weight);
  return {
    progress: num(child.progressPercent),
    weight: Number.isFinite(w) && w > 0 ? w : 1,
  };
}
