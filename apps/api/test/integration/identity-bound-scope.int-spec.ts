/**
 * S6-SEC-IDENTITYBOUND-1 — N-1d (KI-051) + N-1e (KI-052): hai đường còn chiếu danh tính người mà
 * KHÔNG ép `data_scope`.
 *
 * VẾ RED (trên code TRƯỚC khi vá):
 *   • `GET /recycle-bin/employees` gate `read:employee` rồi trả `userFullName` + `userEmail` của MỌI
 *     hồ sơ đã xoá mềm. `RecycleBinService.listDeletedEmployees` không resolve một scope nào.
 *   • `GET /org/teams` gate `read:team` rồi chiếu `leaderUserName` không bound — đúng hình dạng N-1c,
 *     ở phương thức BÊN CẠNH cái mà `S6-SEC-ORGTEAMSCOPE-1` vừa vá trong cùng file.
 *
 * VÌ SAO ca `employee` là ca quan trọng nhất (đo PROD 2026-07-30): role SEEDED `employee` giữ
 * `read:employee@Own` với **45/46 user sống**, và KHÔNG có `view:user` nào. `data_scope` của họ là
 * `Own` nhưng route bỏ qua scope hoàn toàn ⇒ mỗi nhân viên đọc được họ tên + email của toàn bộ nhân
 * sự đã nghỉ việc. KI-049 cùng lớp lỗi nhưng có 0 người giữ cặp; cái này có 45.
 *
 * QUYẾT ĐỊNH khoá ở đây (plan §3, nhất quán với N-1c): cặp gate giữ nguyên việc của nó
 * (`read:employee` = truy cập thùng rác, `read:team` = truy cập tài nguyên team). Cột danh tính người
 * bị buộc bởi scope của cặp danh bạ `view:user`. Ngoài scope ⇒ **BỎ HẲN KHOÁ**, không trả `null`.
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
 * ⚠️ BA LITERAL CÓ CHỦ ĐÍCH — ĐỪNG import hằng số của `src/**` vào đây. Đây là **pin độc lập**: spec
 * seed grant theo cặp NÀY rồi gọi route thật. Nếu nó đọc chính hằng số mà guard/service đọc thì hai
 * vế không bao giờ lệch được và pin mất tác dụng (lỗi F3 mà FULL gate N-1 đã bắt). Đổi hằng số mà
 * quên đây ⇒ 403 hàng loạt, ĐỎ TO TIẾNG, chứ không phải rò im lặng.
 */
const DIRECTORY_PAIR = ["view", "user"] as const;
const EMPLOYEE_PAIR = ["read", "employee"] as const;
const TEAM_PAIR = ["read", "team"] as const;

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

type DeletedRow = { userId: string; userFullName?: string | null; userEmail?: string | null };
type TeamRow = { id: string; leaderUserId: string | null; leaderUserName?: string | null };

