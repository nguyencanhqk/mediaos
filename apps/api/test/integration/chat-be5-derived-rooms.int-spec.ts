/**
 * S7-CHAT-BE-5 — phòng chat dẫn xuất theo phòng ban & dự án (SPEC-15 §13.3), trên Postgres THẬT.
 *
 * Vì sao phải chạy trên DB thật, không unit test được:
 *   • `chat_room_members` chỉ được cấp UPDATE **6 cột** và KHÔNG có DELETE (`0538`) — mọi câu ghi sai cột
 *     là `42501` LÚC CHẠY, TypeScript và unit test đều mù;
 *   • hai CHECK chéo `chk_chat_rooms_type_anchor` / `chk_chat_rooms_sync_source` chỉ nổ ở Postgres;
 *   • `SAVEPOINT` (nhánh CẤP) vs không-SAVEPOINT (nhánh THU HỒI) chỉ khác nhau khi có transaction thật:
 *     mock `withTenant` sẽ cho cả hai cùng "chạy được" và ca 15 mất sạch ý nghĩa;
 *   • vị từ desired-set sống trong SQL — bản mock sẽ đo bản chép tay, không đo bản chạy thật.
 *
 * Chủ thể KHÔNG PHẢI Super Admin (SA khớp `*:*` nên mọi ca positive thành tautology — xem ghi chú đầu
 * `chat-be1-access.int-spec.ts`). Hook được gọi qua SERVICE thật với DI thật: WO này không thêm route
 * nào, nên tầng HTTP không có gì mới để đo; thứ phải chứng minh là hệ quả trong CÙNG transaction.
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { OrgService } from "../../src/org/org.service";
import { HrDepartmentService } from "../../src/org/hr-department.service";
import { ProjectsService } from "../../src/tasks/projects.service";
import { HrWriteService } from "../../src/employees/hr-write.service";
import { EmployeesService } from "../../src/employees/employees.service";
import { RecycleBinService } from "../../src/recycle-bin/recycle-bin.service";
import { ChatAccessService } from "../../src/chat/chat-access.service";
import {
  ChatDerivedRoomsSyncService,
  ChatSyncRevokeError,
} from "../../src/chat/chat-derived-rooms-sync.service";
import { ChatDerivedRoomsReconcileJobHandler } from "../../src/chat/chat-derived-rooms-reconcile.job-handler";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd", "chatbe5"].join("!");

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope, sensitive?: boolean];

/** Cặp quyền tối thiểu để 14 writer chạy được — WO này KHÔNG thêm cặp mới nào. */
const WRITER_PAIRS: PairGrant[] = [
  ["create", "employee", "Company"],
  ["update", "employee", "Company"],
  ["change-status", "employee", "Company"],
  ["read", "project", "Company"],
  ["update", "project", "Company", true],
  ["close", "project", "Company", true],
  ["delete", "project", "Company", true],
  ["manage-member", "project", "Company", true],
];

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-5 — phòng dẫn xuất (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let org: OrgService;
  let hrDept: HrDepartmentService;
  let projects: ProjectsService;
  let hrWrite: HrWriteService;
  let employees: EmployeesService;
  let recycleBin: RecycleBinService;
  let access: ChatAccessService;
  let chatSync: ChatDerivedRoomsSyncService;
  let job: ChatDerivedRoomsReconcileJobHandler;
  let db: DatabaseService;

  /** Actor HR/TASK — người thật có grant Company, KHÔNG phải Super Admin. */
  let actor: { id: string; companyId: string };

  // ─── helper gieo (superuser, bỏ qua RLS — chỉ để DỰNG bối cảnh, không để assert) ───

  async function seedOrgUnit(
    companyId: string,
    name: string,
    type = "department",
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, type, status) VALUES ($1,$2,$3,'active') RETURNING id`,
      [companyId, name, type],
    );
    return r.rows[0].id as string;
  }

  async function seedEmployee(
    companyId: string,
    opts: { userId?: string | null; orgUnitId?: string | null; status?: string },
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, employee_code)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        companyId,
        opts.userId ?? null,
        opts.orgUnitId ?? null,
        opts.status ?? "active",
        `E-${Math.random().toString(36).slice(2, 9)}`,
      ],
    );
    return r.rows[0].id as string;
  }

  async function seedProject(companyId: string, name: string, status = "Active"): Promise<string> {
    const r = await direct.query(
      `INSERT INTO projects (company_id, name, project_status) VALUES ($1,$2,$3) RETURNING id`,
      [companyId, name, status],
    );
    return r.rows[0].id as string;
  }

  async function seedProjectMember(
    companyId: string,
    projectId: string,
    userId: string,
    employeeId: string,
    memberStatus: string | null = "Active",
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status)
       VALUES ($1,$2,$3,$4,'Member',$5) RETURNING id`,
      [companyId, projectId, userId, employeeId, memberStatus],
    );
    return r.rows[0].id as string;
  }

  // ─── helper đo (đọc trạng thái THẬT sau mỗi hành động) ───

  async function roomOfOrgUnit(orgUnitId: string): Promise<Record<string, unknown> | undefined> {
    const r = await direct.query(`SELECT * FROM chat_rooms WHERE org_unit_id = $1`, [orgUnitId]);
    return r.rows[0];
  }

  async function roomOfProject(projectId: string): Promise<Record<string, unknown> | undefined> {
    const r = await direct.query(`SELECT * FROM chat_rooms WHERE ref_id = $1`, [projectId]);
    return r.rows[0];
  }

  async function memberRow(
    roomId: string,
    userId: string,
  ): Promise<
    { left_at: Date | null; joined_at: Date; visible_from_seq: string | null } | undefined
  > {
    const r = await direct.query(
      `SELECT left_at, joined_at, visible_from_seq FROM chat_room_members WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId],
    );
    return r.rows[0];
  }

  async function isActiveMember(roomId: string, userId: string): Promise<boolean> {
    const row = await memberRow(roomId, userId);
    return !!row && row.left_at === null;
  }

  async function activeRoomCountOf(userId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM chat_room_members m
        JOIN chat_rooms r ON r.id = m.room_id
       WHERE m.user_id = $1 AND m.left_at IS NULL AND r.sync_source IN ('department','project')`,
      [userId],
    );
    return r.rows[0].n as number;
  }

  async function auditActions(objectId: string): Promise<string[]> {
    const r = await direct.query(
      `SELECT action FROM audit_logs WHERE object_id = $1 ORDER BY created_at`,
      [objectId],
    );
    return r.rows.map((x) => x.action as string);
  }

  function runJob(companyId: string) {
    return job.run({ companyId });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    org = app.get(OrgService);
    hrDept = app.get(HrDepartmentService);
    projects = app.get(ProjectsService);
    hrWrite = app.get(HrWriteService);
    employees = app.get(EmployeesService);
    recycleBin = app.get(RecycleBinService);
    access = app.get(ChatAccessService);
    chatSync = app.get(ChatDerivedRoomsSyncService);
    job = app.get(ChatDerivedRoomsReconcileJobHandler, { strict: false });
    db = app.get(DatabaseService);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "cb5a");
    B = await seedCompany(direct, "cb5b");
    companyIds.push(A.companyId, B.companyId);

    const actorUserId = await seedUser(direct, A.companyId, `actor@${A.slug}.test`, hash);
    actor = { id: actorUserId, companyId: A.companyId };

    const roleId = await seedRole(direct, A.companyId, `cb5-writer`);
    for (const [action, resource, scope, sensitive] of WRITER_PAIRS) {
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive ?? false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, actorUserId, roleId, A.companyId);
    // Actor cũng phải là nhân viên active (ProjectsService resolve owner theo employee mapping).
    await seedEmployee(A.companyId, { userId: actorUserId });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ══════════════ A. TẠO PHÒNG (W1 · W2 · W3 · W4 · W5) ══════════════

  describe("A. tạo & đóng phòng", () => {
    it("ca 1 — POST /org/units type=department ⇒ đúng 1 phòng department, syncSource+syncedAt đúng", async () => {
      const unit = await org.createOrgUnit(A.companyId, {
        type: "department",
        name: `Ban Biên tập ${Date.now()}`,
      });
      const room = await roomOfOrgUnit(unit.id);

      expect(room, "phải sinh phòng cho org_unit type=department").toBeTruthy();
      expect(room!.room_type).toBe("department");
      expect(room!.sync_source).toBe("department");
      expect(room!.synced_at).not.toBeNull();
      expect(String(room!.room_code)).toMatch(/^ROOM-\d{4,}$/);
      // Neo bộ CHECK chéo: department PHẢI có org_unit_id và KHÔNG có 2 neo còn lại.
      expect(room!.direct_key).toBeNull();
      expect(room!.ref_id).toBeNull();
      expect(await auditActions(room!.id as string)).toContain("chat.room.auto_created");
    });

    it("ca 2 — org_unit type=division KHÔNG sinh phòng nào (§3.8)", async () => {
      const unit = await org.createOrgUnit(A.companyId, {
        name: `Khối Miền Nam ${Date.now()}`,
        type: "division",
      });
      expect(await roomOfOrgUnit(unit.id)).toBeUndefined();
    });

    it("ca 3 — writer THỨ HAI (POST /hr/departments) cũng sinh phòng", async () => {
      const dept = await hrDept.createDepartment(A.companyId, actor.id, {
        name: `Phòng Kỹ thuật ${Date.now()}`,
      } as never);
      const room = await roomOfOrgUnit(dept.id);
      expect(room, "hook một họ writer là bỏ lọt nửa số đường tạo phòng ban").toBeTruthy();
      expect(room!.sync_source).toBe("department");
    });

    it("ca 4 — ensureOrgUnitRoom gọi 2 lần cùng org_unit ⇒ vẫn 1 phòng, không 23505 thoát ra", async () => {
      const unitId = await seedOrgUnit(A.companyId, `Idem ${Date.now()}`);
      const first = await chatSync.ensureOrgUnitRoom(A.companyId, unitId, "Idem", { kind: "job" });
      const second = await chatSync.ensureOrgUnitRoom(A.companyId, unitId, "Idem", { kind: "job" });
      expect(second).toBe(first);

      const r = await direct.query(
        `SELECT count(*)::int AS n FROM chat_rooms WHERE org_unit_id = $1`,
        [unitId],
      );
      expect(r.rows[0].n).toBe(1);
    });

    it("ca 5 (H1) — tạo dự án ⇒ owner ĐỌC ĐƯỢC phòng NGAY, không chờ job", async () => {
      const detail = await projects.createProject(actor, {
        name: `Dự án ${Date.now()}`,
      } as never);
      const room = await roomOfProject(detail.id);
      expect(room, "dự án mới phải có phòng").toBeTruthy();
      expect(room!.room_type).toBe("project");
      expect(room!.sync_source).toBe("project");

      // Đích thật: `assertMember` (đường quyền DUY NHẤT của module) chấp nhận owner NGAY LẬP TỨC.
      await expect(
        db.withTenant(A.companyId, (tx) =>
          access.assertMember(tx, A.companyId, room!.id as string, actor.id),
        ),
      ).resolves.toBeTruthy();
    });

    it("ca 11 — đóng/xoá dự án ⇒ phòng lưu trữ, thành viên KHÔNG bị đuổi (đọc lại lịch sử được)", async () => {
      const detail = await projects.createProject(actor, {
        name: `Dự án đóng ${Date.now()}`,
      } as never);
      const room = await roomOfProject(detail.id);
      expect(await isActiveMember(room!.id as string, actor.id)).toBe(true);

      await projects.closeProject(actor, detail.id, {} as never);

      const after = await roomOfProject(detail.id);
      expect(after!.is_archived).toBe(true);
      // Lưu trữ = ĐÓNG BĂNG. Đuổi hết người ở đây sẽ làm chính họ mất đường đọc lại (listRooms đòi
      // left_at IS NULL kể cả với archived=true).
      expect(await isActiveMember(room!.id as string, actor.id)).toBe(true);
      expect(await auditActions(room!.id as string)).toContain("chat.room.auto_archived");

      // Idempotent: chạy job sau đó không đóng lần hai, không đuổi ai.
      await runJob(A.companyId);
      expect(await isActiveMember(room!.id as string, actor.id)).toBe(true);
      expect(
        (await auditActions(room!.id as string)).filter((a) => a === "chat.room.auto_archived")
          .length,
      ).toBe(1);
    });
  });

  // ══════════════ B. ĐỒNG BỘ THỜI-GIAN-THỰC (ca a · b · c · 6-10 · 19 · 20) ══════════════

  describe("B. đồng bộ thành viên trong tx nguồn", () => {
    it("ca b — PATCH /employees/:id đổi orgUnitId A→B: rời A + vào B trong CÙNG response", async () => {
      const ouA = await seedOrgUnit(A.companyId, `DeptA ${Date.now()}`);
      const ouB = await seedOrgUnit(A.companyId, `DeptB ${Date.now()}`);
      const roomA = await chatSync.ensureOrgUnitRoom(A.companyId, ouA, "A", { kind: "job" });
      const roomB = await chatSync.ensureOrgUnitRoom(A.companyId, ouB, "B", { kind: "job" });

      const uid = await seedUser(direct, A.companyId, `mv-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ouA });
      await runJob(A.companyId);
      expect(await isActiveMember(roomA, uid)).toBe(true);

      await employees.updateEmployee(actor, empId, { orgUnitId: ouB } as never);

      // KHÔNG chờ job: cả hai vế phải đúng ngay sau khi response trả về.
      expect(await isActiveMember(roomA, uid), "phải RỜI phòng cũ ngay").toBe(false);
      expect(await isActiveMember(roomB, uid), "phải VÀO phòng mới ngay").toBe(true);

      // Đích thật: đường quyền của module từ chối phòng cũ NGAY (404, không phải 403 — SPEC-15).
      await expect(
        db.withTenant(A.companyId, (tx) => access.assertMember(tx, A.companyId, roomA, uid)),
      ).rejects.toThrow();
    });

    it("ca a — nghỉ việc rời MỌI phòng dẫn xuất, và job KHÔNG join lại (vế employee_profiles.status)", async () => {
      const ou = await seedOrgUnit(A.companyId, `Nghi ${Date.now()}`);
      const roomD = await chatSync.ensureOrgUnitRoom(A.companyId, ou, "D", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `res-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ou });

      const p1 = await seedProject(A.companyId, `P1 ${Date.now()}`);
      const p2 = await seedProject(A.companyId, `P2 ${Date.now()}`);
      const room1 = await chatSync.ensureProjectRoom(A.companyId, p1, "P1", { kind: "job" });
      const room2 = await chatSync.ensureProjectRoom(A.companyId, p2, "P2", { kind: "job" });
      await seedProjectMember(A.companyId, p1, uid, empId);
      await seedProjectMember(A.companyId, p2, uid, empId);

      await runJob(A.companyId);
      expect(await activeRoomCountOf(uid)).toBe(3);

      await hrWrite.changeStatus(actor, empId, { newStatus: "resigned", lockUser: false });

      expect(await isActiveMember(roomD, uid)).toBe(false);
      expect(await isActiveMember(room1, uid)).toBe(false);
      expect(await isActiveMember(room2, uid)).toBe(false);

      // ĐÂY là vế rev 2 bỏ sót: `changeStatus` KHÔNG chạm `project_members`, nên nếu vị từ dự án thiếu
      // JOIN employee_profiles thì nhịp job kế tiếp sẽ JOIN LẠI người vừa nghỉ việc vào 2 phòng dự án.
      await runJob(A.companyId);
      expect(await activeRoomCountOf(uid), "job KHÔNG được join lại người đã nghỉ việc").toBe(0);
    });

    it("ca c — khôi phục từ thùng rác ⇒ vào lại phòng NGAY trong response", async () => {
      const ou = await seedOrgUnit(A.companyId, `Restore ${Date.now()}`);
      const room = await chatSync.ensureOrgUnitRoom(A.companyId, ou, "R", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `rst-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ou });
      await runJob(A.companyId);
      expect(await isActiveMember(room, uid)).toBe(true);

      await employees.deleteEmployee(A.companyId, empId, actor.id); // ca 20 — W14
      expect(await isActiveMember(room, uid), "xoá mềm ⇒ rời phòng").toBe(false);

      await recycleBin.restoreEmployee(actor, empId);
      expect(await isActiveMember(room, uid), "khôi phục ⇒ vào lại NGAY").toBe(true);
    });

    it("ca 20 — deleteEmployee rời MỌI phòng dẫn xuất và giữ nguyên hợp đồng API (không ném khi tồn tại)", async () => {
      const ou = await seedOrgUnit(A.companyId, `Del ${Date.now()}`);
      const roomD = await chatSync.ensureOrgUnitRoom(A.companyId, ou, "D", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `del-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ou });
      const proj = await seedProject(A.companyId, `PDel ${Date.now()}`);
      const roomP = await chatSync.ensureProjectRoom(A.companyId, proj, "PDel", { kind: "job" });
      await seedProjectMember(A.companyId, proj, uid, empId);
      await runJob(A.companyId);

      await expect(employees.deleteEmployee(A.companyId, empId, actor.id)).resolves.toBeUndefined();
      expect(await isActiveMember(roomD, uid)).toBe(false);
      expect(await isActiveMember(roomP, uid)).toBe(false);
    });

    it("ca 6 — nhân viên KHÔNG có tài khoản: mọi writer là no-op im lặng, 0 hàng bị đụng", async () => {
      const ou = await seedOrgUnit(A.companyId, `NoUser ${Date.now()}`);
      const room = await chatSync.ensureOrgUnitRoom(A.companyId, ou, "NU", { kind: "job" });
      const empId = await seedEmployee(A.companyId, { userId: null, orgUnitId: ou });

      const before = await direct.query(
        `SELECT count(*)::int AS n FROM chat_room_members WHERE room_id = $1`,
        [room],
      );
      await employees.updateEmployee(actor, empId, { orgUnitId: ou } as never);
      await runJob(A.companyId);
      const after = await direct.query(
        `SELECT count(*)::int AS n FROM chat_room_members WHERE room_id = $1`,
        [room],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it("ca 7+8 — linkUser vào phòng, unlinkUser rời phòng (tài khoản VỪA BỊ GỠ, không phải hồ sơ)", async () => {
      const ou = await seedOrgUnit(A.companyId, `Link ${Date.now()}`);
      const room = await chatSync.ensureOrgUnitRoom(A.companyId, ou, "L", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `lnk-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: null, orgUnitId: ou });

      await hrWrite.linkUser(actor, empId, { userId: uid });
      expect(await isActiveMember(room, uid), "linkUser ⇒ vào phòng").toBe(true);

      await hrWrite.unlinkUser(actor, empId, { lockUser: false } as never);
      expect(await isActiveMember(room, uid), "unlinkUser ⇒ rời phòng").toBe(false);
    });

    it("ca 10 — addMember/removeMember dự án chỉ đụng phòng dự án đó", async () => {
      const ou = await seedOrgUnit(A.companyId, `Keep ${Date.now()}`);
      const roomD = await chatSync.ensureOrgUnitRoom(A.companyId, ou, "K", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `pm-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ou });
      await runJob(A.companyId);

      const detail = await projects.createProject(actor, {
        name: `PMem ${Date.now()}`,
      } as never);
      const roomP = (await roomOfProject(detail.id))!.id as string;

      const member = await projects.addMember(actor, detail.id, {
        employeeId: empId,
        projectRole: "Member",
      } as never);
      expect(await isActiveMember(roomP, uid)).toBe(true);
      expect(await isActiveMember(roomD, uid), "phòng ban KHÔNG được đụng").toBe(true);

      await projects.removeMember(actor, detail.id, member.id);
      expect(await isActiveMember(roomP, uid)).toBe(false);
      expect(await isActiveMember(roomD, uid), "phòng ban vẫn nguyên").toBe(true);
    });

    /**
     * FULL gate S7-CHAT-BE-GATE-3 (L5 HIGH) — `removeMember` phải thu hồi theo danh tính mà VỊ TỪ dùng.
     *
     * `desiredProjectPairsSql` tính thành viên phòng qua `pm.employee_id → employee_profiles.user_id`,
     * còn `removeMemberCore` từng đồng bộ theo `pm.user_id` — cột LEGACY, không FK/CHECK nào ghim hai cột.
     * Ca 10 ở trên KHÔNG bắt được vì `addMember` tự đặt `pm.user_id = emp.userId` nên hai danh tính luôn
     * trùng; phải làm chúng LỆCH bằng đường HR đang sống (unlink rồi link sang user khác) mới lộ.
     *
     * Hỏng thì: V bị gỡ khỏi dự án nhưng vẫn đọc/gửi trong phòng chat dự án tới nhịp job (15 phút), và
     * VĨNH VIỄN nếu `WORKERS_SCHEDULER_ENABLED=false` — đúng cửa sổ mà chính sách LOUD sinh ra để bằng 0.
     */
    it("ca 10b — pm.user_id LỆCH employee_profiles.user_id: removeMember vẫn phải đuổi ĐÚNG người", async () => {
      const uOld = await seedUser(direct, A.companyId, `drift-old-${Date.now()}@${A.slug}.test`);
      const uNew = await seedUser(direct, A.companyId, `drift-new-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uOld });

      const detail = await projects.createProject(actor, { name: `Drift ${Date.now()}` } as never);
      const roomP = (await roomOfProject(detail.id))!.id as string;

      const member = await projects.addMember(actor, detail.id, {
        employeeId: empId,
        projectRole: "Member",
      } as never);
      expect(await isActiveMember(roomP, uOld), "người cũ vào phòng").toBe(true);

      // Làm hai danh tính LỆCH: hồ sơ đổi sang user MỚI, `project_members.user_id` vẫn giữ user CŨ.
      await hrWrite.unlinkUser(actor, empId, { lockUser: false } as never);
      await hrWrite.linkUser(actor, empId, { userId: uNew });
      expect(await isActiveMember(roomP, uNew), "người mới vào phòng theo vị từ employee_id").toBe(
        true,
      );

      const pm = await direct.query("SELECT user_id FROM project_members WHERE id = $1", [
        member.id,
      ]);
      expect(pm.rows[0].user_id, "tiền đề của ca: cột legacy KHÔNG được cập nhật theo").toBe(uOld);

      await projects.removeMember(actor, detail.id, member.id);
      expect(
        await isActiveMember(roomP, uNew),
        "người đang thực sự ở trong phòng phải bị đuổi — thu hồi theo cột legacy là no-op",
      ).toBe(false);
    });

    it("ca 19 — phòng đích CHƯA tồn tại: rời phòng cũ vẫn xong, vào phòng mới NO-OP êm, writer trả bình thường", async () => {
      const ouOld = await seedOrgUnit(A.companyId, `Old ${Date.now()}`);
      const roomOld = await chatSync.ensureOrgUnitRoom(A.companyId, ouOld, "Old", { kind: "job" });
      // org_unit mới gieo THẲNG DB ⇒ chưa có phòng nào (job chưa chạy).
      const ouNew = await seedOrgUnit(A.companyId, `New ${Date.now()}`);
      expect(await roomOfOrgUnit(ouNew)).toBeUndefined();

      const uid = await seedUser(direct, A.companyId, `noroom-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ouOld });
      await runJob(A.companyId);
      expect(await isActiveMember(roomOld, uid)).toBe(true);

      // KHÔNG được ném: SAVEPOINT của nhánh CẤP phải nuốt "phòng chưa có" mà không lây sang tx nghiệp vụ.
      await expect(
        employees.updateEmployee(actor, empId, { orgUnitId: ouNew } as never),
      ).resolves.toBeTruthy();
      expect(await isActiveMember(roomOld, uid), "vẫn phải rời phòng cũ").toBe(false);
    });
  });

  // ══════════════ C. JOB ĐỐI SOÁT (ca 12 · 13 · 14 · 16 · 18) ══════════════

  describe("C. job đối soát định kỳ", () => {
    it("ca 12 — company có sẵn dữ liệu TRƯỚC khi job chạy lần đầu: tạo đủ phòng + thành viên, dưới TTL 10 phút", async () => {
      const ou = await seedOrgUnit(A.companyId, `Legacy ${Date.now()}`);
      const proj = await seedProject(A.companyId, `LegacyP ${Date.now()}`);
      const uid = await seedUser(direct, A.companyId, `lg-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ou });
      await seedProjectMember(A.companyId, proj, uid, empId);

      const t0 = Date.now();
      await runJob(A.companyId);
      const elapsed = Date.now() - t0;

      const roomD = await roomOfOrgUnit(ou);
      const roomP = await roomOfProject(proj);
      expect(roomD).toBeTruthy();
      expect(roomP).toBeTruthy();
      expect(await isActiveMember(roomD!.id as string, uid)).toBe(true);
      expect(await isActiveMember(roomP!.id as string, uid)).toBe(true);
      // `JobRunner.DEFAULT_LOCK_TTL_MS` = 10 phút — vòng chạy phải kết thúc trước khi lock hết hạn.
      expect(elapsed).toBeLessThan(10 * 60_000);
    });

    it("ca 13+14 — gieo lệch hai chiều: job sửa cả thừa lẫn thiếu, chạy lần 2 = 0 thay đổi (idempotent)", async () => {
      const ou = await seedOrgUnit(A.companyId, `Drift ${Date.now()}`);
      const room = await chatSync.ensureOrgUnitRoom(A.companyId, ou, "Drift", { kind: "job" });

      const uIn = await seedUser(direct, A.companyId, `in-${Date.now()}@${A.slug}.test`);
      const empIn = await seedEmployee(A.companyId, { userId: uIn, orgUnitId: ou });
      const uOut = await seedUser(direct, A.companyId, `out-${Date.now()}@${A.slug}.test`);
      await seedEmployee(A.companyId, { userId: uOut, orgUnitId: null });

      // THỪA: người không thuộc org_unit nhưng đang ở trong phòng. THIẾU: người thuộc org_unit mà đã rời.
      await direct.query(
        `INSERT INTO chat_room_members (company_id, room_id, user_id, role) VALUES ($1,$2,$3,'member')`,
        [A.companyId, room, uOut],
      );
      await direct.query(
        `INSERT INTO chat_room_members (company_id, room_id, user_id, role, left_at)
         VALUES ($1,$2,$3,'member', now())`,
        [A.companyId, room, uIn],
      );
      void empIn;

      const first = await runJob(A.companyId);
      expect(await isActiveMember(room, uOut), "thừa ⇒ bị đuổi").toBe(false);
      expect(await isActiveMember(room, uIn), "thiếu ⇒ được thêm").toBe(true);
      expect(first.success).toBeGreaterThan(0);

      // Vào lại tái dùng ĐÚNG hàng cũ — `joined_at` không đổi được (cột ngoài tập 6 cột UPDATE).
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM chat_room_members WHERE room_id = $1 AND user_id = $2`,
        [room, uIn],
      );
      expect(r.rows[0].n).toBe(1);

      const second = await runJob(A.companyId);
      expect(second.success, "chạy lại ngay = không còn gì để sửa").toBe(0);
    });

    it("ca 16 — cross-tenant: job của company B không đụng một hàng nào của company A", async () => {
      const ouA = await seedOrgUnit(A.companyId, `XT-A ${Date.now()}`);
      const roomA = await chatSync.ensureOrgUnitRoom(A.companyId, ouA, "XT", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `xt-${Date.now()}@${A.slug}.test`);
      await seedEmployee(A.companyId, { userId: uid, orgUnitId: ouA });
      await runJob(A.companyId);
      expect(await isActiveMember(roomA, uid)).toBe(true);

      const beforeB = await direct.query(
        `SELECT count(*)::int AS n FROM chat_rooms WHERE company_id = $1`,
        [B.companyId],
      );
      const res = await runJob(B.companyId);
      const afterB = await direct.query(
        `SELECT count(*)::int AS n FROM chat_rooms WHERE company_id = $1`,
        [B.companyId],
      );

      expect(res.success).toBe(0);
      expect(afterB.rows[0].n).toBe(beforeB.rows[0].n);
      expect(await isActiveMember(roomA, uid), "hàng của A phải nguyên vẹn").toBe(true);
    });

    it("ca 18 — member_status IS NULL (dữ liệu trước mig 0478) KHÔNG được coi là Active", async () => {
      const proj = await seedProject(A.companyId, `NullMs ${Date.now()}`);
      const room = await chatSync.ensureProjectRoom(A.companyId, proj, "NullMs", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `nms-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid });
      await seedProjectMember(A.companyId, proj, uid, empId, null);

      await direct.query(
        `INSERT INTO chat_room_members (company_id, room_id, user_id, role) VALUES ($1,$2,$3,'member')`,
        [A.companyId, room, uid],
      );

      await runJob(A.companyId);
      // ĐÚNG hành vi, không phải oan: mọi đường đọc khác của hệ (buildScopeExists của TASK) cũng loại
      // `member_status IS NULL` khỏi "Active" — CHAT không được tự đặt luật riêng.
      expect(await isActiveMember(room, uid)).toBe(false);
    });
  });

  // ══════════════ D. BẤT BIẾN (ca 15 · 21) ══════════════

  describe("D. bất biến", () => {
    it("ca 15 — THU HỒI hỏng ⇒ ghi nghiệp vụ ROLLBACK TOÀN BỘ (cửa sổ lệch = 0) + audit Failure", async () => {
      const ou = await seedOrgUnit(A.companyId, `Loud ${Date.now()}`);
      await chatSync.ensureOrgUnitRoom(A.companyId, ou, "Loud", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `loud-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ou });
      await runJob(A.companyId);

      const failuresBefore = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE action = 'chat.room.member_sync_failed' AND company_id = $1`,
        [A.companyId],
      );

      // Ép nhánh THU HỒI hỏng ở tầng SQL thật (không mock service): đổi private method qua prototype.
      const proto = Object.getPrototypeOf(chatSync) as Record<string, unknown>;
      const original = proto.applyLeavesTx;
      proto.applyLeavesTx = async () => {
        throw new Error("gia lap loi thu hoi");
      };
      try {
        await expect(
          hrWrite.changeStatus(actor, empId, { newStatus: "resigned", lockUser: false }),
        ).rejects.toBeInstanceOf(ChatSyncRevokeError);
      } finally {
        proto.applyLeavesTx = original;
      }

      // (1) Ghi nghiệp vụ KHÔNG được commit nửa vời.
      const emp = await direct.query(`SELECT status FROM employee_profiles WHERE id = $1`, [empId]);
      expect(emp.rows[0].status, "status phải quay về nguyên trạng").toBe("active");
      const hist = await direct.query(
        `SELECT count(*)::int AS n FROM employee_status_histories WHERE employee_id = $1`,
        [empId],
      );
      expect(hist.rows[0].n, "history append-only cũng phải rollback theo").toBe(0);

      // (2) Dấu vết điều tra tồn tại ở transaction RIÊNG — thất bại không được im lặng.
      const failuresAfter = await direct.query(
        `SELECT count(*)::int AS n, max(result_status) AS rs FROM audit_logs
          WHERE action = 'chat.room.member_sync_failed' AND company_id = $1`,
        [A.companyId],
      );
      expect(failuresAfter.rows[0].n).toBe(failuresBefore.rows[0].n + 1);
      expect(failuresAfter.rows[0].rs).toBe("Failure");
    });

    it("ca 21 — CHAT-DEC-008: KHÔNG một hàng nào có visible_from_seq sau toàn bộ ca ở trên", async () => {
      // CHỨNG-DƯƠNG trước: không có hàng nào thì "0 hàng có visible_from_seq" đúng một cách vô nghĩa.
      const total = await direct.query(
        `SELECT count(*)::int AS n FROM chat_room_members m
           JOIN chat_rooms rm ON rm.id = m.room_id
          WHERE rm.sync_source IN ('department','project')`,
      );
      expect(
        total.rows[0].n,
        "phải có hàng membership thật để phép đếm dưới có nghĩa",
      ).toBeGreaterThan(0);

      const r = await direct.query(
        `SELECT count(*)::int AS n FROM chat_room_members m
           JOIN chat_rooms rm ON rm.id = m.room_id
          WHERE m.visible_from_seq IS NOT NULL AND rm.sync_source IN ('department','project')`,
      );
      // Cột này NẰM TRONG tập 6 cột được cấp UPDATE ⇒ viết vào là chạy được, không lỗi gì. Đây là đai
      // DUY NHẤT gác lời hứa "người được đồng bộ vào phòng đọc được TOÀN BỘ lịch sử" (SPEC-15 §20 mục 3).
      expect(r.rows[0].n).toBe(0);
    });

    it("wiring — job ĐƯỢC scheduler gom qua DiscoveryService (không chỉ resolve được bằng tay)", async () => {
      // `app.get(handler)` chỉ chứng minh DI resolve. Thứ quyết định job có CHẠY hay không là
      // DiscoveryService quét đúng metadata `SYSTEM_JOB_HANDLER` — nếu ChatModule không được
      // SchedulerModule import, provider chưa init lúc quét và job im lặng KHÔNG BAO GIỜ chạy.
      const { DiscoveryService } = await import("@nestjs/core");
      const { SYSTEM_JOB_HANDLER } = await import("../../src/scheduler/job-handler");
      const discovery = app.get(DiscoveryService);

      const codes = discovery
        .getProviders()
        .filter(
          (w) =>
            w.metatype &&
            w.instance != null &&
            Reflect.getMetadata(SYSTEM_JOB_HANDLER, w.metatype) === true,
        )
        .map((w) => (w.instance as { jobCode?: string }).jobCode);

      expect(codes).toContain("CHAT_DERIVED_ROOMS_RECONCILE");
      // jobCode phải DUY NHẤT toàn hệ — nó là khoá `system_job_locks`; trùng = hai job giành một khoá.
      expect(codes.filter((c) => c === "CHAT_DERIVED_ROOMS_RECONCILE")).toHaveLength(1);
    });

    it("ca 17 — chỉ MỘT nơi trong cây code tạo phòng dẫn xuất", async () => {
      // Checklist cấu trúc: `insertRoom` với roomType department/project chỉ được gọi từ sync service.
      // Bản sao thứ hai ở một service khác sẽ trôi khỏi luật seed-thành-viên và audit.
      const { readdirSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? walk(join(dir, e.name))
            : e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts")
              ? [join(dir, e.name)]
              : [],
        );

      const hits = walk("src")
        .filter((f) => {
          const src = readFileSync(f, "utf8");
          return /roomType:\s*"(department|project)"/.test(src);
        })
        // `chat-rooms.repository.ts` chỉ ĐỊNH NGHĨA union + suy `sync_source`, không phải nơi gọi.
        .filter((f) => !f.endsWith("chat-rooms.repository.ts"))
        .map((f) => f.replace(/\\/g, "/"));

      expect(hits).toEqual(["src/chat/chat-derived-rooms-sync.service.ts"]);
    });
  });

  // ══════════════ E. VÁ FULL GATE (mỗi ca gác đúng một lỗ reviewer tìm ra) ══════════════

  describe("E. vá FULL gate", () => {
    it("HIGH — rời công ty ⇒ rời cả phòng ĐÃ LƯU TRỮ; người CÒN làm việc thì KHÔNG bị đụng", async () => {
      const detail = await projects.createProject(actor, {
        name: `Off-board ${Date.now()}`,
      } as never);
      const roomId = (await roomOfProject(detail.id))!.id as string;

      const uLeaver = await seedUser(direct, A.companyId, `lv-${Date.now()}@${A.slug}.test`);
      const empLeaver = await seedEmployee(A.companyId, { userId: uLeaver });
      const uStay = await seedUser(direct, A.companyId, `st-${Date.now()}@${A.slug}.test`);
      const empStay = await seedEmployee(A.companyId, { userId: uStay });
      await seedProjectMember(A.companyId, detail.id, uLeaver, empLeaver);
      await seedProjectMember(A.companyId, detail.id, uStay, empStay);
      await runJob(A.companyId);
      expect(await isActiveMember(roomId, uLeaver)).toBe(true);
      expect(await isActiveMember(roomId, uStay)).toBe(true);

      // Đóng dự án ⇒ phòng lưu trữ, cả hai còn nguyên (đóng băng — đúng thiết kế).
      await projects.closeProject(actor, detail.id, {} as never);
      expect((await roomOfProject(detail.id))!.is_archived).toBe(true);
      expect(await isActiveMember(roomId, uLeaver)).toBe(true);

      // Rồi một người NGHỈ VIỆC. Đây là chuỗi mà bản đầu để hở: `applyLeavesTx` bỏ qua phòng đã lưu trữ,
      // `assertMember` không có vế `is_archived`, `listRooms(archived=true)` vẫn trả phòng, và đăng nhập
      // chỉ gate `users.status` — người đã nghỉ đọc được toàn bộ lịch sử dự án đã đóng, vĩnh viễn.
      await hrWrite.changeStatus(actor, empLeaver, { newStatus: "resigned", lockUser: false });

      expect(await isActiveMember(roomId, uLeaver), "đã nghỉ việc ⇒ phải rời phòng lưu trữ").toBe(
        false,
      );
      await expect(
        db.withTenant(A.companyId, (tx) => access.assertMember(tx, A.companyId, roomId, uLeaver)),
      ).rejects.toThrow();

      // CHỨNG-DƯƠNG: người còn làm việc KHÔNG bị vạ lây — "đóng băng" vẫn đúng cho họ.
      expect(await isActiveMember(roomId, uStay), "còn làm việc ⇒ giữ nguyên quyền đọc").toBe(true);
      await expect(
        db.withTenant(A.companyId, (tx) => access.assertMember(tx, A.companyId, roomId, uStay)),
      ).resolves.toBeTruthy();
    });

    it("HIGH — đổi chủ dự án sang người CHƯA là thành viên ⇒ vào phòng NGAY (writer thứ 15)", async () => {
      const detail = await projects.createProject(actor, {
        name: `Reassign ${Date.now()}`,
      } as never);
      const roomId = (await roomOfProject(detail.id))!.id as string;

      const uNew = await seedUser(direct, A.companyId, `own-${Date.now()}@${A.slug}.test`);
      const empNew = await seedEmployee(A.companyId, { userId: uNew });
      expect(await isActiveMember(roomId, uNew)).toBe(false);

      // `syncOwnerMemberTx` INSERT một hàng `project_members` cho chủ mới. Không hook điểm này thì chủ
      // mới thấy dự án ở TASK nhưng `assertMember` phòng chat trả 404 — im lặng tới nhịp job kế tiếp.
      await projects.updateProject(actor, detail.id, { ownerEmployeeId: empNew } as never);

      expect(await isActiveMember(roomId, uNew), "chủ mới phải vào phòng NGAY").toBe(true);
      await expect(
        db.withTenant(A.companyId, (tx) => access.assertMember(tx, A.companyId, roomId, uNew)),
      ).resolves.toBeTruthy();
    });

    it("MEDIUM — phòng ban bị xoá mềm ⇒ job LƯU TRỮ phòng chat của nó (đối xứng với dự án)", async () => {
      const ou = await seedOrgUnit(A.companyId, `Dissolve ${Date.now()}`);
      const roomId = await chatSync.ensureOrgUnitRoom(A.companyId, ou, "Dissolve", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `ds-${Date.now()}@${A.slug}.test`);
      await seedEmployee(A.companyId, { userId: uid, orgUnitId: ou });
      await runJob(A.companyId);
      expect(await isActiveMember(roomId, uid)).toBe(true);

      await org.deleteOrgUnit(A.companyId, ou);
      await runJob(A.companyId);

      const room = await roomOfOrgUnit(ou);
      expect(room!.is_archived, "phòng ban biến mất mà phòng chat còn SỐNG là lỗ").toBe(true);
      expect(await auditActions(roomId)).toContain("chat.room.auto_archived");
    });

    it("MEDIUM — hai action audit thành viên tự động ĐƯỢC ghi thật (không chỉ nằm trong hằng số)", async () => {
      const ouA = await seedOrgUnit(A.companyId, `AudA ${Date.now()}`);
      const ouB = await seedOrgUnit(A.companyId, `AudB ${Date.now()}`);
      const roomA = await chatSync.ensureOrgUnitRoom(A.companyId, ouA, "AudA", { kind: "job" });
      const roomB = await chatSync.ensureOrgUnitRoom(A.companyId, ouB, "AudB", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `aud-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ouA });
      await runJob(A.companyId);

      await employees.updateEmployee(actor, empId, { orgUnitId: ouB } as never);

      expect(await auditActions(roomA), "rời phòng cũ phải để lại dấu").toContain(
        "chat.room.member_auto_removed",
      );
      expect(await auditActions(roomB), "vào phòng mới phải để lại dấu").toContain(
        "chat.room.member_auto_added",
      );
    });

    it("HIGH — audit thất-bại ghi PHÂN LOẠI, KHÔNG ghi câu SQL/tham số bind vào bảng append-only", async () => {
      const ou = await seedOrgUnit(A.companyId, `Scrub ${Date.now()}`);
      await chatSync.ensureOrgUnitRoom(A.companyId, ou, "Scrub", { kind: "job" });
      const uid = await seedUser(direct, A.companyId, `scr-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid, orgUnitId: ou });
      await runJob(A.companyId);

      // Lỗi giả lập mang HÌNH DẠNG lỗi driver thật: drizzle bọc mọi lỗi query thành message
      // "Failed query: <SQL> params: <bind>". Ghi thẳng message đó vào audit là chôn nguyên câu SQL kèm
      // giá trị hàng vào một bảng mà app role KHÔNG có UPDATE/DELETE.
      const driverLikeError = Object.assign(
        new Error(
          "Failed query: UPDATE chat_room_members m SET left_at = now() FROM chat_rooms r WHERE ... params: 11111111-1111-1111-1111-111111111111, looks-like-a-value",
        ),
        { code: "42501" },
      );
      const proto = Object.getPrototypeOf(chatSync) as Record<string, unknown>;
      const original = proto.applyLeavesTx;
      proto.applyLeavesTx = async () => {
        throw driverLikeError;
      };
      try {
        await expect(
          hrWrite.changeStatus(actor, empId, { newStatus: "resigned", lockUser: false }),
        ).rejects.toBeInstanceOf(ChatSyncRevokeError);
      } finally {
        proto.applyLeavesTx = original;
      }

      const row = await direct.query(
        `SELECT new_values->>'reason' AS reason FROM audit_logs
          WHERE action = 'chat.room.member_sync_failed' AND company_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [A.companyId],
      );
      const reason = row.rows[0].reason as string;
      expect(reason, "phải là phân loại ổn định").toBe("pg:42501");
      expect(reason).not.toContain("Failed query");
      expect(reason).not.toContain("params:");
      expect(reason).not.toContain("looks-like-a-value");
    });

    it("chứng-dương cho ca 15 — changeStatus THÀNH CÔNG ghi ĐÚNG 1 hàng lịch sử", async () => {
      const uid = await seedUser(direct, A.companyId, `pos-${Date.now()}@${A.slug}.test`);
      const empId = await seedEmployee(A.companyId, { userId: uid });

      await hrWrite.changeStatus(actor, empId, { newStatus: "inactive", lockUser: false });

      // Không có ca này thì "0 hàng lịch sử sau rollback" của ca 15 chỉ chứng minh đường ghi lịch sử im
      // lặng — không phân biệt được với việc nó chưa bao giờ ghi gì.
      const hist = await direct.query(
        `SELECT count(*)::int AS n FROM employee_status_histories WHERE employee_id = $1`,
        [empId],
      );
      expect(hist.rows[0].n).toBe(1);
    });

    it("chứng-dương cho ca 16 — lệch CÓ THẬT của A vẫn còn nguyên sau khi chạy job của B", async () => {
      // Ca 16 cũ chạy khi A đã đồng bộ xong ⇒ một job mất hẳn vế `company_id` cũng sẽ "không đụng A".
      // Ca này gieo lệch CHƯA sửa ở A rồi chạy job B: nếu B nhìn thấy A, lệch đó sẽ bị sửa.
      const ou = await seedOrgUnit(A.companyId, `Drift-A ${Date.now()}`);
      const uid = await seedUser(direct, A.companyId, `dra-${Date.now()}@${A.slug}.test`);
      await seedEmployee(A.companyId, { userId: uid, orgUnitId: ou });
      expect(await roomOfOrgUnit(ou), "chưa chạy job A ⇒ chưa có phòng").toBeUndefined();

      const res = await runJob(B.companyId);

      expect(res.success).toBe(0);
      expect(await roomOfOrgUnit(ou), "job của B KHÔNG được tạo phòng cho A").toBeUndefined();

      // Rồi chạy job của A để chắc lệch đó THẬT SỰ sửa được (nếu không, ca trên đúng vì lý do sai).
      await runJob(A.companyId);
      expect(await roomOfOrgUnit(ou)).toBeTruthy();
    });
  });
});
