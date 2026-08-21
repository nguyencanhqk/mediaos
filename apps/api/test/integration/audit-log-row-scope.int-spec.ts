/**
 * S10-SEC-AUDITLOGROW-1 — KI-070: `data_scope` phải chặn **TẬP HÀNG** của `login_logs` +
 * `user_security_events`, không chỉ che CỘT danh tính.
 *
 * VẾ RED (hành vi TRƯỚC bản vá, đo trên cây 2026-08-21):
 *   • `AuthLogsViewerService` gọi `withTenant(companyId)` rồi `findManyTx(tx, filter, …)`, mà
 *     `buildWhere` dựng `WHERE` **chỉ từ `filter`**, và `filter` đến **trọn vẹn từ query param của
 *     caller** ⇒ một vai `view:audit-log@Own` đọc trọn 366 hàng login của tenant.
 *   • `?user_id=<UUID bất kỳ>` đi thẳng vào `eq(loginLogs.userId, …)` ⇒ dò được lịch sử đăng nhập
 *     của người khác. Nặng hơn vế trên vì nó là oracle CÓ ĐIỀU KHIỂN.
 *   • `countTx` dùng cùng `buildWhere` ⇒ vá mỗi `findManyTx` thì `pagination.total` VẪN phát ra số
 *     hàng ngoài scope trong khi `data` sạch — oracle ĐẾM ĐƯỢC, im lặng, không lộ ở body.
 *
 * ⚠️ HAI CẶP QUYỀN, ĐỪNG GỘP. Tập HÀNG đi theo `view:audit-log` (chính cặp GATE); CỘT danh tính đi
 * theo `view:user` (cặp danh bạ — khuôn N-1c, vá ở `S6-SEC-IDENTITY-PROJ-1`). Vì thế fixture cho
 * `uOwn` giữ `view:user@Company`: nếu để nó thiếu cặp danh bạ thì "không thấy email của người khác"
 * có thể do CỘT bị che chứ không do HÀNG bị chặn, và ca sẽ xanh cả khi bản vá bị vô hiệu hoàn toàn.
 * Ô `Own × Own` (`uOwnOwn`) là chỗ ba vị từ trông giống hệt nhau (`user_id = actor` trên
 * `user_security_events`, trên `users`, trên `sec_event_actor`) — đúng chỗ một bản vá "gộp cho gọn"
 * trông xanh mà sai.
 *
 * LUẬT CA (memory `deny-cases-vacuous-without-allow-case`): mỗi vế DENY có vế ALLOW đối chứng. Ca
 * "0 hàng" một mình không phân biệt được "bị chặn đúng" với "route hỏng".
 *
 * ⚠️ Mọi lượt gọi dùng `per_page=100`: mặc định là 20, và **mỗi lượt `login()` của fixture tự sinh
 * thêm một hàng `login_logs`** ⇒ assert trên trang mặc định là xanh-rỗng hoặc flake.
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
 * ⚠️ LITERAL CÓ CHỦ ĐÍCH — ĐỪNG import hằng số của `src/**` vào đây. Spec seed grant theo cặp NÀY rồi
 * gọi route thật; nếu nó đọc chính hằng số mà guard/service đọc thì hai vế không bao giờ lệch được và
 * pin mất tác dụng. Đổi hằng số mà quên đây ⇒ 403 hàng loạt, ĐỎ TO TIẾNG, chứ không phải rò im lặng.
 *
 * Cờ `isSensitive` phải khớp catalog thật (`view:audit-log` = true, `view:user` = false) — sai cờ thì
 * `seedPermissionCatalog` NÉM.
 */
const AUDIT_LOG_PAIR = ["view", "audit-log"] as const;
const DIRECTORY_PAIR = ["view", "user"] as const;

