/**
 * S20-SEC-TASKLEGACYREAD-1 — mọi đường đọc DANH SÁCH việc của `TasksController` dùng CÙNG một phạm vi đọc.
 * Plan: `docs/plans/S20-SEC-TASKLEGACYREAD-1.md` §4 (ca R1–R4 · A1–A5 · X1; S1 là chốt tĩnh ở
 * `src/tasks/tasks.permissions.spec.ts`). App THẬT (AppModule) dựng qua `applyMainPipeline`, engine quyền
 * THẬT, Postgres THẬT (lane cô lập).
 *
 * Bất biến I-1: với cùng người gọi, tập id việc trả về qua `GET /tasks/board`, `GET /tasks/by-project/:id`,
 * `GET /tasks/by-team/:id` ⊆ tập id mà `GET /tasks` trả cho người đó (không 2xx ⇒ tập rỗng).
 * Bất biến I-2: không có biểu thức phạm vi đọc thứ hai — đường chuẩn là nơi duy nhất quyết định.
 *
 * ⚠️ Bẫy xanh rỗng: ca phủ định («không thấy tO») xanh vô nghĩa nếu tO không tồn tại hoặc không nằm đúng chỗ
 *    mà ba đường đọc nhìn vào. Vì vậy `beforeAll` assert tiền điều kiện bằng direct pool (cột mà từng đường
 *    lọc), và A2 (người gọi phạm vi Company) là neo dương: tO tồn tại và đọc được ở phạm vi rộng.
 * ⚠️ Thứ tự assertion ở R1–R3: NỘI DUNG (body không chứa tO) TRƯỚC, status SAU — lượt đỏ ghi đúng nguyên nhân.
 *
 * Cổng `hasDb && LANE_DB` (CLAUDE.md §9.5). Không `Promise.all` quanh supertest (census S18-QA-SUPERTESTLISTEN-1).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { grant, seedEmployee, seedTask } from "../helpers/task-file-seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = loginPasswordFixture("s20trp");

/** Người gọi có đăng nhập. `N` @Own · `M` @Team · `H` @Company (công ty A) · `X` @Company (công ty B). */
type Caller = "N" | "M" | "H" | "X";

