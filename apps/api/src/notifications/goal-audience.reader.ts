import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

export interface GoalAudience {
  /** `users.id` của người phụ trách mục tiêu (owner_employee_id → employee_profiles.user_id). */
  ownerUserId: string | null;
  /** `users.id` của trưởng đơn vị neo (phòng của goal / phòng dự án / phòng nhân viên). */
  headUserIds: string[];
}

interface AudienceRow {
  ownerUserId: string | null;
  headUserId: string | null;
}

const EMPTY: GoalAudience = { ownerUserId: null, headUserIds: [] };

/**
 * S5-GOAL-BE-2 — GoalAudienceReader: audience HIỆN TẠI của một mục tiêu cho `GoalNotiBridgeRegistrar`
 * (SPEC-10 §17). Mirror `TaskAudienceReader`: đọc thẳng bảng bằng raw SQL, KHÔNG import `GoalsModule`
 * (giữ chiều phụ thuộc acyclic — `notifications/**` không được biết feature module).
 *
 * "Trưởng đơn vị" suy ra từ NEO của mục tiêu (`org_units.head_user_id`), theo đúng thứ tự neo của
 * SPEC-10 §8: goal phòng → phòng đó · goal dự án → phòng của dự án · goal nhân viên → phòng của nhân
 * viên. Không tìm được đơn vị/đơn vị chưa đặt trưởng ⇒ danh sách rỗng (fail-soft: thiếu người nhận
 * KHÔNG được làm hỏng việc chốt kỳ).
 *
 * BẤT BIẾN #1: chạy TRONG `withTenant` do caller mở + `company_id` bind tường minh mọi câu — kể cả các
 * bảng join (org_units/employee_profiles), vì đây là đường đi ra NGOÀI tenant nếu sai.
 * Actor-exclusion KHÔNG làm ở đây: engine (`NotificationRecipientResolverService`) tự loại actor.
 */
@Injectable()
export class GoalAudienceReader {
  async resolve(tx: TenantTx, companyId: string, goalId: string): Promise<GoalAudience> {
    const res = await tx.execute(sql`
      select ou_owner.user_id as "ownerUserId", ou.head_user_id as "headUserId"
        from goals g
        left join employee_profiles ou_owner
               on ou_owner.id = g.owner_employee_id
              and ou_owner.company_id = ${companyId}
              and ou_owner.deleted_at is null
              and ou_owner.status = 'active'
        left join employee_profiles subj
               on subj.id = g.employee_id and subj.company_id = ${companyId}
        left join projects pr
               on pr.id = g.project_id and pr.company_id = ${companyId}
        left join org_units ou
               on ou.company_id = ${companyId}
              and ou.deleted_at is null
              and ou.id = coalesce(g.department_id, pr.department_id, subj.org_unit_id)
       where g.id = ${goalId} and g.company_id = ${companyId} and g.deleted_at is null
       limit 1
    `);
    const row = (res.rows as unknown as AudienceRow[])[0];
    if (!row) return EMPTY;
    return {
      ownerUserId: row.ownerUserId ?? null,
      headUserIds: row.headUserId ? [row.headUserId] : [],
    };
  }
}
