import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { GOAL_ERR } from "./goals.errors";
import {
  GoalsRepository,
  type EmployeeRefRow,
  type GoalRefRow,
  type ProjectRefRow,
} from "./goals.repository";

/**
 * S5-GOAL-BE-1 — luật nghiệp vụ GOAL (SPEC-10 §12) tách khỏi orchestration.
 *
 * MỘT ĐƯỜNG VALIDATE DUY NHẤT cho cả create lẫn update: update merge trạng thái hiện tại với payload rồi
 * chạy LẠI TOÀN BỘ (không patch từng field) — vá lỗ "đổi 1 cột làm vỡ bất biến mà CHECK vẫn cho qua"
 * (vd đổi `level` mà giữ nguyên cột neo cũ).
 *
 * BẪY SỐ 1 ĐÃ XỬ LÝ: FK đơn cột KHÔNG ép cùng-tenant (finding gate S5-GOAL-DB-1) ⇒ MỌI id client gửi
 * (department/project/employee/owner/parent) resolve DƯỚI `company_id` của actor TRƯỚC khi ghi; thuộc
 * công ty khác ⇒ 404 (không lộ tồn tại), KHÔNG để vỡ FK thành 500.
 */

/** Trạng thái MONG MUỐN của goal sau thao tác (đã merge với bản ghi hiện tại nếu là update). */
export interface GoalDesiredState {
  name: string;
  description: string | null;
  level: string;
  departmentId: string | null;
  projectId: string | null;
  employeeId: string | null;
  parentGoalId: string | null;
  ownerEmployeeId: string | null;
  periodType: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  measureType: string;
  targetValue: number | null;
  unit: string | null;
  progressMode: string;
  weight: number;
  status: string;
}

/** Kết quả validate: giá trị đã chuẩn hoá + các thực thể neo đã resolve (dùng tiếp cho write-scope). */
export interface ResolvedGoalWrite {
  values: Required<
    Pick<
      GoalDesiredState,
      "level" | "periodType" | "measureType" | "progressMode" | "status" | "name"
    >
  > &
    GoalDesiredState & {
      ownerEmployeeId: string;
      periodStart: string;
      periodEnd: string;
    };
  department: { id: string } | null;
  project: ProjectRefRow | null;
  employee: EmployeeRefRow | null;
  parent: GoalRefRow | null;
  /** Phòng ban SUY RA từ neo (goal phòng → chính nó · dự án → phòng dự án · nhân viên → phòng nhân viên). */
  anchorDepartmentId: string | null;
}

/** Chiều cha-con hợp lệ (SPEC-10 §3.1 / GOAL-DEC-010). `department` chưa có cha vì cấp company đóng ở MVP. */
const ALLOWED_PARENT_LEVELS: Record<string, readonly string[]> = {
  employee: ["project", "department"],
  project: ["department"],
  department: [],
  company: [],
};

/** Trần số bước đi ngược cây khi dò chu trình (cây thiết kế ≤3 tầng — dư sức, chặn dữ liệu lệch). */
const MAX_ANCESTOR_WALK = 16;

@Injectable()
export class GoalsValidationService {
  constructor(private readonly repo: GoalsRepository) {}

  /**
   * Validate + resolve toàn bộ trạng thái mong muốn. `goalId` chỉ có ở đường update (dùng cho chống
   * chu trình). `actorEmployeeId` dùng suy `ownerEmployeeId` khi client không gửi.
   */
  async resolve(
    tx: TenantTx,
    companyId: string,
    desired: GoalDesiredState,
    ctx: { goalId?: string; actorEmployeeId: string | null },
  ): Promise<ResolvedGoalWrite> {
    if (desired.level === "company") throw new UnprocessableEntityException(GOAL_ERR.LEVEL_COMPANY);
    this.assertAnchorShape(desired);

    const department = await this.resolveDepartment(tx, companyId, desired);
    const project = await this.resolveProject(tx, companyId, desired);
    const employee = await this.resolveEmployee(tx, companyId, desired);
    const ownerEmployeeId = await this.resolveOwner(tx, companyId, desired, ctx.actorEmployeeId);
    this.assertEmployeeGoal(desired, employee, ownerEmployeeId);

    const parent = await this.resolveParent(tx, companyId, desired, ctx.goalId);
    const { periodStart, periodEnd } = this.assertPeriod(desired);
    this.assertMeasurement(desired);

    return {
      values: { ...desired, ownerEmployeeId, periodStart, periodEnd },
      department,
      project,
      employee,
      parent,
      anchorDepartmentId:
        desired.level === "department"
          ? desired.departmentId
          : desired.level === "project"
            ? (project?.departmentId ?? null)
            : (employee?.orgUnitId ?? null),
    };
  }

