import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { projectMembers } from "../db/schema/media";

/** Vai trò per-project (CHECK `chk_project_members_project_role` — mig `0478`). */
export type ProjectRole = "Owner" | "Manager" | "Member" | "Viewer";

/** Membership Active của actor trong 1 dự án (role đã coalesce NULL→Member theo D-24). */
export interface ProjectMembership {
  role: ProjectRole;
  memberId: string;
}

/** Xếp hạng role MẠNH NHẤT khi actor khớp nhiều hàng member (legacy user_id-only + hàng employee_id). */
const ROLE_RANK: Record<ProjectRole, number> = { Owner: 0, Manager: 1, Member: 2, Viewer: 3 };

/**
 * S8-CHAT-UX-BE-2 — **MODULE LÁ** giữ vị từ đọc `project_members` (DECISIONS-04 D-23/D-24).
 *
 * ┌─ VÌ SAO TÁCH RA KHỎI `ProjectAccessService` ────────────────────────────────────────────────────┐
 * │ `tasks.module.ts` ĐÃ `import { ChatModule }` (nó cần `ChatDerivedRoomsSyncService`). CHAT cần đọc │
 * │ vai trò dự án để biết ai được đặt avatar phòng `project` (CHAT-DEC-016) ⇒ `ChatModule → Tasks-   │
 * │ Module` là **vòng** `Chat → Tasks → Chat`: Nest sập lúc bootstrap, kéo theo 100+ int-spec đỏ dây │
 * │ chuyền (lớp `systemjobhandler-optional-dbw-di`), không chỉ CHAT.                                  │
 * │                                                                                                   │
 * │ `forwardRef` chữa được về mặt kỹ thuật nhưng nó **giấu** vòng thay vì phá, và cạnh này chạy trên  │
 * │ ĐƯỜNG QUYỀN — một thay đổi thứ tự khởi tạo về sau làm dependency là `undefined` thì hoặc sập boot │
 * │ hoặc (tệ hơn) một nhánh `?.` nào đó biến nó thành fail-OPEN.                                      │
 * │                                                                                                   │
 * │ Khuôn đã dùng ở nhà này: `RealtimeEmitterModule` được tách ra chính xác để phá vòng               │
 * │ `Realtime → Chat → Realtime`. Module lá = 0 import, chỉ cấp 1 provider thuần-truy-vấn.            │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **MỘT BẢN SAO DUY NHẤT.** `ProjectAccessService.getMembershipTx` **uỷ quyền** xuống đây chứ không
 * giữ bản sao thứ hai. Vị từ identity (`employee_id = … OR user_id = …`) MIRROR `memberPredicate` của
 * `TaskCoreRepository.buildReadScopeExists` — hai nơi lệch nhau là hai cửa quyền khác nhau cho cùng một
 * người (`module-closed-by-second-assert-not-scope`). Ai cần đọc vai trò dự án thì import module lá này,
 * **KHÔNG** viết lại câu truy vấn trong repo của module mình.
 *
 * BẤT BIẾN #1: nhận `tx` (đã mở `withTenant`) + AND `company_id` tường minh bên cạnh RLS+FORCE.
 */
@Injectable()
export class ProjectMembershipService {
  /**
   * Membership Active MẠNH NHẤT của actor trong `projectId` (`null` = không phải member Active).
   *
   * `actorEmployeeId` NULL (user chưa gắn hồ sơ nhân sự) ⇒ chỉ so `user_id` — fail-closed tự nhiên,
   * không nới sang vế employee.
   */
  async getMembershipTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    actorEmployeeId: string | null,
    actorUserId: string,
  ): Promise<ProjectMembership | null> {
    const identity = actorEmployeeId
      ? sql`(${projectMembers.employeeId} = ${actorEmployeeId} or ${projectMembers.userId} = ${actorUserId})`
      : sql`${projectMembers.userId} = ${actorUserId}`;
    const rows = await tx
      .select({ id: projectMembers.id, role: projectMembers.projectRole })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.memberStatus, "Active"),
          isNull(projectMembers.deletedAt),
          identity,
        ),
      );
    if (rows.length === 0) return null;
    let best: ProjectMembership | null = null;
    for (const r of rows) {
      const role = this.coalesceRole(r.role);
      if (!best || ROLE_RANK[role] < ROLE_RANK[best.role]) best = { role, memberId: r.id };
    }
    return best;
  }

  /**
   * Hồ sơ nhân sự ĐANG hoạt động của một user (`null` = chưa gắn / đã nghỉ / đã xoá mềm) — bước 1 của
   * `getMembershipForUserTx`.
   *
   * ⚠️ **ĐÂY LÀ BẢN SAO THỨ HAI CÓ CHỦ ĐÍCH** của `TaskCoreRepository.findActiveEmployeeByUserTx`, và
   * lý do là ràng buộc kiến trúc chứ không phải lười: module này PHẢI là **lá** (0 import) để phá vòng
   * `Chat → Tasks → Chat`; import `TaskCoreRepository` là dựng lại đúng cạnh đó.
   *
   * Vì sao chấp nhận được ở đây mà không chấp nhận được với vị từ `project_members`: đây là **phân giải
   * danh tính**, không phải cấp quyền — và hướng trôi của nó **fail-CLOSED**. Vế nào chặt hơn cũng chỉ
   * làm hàm trả `null` ⇒ `getMembershipTx` so bằng `user_id` thôi ⇒ TỪ CHỐI nhiều hơn, không bao giờ
   * cấp thêm. Vị từ `project_members` thì ngược lại: nới một vế là mở cửa quyền, nên nó chỉ được có
   * MỘT bản.
   */
  async findActiveEmployeeIdTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<string | null> {
    const rows = await tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          eq(employeeProfiles.status, "active"),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /**
   * Tiện ích một-bước cho caller CHỈ có `userId` (CHAT không giữ `employee_profiles.id` ở đâu cả):
   * phân giải hồ sơ nhân sự rồi tra membership. `null` = không phải member Active của dự án.
   */
  async getMembershipForUserTx(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    actorUserId: string,
  ): Promise<ProjectMembership | null> {
    const employeeId = await this.findActiveEmployeeIdTx(tx, companyId, actorUserId);
    return this.getMembershipTx(tx, companyId, projectId, employeeId, actorUserId);
  }

  /** NULL→Member (D-24); giá trị ngoài enum (không thể xảy ra nhờ CHECK) fail về Viewer cho an toàn. */
  private coalesceRole(role: string | null): ProjectRole {
    if (role === null) return "Member";
    if (role === "Owner" || role === "Manager" || role === "Member" || role === "Viewer") {
      return role;
    }
    return "Viewer";
  }
}
