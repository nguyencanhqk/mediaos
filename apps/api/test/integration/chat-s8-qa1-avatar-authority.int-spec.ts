/**
 * S8-CHAT-UX-QA-1 — nghiệm thu wave: **hai nhánh tư cách CHƯA TỪNG CÓ MỘT CA NÀO** của `CHAT-DEC-016`.
 *
 * ══ VÌ SAO FILE NÀY TỒN TẠI ══
 * `assertAvatarAuthorityTx` (`chat-room-avatar.service.ts:231`) có BỐN nhánh theo `room_type`.
 * `chat-s8-be2-room-avatar.int-spec.ts` phủ **hai**: `group` (admin phòng) và `direct` (422). Đo 07/08:
 *
 *   grep -l "ChatRoomAvatarService" apps/api/**\/*.spec.ts   → 0 file
 *   grep -n "department|project"    chat-s8-be2-room-avatar.int-spec.ts → 0 dòng
 *
 * ⇒ `department` và `project` — **đúng hai loại phòng mà DEC-016 được viết RA VÌ CHÚNG** (phòng dẫn xuất
 * có 0 admin, nên luật "admin phòng đặt avatar" làm tính năng chết ở đó) — chưa từng chạy trong test nào,
 * cả deny lẫn allow. Một nhánh không có ca ALLOW thì mọi ca DENY của nó là **xanh rỗng**: nếu cả nhánh
 * ném 403 vô điều kiện (ví dụ sai chính tả `'org-unit'` vs `'org_unit'` — chính bẫy mà docstring của
 * `ORG_UNIT_WRITE_PAIR` cảnh báo), deny-test vẫn xanh và tính năng vẫn chết trên PROD.
 *
 * Vì thế mỗi nhánh ở đây có **cặp allow + deny**, và ca allow đứng TRƯỚC ca deny trong file.
 *
 * ══ PHỦ THÊM: cross-tenant ở TẦNG API ══
 * `s7-chat-db1-invariants.int-spec.ts` mục I chứng minh composite FK + RLS chặn ghi chéo tenant ở tầng
 * **DB**. Vế còn lại — người của công ty B cầm `roomId` của A gọi thẳng route — chưa có ca nào cho avatar
 * (BE-1 ca 13 phủ `pinned_at`, BE-3 ca 16 phủ reaction).
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { ChatDerivedRoomsSyncService } from "../../src/chat/chat-derived-rooms-sync.service";
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
const LOGIN_PW = ["Passw0rd", "s8qa1avatar"].join("!");
const UNKNOWN_FILE = "00000000-0000-4000-8000-0000000000fd";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/** Cổng MODULE — mọi chủ thể trong file này đều có đủ, để deny-path đo TƯ CÁCH chứ không đo cặp quyền. */
const CHAT_PAIRS: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
];

/**
 * Vai trò dự án của 4 chủ thể nhánh B. `projLeft` mang vai `Owner` **có chủ đích**: ca B4 phải chứng minh
 * việc RỜI dự án thắng vai trò cũ, chứ không phải "Owner thì luôn được".
 */
const PROJECT_ROLES = [
  ["projOwner", "Owner"],
  ["projManager", "Manager"],
  ["projMember", "Member"],
  ["projLeft", "Owner"],
] as const;