describe.skipIf(!hasLaneDb)(
  "S6-SEC-IDENTITYBOUND-1 — recycle-bin + /org/teams ép scope danh bạ (N-1d/N-1e)",
  () => {
    const direct = directPool();
    let app: INestApplication;
    let A: SeededTenant;

    /** `view:user@Company` — hình dạng SA/company-admin của PROD. */
    let uCompany = "";
    /** `view:user@Own` — danh bạ hẹp, cửa nghiệp vụ rộng. */
    let uOwn = "";
    /** KHÔNG có `view:user` — hình dạng role SEEDED `employee`/`hr-manager` (45 user sống). */
    let uNoDir = "";
    /** Không grant nghiệp vụ nào — pin cổng route vẫn đóng. */
    let uNone = "";
    /** Người thứ năm: chỉ để bị xoá mềm / làm leader — KHÔNG đăng nhập. */
    let uOther = "";

    let teamOwnLed = "";
    let teamOtherLed = "";

    async function grant(
      companyId: string,
      userId: string,
      pair: readonly [string, string],
      dataScope: "Own" | "Team" | "Department" | "Company",
      label: string,
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `idbound-${label}-${userId.slice(0, 8)}`);
      const permId = await seedPermissionCatalog(direct, pair[0], pair[1], false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", dataScope);
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await api(app)
        .post("/auth/login")
        .send({ companySlug: slug, email, password: PASSWORD });
      expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function deletedEmployees(token: string) {
      const res = await api(app).get("/recycle-bin/employees").set(bearer(token));
      return { status: res.status, rows: (res.body?.data ?? []) as DeletedRow[] };
    }

    async function teams(token: string) {
      const res = await api(app).get("/org/teams").set(bearer(token));
      return { status: res.status, rows: (res.body?.data ?? []) as TeamRow[] };
    }

    /** Đếm khoá TỒN TẠI, không đếm giá trị truthy — quyết định là BỎ KHOÁ, không phải trả null. */
    function withIdentity<T extends object>(rows: T[], ...keys: string[]): T[] {
      return rows.filter((r) => keys.some((k) => k in r));
    }

    let tokCompany = "";
    let tokOwn = "";
    let tokNoDir = "";
    let tokNone = "";

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      // KHÔNG `setGlobalPrefix`: int-spec khác gọi route TRẦN. Đặt prefix ở đây cho 404 mọi request
      // và trông như route biến mất chứ không như lỗi cấu hình test.
      app = moduleRef.createNestApplication();
      app.useGlobalFilters(new AllExceptionsFilter());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      await app.init();

      A = await seedCompany(direct, "idbound");

      // `seedUser` nhận password HASH (không phải mật khẩu thô) — truyền thô thì login trả 500
      // PasswordVerificationError, trông như hạ tầng hỏng chứ không như lỗi seed.
      const hash = await new PasswordService().hash(PASSWORD);
      uCompany = await seedUser(direct, A.companyId, "company@idbound.test", hash);
      uOwn = await seedUser(direct, A.companyId, "own@idbound.test", hash);
      uNoDir = await seedUser(direct, A.companyId, "nodir@idbound.test", hash);
      uNone = await seedUser(direct, A.companyId, "none@idbound.test", hash);
      uOther = await seedUser(direct, A.companyId, "other@idbound.test", hash);

      await grant(A.companyId, uCompany, DIRECTORY_PAIR, "Company", "dir-company");
      await grant(A.companyId, uCompany, EMPLOYEE_PAIR, "Company", "emp-company");
      await grant(A.companyId, uCompany, TEAM_PAIR, "Company", "team-company");

      await grant(A.companyId, uOwn, DIRECTORY_PAIR, "Own", "dir-own");
      await grant(A.companyId, uOwn, EMPLOYEE_PAIR, "Own", "emp-own");
      await grant(A.companyId, uOwn, TEAM_PAIR, "Company", "team-own");

      // CỐ Ý không grant DIRECTORY_PAIR — đây là hình dạng `employee` của PROD (45 user sống).
      await grant(A.companyId, uNoDir, EMPLOYEE_PAIR, "Own", "emp-nodir");
      await grant(A.companyId, uNoDir, TEAM_PAIR, "Company", "team-nodir");

      // ── Thùng rác: HAI hồ sơ xoá mềm — một của chính `uOwn`, một của người khác. Cần cả hai thì ca
      //    `Own` mới phân biệt được "bound đúng theo chính mình" với "chặn sạch mọi thứ".
      for (const uid of [uOwn, uOther]) {
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id, deleted_at)
           VALUES ($1, $2, now())`,
          [A.companyId, uid],
        );
      }

      // ── Teams: một team do `uOwn` dẫn, một do `uOther` dẫn — cùng lý do như trên.
      const t1 = await direct.query(
        `INSERT INTO teams (company_id, name, status, leader_user_id)
         VALUES ($1, 'Team Own-led', 'active', $2) RETURNING id`,
        [A.companyId, uOwn],
      );
      teamOwnLed = t1.rows[0].id as string;
      const t2 = await direct.query(
        `INSERT INTO teams (company_id, name, status, leader_user_id)
         VALUES ($1, 'Team Other-led', 'active', $2) RETURNING id`,
        [A.companyId, uOther],
      );
      teamOtherLed = t2.rows[0].id as string;

      tokCompany = await login(A.slug, "company@idbound.test");
      tokOwn = await login(A.slug, "own@idbound.test");
      tokNoDir = await login(A.slug, "nodir@idbound.test");
      tokNone = await login(A.slug, "none@idbound.test");
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await cleanupTenants(direct, [A?.companyId].filter(Boolean) as string[]);
      await direct.end();
    });

    // ══ KI-051 — GET /recycle-bin/employees ═══════════════════════════════════════════════════════

    // Ca ĐỐI CHỨNG: thiếu nó thì "0 danh tính" không phân biệt được với "route hỏng".
    it("KI-051 Company: thấy đủ 2 hồ sơ đã xoá VÀ đủ danh tính (chống siết quá tay)", async () => {
      const { status, rows } = await deletedEmployees(tokCompany);
      expect(status).toBe(200);
      expect(rows).toHaveLength(2);
      expect(withIdentity(rows, "userEmail", "userFullName")).toHaveLength(2);
      expect(rows.map((r) => r.userEmail).sort()).toEqual(
        ["other@idbound.test", "own@idbound.test"].sort(),
      );
    });

    it("KI-051 Own: vẫn thấy 2 hàng, nhưng CHỈ hàng của chính mình có danh tính", async () => {
      const { status, rows } = await deletedEmployees(tokOwn);
      expect(status).toBe(200);
      // Vế nghiệp vụ KHÔNG bị siết — `read:employee` vẫn cho biết thùng rác có bao nhiêu hồ sơ.
      expect(rows).toHaveLength(2);
      const identity = withIdentity(rows, "userEmail", "userFullName");
      expect(identity).toHaveLength(1);
      expect(identity[0]?.userId).toBe(uOwn);
      expect(identity[0]?.userEmail).toBe("own@idbound.test");
      for (const r of rows.filter((x) => x.userId !== uOwn)) {
        expect("userEmail" in r, `userEmail phải VẮNG cho ${r.userId}`).toBe(false);
        expect("userFullName" in r, `userFullName phải VẮNG cho ${r.userId}`).toBe(false);
      }
    });

    // ⭐ Ca cốt lõi: hình dạng `employee` của PROD — 45/46 user sống đang ở đúng hình dạng này.
    it("KI-051 read:employee@Own mà KHÔNG có view:user (hình dạng `employee` seeded, 45 user): 2 hàng, 0 danh tính", async () => {
      const { status, rows } = await deletedEmployees(tokNoDir);
      expect(status).toBe(200);
      expect(rows).toHaveLength(2);
      expect(withIdentity(rows, "userEmail", "userFullName")).toHaveLength(0);
    });

    it("KI-051 không có read:employee: 403 — vá này KHÔNG được biến route thành mở", async () => {
      const { status } = await deletedEmployees(tokNone);
      expect(status).toBe(403);
    });

    // ══ KI-052 — GET /org/teams (leaderUserName) ══════════════════════════════════════════════════

    it("KI-052 Company: thấy đủ 2 team VÀ đủ tên trưởng nhóm (đối chứng)", async () => {
      const { status, rows } = await teams(tokCompany);
      expect(status).toBe(200);
      expect(rows).toHaveLength(2);
      expect(withIdentity(rows, "leaderUserName")).toHaveLength(2);
    });

    it("KI-052 Own: thấy đủ 2 team, chỉ team do CHÍNH MÌNH dẫn mới có tên trưởng nhóm", async () => {
      const { status, rows } = await teams(tokOwn);
      expect(status).toBe(200);
      expect(rows).toHaveLength(2);
      const identity = withIdentity(rows, "leaderUserName");
      expect(identity).toHaveLength(1);
      expect(identity[0]?.id).toBe(teamOwnLed);
      expect(
        rows.find((r) => r.id === teamOtherLed) &&
          "leaderUserName" in (rows.find((r) => r.id === teamOtherLed) as TeamRow),
      ).toBe(false);
    });

    it("KI-052 read:team@Company mà KHÔNG có view:user (hình dạng `hr-manager`): 2 team, 0 tên trưởng nhóm", async () => {
      const { status, rows } = await teams(tokNoDir);
      expect(status).toBe(200);
      expect(rows).toHaveLength(2);
      expect(withIdentity(rows, "leaderUserName")).toHaveLength(0);
    });

    it("KI-052 không có read:team: 403 — route vẫn đóng", async () => {
      const { status } = await teams(tokNone);
      expect(status).toBe(403);
    });

    // Biên của `leftJoin`: team CHƯA có trưởng nhóm ⇒ hàng `users` toàn NULL ⇒ vị từ scope ra NULL
    // (không phải false) ⇒ `identityInScope` NULL. Ca này khoá lại rằng NULL đi vào nhánh "bỏ khoá"
    // một cách an toàn, KHÔNG làm 500 và KHÔNG nuốt mất hàng — nếu không thì bản vá âm thầm làm biến
    // mất mọi team chưa gán trưởng nhóm khỏi màn cơ cấu.
    it("KI-052 team CHƯA có trưởng nhóm: vẫn liệt kê đủ, chỉ vắng khoá tên (kể cả actor Company)", async () => {
      const t3 = await direct.query(
        `INSERT INTO teams (company_id, name, status, leader_user_id)
         VALUES ($1, 'Team Leaderless', 'active', NULL) RETURNING id`,
        [A.companyId],
      );
      const leaderless = t3.rows[0].id as string;

      const { status, rows } = await teams(tokCompany);
      expect(status).toBe(200);
      expect(rows).toHaveLength(3);
      const row = rows.find((r) => r.id === leaderless);
      expect(row, "team chưa có trưởng nhóm phải VẪN được liệt kê").toBeDefined();
      expect(row?.leaderUserId).toBeNull();
      expect("leaderUserName" in (row as TeamRow)).toBe(false);
      // Hai team có trưởng nhóm vẫn đủ tên — không bị ca biên này kéo theo.
      expect(withIdentity(rows, "leaderUserName")).toHaveLength(2);

      await direct.query(`DELETE FROM teams WHERE id = $1`, [leaderless]);
    });
  },
);