type UserRef = { id: string; email?: string; display_name: string | null } | null;
type LoginLogItem = { id: string; user: UserRef };
type SecurityEventItem = { id: string; user: UserRef; actor: UserRef };
type Listed<T> = { status: number; rows: T[]; total: number };

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe.skipIf(!hasLaneDb)(
  "S10-SEC-AUDITLOGROW-1 — KI-070 vị từ scope chặn TẬP HÀNG nhật ký",
  () => {
    const direct = directPool();
    let app: INestApplication;
    let A: SeededTenant;

    /** `view:audit-log@Company` + `view:user@Company` — hình dạng SA/company-admin của PROD. */
    let uCompany = "";
    /** `view:audit-log@Own` + `view:user@Company` — hình dạng lỗ. Cột KHÔNG phải biến nhiễu. */
    let uOwn = "";
    /** `view:audit-log@Own` + `view:user@Own` — ô nguy hiểm nhất của ma trận. */
    let uOwnOwn = "";
    /** `view:audit-log@Team` — lattice không định nghĩa membership trên bảng nhật ký ⇒ 0 hàng. */
    let uTeam = "";
    /** `view:audit-log@Company`, KHÔNG có cặp danh bạ — chiều còn lại của ma trận. */
    let uCoNoDir = "";
    /** KHÔNG có cặp nào — chủ thể/tác nhân hàng của người khác, và ca 403 ở guard. */
    let uOther = "";

    let tokCompany = "";
    let tokOwn = "";
    let tokOwnOwn = "";
    let tokTeam = "";
    let tokCoNoDir = "";
    let tokOther = "";

    /** Số hàng login_logs seed TAY cho mỗi người (KHÔNG tính hàng do `login()` sinh ra). */
    const SEEDED_LOGIN_ROWS_PER_USER = 2;

    async function grant(
      userId: string,
      pair: readonly [string, string],
      dataScope: "Own" | "Team" | "Company",
      isSensitive: boolean,
      label: string,
    ): Promise<void> {
      const roleId = await seedRole(direct, A.companyId, `arow-${label}-${userId.slice(0, 8)}`);
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

    async function insertLoginLog(userId: string | null, email: string): Promise<void> {
      await direct.query(
        `INSERT INTO login_logs (company_id, user_id, email, normalized_email, login_status,
                               ip_address, user_agent)
       VALUES ($1, $2, $3, $4, 'success', '10.9.9.9', 'arow-seed')`,
        [A.companyId, userId, email, email.toLowerCase()],
      );
    }

    async function insertSecurityEvent(subject: string, actor: string | null): Promise<void> {
      await direct.query(
        `INSERT INTO user_security_events (company_id, user_id, actor_user_id, event_type, severity)
       VALUES ($1, $2, $3, 'SESSION_REVOKED', 'medium')`,
        [A.companyId, subject, actor],
      );
    }

    async function loginLogs(token: string, qs = ""): Promise<Listed<LoginLogItem>> {
      const res = await api(app).get(`/auth/login-logs?per_page=100${qs}`).set(bearer(token));
      return {
        status: res.status,
        rows: (res.body?.data ?? []) as LoginLogItem[],
        total: res.body?.pagination?.total ?? -1,
      };
    }

    async function securityEvents(token: string, qs = ""): Promise<Listed<SecurityEventItem>> {
      const res = await api(app).get(`/auth/security-events?per_page=100${qs}`).set(bearer(token));
      return {
        status: res.status,
        rows: (res.body?.data ?? []) as SecurityEventItem[],
        total: res.body?.pagination?.total ?? -1,
      };
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalFilters(new AllExceptionsFilter());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      await app.init();

      A = await seedCompany(direct, "arow");

      // `seedUser` nhận password HASH — truyền mật khẩu thô thì login trả 500 PasswordVerificationError,
      // trông như hạ tầng hỏng chứ không như lỗi seed.
      const hash = await new PasswordService().hash(PASSWORD);
      uCompany = await seedUser(direct, A.companyId, "company@arow.test", hash);
      uOwn = await seedUser(direct, A.companyId, "own@arow.test", hash);
      uOwnOwn = await seedUser(direct, A.companyId, "ownown@arow.test", hash);
      uTeam = await seedUser(direct, A.companyId, "team@arow.test", hash);
      uCoNoDir = await seedUser(direct, A.companyId, "conodir@arow.test", hash);
      uOther = await seedUser(direct, A.companyId, "other@arow.test", hash);

      await grant(uCompany, AUDIT_LOG_PAIR, "Company", true, "audit-company");
      await grant(uOwn, AUDIT_LOG_PAIR, "Own", true, "audit-own");
      await grant(uOwnOwn, AUDIT_LOG_PAIR, "Own", true, "audit-ownown");
      await grant(uTeam, AUDIT_LOG_PAIR, "Team", true, "audit-team");
      await grant(uCoNoDir, AUDIT_LOG_PAIR, "Company", true, "audit-conodir");
      // uOther: CỐ Ý không cấp cặp audit-log nào (ca G1 — guard phải chặn TRƯỚC service).

      await grant(uCompany, DIRECTORY_PAIR, "Company", false, "dir-company");
      await grant(uOwn, DIRECTORY_PAIR, "Company", false, "dir-own");
      await grant(uOwnOwn, DIRECTORY_PAIR, "Own", false, "dir-ownown");
      await grant(uTeam, DIRECTORY_PAIR, "Company", false, "dir-team");
      // uCoNoDir: CỐ Ý không cấp cặp danh bạ (ca X2).

      for (const [id, email] of [
        [uCompany, "company@arow.test"],
        [uOwn, "own@arow.test"],
        [uOwnOwn, "ownown@arow.test"],
        [uTeam, "team@arow.test"],
        [uCoNoDir, "conodir@arow.test"],
        [uOther, "other@arow.test"],
      ] as const) {
        for (let i = 0; i < SEEDED_LOGIN_ROWS_PER_USER; i += 1) await insertLoginLog(id, email);
      }
      // Hàng pre-auth VÔ CHỦ đã resolve được company (fail với email tồn tại nhưng sai mật khẩu ghi
      // user_id; ca này mô phỏng hàng user_id NULL vẫn thuộc tenant) — ca N1.
      await insertLoginLog(null, "ghost@arow.test");

      // Bốn hàng security-event dựng TAY để điều khiển hai vai một cách tường minh:
      //   chủ thể = uOwn    / tác nhân = uOther  → hàng "về tôi", tác nhân là người khác
      //   chủ thể = uOther  / tác nhân = uOwn    → hàng "về người khác", tôi là tác nhân (D7: KHÔNG thấy)
      //   cùng cặp đó cho uOwnOwn → ô Own × Own
      await insertSecurityEvent(uOwn, uOther);
      await insertSecurityEvent(uOther, uOwn);
      await insertSecurityEvent(uOwnOwn, uOther);
      await insertSecurityEvent(uOther, uOwnOwn);

      tokCompany = await login("company@arow.test");
      tokOwn = await login("own@arow.test");
      tokOwnOwn = await login("ownown@arow.test");
      tokTeam = await login("team@arow.test");
      tokCoNoDir = await login("conodir@arow.test");
      tokOther = await login("other@arow.test");
    });

    afterAll(async () => {
      await app?.close();
      await cleanupTenants(direct, [A.companyId]);
    });

    // ── VẾ RED — phải ĐỎ trên cây trước bản vá ───────────────────────────────────

    it("R1 🔴 `view:audit-log@Own` chỉ đọc được login-log CỦA CHÍNH MÌNH", async () => {
      const { status, rows } = await loginLogs(tokOwn);
      expect(status).toBe(200);
      expect(rows.length).toBeGreaterThan(0); // vế chống "0 hàng cũng xanh"
      const foreign = rows.filter((r) => r.user?.id !== uOwn);
      expect(
        foreign.map((r) => r.user?.id),
        "hàng NGOÀI scope lọt vào response — vị từ scope không được áp",
      ).toEqual([]);
    });

    it("R2 🔴 `?user_id=<người khác>` bị GIAO với vị từ scope ⇒ 0 hàng VÀ total = 0", async () => {
      const { status, rows, total } = await loginLogs(tokOwn, `&user_id=${uOther}`);
      // 200 + rỗng, KHÔNG 403: 403 ở đây phân biệt "ngoài scope" với "không có hàng", tức trả lời hộ
      // câu "UUID này có tồn tại/hoạt động không".
      expect(status).toBe(200);
      expect(rows).toEqual([]);
      // `total` là nửa dễ quên nhất — vá `findManyTx` mà quên `countTx` thì `data` sạch còn `total`
      // vẫn đếm hàng của người khác.
      expect(total, "pagination.total rò số hàng ngoài scope (countTx thiếu vị từ)").toBe(0);
    });

    it("R3 🔴 security-event @Own bám CHỦ THỂ — hàng 'tôi là tác nhân' KHÔNG hiện", async () => {
      const { status, rows } = await securityEvents(tokOwn);
      expect(status).toBe(200);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.user?.id === uOwn)).toBe(true);
      // Chiều D7: hàng chủ thể = uOther / tác nhân = uOwn phải VẮNG. Nới vị từ thành
      // `OR actor_user_id = :actor` sẽ làm ca này đỏ — đó là dấu hiệu nới, không phải lỗi.
      expect(rows.some((r) => r.user?.id === uOther)).toBe(false);
    });

    it("R4 🔴 total khớp ĐÚNG số hàng seed của chính mình, không phải tổng tenant", async () => {
      const { rows, total } = await loginLogs(tokOwn);
      // `login()` của fixture sinh thêm ĐÚNG 1 hàng cho uOwn ⇒ hằng tính được, không phải "số hàng trả
      // về" (đếm rows == total là tautology khi cả hai cùng sai).
      const expected = SEEDED_LOGIN_ROWS_PER_USER + 1;
      expect(total).toBe(expected);
      expect(rows.length).toBe(expected);
    });

    // ── ĐỐI CHỨNG ALLOW — không có chúng thì mọi ca trên xanh-RỖNG ───────────────

    it("A1 ✅ `@Company` vẫn thấy hàng của TẤT CẢ mọi người (bản vá không chặn oan)", async () => {
      const { status, rows } = await loginLogs(tokCompany);
      expect(status).toBe(200);
      const seen = new Set(rows.map((r) => r.user?.id));
      for (const u of [uCompany, uOwn, uOwnOwn, uTeam, uCoNoDir, uOther])
        expect(seen.has(u)).toBe(true);
    });

    it("A1b ✅ `@Company` thấy CẢ BỐN hàng security-event của cả hai chiều", async () => {
      const { status, rows } = await securityEvents(tokCompany);
      expect(status).toBe(200);
      expect(rows.filter((r) => r.user?.id === uOther).length).toBeGreaterThanOrEqual(2);
      expect(rows.some((r) => r.user?.id === uOwn)).toBe(true);
    });

    it("A2 ✅ `@Own` vẫn thấy hàng của chính mình ở CẢ HAI route (không phải route hỏng)", async () => {
      expect((await loginLogs(tokOwn)).rows.length).toBeGreaterThan(0);
      expect((await securityEvents(tokOwn)).rows.length).toBeGreaterThan(0);
    });

    it("A3 ✅ `@Own` + `?user_id=<chính mình>` ⇒ phép GIAO không chặn oan", async () => {
      const { status, rows, total } = await loginLogs(tokOwn, `&user_id=${uOwn}`);
      expect(status).toBe(200);
      expect(rows.length).toBe(SEEDED_LOGIN_ROWS_PER_USER + 1);
      expect(total).toBe(SEEDED_LOGIN_ROWS_PER_USER + 1);
      expect(rows.every((r) => r.user?.id === uOwn)).toBe(true);
    });

    // ── FAIL-CLOSED + ma trận hai cặp quyền ─────────────────────────────────────

    it("T1 `@Team` ⇒ 200 + 0 hàng + total 0 ở CẢ HAI route (lattice chưa định nghĩa membership)", async () => {
      // ⚠️ Ca này ghim luôn cái giá của việc TÁI DÙNG `buildUserScopeConditionOn`: ngày ai đó "sàn hoá"
      // Team/Department cho hai route danh bạ (nợ N-1b), tập hàng ở ĐÂY cũng đổi theo. Chiều đổi là
      // NỚI ⇒ ca này phải ĐỎ để việc đó không xảy ra âm thầm.
      const ll = await loginLogs(tokTeam);
      expect(ll.status).toBe(200);
      expect(ll.rows).toEqual([]);
      expect(ll.total).toBe(0);
      const se = await securityEvents(tokTeam);
      expect(se.status).toBe(200);
      expect(se.rows).toEqual([]);
      expect(se.total).toBe(0);
    });

    it("N1 hàng `user_id IS NULL`: `@Company` thấy, `@Own` KHÔNG", async () => {
      expect((await loginLogs(tokCompany)).rows.some((r) => r.user === null)).toBe(true);
      expect((await loginLogs(tokOwn)).rows.some((r) => r.user === null)).toBe(false);
    });

    it("X1 bound HÀNG KHÔNG kéo theo mất CỘT — `@Own` + `view:user@Company` vẫn có `email`", async () => {
      const { rows } = await loginLogs(tokOwn);
      // ⚠️ Lọc `user !== null` TRƯỚC: đây là ca về CỘT, mà hàng pre-auth (`user_id IS NULL`) không có
      // cột danh tính nào để nói tới. Không lọc thì ca này đỏ khi vị từ HÀNG hỏng — đỏ ĐÚNG nhưng SAI
      // LÝ DO, và một ca đỏ vì lý do khác với tên của nó là một ca không đọc được. Vế HÀNG đã có R1.
      const withUser = rows.filter((r) => r.user !== null);
      expect(withUser.length).toBeGreaterThan(0);
      // Đếm KHOÁ TỒN TẠI, không đếm giá trị truthy: quyết định thiết kế là BỎ HẲN KHOÁ (bẫy KI-052).
      expect(withUser.every((r) => "email" in (r.user as object))).toBe(true);
    });

    it("X2 `@Company` nhưng KHÔNG có cặp danh bạ ⇒ đủ hàng, VẮNG khoá `email`", async () => {
      const { status, rows } = await loginLogs(tokCoNoDir);
      expect(status).toBe(200);
      expect(rows.some((r) => r.user?.id === uOther)).toBe(true); // hàng KHÔNG bị chặn
      const withEmail = rows.filter((r) => r.user !== null && "email" in r.user);
      expect(withEmail, "cặp danh bạ vắng mà cột danh tính vẫn hiện").toEqual([]);
    });

    it("X3 ô `Own × Own`: chủ thể (=tôi) CÓ email, tác nhân (người khác) VẮNG khoá", async () => {
      // Ba vị từ ở đây trông giống hệt nhau (`user_id = actor`) nhưng nói về BA bảng khác nhau:
      // `user_security_events` (hàng) · `users` (chủ thể) · `sec_event_actor` (tác nhân). Gộp bất kỳ
      // hai cái nào cũng cho ra một trong hai chiều sai của lỗ B1.
      const { status, rows } = await securityEvents(tokOwnOwn);
      expect(status).toBe(200);
      const mine = rows.filter((r) => r.user?.id === uOwnOwn);
      expect(mine.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.user?.id === uOwnOwn)).toBe(true); // vế HÀNG
      for (const r of mine) {
        expect(r.user !== null && "email" in r.user, "email của CHÍNH MÌNH bị giấu oan").toBe(true);
        // ⚠️ Vế "tác nhân VẮNG email" phải đứng SAU hai assert dựng hình dạng, nếu không nó xanh
        // RỖNG: `r.actor !== null && "email" in r.actor` cho `false` **cả khi `actor === null`**,
        // tức ca vẫn xanh nếu bản vá làm mất hẳn tác nhân khỏi DTO — đúng lớp bẫy KI-052 (một `null`
        // mang hai nghĩa). `userRef()` của KI-054 trả `{id, display_name:null}` KHÔNG khoá `email`
        // cho hàng ngoài scope danh bạ ⇒ hình dạng ĐÚNG là: có object, `id` đúng người, KHÔNG có
        // khoá `email`. Ba assert, ba câu hỏi khác nhau — gộp lại là mất hai câu.
        expect(
          r.actor,
          "tác nhân biến mất khỏi DTO — assert vắng-email sẽ xanh RỖNG",
        ).not.toBeNull();
        expect(r.actor?.id, "tác nhân không phải người đã seed (uOther)").toBe(uOther);
        expect("email" in (r.actor ?? {}), "email của TÁC NHÂN người khác bị lộ").toBe(false);
      }
    });

    it("G1 thiếu cặp GATE `view:audit-log` ⇒ 403 ở guard (bản vá KHÔNG nới route)", async () => {
      expect((await loginLogs(tokOther)).status).toBe(403);
      expect((await securityEvents(tokOther)).status).toBe(403);
    });
  },
);