  // ── GOAL-ERR-001: đúng 1 cột neo theo cấp, các cột neo khác PHẢI NULL ─────────
  private assertAnchorShape(d: GoalDesiredState): void {
    const anchors: Record<string, string | null> = {
      department_id: d.departmentId,
      project_id: d.projectId,
      employee_id: d.employeeId,
    };
    const required: Record<string, string> = {
      department: "department_id",
      project: "project_id",
      employee: "employee_id",
    };
    const need = required[d.level];
    if (!need) throw new UnprocessableEntityException(GOAL_ERR.LEVEL_COMPANY);
    if (!anchors[need]) {
      throw new UnprocessableEntityException(
        GOAL_ERR.ANCHOR(`cấp '${d.level}' bắt buộc có ${need}.`),
      );
    }
    const extra = Object.entries(anchors)
      .filter(([key, value]) => key !== need && value)
      .map(([key]) => key);
    if (extra.length > 0) {
      throw new UnprocessableEntityException(
        GOAL_ERR.ANCHOR(`cấp '${d.level}' phải để trống ${extra.join(", ")}.`),
      );
    }
  }

  // ── Resolve neo DƯỚI tenant (chéo công ty ⇒ 404) ─────────────────────────────
  private async resolveDepartment(
    tx: TenantTx,
    companyId: string,
    d: GoalDesiredState,
  ): Promise<{ id: string } | null> {
    if (!d.departmentId) return null;
    const row = await this.repo.resolveDepartmentTx(tx, companyId, d.departmentId);
    if (!row) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("phòng ban"));
    return row;
  }

  private async resolveProject(
    tx: TenantTx,
    companyId: string,
    d: GoalDesiredState,
  ): Promise<ProjectRefRow | null> {
    if (!d.projectId) return null;
    const row = await this.repo.resolveProjectTx(tx, companyId, d.projectId);
    if (!row) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("dự án"));
    return row;
  }

  private async resolveEmployee(
    tx: TenantTx,
    companyId: string,
    d: GoalDesiredState,
  ): Promise<EmployeeRefRow | null> {
    if (!d.employeeId) return null;
    const row = await this.repo.resolveEmployeeTx(tx, companyId, d.employeeId);
    if (!row) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("nhân viên"));
    return row;
  }

  /** owner client gửi ⇒ resolve dưới tenant; vắng ⇒ suy (goal nhân viên = chủ thể · còn lại = actor). */
  private async resolveOwner(
    tx: TenantTx,
    companyId: string,
    d: GoalDesiredState,
    actorEmployeeId: string | null,
  ): Promise<string> {
    if (d.ownerEmployeeId) {
      const row = await this.repo.resolveEmployeeTx(tx, companyId, d.ownerEmployeeId);
      if (!row) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("người phụ trách"));
      return row.id;
    }
    if (d.level === "employee" && d.employeeId) return d.employeeId;
    if (actorEmployeeId) return actorEmployeeId;
    throw new UnprocessableEntityException(GOAL_ERR.OWNER_UNRESOLVED);
  }

  // ── GOAL-ERR-010: goal nhân viên — employee Active + owner = employee ────────
  private assertEmployeeGoal(
    d: GoalDesiredState,
    employee: EmployeeRefRow | null,
    ownerEmployeeId: string,
  ): void {
    if (d.level !== "employee" || !employee) return;
    // employee_profiles.status là enum CHỮ THƯỜNG ('active'/'inactive'/'resigned'/'terminated') —
    // KHÔNG nhầm với goals.status TitleCase ('Draft'/'Active'/...).
    if (employee.status !== "active") {
      throw new UnprocessableEntityException(
        GOAL_ERR.EMPLOYEE_GOAL("nhân viên không còn hoạt động."),
      );
    }
    if (ownerEmployeeId !== employee.id) {
      throw new UnprocessableEntityException(
        GOAL_ERR.EMPLOYEE_GOAL("người phụ trách phải là chính nhân viên đó."),
      );
    }
  }

  // ── GOAL-ERR-002: cha cùng company + đúng chiều cấp + không tạo chu trình ────
  private async resolveParent(
    tx: TenantTx,
    companyId: string,
    d: GoalDesiredState,
    goalId?: string,
  ): Promise<GoalRefRow | null> {
    if (!d.parentGoalId) return null;
    if (goalId && d.parentGoalId === goalId) {
      throw new UnprocessableEntityException(GOAL_ERR.PARENT_CYCLE);
    }
    const parent = await this.repo.findGoalRefTx(tx, companyId, d.parentGoalId);
    if (!parent) throw new NotFoundException(GOAL_ERR.REF_NOT_FOUND("mục tiêu cha"));

    const allowed = ALLOWED_PARENT_LEVELS[d.level] ?? [];
    if (!allowed.includes(parent.level)) {
      throw new UnprocessableEntityException(
        GOAL_ERR.PARENT_DIRECTION(
          allowed.length === 0
            ? `mục tiêu cấp '${d.level}' chưa được phép có mục tiêu cha ở phiên bản này.`
            : `cha của mục tiêu cấp '${d.level}' phải ở cấp ${allowed.join(" hoặc ")} (đang là '${parent.level}').`,
        ),
      );
    }
    if (goalId) await this.assertNoCycle(tx, companyId, parent, goalId);
    return parent;
  }

  /**
   * Đi NGƯỢC chuỗi cha từ `parent`: gặp lại chính goal đang sửa ⇒ chu trình (GOAL-ERR-002).
   * Luật chiều cấp đã chặn phần lớn ca, NHƯNG dữ liệu lệch (seed/migration/di sản) vẫn dựng được vòng
   * mà mỗi cạnh đều "đúng chiều" — nên guard này là tường minh, không phải thừa.
   */
  private async assertNoCycle(
    tx: TenantTx,
    companyId: string,
    parent: GoalRefRow,
    goalId: string,
  ): Promise<void> {
    let cursor: string | null = parent.parentGoalId;
    for (let hop = 0; hop < MAX_ANCESTOR_WALK && cursor; hop += 1) {
      if (cursor === goalId) throw new UnprocessableEntityException(GOAL_ERR.PARENT_CYCLE);
      const row: GoalRefRow | undefined = await this.repo.findGoalRefTx(tx, companyId, cursor);
      if (!row) return;
      cursor = row.parentGoalId;
    }
    if (cursor) {
      // Chuỗi dài bất thường ⇒ dữ liệu cây hỏng: từ chối fail-loud thay vì ghi thêm cạnh.
      throw new UnprocessableEntityException(GOAL_ERR.PARENT_CYCLE);
    }
  }

  // ── GOAL-ERR-003 / 011 / 012 / 015 ──────────────────────────────────────────
  private assertPeriod(d: GoalDesiredState): { periodStart: string; periodEnd: string } {
    if (!d.periodStart || !d.periodEnd) {
      throw new UnprocessableEntityException(
        GOAL_ERR.PERIOD("cần cả ngày bắt đầu và ngày kết thúc kỳ."),
      );
    }
    if (d.periodEnd < d.periodStart) {
      throw new UnprocessableEntityException(
        GOAL_ERR.PERIOD("ngày kết thúc kỳ phải sau hoặc bằng ngày bắt đầu."),
      );
    }
    return { periodStart: d.periodStart, periodEnd: d.periodEnd };
  }

  private assertMeasurement(d: GoalDesiredState): void {
    if (!(d.weight > 0)) throw new UnprocessableEntityException(GOAL_ERR.WEIGHT);
    if (d.progressMode === "project" && d.level !== "project") {
      throw new UnprocessableEntityException(GOAL_ERR.MODE_PROJECT);
    }
    if (d.measureType === "number" && d.progressMode === "manual" && d.targetValue === null) {
      throw new UnprocessableEntityException(GOAL_ERR.TARGET_REQUIRED);
    }
  }
}
