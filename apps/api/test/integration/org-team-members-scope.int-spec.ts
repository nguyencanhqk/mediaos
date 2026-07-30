/**
 * S6-SEC-ORGTEAMSCOPE-1 — N-1c (KI-049): `GET /org/teams/:id/members` chiếu `userEmail` +
 * `userFullName` mà KHÔNG ép `data_scope`.
 *
 * VẾ RED (trên code TRƯỚC khi vá): cả ba ca dưới đây trả email của MỌI thành viên team, kể cả khi
 * actor chỉ có `view:user@Own`, và kể cả khi actor **không có `view:user` nào**. `OrgService.
 * listTeamMembers` chỉ gọi repo, repo chỉ `withTenant` ⇒ **cặp quyền gate (`team`) LỆCH với lớp dữ
 * liệu trả về (`user`)** — cùng lớp lỗi mà N-1 vừa vá cho `/org/employees` (memory
 * `read-path-gate-pair-must-match-download-pair`).
 *
 * VÌ SAO ca `hr-manager` quan trọng nhất: đo PROD 2026-07-29 cho thấy role SEEDED `hr-manager` giữ
 * `read:team@Company` mà **KHÔNG có `view:user` nào**. Nó bị 403 ở `/org/employees` lại đọc được
 * `userEmail` của toàn bộ thành viên mọi team qua cửa bên cạnh. Lỗ có sẵn trong seed, không phải role
 * ai đúc sai.
 *
 * QUYẾT ĐỊNH được khoá ở đây (plan §3.1 + §3.2, owner chốt 2026-07-29): route trả HAI lớp dữ liệu.
 * `read:team` quyết định truy cập *tài nguyên team* (giữ nguyên). Hai cột danh tính người bị buộc bởi
 * scope của **cặp danh bạ `view:user`** — KHÔNG phát minh ngữ nghĩa `Own`/`Team`/`Department` thứ hai
 * cho `teams`. Ngoài scope ⇒ **BỎ HẲN KHOÁ** (không phải trả `null`): contract `teamMemberSchema` khai
 * `userEmail: z.string().email().optional()` — **không** `.nullable()` ⇒ trả `null` sẽ vỡ Zod ở FE
 * dù HTTP 200 (memory `apifetch-drops-pagination-bare-array`).
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
 * ⚠️ HAI LITERAL CÓ CHỦ ĐÍCH — ĐỪNG import hằng số của `src/org/org.permissions.ts` vào đây.
 * Đây là **pin độc lập**: spec seed grant theo cặp NÀY rồi gọi route thật. Nếu nó đọc chính hằng số
 * mà guard/service đọc thì hai vế không bao giờ lệch được và pin mất tác dụng — đúng lỗi F3 mà FULL
 * gate của N-1 đã bắt (biến pin thành vòng tròn). Đổi hằng số mà quên đây ⇒ 403 hàng loạt, ĐỎ TO
 * TIẾNG, chứ không phải rò im lặng.
 */
const DIRECTORY_PAIR = ["view", "user"] as const;
const TEAM_PAIR = ["read", "team"] as const;

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

type MemberRow = {
  userId: string;
  roleName: string;
  userEmail?: string | null;
  userFullName?: string | null;
};

