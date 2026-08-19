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

    let roleUnderTest = "";

    let tokCompany = "";
    let tokOwn = "";
    let tokNoDir = "";

    async function grant(
      userId: string,
      pair: readonly [string, string],
      dataScope: "Own" | "Company",
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

    async function roleMembers(token: string) {
      const res = await api(app).get(`/auth/roles/${roleUnderTest}/members`).set(bearer(token));
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

      await grant(uCompany, DIRECTORY_PAIR, "Company", false, "dir-company");
      await grant(uOwn, DIRECTORY_PAIR, "Own", false, "dir-own");
      // uNoDir: CỐ Ý không cấp cặp danh bạ nào.

      await grant(uCompany, AUDIT_LOG_PAIR, "Company", true, "audit-company");
      await grant(uOwn, AUDIT_LOG_PAIR, "Company", true, "audit-own");
      await grant(uNoDir, AUDIT_LOG_PAIR, "Company", true, "audit-nodir");

      await grant(uCompany, LEAVE_BALANCE_PAIR, "Company", true, "bal-company");
      await grant(uNoDir, LEAVE_BALANCE_PAIR, "Company", true, "bal-nodir");

      // Role có 3 thành viên để `members` không rỗng — ca trên tập rỗng là xanh-RỖNG.
      roleUnderTest = await seedRole(direct, A.companyId, "idproj-subject-role");
      for (const u of [uCompany, uOwn, uOther]) {
        await seedUserRole(direct, u, roleUnderTest, A.companyId);
      }

      tokCompany = await login("company@idproj.test");
      tokOwn = await login("own@idproj.test");
      tokNoDir = await login("nodir@idproj.test");

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
      await cleanupTenants(direct, [A.companyId]);
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

    it("A2 DENY — `view:user@Own` chỉ thấy danh tính của CHÍNH MÌNH, 2 hàng kia BỎ KHOÁ", async () => {
      const { status, rows } = await roleMembers(tokOwn);
      expect(status).toBe(200);
      // Tập HÀNG không đổi — vá bound CỘT, không bound HÀNG (ranh giới ghi ở plan §3.4 + RELEASE-02).
      expect(rows.length).toBe(3);
      expect(withKey(rows, "email")).toBe(1);
      const mine = rows.find((r) => r.userId === uOwn);
      expect(mine?.email).toBe("own@idproj.test");
      for (const r of rows.filter((x) => x.userId !== uOwn)) {
        expect("email" in r, "hàng ngoài scope PHẢI bỏ khoá, không trả null").toBe(false);
        expect("fullName" in r).toBe(false);
      }
    });

    it("A3 — cột `identityInScope` của repo KHÔNG được rò ra response", async () => {
      const { rows } = await roleMembers(tokOwn);
      expect(withKey(rows, "identityInScope")).toBe(0);
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
  },
);
