/**
 * S6-SEC-IDENTITY-PROJ-1 — KI-053 · KI-054 · KI-069: ba đường chiếu danh tính người còn lại sau
 * `S6-SEC-IDENTITYBOUND-1`, cộng cơ chế chung ép chúng.
 *
 * VẾ RED (hành vi TRƯỚC bản vá, đo trên cây 2026-08-19):
 *   • `GET /auth/roles/:id/members` — gate `view:user` CÓ, nhưng `assertCan` chỉ trả lời có/không:
 *     `where` của `listRoleMembersTx` là `roleId`+`companyId`+`notDeleted`+chưa-hết-hạn, **0 vị từ
 *     scope** ⇒ một vai giữ `view:user@Own` nhận trọn email + họ tên MỌI thành viên của role.
 *   • `GET /auth/login-logs` + `GET /auth/security-events` — docstring `AuthLogsViewerService` ghi
 *     "Company-scope" nhưng không có gì resolve `data_scope`; "Company" là mô tả ý định.
 *   • `GET /leave/balances` (admin) — `resolveAndAssert('view','leave-balance')` rồi **VỨT** giá trị
 *     scope trả về; truy vấn không nhận vị từ nào.
 *
 * ⚠️ CA QUAN TRỌNG NHẤT là `security-events` với `view:user@Own` (D3/D4). Truy vấn đó join `users`
 * HAI LẦN cho hai vai — chủ thể sự kiện (`user_id`) và người gây ra (`actor_user_id`, alias
 * `sec_event_actor`). Một bản vá dùng CHUNG một vị từ cho cả hai vai (điều tự nhiên nhất để viết, vì
 * `buildUserScopeCondition` hard-code bảng `users`) sẽ:
 *   – hàng có chủ thể = tôi ⇒ điều kiện đúng ⇒ **lộ email của NGƯỜI GÂY RA** = lỗ MỚI do bản vá đẻ ra;
 *   – hàng tôi là người gây ra, chủ thể là người khác ⇒ **giấu mất email của chính tôi** = hồi quy
 *     đường ALLOW.
 * Hai ca đó bắt cả hai chiều. Không có chúng thì bản vá trông xanh mà vẫn sai.
 *
 * LUẬT CA (memory `deny-cases-vacuous-without-allow-case`): mỗi đường có CẢ ca DENY lẫn ca ALLOW đối
 * chứng. Ca DENY một mình là xanh-RỖNG — khi actor đủ quyền và actor thiếu quyền cùng nhận `undefined`
 * thì nó không chứng minh gì về cơ chế. Đếm NHÁNH, không đếm ca.
 *
 * ĐẾM KHOÁ TỒN TẠI, không đếm giá trị truthy: quyết định thiết kế là **BỎ HẲN KHOÁ**, không trả `null`
 * (bẫy KI-052 — `null` lẫn nghĩa với "chưa có giá trị").
 *
 * Gate `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { PasswordService } from "../../src/auth/password.service";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
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

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

/**
 * ⚠️ LITERAL CÓ CHỦ ĐÍCH — ĐỪNG import hằng số của `src/**` vào đây (lỗi F3 mà FULL gate N-1 đã bắt).
 * Spec seed grant theo cặp NÀY rồi gọi route thật; nếu nó đọc chính hằng số mà guard/service đọc thì
 * hai vế không bao giờ lệch được và pin mất tác dụng. Đổi hằng số mà quên đây ⇒ 403 hàng loạt, ĐỎ TO
 * TIẾNG, chứ không phải rò im lặng.
 */
const DIRECTORY_PAIR = ["view", "user"] as const;
const AUDIT_LOG_PAIR = ["view", "audit-log"] as const;
const LEAVE_BALANCE_PAIR = ["view", "leave-balance"] as const;

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

type MemberRow = { userId: string; email?: string; fullName?: string | null };
type UserRef = { id: string; email?: string; display_name: string | null } | null;
type LoginLogItem = { id: string; user: UserRef };
type SecurityEventItem = { id: string; user: UserRef; actor: UserRef };