describe.skipIf(!runDb)(
  "S20-SEC-TASKLEGACYREAD-1 — cùng phạm vi đọc trên mọi đường danh sách việc",
  () => {
    const direct: Pool = directPool();
    let nest: INestApplication;
    let A: SeededTenant;
    let B: SeededTenant;
    const token: Partial<Record<Caller, string>> = {};
    const uid: Record<string, string> = {};
    const emp: Record<string, string> = {};
    let projectP = "";
    let teamT = "";
    const t = { N: "", O: "", E: "", B: "" };

    const http = () => request(nest.getHttpServer());
    const getAs = (who: Caller, path: string) =>
      http().get(path).set("Authorization", `Bearer ${token[who]}`);

    const legacyPaths = () => [
      "/tasks/board",
      `/tasks/by-project/${projectP}`,
      `/tasks/by-team/${teamT}`,
    ];

    /**
     * id việc trong `data` (mảng) của một response 2xx; không 2xx ⇒ tập rỗng (đường không phục vụ).
     * 2xx mà `data` không phải mảng ⇒ NÉM: phong bì lạ không được đọc thành «không có việc» (chống xanh rỗng).
     */
    function idsOf(res: request.Response): string[] {
      if (res.status < 200 || res.status >= 300) return [];
      const data: unknown = res.body?.data;
      if (!Array.isArray(data)) {
        throw new Error(`status ${res.status} nhưng data không phải mảng (${typeof data})`);
      }
      return data.map((row: { id?: unknown }) => String(row.id));
    }

    async function canonicalIds(who: Caller): Promise<string[]> {
      const res = await getAs(who, "/tasks?limit=100");
      expect(res.status, `GET /tasks (${who}): ${JSON.stringify(res.body)}`).toBe(200);
      expect(Array.isArray(res.body.data), "GET /tasks trả mảng trong data").toBe(true);
      return idsOf(res);
    }

    /** Content TRƯỚC, status SAU (plan §4 F3). */
    function expectNotServedWithout(res: request.Response, hiddenId: string, statuses: number[]) {
      const body = JSON.stringify(res.body);
      expect(body.includes(hiddenId), `body lộ việc ngoài phạm vi (status ${res.status})`).toBe(
        false,
      );
      expect(statuses, `status ${res.status}: ${body.slice(0, 300)}`).toContain(res.status);
    }

    beforeAll(async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "trpA");
      B = await seedCompany(direct, "trpB");

      const user = async (k: string, companyId: string, slug: string) => {
        uid[k] = await seedUser(direct, companyId, `${k.toLowerCase()}@${slug}.test`, hash);
      };
      await user("N", A.companyId, A.slug);
      await user("O", A.companyId, A.slug);
      await user("M", A.companyId, A.slug);
      await user("H", A.companyId, A.slug);
      await user("X", B.companyId, B.slug);
      await grant(direct, A.companyId, uid.N, [["read", "task"]], "Own");
      await grant(direct, A.companyId, uid.M, [["read", "task"]], "Team");
      await grant(direct, A.companyId, uid.H, [["read", "task"]], "Company");
      await grant(direct, B.companyId, uid.X, [["read", "task"]], "Company");

      emp.N = await seedEmployee(direct, A.companyId, uid.N);
      emp.O = await seedEmployee(direct, A.companyId, uid.O);
      emp.E = await seedEmployee(direct, A.companyId, null);
      // Nhánh Team của phạm vi đọc: nhân viên có quản lý trực tiếp = người gọi M.
      await direct.query(`UPDATE employee_profiles SET direct_manager_id = $1 WHERE id = $2`, [
        uid.M,
        emp.E,
      ]);

      // Dự án P: N KHÔNG là thành viên (không có hàng project_members nào).
      const p = await direct.query(
        `INSERT INTO projects (company_id, name, project_status) VALUES ($1, 'trp-proj', 'Active') RETURNING id`,
        [A.companyId],
      );
      projectP = p.rows[0].id as string;

      // Team T: hàng `teams` TRƯỚC (team_members.team_id có FK tới teams), rồi thành viên O.
      const tm = await direct.query(
        `INSERT INTO teams (company_id, name) VALUES ($1, 'trp-team') RETURNING id`,
        [A.companyId],
      );
      teamT = tm.rows[0].id as string;
      await direct.query(
        `INSERT INTO team_members (company_id, team_id, user_id) VALUES ($1, $2, $3)`,
        [A.companyId, teamT, uid.O],
      );

      t.N = await seedTask(direct, A.companyId, emp.N);
      t.O = await seedTask(direct, A.companyId, emp.O, projectP);
      t.E = await seedTask(direct, A.companyId, emp.E);
      t.B = await seedTask(direct, B.companyId, null);
      // Cột người nhận theo user — cột mà đường theo nhóm lọc; helper `seedTask` không ghi cột này.
      await direct.query(`UPDATE tasks SET assignee_user_id = $1 WHERE id = $2`, [uid.O, t.O]);

      // ── Tiền điều kiện (direct pool) — thiếu một cái ⇒ đỏ ngay, các ca phủ định không được xanh rỗng.
      const pre = await direct.query(
        `SELECT tk.assignee_user_id, tk.project_id, tk.deleted_at,
              (SELECT count(*)::int FROM team_members tmm
                WHERE tmm.team_id = $2 AND tmm.user_id = $3 AND tmm.deleted_at IS NULL) AS in_team,
              (SELECT ep.direct_manager_id FROM employee_profiles ep WHERE ep.id = $4) AS e_manager
         FROM tasks tk WHERE tk.id = $1`,
        [t.O, teamT, uid.O, emp.E],
      );
      expect(pre.rows, "tiền điều kiện: hàng tO").toHaveLength(1);
      expect(pre.rows[0].assignee_user_id, "tiền điều kiện: tO.assignee_user_id = O").toBe(uid.O);
      expect(pre.rows[0].project_id, "tiền điều kiện: tO.project_id = P").toBe(projectP);
      expect(pre.rows[0].deleted_at, "tiền điều kiện: tO chưa xoá mềm").toBeNull();
      expect(pre.rows[0].in_team, "tiền điều kiện: team_members(T, O) còn hiệu lực").toBe(1);
      expect(pre.rows[0].e_manager, "tiền điều kiện: E.direct_manager_id = M").toBe(uid.M);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = applyMainPipeline(moduleRef.createNestApplication());
      await nest.init();
      await nest.listen(0);

      const logins: Array<[Caller, SeededTenant]> = [
        ["N", A],
        ["M", A],
        ["H", A],
        ["X", B],
      ];
      for (const [k, tenant] of logins) {
        const res = await http()
          .post("/auth/login")
          .send({
            companySlug: tenant.slug,
            email: `${k.toLowerCase()}@${tenant.slug}.test`,
            password: LOGIN_PW,
          });
        expect(res.status, `login ${k}: ${JSON.stringify(res.body)}`).toBe(200);
        token[k] = res.body.data.accessToken as string;
      }
    });

    afterAll(async () => {
      if (nest) await nest.close();
      if (A && B) await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
    });

    // ══ Neo ALLOW (đường chuẩn) — chạy trước để ca phủ định có đối chứng dương ═════════════════════

    it("A1 · phạm vi Own: GET /tasks thấy việc của mình, không thấy việc của người khác", async () => {
      const ids = await canonicalIds("N");
      expect(ids).toContain(t.N);
      expect(ids).not.toContain(t.O);
    });

    it("A2 · phạm vi Company: GET /tasks thấy đủ tN, tO, tE (neo chống xanh rỗng)", async () => {
      const ids = await canonicalIds("H");
      expect(ids).toEqual(expect.arrayContaining([t.N, t.O, t.E]));
    });

    it("A3 · phạm vi Team: GET /tasks thấy việc của người mình quản lý, không thấy việc ngoài nhóm", async () => {
      const ids = await canonicalIds("M");
      expect(ids).toContain(t.E);
      expect(ids).not.toContain(t.O);
    });

    it("A4 · đường chi tiết giữ cùng phạm vi: việc của mình 200, việc ngoài phạm vi 404", async () => {
      const own = await getAs("N", `/tasks/${t.N}`);
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body.data?.id).toBe(t.N);
      const other = await getAs("N", `/tasks/${t.O}`);
      expect(JSON.stringify(other.body).includes(t.O), "404 không được kèm dữ liệu việc").toBe(
        false,
      );
      expect(other.status, JSON.stringify(other.body)).toBe(404);
    });

    it("A5 · GET /tasks/my vẫn 200 (literal anh em của :taskId)", async () => {
      const res = await getAs("N", "/tasks/my");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ Ba đường đọc danh sách đời cũ ═══════════════════════════════════════════════════════════════

    it("R1 · GET /tasks/board không trả việc ngoài phạm vi và không còn phục vụ (400/404)", async () => {
      expectNotServedWithout(await getAs("N", "/tasks/board"), t.O, [400, 404]);
    });

    it("R2 · GET /tasks/by-project/:projectId không trả việc ngoài phạm vi và không còn phục vụ (404)", async () => {
      expectNotServedWithout(await getAs("N", `/tasks/by-project/${projectP}`), t.O, [404]);
    });

    it("R3 · GET /tasks/by-team/:teamId không trả việc ngoài phạm vi và không còn phục vụ (404)", async () => {
      expectNotServedWithout(await getAs("N", `/tasks/by-team/${teamT}`), t.O, [404]);
    });

    it("R4 · I-1: với người gọi Own và Team, id từ mỗi đường đời cũ ⊆ id của GET /tasks", async () => {
      // Lưới PHỤ: sau khi gỡ, ba đường không 2xx ⇒ tập rỗng ⇒ ca này chỉ có giá trị khi một đường được
      // khai lại; lớp chính là R1–R3 (nội dung + status), S1 (danh sách GET đã duyệt) và neo dương A1–A3.
      // Gom MỌI vi phạm rồi assert một lần — lượt đỏ ghi đủ 2 người gọi × 3 đường, không dừng ở cái đầu.
      const violations: string[] = [];
      for (const who of ["N", "M"] as const) {
        const allowed = new Set(await canonicalIds(who));
        for (const path of legacyPaths()) {
          const res = await getAs(who, path);
          const extra = idsOf(res).filter((id) => !allowed.has(id));
          const route = path.replace(/[0-9a-f-]{36}/g, ":id");
          if (extra.length > 0)
            violations.push(`${who} ${route} status=${res.status} extra=${extra.length}`);
        }
      }
      expect(violations).toEqual([]);
    });

    // ══ Cross-tenant ════════════════════════════════════════════════════════════════════════════════

    it("X1 · người gọi công ty khác: GET /tasks không chứa id công ty A; đường theo dự án/nhóm của A không 2xx", async () => {
      const ids = await canonicalIds("X");
      expect(ids, "đối chứng: người gọi B thấy việc của B").toContain(t.B);
      for (const id of [t.N, t.O, t.E]) expect(ids).not.toContain(id);
      for (const path of [`/tasks/by-project/${projectP}`, `/tasks/by-team/${teamT}`]) {
        const res = await getAs("X", path);
        const body = JSON.stringify(res.body);
        for (const id of [t.N, t.O, t.E]) expect(body.includes(id)).toBe(false);
        expect(res.status >= 200 && res.status < 300, `status ${res.status}`).toBe(false);
      }
    });
  },
);
