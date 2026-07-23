import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S5-GOAL-BE-2 — persistence RIÊNG của vòng đo tiến độ (SPEC-10 §13). Đặt trong `tasks/` chứ KHÔNG
 * trong `goals/` là CÓ CHỦ ĐÍCH: `GoalsModule` đã import `TasksModule` (lấy `ProjectAccessService` từ
 * S5-GOAL-BE-1) nên engine nằm ở `goals/` sẽ buộc `TasksModule` import ngược ⇒ **cycle**. Chiều phụ
 * thuộc giữ MỘT HƯỚNG: TASK không biết GOAL-module, GOAL dùng lại engine của TASK.
 *
 * BẤT BIẾN #1: MỌI method chạy TRONG tx của `withTenant` (RLS+FORCE) và WHERE luôn AND `company_id`
 * tường minh. Raw SQL (mirror TaskCoreRepository) vì cột `tasks.goal_id` (0505) + `tasks.task_status`
 * (0478) CHƯA typed trong Drizzle schema `tasks`.
 */

export interface GoalProgressRow {
  id: string;
  level: string;
  projectId: string | null;
  parentGoalId: string | null;
  progressMode: string;
  measureType: string;
  /** numeric → CHUỖI qua driver; caller ép số một chỗ (mirror goals.mapper). */
  targetValue: string | null;
  currentValue: string | null;
  progressPercent: string | null;
  weight: string;
  status: string;
  finalizedAt: string | Date | null;
}

export interface GoalChildRow {
  id: string;
  progressPercent: string | null;
  weight: string;
}

const GOAL_PROGRESS_SELECT = sql`
  g.id, g.level, g.project_id as "projectId", g.parent_goal_id as "parentGoalId",
  g.progress_mode as "progressMode", g.measure_type as "measureType",
  g.target_value as "targetValue", g.current_value as "currentValue",
  g.progress_percent as "progressPercent", g.weight, g.status,
  g.finalized_at as "finalizedAt"`;

@Injectable()
export class GoalProgressEngineRepository {
  async findProgressRowTx(
    tx: TenantTx,
    companyId: string,
    goalId: string,
  ): Promise<GoalProgressRow | undefined> {
    const res = await tx.execute(sql`
      select ${GOAL_PROGRESS_SELECT}
        from goals g
       where g.id = ${goalId} and g.company_id = ${companyId} and g.deleted_at is null
       limit 1
    `);
    return (res.rows as unknown as GoalProgressRow[])[0];
  }

  /**
   * mode='tasks' (SPEC-10 §13.1 + GOAL-DEC-006): tập = task có `goal_id` = goal NÀY, chưa xoá mềm,
   * **loại `Cancelled` khỏi CẢ tử VÀ mẫu**. Task được đếm CHÍNH NÓ — KHÔNG kéo cây con vào (muốn đếm
   * việc con thì gắn việc con). Đây là chỗ khác biệt với đếm-lá của mode='project'; đừng "hợp nhất".
   */
  async countTasksForGoalTx(
    tx: TenantTx,
    companyId: string,
    goalId: string,
  ): Promise<{ done: number; total: number }> {
    const res = await tx.execute(sql`
      select count(*)::int as total,
             count(*) filter (where tk.task_status = 'Done')::int as done
        from tasks tk
       where tk.company_id = ${companyId}
         and tk.goal_id = ${goalId}
         and tk.deleted_at is null
         and tk.task_status is distinct from 'Cancelled'
    `);
    const row = (res.rows as unknown as { total: number; done: number }[])[0];
    return { done: Number(row?.done ?? 0), total: Number(row?.total ?? 0) };
  }

  /**
   * mode='children': con CÒN SỐNG và status ≠ 'Cancelled' (mục tiêu đã huỷ không còn là mục tiêu).
   * Con chưa đo được (`progress_percent IS NULL`) bị caller loại khỏi CẢ tử VÀ mẫu — lọc ở tầng service
   * chứ không ở SQL để unit-test phủ được đúng luật đó mà không cần DB.
   */
  async listChildrenForRollupTx(
    tx: TenantTx,
    companyId: string,
    goalId: string,
  ): Promise<GoalChildRow[]> {
    const res = await tx.execute(sql`
      select g.id, g.progress_percent as "progressPercent", g.weight
        from goals g
       where g.company_id = ${companyId}
         and g.parent_goal_id = ${goalId}
         and g.deleted_at is null
         and g.status <> 'Cancelled'
    `);
    return res.rows as unknown as GoalChildRow[];
  }

  /**
   * Ghi cache `progress_percent`. WRITER DUY NHẤT của cột này (check-in chỉ ghi `current_value`).
   * ⚠️ Vị từ `finalized_at is null` là hàng phòng thủ CUỐI của GOAL-ERR-005: kể cả khi có ai đó gọi
   * nhầm engine trên goal đã chốt, DB vẫn không cho ghi (ghi 0 hàng, không lỗi).
   * KHÔNG chạm `updated_at/updated_by`: recompute là hệ quả tự động, không phải "người dùng sửa
   * mục tiêu" — bump mốc sẽ đẩy goal lên đầu danh sách "mới cập nhật" mỗi lần ai đó tick một task.
   */
  async updateProgressTx(
    tx: TenantTx,
    companyId: string,
    goalId: string,
    progressPercent: string | null,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      update goals
         set progress_percent = ${progressPercent}
       where id = ${goalId} and company_id = ${companyId}
         and deleted_at is null and finalized_at is null
       returning id
    `);
    return (res.rows as unknown as { id: string }[]).length > 0;
  }

  /**
   * Goal `progress_mode='project'` neo vào một dự án — dùng khi task của dự án đổi trạng thái/đổi dự án.
   * Goal ĐÃ CHỐT bị loại ngay tại đây (đỡ một vòng đọc), goal chưa chốt vẫn được engine kiểm lại.
   */
  async listProjectModeGoalIdsTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
  ): Promise<string[]> {
    const res = await tx.execute(sql`
      select g.id from goals g
       where g.company_id = ${companyId}
         and g.project_id = ${projectId}
         and g.progress_mode = 'project'
         and g.deleted_at is null
         and g.finalized_at is null
    `);
    return (res.rows as unknown as { id: string }[]).map((r) => r.id);
  }

  /**
   * Job đối soát đêm (SPEC-10 §13.3): goal CHƯA CHỐT của **kỳ đang chạy** (kỳ bao trùm hôm nay).
   * Sắp theo cấp `employee → project → department` rồi `period_start`: con tính TRƯỚC cha nên rollup
   * `children` hội tụ sớm, giảm số vòng lặp cần thiết.
   */
  async listReconcileTargetsTx(
    tx: TenantTx,
    companyId: string,
    today: string,
  ): Promise<GoalProgressRow[]> {
    const res = await tx.execute(sql`
      select ${GOAL_PROGRESS_SELECT}
        from goals g
       where g.company_id = ${companyId}
         and g.deleted_at is null
         and g.finalized_at is null
         and g.period_start <= ${today}
         and g.period_end   >= ${today}
       order by case g.level when 'employee' then 0 when 'project' then 1 else 2 end,
                g.period_start
    `);
    return res.rows as unknown as GoalProgressRow[];
  }
}