describe.skipIf(!hasLaneDb)(
  "S6-SEC-IDENTITY-PROJ-1 — role-members · auth-logs · leave-balances ép scope danh bạ",
  () => {
    const direct = directPool();
    let app: INestApplication;
    let A: SeededTenant;

    /** `view:user@Company` — hình dạng `SA`/`company-admin`/`QUẢN LÝ CẤP CAO` của PROD. */
    let uCompany = "";
    /** `view:user@Own` — danh bạ HẸP nhưng cửa nghiệp vụ rộng. Đây là hình dạng lỗ. */
    let uOwn = "";
    /** KHÔNG có `view:user` — hình dạng vai SEEDED `employee` (34/35 user sống trên PROD). */
    let uNoDir = "";
    /** Người thứ tư: chỉ để làm chủ thể/tác nhân của sự kiện, KHÔNG đăng nhập. */
    let uOther = "";
    /**
     * S10-SEC-ROLEMEMBERROW-1 (KI-071) — `view:user@Team` / `@Department`.
     *
     * ⚠️ Hai người này PHẢI là thành viên của chính role họ gọi (`roleOther`). Nếu để họ ngoài mọi
     * role thì ca R-T1/R-T2 xanh-RỖNG: người KHÔNG có chân thì `Own` cũng cho 0 hàng, nên "0 hàng"
     * không phân biệt được nhánh `default: false` với nhánh `Own` ⇒ mệnh đề "Team HẸP HƠN Own"
     * (nghịch lý lưới không đơn điệu, nợ N-1b) không được ca nào chứng minh.
     */
    let uTeam = "";
    let uDept = "";

    let roleUnderTest = "";
    /**
     * KI-071 — role thứ hai, CÓ thành viên thật nhưng KHÔNG có `uOwn`. Nền cho ca R-D3 ("`@Own` gọi
     * role mình không có chân ⇒ 0 hàng, 200") và cho R-T1/R-T2. Thiếu thành viên ⇒ mọi ca trên nó
     * đúng một cách RỖNG.
     */
    let roleOther = "";
    /** Tenant B — chỉ để ghim bất biến #1 ở tầng HTTP cho route này (ca R-X1). */
    let B: SeededTenant;
    let roleTenantB = "";

    let tokCompany = "";
    let tokOwn = "";
    let tokNoDir = "";
    let tokTeam = "";
    let tokDept = "";

    async function grant(
      userId: string,
      pair: readonly [string, string],
      dataScope: "Own" | "Team" | "Department" | "Company",
      isSensitive: boolean,
      label: string,
    ): Promise<void> {
      const roleId = await seedRole(direct, A.companyId, `idproj-${label}-${userId.slice(0, 8)}`);
      const permId = await seedPermissionCatalog(direct, pair[0], pair[1], isSensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", dataScope);
      await seedUserRole(direct, userId, roleId, A.companyId);
    }

    async function login(email: string): Promise<string> {
      const res = await api(app)
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: PASSWORD });
      expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    // ⚠️ KI-071: `roleId` là THAM SỐ, không hard-code `roleUnderTest`. Hard-code làm R-D3/R-A3/R-T1/
    // R-T2 lặng lẽ gọi nhầm role — R-D3 khi đó chỉ là bản sao của R-D1 và vẫn XANH.
    async function roleMembers(token: string, roleId: string = roleUnderTest) {
      const res = await api(app).get(`/auth/roles/${roleId}/members`).set(bearer(token));
      return { status: res.status, rows: (res.body?.data?.members ?? []) as MemberRow[] };
    }

    async function loginLogs(token: string) {
      const res = await api(app).get("/auth/login-logs?per_page=100").set(bearer(token));
      return { status: res.status, rows: (res.body?.data ?? []) as LoginLogItem[] };
    }

    async function securityEvents(token: string) {
      const res = await api(app).get("/auth/security-events?per_page=100").set(bearer(token));
      return { status: res.status, rows: (res.body?.data ?? []) as SecurityEventItem[] };
    }

    async function leaveBalances(token: string) {
      // Route ADMIN là `/leave/admin/balances` (leave.controller.ts:474). `/leave/balances` là
      // route "số dư của tôi" gate `view-own:leave-balance` — gọi nhầm nó thì MỌI ca đều 403 và ca
      // DENY xanh vì sai lý do.
      const res = await api(app).get("/leave/admin/balances").set(bearer(token));
      return { status: res.status, rows: (res.body?.data ?? []) as Array<{ userId: string }> };
    }

    /** Số hàng CÓ KHOÁ `key` — khoá tồn tại, không phải giá trị truthy. */
    function withKey(rows: object[], key: string): number {
      return rows.filter((r) => key in r).length;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalFilters(new AllExceptionsFilter());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      await app.init();

      A = await seedCompany(direct, "idproj");

      // `seedUser` nhận password HASH — truyền mật khẩu thô thì login trả 500 PasswordVerificationError,
      // trông như hạ tầng hỏng chứ không như lỗi seed.
      const hash = await new PasswordService().hash(PASSWORD);
      uCompany = await seedUser(direct, A.companyId, "company@idproj.test", hash);
      uOwn = await seedUser(direct, A.companyId, "own@idproj.test", hash);
      uNoDir = await seedUser(direct, A.companyId, "nodir@idproj.test", hash);
      uOther = await seedUser(direct, A.companyId, "other@idproj.test", hash);
      uTeam = await seedUser(direct, A.companyId, "team@idproj.test", hash);
      uDept = await seedUser(direct, A.companyId, "dept@idproj.test", hash);

      await grant(uCompany, DIRECTORY_PAIR, "Company", false, "dir-company");
      await grant(uOwn, DIRECTORY_PAIR, "Own", false, "dir-own");
      await grant(uTeam, DIRECTORY_PAIR, "Team", false, "dir-team");
      await grant(uDept, DIRECTORY_PAIR, "Department", false, "dir-dept");
      // uNoDir: CỐ Ý không cấp cặp danh bạ nào.

      await grant(uCompany, AUDIT_LOG_PAIR, "Company", true, "audit-company");
      await grant(uOwn, AUDIT_LOG_PAIR, "Company", true, "audit-own");
      await grant(uNoDir, AUDIT_LOG_PAIR, "Company", true, "audit-nodir");

      await grant(uCompany, LEAVE_BALANCE_PAIR, "Company", true, "bal-company");
      await grant(uNoDir, LEAVE_BALANCE_PAIR, "Company", true, "bal-nodir");

      // Role có 3 thành viên để `members` không rỗng — ca trên tập rỗng là xanh-RỖNG.
      // ⚠️ KI-071: TUYỆT ĐỐI KHÔNG thêm người vào role này — A1/R-A1 assert `rows.length === 3`; thêm
      // ai vào đây làm chúng ĐỎ **vì sai lý do**. Actor mới đi vào `roleOther`.
      roleUnderTest = await seedRole(direct, A.companyId, "idproj-subject-role");
      for (const u of [uCompany, uOwn, uOther]) {
        await seedUserRole(direct, u, roleUnderTest, A.companyId);
      }

      // KI-071 — role thứ hai: CÓ 4 thành viên thật, KHÔNG có `uOwn`. `uTeam`/`uDept` là thành viên ở
      // đây để "0 hàng" của R-T1/R-T2 mang tin (hàng của chính họ TỒN TẠI — R-A3 nhìn thấy — mà họ
      // vẫn không đọc được: đó đúng là nghịch lý lưới không đơn điệu).
      roleOther = await seedRole(direct, A.companyId, "idproj-other-role");
      for (const u of [uCompany, uOther, uTeam, uDept]) {
        await seedUserRole(direct, u, roleOther, A.companyId);
      }

      // KI-071 R-X1 — tenant B chỉ để ghim bất biến #1 ở tầng HTTP cho ĐÚNG route này (trước WO này
      // route không có ca chéo-tenant nào ở tầng HTTP).
      B = await seedCompany(direct, "idprojb");
      roleTenantB = await seedRole(direct, B.companyId, "idprojb-role");

      tokCompany = await login("company@idproj.test");
      tokOwn = await login("own@idproj.test");
      tokNoDir = await login("nodir@idproj.test");
      tokTeam = await login("team@idproj.test");
      tokDept = await login("dept@idproj.test");

      // Số dư phép THẬT — ca D2 phải có hàng để khẳng định điều gì đó. Không seed thì "0 hàng mang
      // khoá danh tính" đúng một cách RỖNG, và nó vẫn xanh cả khi bản vá bị vô hiệu hoàn toàn (đã
      // chứng minh: neutralise `fromScope` ⇒ A2/B2/C2/C3 đỏ nhưng D2 vẫn xanh).
      const { rows: ltRows } = await direct.query<{ id: string }>(
        `INSERT INTO leave_types (company_id, name, code) VALUES ($1, 'Nghỉ phép năm', 'AL')
         RETURNING id`,
        [A.companyId],
      );
      const leaveTypeId = ltRows[0]!.id;
      for (const u of [uCompany, uOwn, uOther]) {
        await direct.query(
          `INSERT INTO leave_balances (company_id, user_id, leave_type_id, year, total_days)
           VALUES ($1, $2, $3, 2026, 12)`,
          [A.companyId, u, leaveTypeId],
        );
      }

      // Sự kiện an ninh dựng TAY để điều khiển được hai vai một cách tường minh:
      //   E1: chủ thể = uOwn, người gây ra = uOther  → chiều "chủ thể của tôi, tác nhân người khác"
      //   E2: chủ thể = uOther, người gây ra = uOwn  → chiều ngược lại
      // Hai hàng này là thứ duy nhất phân biệt được bản vá HAI grant với bản vá một grant.
      for (const [subject, actor] of [
        [uOwn, uOther],
        [uOther, uOwn],
      ]) {
        await direct.query(
          `INSERT INTO user_security_events (company_id, user_id, actor_user_id, event_type, severity)
           VALUES ($1, $2, $3, 'SESSION_REVOKED', 'medium')`,
          [A.companyId, subject, actor],
        );
      }
    });

    afterAll(async () => {
      await app?.close();
      await cleanupTenants(direct, [A.companyId, B.companyId]);
    });

    // ── KI-053 · GET /auth/roles/:id/members ────────────────────────────────────

    it("A1 ALLOW — `view:user@Company` thấy ĐỦ danh tính của cả 3 thành viên", async () => {
      const { status, rows } = await roleMembers(tokCompany);
      expect(status).toBe(200);
      expect(rows.length).toBe(3);
      // Đây là vế chống "0 hàng cũng xanh": không có ca này thì DENY bên dưới không phân biệt được
      // với "route hỏng".
      expect(withKey(rows, "email")).toBe(3);
      expect(rows.every((r) => typeof r.email === "string" && r.email.length > 0)).toBe(true);
    });

    // ⟲ S10-SEC-ROLEMEMBERROW-1 (KI-071) — A2 VIẾT LẠI. Bản cũ assert `rows.length === 3` kèm câu
    // "Tập HÀNG không đổi — vá bound CỘT, không bound HÀNG": đó là ca ĐANG GHIM LỖ MỞ
    // (`tests-can-pin-a-hole-open`). Nay tập hàng ĐI THEO `data_scope`.
    //
    // ⚠️ Khối lặp cũ (`for (const r of rows.filter(x => x.userId !== uOwn))`) đã bị XOÁ, không phải
    // sửa số: với 1 hàng nó lặp 0 vòng ⇒ hai `expect` bên trong KHÔNG BAO GIỜ CHẠY mà ca vẫn XANH và
    // vẫn *đọc như* đang chứng minh tầng CỘT — cùng lớp bẫy, chiều thứ hai.
    //
    // Bằng chứng ĐỘC LẬP của cơ chế bound-CỘT (KI-053) nay sống ở ca B*/C* (`login-logs` /
    // `security-events`), nơi hai vai có vị từ THẬT SỰ khác nhau. Trên route NÀY vị từ hàng và vị từ
    // cột dựng từ cùng scope/cùng builder/cùng cặp cột ⇒ mọi hàng trả về đều trong scope ⇒
    // `identityInScope` luôn true: tầng cột bị BAO TRÙM, không còn quan sát được ở đây (plan D7).
    it("A2 DENY — `view:user@Own` chỉ thấy CHÍNH tư cách thành viên của mình (KI-071: bound HÀNG)", async () => {
      const { status, rows } = await roleMembers(tokOwn);
      expect(status).toBe(200);
      // Assert theo `userId`, KHÔNG theo số đếm: "đúng 1 hàng" không phân biệt được "hàng của tôi" với
      // "hàng của người khác".
      expect(rows.map((r) => r.userId)).toEqual([uOwn]);
      // Hàng của chính mình VẪN mang danh tính — chống hồi quy "siết quá tay thành 0 hàng/0 cột".
      expect(rows[0]?.email).toBe("own@idproj.test");
    });

    it("A3 — cột `identityInScope` của repo KHÔNG được rò ra response", async () => {
      const { rows } = await roleMembers(tokOwn);
      // Chống xanh-RỖNG: `withKey([], …) === 0` cũng đúng. A2 đã ràng tập hàng nhưng đó là một `it()`
      // KHÁC — vitest không hứa thứ tự, và ai chạy `.only` ca này là assertion mất hiệu lực trong im
      // lặng. Mỗi ca phải tự đứng được.
      expect(rows.length).toBe(1);
      expect(withKey(rows, "identityInScope")).toBe(0);
    });

    // ── KI-071 · TẬP HÀNG đi theo `data_scope` (S10-SEC-ROLEMEMBERROW-1) ────────
    //
    // LUẬT CA: mỗi ca DENY có ca ALLOW đối chứng (`deny-cases-vacuous-without-allow-case`). R-A1 (=A1)
    // và R-A3 là thứ duy nhất phân biệt "vị từ chạy đúng" với "route hỏng / fixture rỗng".

    it("R-D2 DENY — `@Own` KHÔNG thấy hàng của bất kỳ ai khác", async () => {
      const { rows } = await roleMembers(tokOwn);
      const ids = rows.map((r) => r.userId);
      expect(ids).not.toContain(uOther);
      expect(ids).not.toContain(uCompany);
    });

    it("R-D3 DENY — `@Own` gọi role mình KHÔNG có chân ⇒ 200 + 0 hàng (KHÔNG 404/403)", async () => {
      const { status, rows } = await roleMembers(tokOwn, roleOther);
      // 404 ở đây sẽ là oracle "role này có/không có bạn trong đó"; 403 sẽ là oracle khác. Sự tồn tại
      // của role do `findRoleByIdTx` quyết (tài nguyên *role*), không do scope thành viên quyết.
      expect(status).toBe(200);
      expect(rows.length).toBe(0);
    });

    it("R-A3 ALLOW — `@Company` gọi `roleOther` thấy ĐỦ 4 thành viên (neo chống-rỗng của R-D3/R-T1/R-T2)", async () => {
      const { status, rows } = await roleMembers(tokCompany, roleOther);
      expect(status).toBe(200);
      // Nếu ca này đỏ thì MỌI kết luận rút ra từ "0 hàng" của R-D3/R-T1/R-T2 đều vô giá trị: chúng sẽ
      // không phân biệt được với "roleOther chưa seed ai".
      expect(rows.map((r) => r.userId).sort()).toEqual([uCompany, uOther, uTeam, uDept].sort());
    });

    it("R-T1 DENY — `@Team` LÀ thành viên `roleOther` nhưng vẫn 0 hàng (fail-closed, lưới KHÔNG đơn điệu)", async () => {
      const { status, rows } = await roleMembers(tokTeam, roleOther);
      expect(status).toBe(200);
      // Hàng của chính `uTeam` TỒN TẠI (R-A3 vừa nhìn thấy) mà `@Team` không đọc được ⇒ `Team` HẸP HƠN
      // `Own`. Sai về phía HẸP, không bao giờ về phía rò. Sàn hoá là nợ N-1b — phải sửa cho CẢ BA
      // đường cùng lúc, cấm vá lén ở đây.
      expect(rows.length).toBe(0);
    });

    it("R-T2 DENY — `@Department` cùng nhánh fail-closed, ghim CẢ HAI giá trị chứ không một", async () => {
      const { status, rows } = await roleMembers(tokDept, roleOther);
      expect(status).toBe(200);
      expect(rows.length).toBe(0);
    });

    it("R-G1 — KHÔNG có cặp `view:user` ⇒ 403 (bản vá KHÔNG nới route)", async () => {
      const { status } = await roleMembers(tokNoDir);
      expect(status).toBe(403);
    });

    it("R-X1 — role của tenant B ⇒ 404 với actor tenant A (BẤT BIẾN #1 ở tầng HTTP)", async () => {
      const { status } = await roleMembers(tokCompany, roleTenantB);
      expect(status).toBe(404);
    });

    // ── KI-054 · GET /auth/login-logs ───────────────────────────────────────────

    it("B1 ALLOW — có `view:audit-log` + `view:user@Company` ⇒ ref user CÓ email", async () => {
      const { status, rows } = await loginLogs(tokCompany);
      expect(status).toBe(200);
      const refs = rows.map((r) => r.user).filter((u): u is NonNullable<UserRef> => u !== null);
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.every((u) => typeof u.email === "string")).toBe(true);
    });

    it("B2 DENY — có `view:audit-log` nhưng KHÔNG có cặp danh bạ ⇒ ref user còn id, MẤT khoá email", async () => {
      const { status, rows } = await loginLogs(tokNoDir);
      expect(status).toBe(200);
      const refs = rows.map((r) => r.user).filter((u): u is NonNullable<UserRef> => u !== null);
      // Vẫn phải CÒN ref (id) — nếu cả object thành `null` thì nó lẫn nghĩa với "user đã bị xoá",
      // đúng bẫy KI-052 mà bản vá phải tránh.
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.every((u) => !("email" in u))).toBe(true);
      expect(refs.every((u) => u.display_name === null)).toBe(true);
    });

    // ── KI-054 · GET /auth/security-events — HAI VAI, HAI VỊ TỪ ─────────────────

    it("C1 ALLOW — `view:user@Company` thấy danh tính CẢ chủ thể lẫn người gây ra", async () => {
      const { status, rows } = await securityEvents(tokCompany);
      expect(status).toBe(200);
      const withBoth = rows.filter((r) => r.user !== null && r.actor !== null);
      expect(withBoth.length).toBeGreaterThanOrEqual(2);
      expect(withBoth.every((r) => "email" in r.user! && "email" in r.actor!)).toBe(true);
    });

    it("C2 DENY chiều 1 — chủ thể = TÔI, người gây ra = người khác ⇒ chỉ chủ thể có email", async () => {
      // Ca chống LỖ MỚI: một bản vá dùng chung vị từ của chủ thể cho cả hai vai sẽ cho `true` ở hàng
      // này và LỘ email của người gây ra.
      const { rows } = await securityEvents(tokOwn);
      const e1 = rows.find((r) => r.user?.id === uOwn && r.actor?.id === uOther);
      expect(e1, "không tìm thấy hàng E1 — fixture hỏng, đừng đọc kết quả bên dưới").toBeDefined();
      expect("email" in e1!.user!).toBe(true);
      expect(
        "email" in e1!.actor!,
        "LỘ email người gây ra: hai vai đang dùng CHUNG một vị từ",
      ).toBe(false);
    });

    it("C3 DENY chiều 2 — chủ thể = người khác, người gây ra = TÔI ⇒ chỉ người gây ra có email", async () => {
      // Ca chống HỒI QUY ALLOW: cùng bản vá một-vị-từ sẽ giấu mất email của CHÍNH TÔI ở hàng này.
      const { rows } = await securityEvents(tokOwn);
      const e2 = rows.find((r) => r.user?.id === uOther && r.actor?.id === uOwn);
      expect(e2, "không tìm thấy hàng E2 — fixture hỏng").toBeDefined();
      expect("email" in e2!.user!).toBe(false);
      expect(
        "email" in e2!.actor!,
        "GIẤU email của chính actor: vị từ vai `sec_event_actor` đang dựng trên cột sai",
      ).toBe(true);
    });

    // ── KI-069 · GET /leave/balances (admin) ────────────────────────────────────

    it("D1 — thiếu cặp GATE `view:leave-balance` vẫn 403 (bản vá KHÔNG nới route)", async () => {
      const { status } = await leaveBalances(tokOwn);
      expect(status).toBe(403);
    });

    it("D2 — có cặp GATE nhưng KHÔNG có cặp danh bạ ⇒ 200 và MẤT khoá `userFullName`", async () => {
      const { status, rows } = await leaveBalances(tokNoDir);
      expect(status).toBe(200);
      // Có hàng THẬT thì assert mới không rỗng — ca này từng xanh cả khi bản vá bị vô hiệu vì chưa
      // seed số dư nào (0 hàng ⇒ "0 hàng mang khoá" đúng một cách vô nghĩa).
      expect(rows.length).toBe(3);
      expect(withKey(rows, "userFullName")).toBe(0);
    });

    it("D3 ALLOW — có cả hai cặp ⇒ đủ 3 hàng VÀ đủ 3 tên (không bị chặn oan)", async () => {
      const { status, rows } = await leaveBalances(tokCompany);
      expect(status).toBe(200);
      expect(rows.length).toBe(3);
      expect(withKey(rows, "userFullName")).toBe(3);
    });

    // ── KI-073 · POST /permissions/users/:userId/roles — oracle THÂN 201 (S10-SEC-ROLEMEMBERFE-1) ──
    //
    // Plan §0: nhánh no-op trả 201 + HÀNG GỐC (`existing`) ⇒ `id`/`grantedBy`/`createdAt` phân biệt
    // được "đã là thành viên" (createdAt quá khứ, grantedBy gốc) với "vừa gán". D2: thân đồng nhất
    // đúng 4 khoá `{userId, roleId, companyId, expiresAt}` cho MỌI actor, CẢ BA nhánh.
    //
    // ⚠️ VỊ TRÍ CỐ Ý Ở CUỐI FILE (plan §3.1 ⟲R2): beforeAll ở đây đăng nhập thêm 2 user (⇒ ghi
    // `login_logs`) và O2/O3 ghi `user_security_events ROLE_ASSIGNED` trong tenant A — đúng hai bảng
    // mà B1/B2/C1/C2/C3 đọc với per_page=100. Đặt sau chúng để không xê dịch dữ liệu các ca đó nhìn.
    //
    // ⚠️ KHÔNG đụng `roleUnderTest`/`roleOther` (bị A1/R-A1/R-A3/R-T1/R-T2 ghim theo TẬP THÀNH VIÊN)
    // — mọi ca O sống trên role THỨ BA `roleKN` + user riêng.
    describe("KI-073 — thân 201 của đường ghi không được phân biệt 'đã là thành viên' với 'vừa gán'", () => {
      const ASSIGN_PAIR = ["assign-role", "user"] as const;
      const FOUR_KEYS = ["companyId", "expiresAt", "roleId", "userId"];

      let roleKN = "";
      let uGrantor = "";
      let uMemberM = "";
      let uFreshN = "";
      let uFreshN2 = "";
      let tokProv = "";
      let tokProvCo = "";

      async function assign(token: string, targetUserId: string) {
        const res = await api(app)
          .post(`/permissions/users/${targetUserId}/roles`)
          .set(bearer(token))
          .send({ roleId: roleKN });
        return {
          status: res.status,
          body: (res.body?.data ?? {}) as Record<string, unknown>,
        };
      }

      beforeAll(async () => {
        const hash = await new PasswordService().hash(PASSWORD);
        const uProv = await seedUser(direct, A.companyId, "prov@idproj.test", hash);
        const uProvCo = await seedUser(direct, A.companyId, "provco@idproj.test", hash);
        uGrantor = await seedUser(direct, A.companyId, "grantor@idproj.test", hash);
        uMemberM = await seedUser(direct, A.companyId, "memberm@idproj.test", hash);
        uFreshN = await seedUser(direct, A.companyId, "freshn@idproj.test", hash);
        uFreshN2 = await seedUser(direct, A.companyId, "freshn2@idproj.test", hash);

        // Hình dạng "người vận hành cấp phát" (plan §1): GHI toàn công ty + ĐỌC danh bạ hẹp.
        // `isSensitive: true` cho cặp GHI khớp PROD (seedPermissionCatalog là INSERT-only —
        // cờ bị bỏ qua nếu cặp đã có, nhưng KHÔNG được khai sai trong fixture).
        await grant(uProv, ASSIGN_PAIR, "Company", true, "ki073-prov-assign");
        await grant(uProv, DIRECTORY_PAIR, "Own", false, "ki073-prov-dir");
        // O3: actor đối chứng — cả hai cặp @Company.
        await grant(uProvCo, ASSIGN_PAIR, "Company", true, "ki073-provco-assign");
        await grant(uProvCo, DIRECTORY_PAIR, "Company", false, "ki073-provco-dir");

        roleKN = await seedRole(direct, A.companyId, "idproj-ki073-target");
        // `M` — ĐÃ là thành viên: granted_by = NGƯỜI KHÁC actor + created_at LÙI VỀ QUÁ KHỨ.
        // Gieo granted_by = actor là O1/O2 xanh-RỖNG với bản vá chỉ che createdAt (plan §3.1).
        await direct.query(
          `INSERT INTO user_roles (user_id, role_id, company_id, granted_by, created_at)
           VALUES ($1, $2, $3, $4, '2026-01-05T07:00:00Z')`,
          [uMemberM, roleKN, A.companyId, uGrantor],
        );

        tokProv = await login("prov@idproj.test");
        tokProvCo = await login("provco@idproj.test");
      });

      it("O1 DENY — POST cho người ĐÃ là thành viên: đúng 4 khoá, không id/grantedBy/createdAt", async () => {
        const { status, body } = await assign(tokProv, uMemberM);
        // 201 đã đo sẵn tại permadmin-roles-http.int-spec.ts:218 — cả ba nhánh cùng status.
        expect(status).toBe(201);
        // Neo giá trị TRƯỚC đẳng thức tập khoá — chống thân rỗng/route hỏng (plan §3.1 ⟲R1 #4).
        expect(body.userId).toBe(uMemberM);
        expect(body.roleId).toBe(roleKN);
        // Đẳng thức tập khoá (KHÔNG phủ định "không chứa"): hôm nay thân = HÀNG GỐC ⇒ ĐỎ.
        expect(Object.keys(body).sort()).toEqual(FOUR_KEYS);
      });

      it("O2 DENY (cốt lõi) — thân 'đã là thành viên' và 'vừa gán' BẰNG NHAU modulo userId", async () => {
        const m = await assign(tokProv, uMemberM); // no-op (M vĩnh viễn, request không expiresAt)
        const n = await assign(tokProv, uFreshN); // fresh — người này ĐƯỢC GÁN THẬT
        // (a) hai status bằng nhau — status không được mang bit.
        expect(m.status).toBe(n.status);
        // (b) mỗi thân đúng bốn khoá — "hai thân bằng nhau" cũng đúng khi cả hai là {} (bẫy xanh-RỖNG).
        expect(Object.keys(m.body).sort()).toEqual(FOUR_KEYS);
        expect(Object.keys(n.body).sort()).toEqual(FOUR_KEYS);
        // (c) bằng nhau modulo userId.
        const { userId: mUser, ...mRest } = m.body;
        const { userId: nUser, ...nRest } = n.body;
        expect(mUser).toBe(uMemberM);
        expect(nUser).toBe(uFreshN);
        expect(mRest).toEqual(nRest);
      });

      it("O3 ALLOW (neo) — mutation vẫn sống: hàng user_roles THẬT + audit RoleAssigned trỏ id THẬT", async () => {
        const { status } = await assign(tokProvCo, uFreshN2);
        expect(status).toBe(201);
        // id đọc từ DB, KHÔNG từ thân response (thân sẽ không còn `id` sau D2).
        const ur = await direct.query<{ id: string }>(
          `SELECT id FROM user_roles
           WHERE company_id=$1 AND user_id=$2 AND role_id=$3 AND deleted_at IS NULL`,
          [A.companyId, uFreshN2, roleKN],
        );
        expect(ur.rows).toHaveLength(1);
        // Bất biến #2: audit trỏ hàng thật — đột biến M-F (audit ăn bộ chiếu thay vì inserted.id) ĐỎ ở đây.
        const audit = await direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_logs
           WHERE company_id=$1 AND object_type='user_role' AND object_id=$2 AND action='RoleAssigned'`,
          [A.companyId, ur.rows[0]!.id],
        );
        expect(audit.rows[0]!.n).toBe(1);
      });

      it("O4 — no-op KHÔNG ghi gì (ghim D3): user_roles · audit · outbox · security-event đều đứng yên", async () => {
        // TỰ CHỨA + đếm CÓ ĐIỀU KIỆN theo (company, uMemberM, roleKN) — O2/O3 cùng file làm bẩn số toàn cục.
        const counts = async () => {
          const ur = await direct.query<{ ids: string[] | null }>(
            `SELECT array_agg(id) AS ids FROM user_roles
             WHERE company_id=$1 AND user_id=$2 AND role_id=$3`,
            [A.companyId, uMemberM, roleKN],
          );
          const ids = ur.rows[0]!.ids ?? [];
          expect(ids.length, "fixture hỏng: M không có hàng user_roles nào").toBeGreaterThan(0);
          const audit = await direct.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM audit_logs
             WHERE company_id=$1 AND object_type='user_role' AND object_id = ANY($2::uuid[])`,
            [A.companyId, ids],
          );
          const outbox = await direct.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM outbox_events
             WHERE event_type='permission.changed' AND payload->>'companyId'=$1 AND payload->>'userId'=$2`,
            [A.companyId, uMemberM],
          );
          const secEvents = await direct.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM user_security_events
             WHERE company_id=$1 AND user_id=$2 AND event_type='ROLE_ASSIGNED'`,
            [A.companyId, uMemberM],
          );
          return {
            userRoles: ids.length,
            audit: audit.rows[0]!.n,
            outbox: outbox.rows[0]!.n,
            secEvents: secEvents.rows[0]!.n,
          };
        };
        const before = await counts();
        const { status } = await assign(tokProv, uMemberM);
        expect(status).toBe(201);
        // D3: nhánh no-op GIỮ NGUYÊN — không tombstone rác, không audit giả, không permission.changed
        // bắn thừa, không ROLE_ASSIGNED giả (M-E: luôn delete+insert ⇒ ĐỎ cả bốn bộ đếm).
        expect(await counts()).toEqual(before);
      });

      // S1 — cờ `complete` (D4). ⚠️ KHÔNG dùng helper roleMembers() — nó VỨT `complete` (chỉ trả
      // {status, rows}), dùng nó là ca xanh-rỗng kiểu "undefined === false" không bao giờ xanh nổi
      // sau vá / hoặc đỏ vì sai lý do. Gọi thẳng route.
      it("S1a — `view:user@Own` ⇒ complete === false", async () => {
        const res = await api(app).get(`/auth/roles/${roleUnderTest}/members`).set(bearer(tokOwn));
        expect(res.status).toBe(200);
        expect(res.body.data.complete).toBe(false);
      });

      it("S1b — `view:user@Company` ⇒ complete === true", async () => {
        const res = await api(app)
          .get(`/auth/roles/${roleUnderTest}/members`)
          .set(bearer(tokCompany));
        expect(res.status).toBe(200);
        expect(res.body.data.complete).toBe(true);
      });
    });
  },
);
