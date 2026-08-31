import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S12-RECRUIT-BE-1 — role nhận NOTI-EVENT-019 (RECRUIT_CANDIDATE_HIRED). HẰNG CÓ TÊN — KHÔNG rải
 * literal 'hr' (memory `canonical-seed-pin-regression`); drift-guard int-spec assert role này tồn
 * tại trong seed (`recruit-be1-noti.int-spec.ts`). CỐ Ý không gửi `hr-manager` (role đó không có
 * grant RECRUIT — B6 DB-1, SPEC-12 §17).
 */
export const RECRUIT_HR_ROLE_NAME = "hr" as const;

/**
 * S12-RECRUIT-BE-1 — RecruitAudienceReader: resolve recipient cho 4 event RECRUIT (SPEC-12 §17),
 * raw SQL qualify `alias.column` (memory `drizzle-sql-template-renders-columns-unqualified`).
 * Registrar mở tx đọc RIÊNG lúc consumer chạy — audience là trạng thái HIỆN TẠI, không phải lúc
 * phát event (mirror GoalAudienceReader).
 */
@Injectable()
export class RecruitAudienceReader {
  /** NOTI-017 — user của MỌI participant lượt phỏng vấn (employee không có user ⇒ bỏ qua). */
  async interviewParticipantUserIds(
    tx: TenantTx,
    companyId: string,
    interviewId: string,
  ): Promise<string[]> {
    const res = await tx.execute(sql`
      select distinct ep.user_id as "userId"
        from interview_participants ip
        join employee_profiles ep
          on ep.id = ip.employee_id
         and ep.company_id = ${companyId}
         and ep.deleted_at is null
       where ip.interview_id = ${interviewId}
         and ip.company_id = ${companyId}
         and ep.user_id is not null
    `);
    return (res.rows as unknown as Array<{ userId: string | null }>)
      .map((r) => r.userId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  /** NOTI-018 — recruiter phụ trách vị trí của ứng viên (null = không ai nhận). */
  async jobRecruiterUserId(
    tx: TenantTx,
    companyId: string,
    jobOpeningId: string,
  ): Promise<string | null> {
    const res = await tx.execute(sql`
      select jo.recruiter_user_id as "userId"
        from job_openings jo
       where jo.id = ${jobOpeningId}
         and jo.company_id = ${companyId}
         and jo.deleted_at is null
       limit 1
    `);
    const row = (res.rows as unknown as Array<{ userId: string | null }>)[0];
    return row?.userId ?? null;
  }

  /** NOTI-019 — user giữ role `hr` (canonical, company_id NULL) CÒN HIỆU LỰC trong company. */
  async hrRoleUserIds(tx: TenantTx, companyId: string): Promise<string[]> {
    const res = await tx.execute(sql`
      select distinct ur.user_id as "userId"
        from user_roles ur
        join roles r
          on r.id = ur.role_id
         and r.company_id is null
         and r.deleted_at is null
         and r.name = ${RECRUIT_HR_ROLE_NAME}
        join users u
          on u.id = ur.user_id
         and u.company_id = ${companyId}
         and u.deleted_at is null
       where ur.company_id = ${companyId}
         and ur.deleted_at is null
         and (ur.expires_at is null or ur.expires_at > now())
    `);
    return (res.rows as unknown as Array<{ userId: string | null }>)
      .map((r) => r.userId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }
}