describe.skipIf(!hasLaneDb)(
  "S6-SEC-ORGTEAMSCOPE-1 — /org/teams/:id/members ép scope danh bạ (N-1c)",
  () => {
    const direct = directPool();
    let app: INestApplication;

    let A: SeededTenant;

    /** `view:user@Company` + `read:team@Company` — hình dạng SA/company-admin của PROD. */
    let uCompany = "";
    /** `view:user@Own` + `read:team@Company` — ca N-1c cốt lõi: danh bạ hẹp, cửa team rộng. */
    let uOwn = "";
    /** `read:team@Company`, KHÔNG có `view:user` — hình dạng role SEEDED `hr-manager`. */
    let uTeamOnly = "";
    /** Không grant nào — pin `read:team` vẫn còn gate route. */
    let uNone = "";

    let teamA = "";

    async function grant(
      companyId: string,
      userId: string,
      pair: readonly [string, string],
      dataScope: "Own" | "Team" | "Department" | "Company",
      label: string,
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `teamscope-${label}-${userId.slice(0, 8)}`);
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

    async function members(token: string): Promise<{ status: number; rows: MemberRow[] }> {
      const res = await api(app).get(`/org/teams/${teamA}/members`).set(bearer(token));
      return { status: res.status, rows: (res.body?.data ?? []) as MemberRow[] };
    }

    /** Số hàng CÓ khoá danh tính. Đếm khoá tồn tại, KHÔNG đếm giá trị truthy — quyết định là BỎ KHOÁ. */
    function withIdentity(rows: MemberRow[]): MemberRow[] {
      return rows.filter((r) => "userEmail" in r || "userFullName" in r);
    }

    let tokCompany = "";
    let tokOwn = "";
    let tokTeamOnly = "";
    let tokNone = "";

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      // KHÔNG `setGlobalPrefix`: các int-spec khác gọi route TRẦN (`/auth/login`). Đặt prefix ở đây
      // cho 404 ở mọi request và trông như route biến mất chứ không như lỗi cấu hình test.
      app = moduleRef.createNestApplication();
      app.useGlobalFilters(new AllExceptionsFilter());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      await app.init();

      A = await seedCompany(direct, "teamscope");

      // `seedUser` nhận password HASH (không phải mật khẩu thô) — truyền thô thì login trả 500
      // PasswordVerificationError, trông như hạ tầng hỏng chứ không như lỗi seed.
      const hash = await new PasswordService().hash(PASSWORD);
      uCompany = await seedUser(direct, A.companyId, "company@teamscope.test", hash);
      uOwn = await seedUser(direct, A.companyId, "own@teamscope.test", hash);
      uTeamOnly = await seedUser(direct, A.companyId, "teamonly@teamscope.test", hash);
      uNone = await seedUser(direct, A.companyId, "none@teamscope.test", hash);

      await grant(A.companyId, uCompany, DIRECTORY_PAIR, "Company", "dir-company");
      await grant(A.companyId, uCompany, TEAM_PAIR, "Company", "team-company");
      await grant(A.companyId, uOwn, DIRECTORY_PAIR, "Own", "dir-own");
      await grant(A.companyId, uOwn, TEAM_PAIR, "Company", "team-own");
      // CỐ Ý không grant DIRECTORY_PAIR — đây là hình dạng `hr-manager` của PROD.
      await grant(A.companyId, uTeamOnly, TEAM_PAIR, "Company", "team-only");

      // Team có CẢ BỐN người ⇒ mọi actor đều là thành viên, nên "thấy được hàng" không bao giờ là 0
      // và ta phân biệt được "bị chặn hàng" với "bị bỏ cột".
      const t = await direct.query(
        `insert into teams (company_id, name, status) values ($1, 'Team A', 'active') returning id`,
        [A.companyId],
      );
      teamA = t.rows[0].id as string;
      for (const uid of [uCompany, uOwn, uTeamOnly, uNone]) {
        await direct.query(
          `insert into team_members (company_id, team_id, user_id, role_name) values ($1, $2, $3, 'member')`,
          [A.companyId, teamA, uid],
        );
      }

      tokCompany = await login(A.slug, "company@teamscope.test");
      tokOwn = await login(A.slug, "own@teamscope.test");
      tokTeamOnly = await login(A.slug, "teamonly@teamscope.test");
      tokNone = await login(A.slug, "none@teamscope.test");
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await cleanupTenants(direct, [A?.companyId].filter(Boolean) as string[]);
      await direct.end();
    });

    // ── Ca ĐỐI CHỨNG: không có nó thì "0 email" không phân biệt được với "route hỏng" ──────────────
    it("Company: thấy đủ 4 thành viên VÀ đủ email (chống siết quá tay)", async () => {
      const { status, rows } = await members(tokCompany);
      expect(status).toBe(200);
      expect(rows).toHaveLength(4);
      expect(withIdentity(rows)).toHaveLength(4);
      expect(rows.map((r) => r.userEmail).sort()).toEqual(
        [
          "company@teamscope.test",
          "none@teamscope.test",
          "own@teamscope.test",
          "teamonly@teamscope.test",
        ].sort(),
      );
    });

    // ── Ca N-1c cốt lõi ───────────────────────────────────────────────────────────────────────────
    it("Own + read:team@Company: vẫn thấy 4 hàng quan hệ, nhưng CHỈ hàng của chính mình có danh tính", async () => {
      const { status, rows } = await members(tokOwn);
      expect(status).toBe(200);
      // Vế quan hệ KHÔNG bị siết — `read:team` cho phép biết ai thuộc team nào (plan §3.2 đường A).
      expect(rows).toHaveLength(4);
      const identity = withIdentity(rows);
      expect(identity).toHaveLength(1);
      expect(identity[0]?.userId).toBe(uOwn);
      expect(identity[0]?.userEmail).toBe("own@teamscope.test");
      // Ba hàng còn lại: khoá phải VẮNG MẶT, không phải null (contract userEmail chưa .nullable()).
      for (const r of rows.filter((x) => x.userId !== uOwn)) {
        expect("userEmail" in r, `userEmail phải VẮNG cho ${r.userId}`).toBe(false);
        expect("userFullName" in r, `userFullName phải VẮNG cho ${r.userId}`).toBe(false);
      }
    });

    it("read:team@Company mà KHÔNG có view:user (hình dạng `hr-manager` seeded): 4 hàng, 0 danh tính", async () => {
      const { status, rows } = await members(tokTeamOnly);
      expect(status).toBe(200);
      expect(rows).toHaveLength(4);
      expect(withIdentity(rows)).toHaveLength(0);
    });

    // ── Pin: `read:team` vẫn là cổng của route (đừng nới ra khi thêm scope danh bạ) ─────────────────
    it("không có read:team: 403 — vá này KHÔNG được biến route thành mở", async () => {
      const { status } = await members(tokNone);
      expect(status).toBe(403);
    });
  },
);