describe.skipIf(!hasLaneDb)(
  "S8-CHAT-UX-QA-1 — tư cách đặt avatar theo LOẠI PHÒNG (DB thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let sync: ChatDerivedRoomsSyncService;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let d1 = ""; // đơn vị neo của phòng department đang thử
    let d2 = ""; // đơn vị KHÁC — đích của ca "đã chuyển phòng ban, đồng bộ chưa kịp chạy"
    let deptRoomId = "";
    let projRoomId = "";

    /** token theo nhãn — mỗi người một role riêng nên scope không trộn vào nhau. */
    const t: Record<string, string> = {};
    const u: Record<string, string> = {};

    async function grant(userId: string, label: string, extra: PairGrant[] = []): Promise<void> {
      const roleId = await seedRole(direct, A.companyId, `s8qa1-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope] of [...CHAT_PAIRS, ...extra]) {
        const permId = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, A.companyId);
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    const srv = () => request(app.getHttpServer());
    const authPost = (tok: string, url: string) =>
      srv().post(url).set("Authorization", `Bearer ${tok}`);
    const authDel = (tok: string, url: string) =>
      srv().delete(url).set("Authorization", `Bearer ${tok}`);
    const authGet = (tok: string, url: string) =>
      srv().get(url).set("Authorization", `Bearer ${tok}`);

    async function seedOrgUnit(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO org_units (company_id, name, type, status) VALUES ($1,$2,'department','active') RETURNING id`,
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function seedEmployee(
      companyId: string,
      userId: string,
      orgUnitId: string | null,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, employee_code)
       VALUES ($1,$2,$3,'active',$4) RETURNING id`,
        [companyId, userId, orgUnitId, `E-${Math.random().toString(36).slice(2, 9)}`],
      );
      return r.rows[0].id as string;
    }

    /** Đăng ký ảnh qua ĐÚNG đường của WO rồi ép `Uploaded` (lane test không có bytes thật). */
    async function registerImage(token: string, roomId: string): Promise<string> {
      const res = await authPost(token, `/chat/rooms/${roomId}/avatar/upload-url`).send({
        originalName: "anh.png",
        declaredMimeType: "image/png",
        sizeBytes: 1024,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const fileId = res.body.data.fileId as string;
      await direct.query(
        `UPDATE files SET upload_status = 'Uploaded', scan_status = 'Clean' WHERE id = $1`,
        [fileId],
      );
      return fileId;
    }

    async function avatarColumn(roomId: string): Promise<string | null> {
      const r = await direct.query(`SELECT avatar_file_id FROM chat_rooms WHERE id = $1`, [roomId]);
      return (r.rows[0]?.avatar_file_id as string | null) ?? null;
    }

    async function liveAvatarLinkCount(roomId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM file_links
        WHERE entity_id = $1 AND module_code = 'CHAT' AND entity_type = 'chat_room_avatar'
          AND deleted_at IS NULL`,
        [roomId],
      );
      return r.rows[0].n as number;
    }

    async function isActiveMember(roomId: string, userId: string): Promise<boolean> {
      const r = await direct.query(
        `SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [roomId, userId],
      );
      return r.rows.length === 1;
    }

    /** Đặt avatar bằng ảnh do CHÍNH chủ thể đó tải lên — vòng đầy đủ của đường ghi. */
    async function setAvatar(label: string, roomId: string): Promise<request.Response> {
      const fileId = await registerImage(t[label], roomId);
      return authPost(t[label], `/chat/rooms/${roomId}/avatar`).send({ fileId });
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      sync = app.get(ChatDerivedRoomsSyncService, { strict: false });

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "s8qa1a");
      B = await seedCompany(direct, "s8qa1b");
      companyIds.push(A.companyId, B.companyId);

      d1 = await seedOrgUnit(A.companyId, "Ban Nội dung");
      d2 = await seedOrgUnit(A.companyId, "Ban Kỹ thuật");

      const mk = async (name: string, orgUnitId: string | null): Promise<string> => {
        const id = await seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
        u[name] = id;
        await seedEmployee(A.companyId, id, orgUnitId);
        return id;
      };

      // ── nhánh `department`: 5 chủ thể, CÙNG đơn vị D1 ⇒ cùng là thành viên phòng D1 ──
      await mk("orgCompany", d1); // update:org_unit@Company
      await mk("orgDept", d1); // update:org_unit@Department, đơn vị = D1 (trùng neo)
      await mk("orgOwn", d1); // update:org_unit@Own  ⇒ fail-closed
      await mk("plain", d1); // KHÔNG có cặp org_unit nào
      await mk("moved", d1); // sẽ CHUYỂN sang D2 sau khi phòng đã có thành viên

      await grant(u.orgCompany, "orgcompany", [["update", "org_unit", "Company"]]);
      await grant(u.orgDept, "orgdept", [["update", "org_unit", "Department"]]);
      await grant(u.orgOwn, "orgown", [["update", "org_unit", "Own"]]);
      await grant(u.plain, "plain");
      await grant(u.moved, "moved", [["update", "org_unit", "Department"]]);

      // ── nhánh `project`: 4 chủ thể theo vai trò dự án ──
      // CỐ Ý cấp cả `update:org_unit@Company` cho cả bốn: nhánh `project` KHÔNG được hỏi nguồn quyền của
      // phòng ban. Có cặp đó mà vẫn 403 ở B3/B4 mới chứng minh `switch` không rơi nhầm nhánh.
      const projEmp: Record<string, string> = {};
      for (const [name] of PROJECT_ROLES) {
        const id = await mk(name, d2);
        projEmp[name] = (
          await direct.query(`SELECT id FROM employee_profiles WHERE user_id = $1`, [id])
        ).rows[0].id as string;
        await grant(id, name.toLowerCase(), [["update", "org_unit", "Company"]]);
      }

      const projectId = (
        await direct.query(
          `INSERT INTO projects (company_id, name, project_status) VALUES ($1,'Dự án nghiệm thu','Active') RETURNING id`,
          [A.companyId],
        )
      ).rows[0].id as string;
      for (const [name, role] of PROJECT_ROLES) {
        await direct.query(
          `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status)
         VALUES ($1,$2,$3,$4,$5,'Active')`,
          [A.companyId, projectId, u[name], projEmp[name], role],
        );
      }

      // Phòng dẫn xuất tạo SAU khi nhân sự/thành viên dự án đã có ⇒ `applyJoinsTx` seed đủ thành viên.
      deptRoomId = await sync.ensureOrgUnitRoom(A.companyId, d1, "Ban Nội dung", { kind: "job" });
      projRoomId = await sync.ensureProjectRoom(A.companyId, projectId, "Dự án nghiệm thu", {
        kind: "job",
      });

      for (const name of Object.keys(u)) t[name] = await login(A.slug, `${name}@${A.slug}.test`);

      // ── công ty B: đủ MỌI cặp, kể cả `update:org_unit@Company` ⇒ ca cross-tenant đo RANH GIỚI
      //    TENANT, không phải đo "thiếu quyền". ──
      const uB = await seedUser(direct, B.companyId, `outsider@${B.slug}.test`, hash);
      const roleB = await seedRole(direct, B.companyId, "s8qa1-b-outsider");
      for (const [action, resource, scope] of [
        ...CHAT_PAIRS,
        ["update", "org_unit", "Company"] as PairGrant,
      ]) {
        const permId = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, roleB, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, uB, roleB, B.companyId);
      await seedEmployee(B.companyId, uB, null);
      t.outsiderB = await login(B.slug, `outsider@${B.slug}.test`);

      // Điều kiện tiên quyết của TOÀN BỘ file: nếu tư cách thành viên không được seed thì mọi ca 403 dưới
      // đây sẽ là 404 và ta sẽ đọc nhầm "lưới có răng" (memory `module-closed-by-second-assert-not-scope`).
      for (const name of ["orgCompany", "orgDept", "orgOwn", "plain", "moved"]) {
        expect(
          await isActiveMember(deptRoomId, u[name]),
          `${name} phải là thành viên phòng D1`,
        ).toBe(true);
      }
      for (const name of ["projOwner", "projManager", "projMember", "projLeft"]) {
        expect(
          await isActiveMember(projRoomId, u[name]),
          `${name} phải là thành viên phòng DA`,
        ).toBe(true);
      }
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.close();
    });

    // ══════════ A. phòng `department` — nhánh CHƯA TỪNG chạy trong test nào ══════════
    //
    // ⚠️ Mọi ca DENY gửi `fileId: UNKNOWN_FILE` chứ không đăng ký ảnh thật — KHÔNG phải cho gọn:
    //   • người không đủ tư cách **không lấy nổi** một `fileId` (ca A6: `upload-url` cũng 403), nên "ảnh
    //     thật của chính họ" là trạng thái không dựng được;
    //   • mượn ảnh của người khác sẽ đổi lý do từ chối thành `CHAT-ERR-015` (chống IDOR tệp) ⇒ ca sẽ xanh
    //     vì SAI lý do, đúng lớp xanh-giả mà cả file này tồn tại để chặn.
    // Vì thế mã `CHAT-ERR-023` trong thân cũng là RATCHET THỨ TỰ: tư cách phải kiểm TRƯỚC tệp. Đảo hai
    // bước là biến `fileId` thành oracle dò tệp, và ca này sẽ đỏ với `CHAT-ERR-015`.

    describe("A. department (SPEC-15 §11b — 'ai sửa được phòng ban thì đổi được bộ mặt phòng chat')", () => {
      it("A1 ✅ ĐỐI CHỨNG DƯƠNG — `update:org_unit@Company` đặt được avatar phòng phòng-ban", async () => {
        const res = await setAvatar("orgCompany", deptRoomId);

        // Ca này đứng trước mọi ca deny: không có nó, một nhánh 403-vô-điều-kiện (vd sai chính tả cặp
        // `'org-unit'`) vẫn làm A2…A5 xanh trong khi tính năng chết hoàn toàn.
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(await avatarColumn(deptRoomId)).toBe(res.body.data.fileId);
        expect(await liveAvatarLinkCount(deptRoomId), "đúng 1 link sống").toBe(1);
      });

      it("A2 ✅ `update:org_unit@Department` TRÙNG đơn vị neo của phòng ⇒ đặt được", async () => {
        const res = await setAvatar("orgDept", deptRoomId);

        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(await avatarColumn(deptRoomId)).toBe(res.body.data.fileId);
        expect(await liveAvatarLinkCount(deptRoomId), "link cũ phải bị gỡ, không tích luỹ").toBe(1);
      });

      it("A3 🔒 thành viên phòng + `update:chat-room` nhưng KHÔNG có cặp `org_unit` ⇒ 403 CHAT-ERR-023", async () => {
        const before = await avatarColumn(deptRoomId);
        const res = await authPost(t.plain, `/chat/rooms/${deptRoomId}/avatar`).send({
          fileId: UNKNOWN_FILE,
        });

        // 403 chứ KHÔNG 404: người này là thành viên hợp lệ, phòng có thật với họ. Mã trong thân phân biệt
        // CHAT-ERR-023 với 403 của `PermissionGuard` (thiếu cặp gate) — hai thứ trông y hệt ở status.
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-023");
        expect(await avatarColumn(deptRoomId), "cột KHÔNG được đổi").toBe(before);
      });

      it("A4 🔒 `update:org_unit@Own` ⇒ 403 (Own/Team không nói gì về một ĐƠN VỊ TỔ CHỨC — fail-closed)", async () => {
        const before = await avatarColumn(deptRoomId);
        const res = await authPost(t.orgOwn, `/chat/rooms/${deptRoomId}/avatar`).send({
          fileId: UNKNOWN_FILE,
        });

        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-023");
        expect(await avatarColumn(deptRoomId)).toBe(before);
      });

      it("A5 🔒 `@Department` neo theo PHÒNG, không theo tư cách thành viên: đã chuyển sang D2 mà đồng bộ chưa chạy ⇒ 403", async () => {
        // Trạng thái CÓ THẬT: nhân viên chuyển phòng ban, hook/job đồng bộ chưa kịp gỡ họ khỏi phòng cũ.
        // Họ VẪN là thành viên phòng D1 (đo lại ngay dưới), nhưng `departmentOrgUnitIds` giờ là {D2}.
        // Nếu tư cách đọc theo "là thành viên phòng" thay vì theo ĐƠN VỊ NEO thì ca này sẽ 201 — và đó là
        // đường leo thang: một người ngoài phòng ban vẫn đổi được bộ mặt của phòng ban đó.
        await direct.query(`UPDATE employee_profiles SET org_unit_id = $1 WHERE user_id = $2`, [
          d2,
          u.moved,
        ]);
        expect(await isActiveMember(deptRoomId, u.moved), "vẫn phải là thành viên phòng cũ").toBe(
          true,
        );

        const before = await avatarColumn(deptRoomId);
        const res = await authPost(t.moved, `/chat/rooms/${deptRoomId}/avatar`).send({
          fileId: UNKNOWN_FILE,
        });

        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-023");
        expect(await avatarColumn(deptRoomId)).toBe(before);
      });

      it("A6 🔒 `upload-url` gate TRƯỚC khi đăng ký tệp — người không đủ tư cách KHÔNG bơm được file rác", async () => {
        const before = await direct.query(
          `SELECT count(*)::int AS n FROM files WHERE company_id = $1`,
          [A.companyId],
        );
        const res = await authPost(t.plain, `/chat/rooms/${deptRoomId}/avatar/upload-url`).send({
          originalName: "rac.png",
          declaredMimeType: "image/png",
          sizeBytes: 10,
        });
        const after = await direct.query(
          `SELECT count(*)::int AS n FROM files WHERE company_id = $1`,
          [A.companyId],
        );

        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-023");
        expect(after.rows[0].n, "0 hàng `files` mới").toBe(before.rows[0].n);
      });

      it("A7 🔒 DELETE đi qua CÙNG cổng tư cách — không đủ thì 403, đủ thì 204 (đối chứng cùng ca)", async () => {
        const denied = await authDel(t.plain, `/chat/rooms/${deptRoomId}/avatar`);
        expect(denied.status, JSON.stringify(denied.body)).toBe(403);
        expect(JSON.stringify(denied.body)).toContain("CHAT-ERR-023");
        expect(await avatarColumn(deptRoomId), "còn nguyên avatar").not.toBeNull();

        const ok = await authDel(t.orgCompany, `/chat/rooms/${deptRoomId}/avatar`);
        expect(ok.status, JSON.stringify(ok.body)).toBe(204);
        expect(await avatarColumn(deptRoomId)).toBeNull();
        expect(await liveAvatarLinkCount(deptRoomId), "link cũng phải được gỡ").toBe(0);
      });
    });

    // ══════════ B. phòng `project` — vai trò dự án là nguồn tư cách ══════════

    describe("B. project (CHAT-DEC-016 — 'quản lý dự án' = Owner ∪ Manager)", () => {
      it("B1 ✅ ĐỐI CHỨNG DƯƠNG — vai `Owner` đặt được avatar phòng dự án", async () => {
        const res = await setAvatar("projOwner", projRoomId);

        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(await avatarColumn(projRoomId)).toBe(res.body.data.fileId);
      });

      it("B2 ✅ vai `Manager` cũng đặt được (danh sách là Owner ∪ Manager, không chỉ Owner)", async () => {
        const res = await setAvatar("projManager", projRoomId);

        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(await avatarColumn(projRoomId)).toBe(res.body.data.fileId);
        expect(await liveAvatarLinkCount(projRoomId)).toBe(1);
      });

      it("B3 🔒 vai `Member` — là thành viên phòng, có `update:chat-room`, vẫn 403 CHAT-ERR-023", async () => {
        const before = await avatarColumn(projRoomId);
        const res = await authPost(t.projMember, `/chat/rooms/${projRoomId}/avatar`).send({
          fileId: UNKNOWN_FILE,
        });

        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-023");
        expect(await avatarColumn(projRoomId)).toBe(before);
      });

      it("B4 🔒 ĐÃ RỜI dự án (member_status='Inactive') mà còn trong phòng ⇒ 403, kể cả vai `Owner`", async () => {
        // Cùng lớp với A5: tư cách đọc từ NGUỒN (project_members đang Active), không từ việc còn ngồi
        // trong phòng chat. `getMembershipForUserTx` lọc `member_status='Active'` ⇒ null ⇒ từ chối.
        await direct.query(
          `UPDATE project_members SET member_status = 'Inactive' WHERE user_id = $1`,
          [u.projLeft],
        );
        expect(await isActiveMember(projRoomId, u.projLeft), "vẫn còn trong phòng").toBe(true);

        const before = await avatarColumn(projRoomId);
        const res = await authPost(t.projLeft, `/chat/rooms/${projRoomId}/avatar`).send({
          fileId: UNKNOWN_FILE,
        });

        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-023");
        expect(await avatarColumn(projRoomId)).toBe(before);
      });
    });

    // ══════════ C. cross-tenant ở TẦNG API (vế còn lại của mục I trong db1-invariants) ══════════

    describe("C. công ty B cầm roomId của A", () => {
      const cases: readonly [string, (roomIdOf: () => string) => request.Test][] = [
        [
          "POST /avatar",
          (r) => authPost(t.outsiderB, `/chat/rooms/${r()}/avatar`).send({ fileId: UNKNOWN_FILE }),
        ],
        [
          "POST /avatar/upload-url",
          (r) =>
            authPost(t.outsiderB, `/chat/rooms/${r()}/avatar/upload-url`).send({
              originalName: "x.png",
              declaredMimeType: "image/png",
              sizeBytes: 10,
            }),
        ],
        ["DELETE /avatar", (r) => authDel(t.outsiderB, `/chat/rooms/${r()}/avatar`)],
        ["GET /members (roster)", (r) => authGet(t.outsiderB, `/chat/rooms/${r()}/members`)],
      ];

      it.each(cases)(
        "C1 — %s trên phòng phòng-ban của A ⇒ 404 CHAT-ERR-001 (không 403: 403 xác nhận phòng CÓ THẬT)",
        async (_name, run) => {
          const res = await run(() => deptRoomId);

          expect(res.status, JSON.stringify(res.body)).toBe(404);
          expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
        },
      );

      it("C2 🔒 sau loạt C1: 0 byte trạng thái của A bị đổi và 0 link nào mang tenant B", async () => {
        const okAgain = await setAvatar("orgCompany", deptRoomId);
        expect(okAgain.status, JSON.stringify(okAgain.body)).toBe(201);

        const leaked = await direct.query(
          `SELECT count(*)::int AS n FROM file_links
          WHERE entity_id = $1 AND company_id <> $2`,
          [deptRoomId, A.companyId],
        );
        expect(leaked.rows[0].n, "link của phòng A mang company_id khác ⇒ rò tenant").toBe(0);

        const rooms = await direct.query(
          `SELECT count(*)::int AS n FROM chat_rooms WHERE id = $1 AND company_id = $2`,
          [deptRoomId, A.companyId],
        );
        expect(rooms.rows[0].n, "phòng phải vẫn thuộc A").toBe(1);
      });
    });
  },
);
