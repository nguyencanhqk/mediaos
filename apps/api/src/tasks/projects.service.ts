import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { SQL } from "drizzle-orm";
import type {
  AddMemberRequest,
  CloseTaskProjectRequest,
  CreateTaskProjectRequest,
  ListTaskProjectsQueryRequest,
  MemberResponseDto,
  ProjectMemberStatusDto,
  ProjectReportCountsByStatusDto,
  ProjectReportDto,
  ProjectRoleDto,
  TaskProjectListItemDto,
  TaskProjectPriorityDto,
  TaskProjectResponseDto,
  TaskProjectStatusDto,
  UpdateMemberRoleRequest,
  UpdateTaskProjectRequest,
} from "@mediaos/contracts";
import {
  TASK_PROJECT_PAGE_LIMIT_MAX,
  TASK_PROJECT_REPORT_WORKLOAD_LIMIT,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { Project } from "../db/schema/media";
import {
  ProjectsRepository,
  type ProjectDetailRow,
  type ProjectMemberRow,
} from "./projects.repository";
import { TaskActivityService } from "./task-activity.service";

interface RequestUser {
  id: string;
  companyId: string;
}

/** project_status mặc định khi tạo (SPEC-06 §6.1 lifecycle). Hợp lệ theo chk_projects_project_status. */
const DEFAULT_PROJECT_STATUS = "Active";
/** Trạng thái kết thúc — chặn close lặp + chặn tạo task mới (mối nối createHubTask). */
const TERMINAL_STATUSES = new Set(["Completed", "Cancelled", "Archived"]);
const DEFAULT_LIST_LIMIT = 50;

/** Mã lỗi TASK (SPEC-01 §9 MODULE-ERR-XXX) — fail-loud, KHÔNG nuốt nhánh lỗi (silent-failure). */
const ERR = {
  NAME_TAKEN: "TASK-ERR-PROJECT-NAME-TAKEN: tên dự án đã tồn tại trong công ty.",
  CODE_TAKEN: "TASK-ERR-PROJECT-CODE-TAKEN: mã dự án đã tồn tại trong công ty.",
  DEPT_INVALID: "TASK-ERR-PROJECT-DEPT-INVALID: phòng ban không thuộc công ty.",
  OWNER_EMPLOYEE_INVALID:
    "TASK-ERR-PROJECT-OWNER-INVALID: nhân viên chủ dự án không tồn tại hoặc không hoạt động.",
  OWNER_NO_ACCOUNT:
    "TASK-ERR-PROJECT-OWNER-NO-ACCOUNT: nhân viên chủ dự án chưa có tài khoản người dùng.",
  NOT_FOUND: "TASK-ERR-PROJECT-NOT-FOUND: không tìm thấy dự án.",
  ALREADY_TERMINAL: "TASK-ERR-PROJECT-TERMINAL: dự án đã ở trạng thái kết thúc.",
  FORBIDDEN: "TASK-ERR-PROJECT-FORBIDDEN: không đủ quyền trên dự án này.",
  OWNER_REQUIRED:
    "TASK-ERR-PROJECT-OWNER-REQUIRED: dự án chưa có chủ sở hữu — thao tác bị từ chối (fail-closed).",
  NOT_OWNER: "TASK-ERR-PROJECT-NOT-OWNER: chỉ chủ dự án mới được thực hiện thao tác này.",
  EMPLOYEE_NOT_FOUND: "TASK-ERR-MEMBER-EMPLOYEE-NOT-FOUND: không tìm thấy nhân viên.",
  EMPLOYEE_NOT_ACTIVE:
    "TASK-ERR-MEMBER-EMPLOYEE-INACTIVE: nhân viên đã nghỉ/ngưng hoạt động — không thể thêm.",
  MEMBER_NO_ACCOUNT:
    "TASK-ERR-MEMBER-NO-ACCOUNT: nhân viên chưa có tài khoản người dùng — không thể thêm vào dự án.",
  MEMBER_DUP: "TASK-ERR-MEMBER-DUPLICATE: nhân viên đã là thành viên đang hoạt động của dự án.",
  MEMBER_NOT_FOUND: "TASK-ERR-MEMBER-NOT-FOUND: không tìm thấy thành viên trong dự án.",
  LAST_OWNER: "TASK-ERR-MEMBER-LAST-OWNER: không thể gỡ/hạ cấp chủ sở hữu cuối cùng của dự án.",
} as const;

/**
 * S4-TASK-BE-1 — ProjectsService (SPEC-06 Project + member). Business logic (KHÔNG ở controller).
 *
 * BẤT BIẾN #1: mọi query đi qua db.withTenant(companyId) (RLS+FORCE) + repo AND company_id tường minh.
 * BẤT BIẾN #2: soft-delete/soft-remove (KHÔNG hard-delete); audit + task_activity_logs ghi TRONG cùng tx.
 * PHÂN QUYỀN: controller gate cặp seed 0485; service thêm (a) DATA-SCOPE ĐỌC (Own/Team EXISTS-join) và
 *   (c) OWNER-CHECK cho close/delete/manage-member khi scope < Company (manager @Team) — fail-closed khi
 *   owner_employee_id NULL. company-admin @Company KHÔNG qua owner-check.
 *
 * S4-INT-1 (additive): addMember phát `PROJECT_MEMBER_ADDED` qua outbox (SPEC-06 §19) — vá gap Producer
 * (6/7 mã TASK đã phát từ S4-TASK-BE-3/4, mã thứ 8 CÒN THIẾU). CÙNG tx nghiệp vụ (rollback ⇒ event biến mất,
 * ADR-0009). Payload NON-SENSITIVE (BẤT BIẾN #3): chỉ projectId/memberEmployeeId/memberUserId/actorUserId.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ProjectsRepository,
    private readonly audit: AuditService,
    private readonly activity: TaskActivityService,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Reads (data-scope Own/Team EXISTS; Company/System thấy toàn tenant) ─────────

  async listProjects(
    user: RequestUser,
    query: ListTaskProjectsQueryRequest,
  ): Promise<TaskProjectListItemDto[]> {
    const scopeExists = await this.resolveReadScopeExists(user);
    const limit = this.clampLimit(query.limit);
    const offset = query.offset && query.offset > 0 ? query.offset : 0;
    const rows = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.listTx(
        tx,
        user.companyId,
        {
          status: query.status,
          ownerEmployeeId: query.ownerEmployeeId,
          search: query.search,
          limit,
          offset,
        },
        scopeExists,
      ),
    );
    return rows.map((r) => this.toListItem(r));
  }

  async getProject(user: RequestUser, id: string): Promise<TaskProjectResponseDto> {
    const scopeExists = await this.resolveReadScopeExists(user);
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.findDetailByIdTx(tx, user.companyId, id, scopeExists),
    );
    if (!row) throw new NotFoundException(ERR.NOT_FOUND);
    return this.toDetail(row);
  }

  async getMembers(user: RequestUser, id: string): Promise<MemberResponseDto[]> {
    const scopeExists = await this.resolveReadScopeExists(user);
    return this.db.withTenant(user.companyId, async (tx) => {
      // GET /:id/members CÙNG scope với detail: project ngoài scope ⇒ 404 (không lộ danh sách member).
      const proj = await this.repo.findDetailByIdTx(tx, user.companyId, id, scopeExists);
      if (!proj) throw new NotFoundException(ERR.NOT_FOUND);
      const rows = await this.repo.listMembersTx(tx, user.companyId, id);
      return rows.map((r) => this.toMember(r));
    });
  }

  /**
   * S4-TASK-BE-5 — GET /projects/:id/report (SPEC-06 §16.1). Gate view-report:project SENSITIVE ở controller
   * (PermissionGuard). Ở đây (defense-in-depth) resolve view-report SCOPE ⇒ giới hạn project-in-scope: manager
   * @Team chỉ project team (EXISTS member trong team-tree), hr/admin @Company thấy tất. Project ngoài scope/
   * cross-tenant/soft-deleted ⇒ findDetailByIdTx trả undefined ⇒ 404 (KHÔNG lộ tồn tại). Số liệu thô (envelope
   * API-01 do interceptor toàn cục). BẤT BIẾN #1: aggregate đi qua withTenant + repo AND company_id.
   */
  async getReport(user: RequestUser, id: string): Promise<ProjectReportDto> {
    const scopeExists = await this.resolveReportScopeExists(user);
    return this.db.withTenant(user.companyId, async (tx) => {
      const proj = await this.repo.findDetailByIdTx(tx, user.companyId, id, scopeExists);
      if (!proj) throw new NotFoundException(ERR.NOT_FOUND);
      const agg = await this.repo.aggregateReportTx(
        tx,
        user.companyId,
        id,
        TASK_PROJECT_REPORT_WORKLOAD_LIMIT,
      );
      return {
        projectId: id,
        // countsByStatus repo trả đủ 5 khóa FSM (khởi tạo 0) ⇒ khớp shape DTO cố định.
        countsByStatus: agg.countsByStatus as ProjectReportCountsByStatusDto,
        overdueCount: agg.overdueCount,
        assigneeWorkload: agg.assigneeWorkload,
      };
    });
  }

  // ── Create (creator = owner khi actor có employee mapping active) ───────────────

  async createProject(
    user: RequestUser,
    dto: CreateTaskProjectRequest,
  ): Promise<TaskProjectResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      if (await this.repo.nameExistsTx(tx, user.companyId, dto.name)) {
        throw new ConflictException(ERR.NAME_TAKEN);
      }
      if (dto.code && (await this.repo.codeExistsTx(tx, user.companyId, dto.code))) {
        throw new ConflictException(ERR.CODE_TAKEN);
      }
      if (
        dto.departmentId &&
        !(await this.repo.orgUnitExistsTx(tx, user.companyId, dto.departmentId))
      ) {
        throw new BadRequestException(ERR.DEPT_INVALID);
      }

      const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      const owner = await this.resolveOwner(tx, user, dto, actorEmp);

      const project = await this.repo.insertProjectTx(tx, user.companyId, {
        name: dto.name,
        projectCode: dto.code ?? null,
        description: dto.description ?? null,
        ownerEmployeeId: owner?.employeeId ?? null,
        departmentId: dto.departmentId ?? null,
        projectPriority: dto.priority ?? null,
        projectStatus: DEFAULT_PROJECT_STATUS,
        startDate: dto.startDate ?? null,
        endDate: dto.endDate ?? null,
        createdBy: user.id,
      });

      // Creator=Owner: chèn owner-member (user_id legacy NOT NULL + employee_id mới) khi có owner mapping.
      if (owner) {
        await this.repo.insertMemberTx(tx, user.companyId, {
          projectId: project.id,
          userId: owner.userId,
          employeeId: owner.employeeId,
          projectRole: "Owner",
          invitedBy: user.id,
          createdBy: user.id,
        });
      }

      await this.activity.record(tx, {
        action: "PROJECT_CREATED",
        targetType: "Project",
        targetId: project.id,
        projectId: project.id,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        newValues: { name: dto.name, status: DEFAULT_PROJECT_STATUS },
        message: `Tạo dự án ${dto.name}`,
      });
      await this.audit.record(tx, {
        action: "ProjectCreated",
        objectType: "project",
        objectId: project.id,
        actorUserId: user.id,
        after: {
          name: dto.name,
          code: dto.code ?? null,
          status: DEFAULT_PROJECT_STATUS,
          ownerEmployeeId: owner?.employeeId ?? null,
        },
      });

      return this.reloadDetail(tx, user.companyId, project.id);
    });
  }

  // ── Update (field non-sensitive: tồn-tại-tenant; ĐỔI CHỦ: owner-check governance) ──

  async updateProject(
    user: RequestUser,
    id: string,
    dto: UpdateTaskProjectRequest,
  ): Promise<TaskProjectResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findRawByIdTx(tx, user.companyId, id);
      if (!raw) throw new NotFoundException(ERR.NOT_FOUND);

      // BỊT BYPASS OWNER-CHECK: đổi ownerEmployeeId là hành động GOVERNANCE. Nếu chỉ tồn-tại-tenant thì
      // manager @Team (update:project@Team, write không lọc scope) có thể tự gán mình làm chủ 1 project
      // KHÔNG phải của mình rồi qua owner-check của close/delete/manage-member ⇒ vô hiệu hoá owner-check.
      // Ép assertGovern("update"): scope Company/System (company-admin) bỏ qua; scope < Company (manager)
      // PHẢI là chủ hiện tại; owner_employee_id NULL ⇒ 403 FAIL-CLOSED (không chiếm được project vô chủ).
      const reassigningOwner =
        dto.ownerEmployeeId !== undefined && dto.ownerEmployeeId !== raw.ownerEmployeeId;
      if (reassigningOwner) {
        await this.assertGovern(tx, user, raw, "update");
      }

      if (
        dto.name !== undefined &&
        (await this.repo.nameExistsTx(tx, user.companyId, dto.name, id))
      ) {
        throw new ConflictException(ERR.NAME_TAKEN);
      }
      if (
        dto.code !== undefined &&
        dto.code !== null &&
        (await this.repo.codeExistsTx(tx, user.companyId, dto.code, id))
      ) {
        throw new ConflictException(ERR.CODE_TAKEN);
      }
      if (
        dto.departmentId !== undefined &&
        dto.departmentId !== null &&
        !(await this.repo.orgUnitExistsTx(tx, user.companyId, dto.departmentId))
      ) {
        throw new BadRequestException(ERR.DEPT_INVALID);
      }
      if (dto.ownerEmployeeId !== undefined && dto.ownerEmployeeId !== null) {
        const emp = await this.repo.findEmployeeForMemberTx(
          tx,
          user.companyId,
          dto.ownerEmployeeId,
        );
        if (!emp || emp.deletedAt !== null || emp.status !== "active") {
          throw new BadRequestException(ERR.OWNER_EMPLOYEE_INVALID);
        }
      }

      const updated = await this.repo.updateProjectTx(
        tx,
        user.companyId,
        id,
        {
          name: dto.name,
          projectCode: dto.code,
          description: dto.description,
          ownerEmployeeId: dto.ownerEmployeeId,
          departmentId: dto.departmentId,
          projectPriority: dto.priority,
          startDate: dto.startDate,
          endDate: dto.endDate,
        },
        user.id,
      );
      if (!updated) throw new NotFoundException(ERR.NOT_FOUND);

      const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      await this.activity.record(tx, {
        action: "PROJECT_UPDATED",
        targetType: "Project",
        targetId: id,
        projectId: id,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        newValues: this.dtoChangedFields(dto),
        message: `Cập nhật dự án`,
      });
      await this.audit.record(tx, {
        action: "ProjectUpdated",
        objectType: "project",
        objectId: id,
        actorUserId: user.id,
        before: { changed: Object.keys(dto) },
        after: dto,
      });

      return this.reloadDetail(tx, user.companyId, id);
    });
  }

  // ── Lifecycle: close / delete (sensitive → owner-check khi scope < Company) ─────

  async closeProject(
    user: RequestUser,
    id: string,
    dto: CloseTaskProjectRequest,
  ): Promise<TaskProjectResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findRawByIdTx(tx, user.companyId, id);
      if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
      const actorEmpId = await this.assertGovern(tx, user, raw, "close");
      if (raw.projectStatus && TERMINAL_STATUSES.has(raw.projectStatus)) {
        throw new ConflictException(ERR.ALREADY_TERMINAL);
      }

      const closed = await this.repo.closeProjectTx(tx, user.companyId, id, user.id);
      if (!closed) throw new NotFoundException(ERR.NOT_FOUND);

      await this.activity.record(tx, {
        action: "PROJECT_CLOSED",
        targetType: "Project",
        targetId: id,
        projectId: id,
        actorUserId: user.id,
        actorEmployeeId: actorEmpId,
        oldValues: { status: raw.projectStatus },
        newValues: { status: "Completed" },
        message: dto.note ?? "Đóng dự án",
      });
      await this.audit.record(tx, {
        action: "ProjectClosed",
        objectType: "project",
        objectId: id,
        actorUserId: user.id,
        before: { status: raw.projectStatus },
        after: { status: "Completed", note: dto.note ?? null },
      });

      return this.reloadDetail(tx, user.companyId, id);
    });
  }

  async deleteProject(user: RequestUser, id: string): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findRawByIdTx(tx, user.companyId, id);
      if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
      const actorEmpId = await this.assertGovern(tx, user, raw, "delete");

      const deleted = await this.repo.softDeleteProjectTx(tx, user.companyId, id, user.id);
      if (!deleted) throw new NotFoundException(ERR.NOT_FOUND);

      await this.activity.record(tx, {
        action: "PROJECT_DELETED",
        targetType: "Project",
        targetId: id,
        projectId: id,
        actorUserId: user.id,
        actorEmployeeId: actorEmpId,
        message: `Xoá dự án`,
      });
      await this.audit.record(tx, {
        action: "ProjectDeleted",
        objectType: "project",
        objectId: id,
        actorUserId: user.id,
        before: { name: raw.name, status: raw.projectStatus },
      });
    });
  }

  // ── Members (sensitive manage-member → owner-check khi scope < Company) ─────────

  async addMember(
    user: RequestUser,
    id: string,
    dto: AddMemberRequest,
  ): Promise<MemberResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findRawByIdTx(tx, user.companyId, id);
      if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
      const actorEmpId = await this.assertGovern(tx, user, raw, "manage-member");

      // Resolve employee (cross-tenant ⇒ 404). status inactive/resigned/terminated/deleted ⇒ chặn.
      const emp = await this.repo.findEmployeeForMemberTx(tx, user.companyId, dto.employeeId);
      if (!emp || emp.deletedAt !== null) throw new NotFoundException(ERR.EMPLOYEE_NOT_FOUND);
      if (emp.status !== "active") throw new BadRequestException(ERR.EMPLOYEE_NOT_ACTIVE);
      // SCHEMA LEGACY: project_members.user_id NOT NULL ⇒ nhân viên chưa có account = fail-loud 400.
      if (!emp.userId) throw new BadRequestException(ERR.MEMBER_NO_ACCOUNT);

      // Chống-trùng đo trên CẢ HAI unique (legacy user_id + mới employee_id).
      if (await this.repo.activeMemberByUserExistsTx(tx, user.companyId, id, emp.userId)) {
        throw new ConflictException(ERR.MEMBER_DUP);
      }
      if (await this.repo.activeMemberByEmployeeExistsTx(tx, user.companyId, id, emp.id)) {
        throw new ConflictException(ERR.MEMBER_DUP);
      }

      const member = await this.repo.insertMemberTx(tx, user.companyId, {
        projectId: id,
        userId: emp.userId,
        employeeId: emp.id,
        projectRole: dto.projectRole,
        invitedBy: user.id,
        createdBy: user.id,
      });

      await this.activity.record(tx, {
        action: "MEMBER_ADDED",
        targetType: "Member",
        targetId: member.id,
        projectId: id,
        actorUserId: user.id,
        actorEmployeeId: actorEmpId,
        newValues: { employeeId: emp.id, projectRole: dto.projectRole },
        message: `Thêm thành viên`,
      });
      await this.audit.record(tx, {
        action: "ProjectMemberAdded",
        objectType: "project",
        objectId: id,
        actorUserId: user.id,
        after: { memberId: member.id, employeeId: emp.id, projectRole: dto.projectRole },
      });
      // S4-INT-1 — Producer gap vá: PROJECT_MEMBER_ADDED (SPEC-06 §19). emp.userId đã fail-loud non-null
      // ở trên (ERR.MEMBER_NO_ACCOUNT) — an toàn truyền thẳng.
      // S5-NOTI-FIX-2 (lane noti-fix2-project) — additive: `project_name`/`project_code` (snake_case) khớp
      // CHÍNH XÁC placeholder template global 0481 (`{project_name}`/`{project_code}` seed
      // PROJECT_MEMBER_ADDED__IN_APP__vi-VN). `raw` (Project, đã load ở đầu hàm qua findRawByIdTx) có sẵn
      // name/projectCode — KHÔNG cần query thêm. `projectCode` NULLABLE (schema `text("project_code")` không
      // NOT NULL) ⇒ coalesce `?? ""` để renderer (interpolate: value===null/undefined mới giữ placeholder)
      // KHÔNG rớt lại `{project_code}` trần trong body khi dự án chưa có mã — short_body_template (0481) CHỈ
      // dùng `{project_name}` nên luôn sạch bất kể quyết định coalesce này. Key camelCase cũ GIỮ NGUYÊN tên.
      await this.outbox.enqueue(tx, {
        eventType: "project.member_added",
        payload: {
          eventCode: "PROJECT_MEMBER_ADDED",
          projectId: id,
          memberEmployeeId: emp.id,
          memberUserId: emp.userId,
          actorUserId: user.id,
          project_name: raw.name,
          project_code: raw.projectCode ?? "",
        },
      });

      return this.reloadMember(tx, user.companyId, id, member.id);
    });
  }

  async updateMemberRole(
    user: RequestUser,
    id: string,
    memberId: string,
    dto: UpdateMemberRoleRequest,
  ): Promise<MemberResponseDto> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findRawByIdTx(tx, user.companyId, id);
      if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
      const actorEmpId = await this.assertGovern(tx, user, raw, "manage-member");

      const member = await this.repo.findMemberByIdTx(tx, user.companyId, id, memberId);
      if (!member) throw new NotFoundException(ERR.MEMBER_NOT_FOUND);

      // Hạ cấp Owner cuối cùng ⇒ chặn (giữ ≥1 Owner để owner-check còn hiệu lực).
      if (member.projectRole === "Owner" && dto.projectRole !== "Owner") {
        const others = await this.repo.countOtherActiveOwnersTx(tx, user.companyId, id, memberId);
        if (others === 0) throw new ConflictException(ERR.LAST_OWNER);
      }

      const updated = await this.repo.updateMemberRoleTx(
        tx,
        user.companyId,
        memberId,
        dto.projectRole,
        user.id,
      );
      if (!updated) throw new NotFoundException(ERR.MEMBER_NOT_FOUND);

      await this.activity.record(tx, {
        action: "MEMBER_ROLE_CHANGED",
        targetType: "Member",
        targetId: memberId,
        projectId: id,
        actorUserId: user.id,
        actorEmployeeId: actorEmpId,
        oldValues: { projectRole: member.projectRole },
        newValues: { projectRole: dto.projectRole },
        message: `Đổi vai trò thành viên`,
      });
      await this.audit.record(tx, {
        action: "ProjectMemberRoleChanged",
        objectType: "project",
        objectId: id,
        actorUserId: user.id,
        before: { memberId, projectRole: member.projectRole },
        after: { memberId, projectRole: dto.projectRole },
      });

      return this.reloadMember(tx, user.companyId, id, memberId);
    });
  }

  async removeMember(user: RequestUser, id: string, memberId: string): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx) => {
      const raw = await this.repo.findRawByIdTx(tx, user.companyId, id);
      if (!raw) throw new NotFoundException(ERR.NOT_FOUND);
      const actorEmpId = await this.assertGovern(tx, user, raw, "manage-member");

      const member = await this.repo.findMemberByIdTx(tx, user.companyId, id, memberId);
      if (!member) throw new NotFoundException(ERR.MEMBER_NOT_FOUND);

      if (member.projectRole === "Owner") {
        const others = await this.repo.countOtherActiveOwnersTx(tx, user.companyId, id, memberId);
        if (others === 0) throw new ConflictException(ERR.LAST_OWNER);
      }

      const removed = await this.repo.softRemoveMemberTx(tx, user.companyId, memberId, user.id);
      if (!removed) throw new NotFoundException(ERR.MEMBER_NOT_FOUND);

      await this.activity.record(tx, {
        action: "MEMBER_REMOVED",
        targetType: "Member",
        targetId: memberId,
        projectId: id,
        actorUserId: user.id,
        actorEmployeeId: actorEmpId,
        oldValues: { employeeId: member.employeeId, projectRole: member.projectRole },
        message: `Gỡ thành viên`,
      });
      await this.audit.record(tx, {
        action: "ProjectMemberRemoved",
        objectType: "project",
        objectId: id,
        actorUserId: user.id,
        before: { memberId, employeeId: member.employeeId, projectRole: member.projectRole },
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** DATA-SCOPE ĐỌC: Company/System ⇒ undefined (thấy toàn tenant); Own/Team ⇒ EXISTS-join predicate. */
  private async resolveReadScopeExists(user: RequestUser): Promise<SQL | undefined> {
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "read", "project");
    if (scope === "Company" || scope === "System") return undefined;
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    return this.repo.buildScopeExists(user.companyId, scopeCond);
  }

  /**
   * DATA-SCOPE cho REPORT: dùng SCOPE của view-report:project (SENSITIVE) — KHÔNG mượn read:project — để
   * project-in-scope KHỚP đúng năng lực báo cáo của actor (fail-safe: người có view-report@Team chỉ báo cáo
   * project team dù read@Company). resolveAndAssert ném 403 nếu KHÔNG có grant (trùng PermissionGuard route).
   */
  private async resolveReportScopeExists(user: RequestUser): Promise<SQL | undefined> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "view-report",
      "project",
      { isSensitive: true },
    );
    if (scope === "Company" || scope === "System") return undefined;
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    return this.repo.buildScopeExists(user.companyId, scopeCond);
  }

  /**
   * OWNER-CHECK cho hành động sensitive (close/delete/manage-member). Trả actorEmployeeId (cho activity).
   * scope Company/System (company-admin) ⇒ KHÔNG owner-check. scope < Company (manager @Team) ⇒ actor PHẢI
   * là owner (employeeId === owner_employee_id); owner_employee_id NULL ⇒ 403 FAIL-CLOSED.
   */
  private async assertGovern(
    tx: TenantTx,
    user: RequestUser,
    project: Project,
    action: string,
  ): Promise<string | null> {
    const scope = await this.permission.resolveStrongestScope(
      user.id,
      user.companyId,
      action,
      "project",
      { isSensitive: true },
    );
    if (scope === null) throw new ForbiddenException(ERR.FORBIDDEN);
    const actorEmp = await this.repo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
    const actorEmpId = actorEmp?.id ?? null;
    if (scope !== "Company" && scope !== "System") {
      if (!project.ownerEmployeeId) throw new ForbiddenException(ERR.OWNER_REQUIRED);
      if (!actorEmpId || actorEmpId !== project.ownerEmployeeId) {
        throw new ForbiddenException(ERR.NOT_OWNER);
      }
    }
    return actorEmpId;
  }

  /** Chọn owner: dto.ownerEmployeeId (được chỉ định) ⇒ validate active + có account; else actor mapping. */
  private async resolveOwner(
    tx: TenantTx,
    user: RequestUser,
    dto: CreateTaskProjectRequest,
    actorEmp: { id: string; userId: string | null } | undefined,
  ): Promise<{ employeeId: string; userId: string } | null> {
    if (dto.ownerEmployeeId) {
      const emp = await this.repo.findEmployeeForMemberTx(tx, user.companyId, dto.ownerEmployeeId);
      if (!emp || emp.deletedAt !== null || emp.status !== "active") {
        throw new BadRequestException(ERR.OWNER_EMPLOYEE_INVALID);
      }
      if (!emp.userId) throw new BadRequestException(ERR.OWNER_NO_ACCOUNT);
      return { employeeId: emp.id, userId: emp.userId };
    }
    if (actorEmp?.userId) return { employeeId: actorEmp.id, userId: actorEmp.userId };
    return null;
  }

  private clampLimit(limit?: number): number {
    if (!limit || limit <= 0) return DEFAULT_LIST_LIMIT;
    return Math.min(Math.floor(limit), TASK_PROJECT_PAGE_LIMIT_MAX);
  }

  private dtoChangedFields(dto: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  private async reloadDetail(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<TaskProjectResponseDto> {
    const row = await this.repo.findDetailByIdTx(tx, companyId, id);
    if (!row) throw new InternalServerErrorException("Không tải lại được dự án vừa ghi.");
    return this.toDetail(row);
  }

  private async reloadMember(
    tx: TenantTx,
    companyId: string,
    projectId: string,
    memberId: string,
  ): Promise<MemberResponseDto> {
    const rows = await this.repo.listMembersTx(tx, companyId, projectId);
    const found = rows.find((r) => r.id === memberId);
    if (!found) throw new InternalServerErrorException("Không tải lại được thành viên vừa ghi.");
    return this.toMember(found);
  }

  // ── Projection (Date → ISO; enum cast an toàn nhờ DB CHECK) ────────────────────

  private toDetail(row: ProjectDetailRow): TaskProjectResponseDto {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      name: row.name,
      description: row.description,
      ownerEmployeeId: row.ownerEmployeeId,
      ownerName: row.ownerName,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      priority: row.priority as TaskProjectPriorityDto | null,
      status: row.status as TaskProjectStatusDto | null,
      startDate: row.startDate,
      endDate: row.endDate,
      memberCount: row.memberCount,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      closedBy: row.closedBy,
    };
  }

  private toListItem(row: ProjectDetailRow): TaskProjectListItemDto {
    const { description: _d, closedBy: _c, ...rest } = this.toDetail(row);
    return rest;
  }

  private toMember(row: ProjectMemberRow): MemberResponseDto {
    return {
      id: row.id,
      projectId: row.projectId,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      employeeCode: row.employeeCode,
      departmentName: row.departmentName,
      projectRole: row.projectRole as ProjectRoleDto | null,
      status: row.status as ProjectMemberStatusDto | null,
      joinedAt: row.joinedAt ? row.joinedAt.toISOString() : null,
      removedAt: row.removedAt ? row.removedAt.toISOString() : null,
    };
  }
}
