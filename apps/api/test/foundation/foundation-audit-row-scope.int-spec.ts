/**
 * S10-SEC-AUDITLOGROW-2 — KI-072: `data_scope` phải chặn **TẬP HÀNG** của `audit_logs` trên đường
 * COMPANY (`GET /foundation/audit-logs` + `/:id`), không chỉ chặn chéo tenant bằng RLS.
 *
 * VẾ RED (hành vi TRƯỚC bản vá, đo trên cây 2026-08-22):
 *   • `AuditQueryService.listCompany(companyId, query)` KHÔNG nhận `userId` của actor ⇒ không resolve
 *     `data_scope` được kể cả nếu muốn. `withTenant` + RLS chặn CHÉO tenant, không chặn TRONG tenant
 *     ⇒ vai `view:audit-log@Own` đọc trọn 13.201 hàng audit của tenant.
 *   • `query.actorUserId` đi THẲNG vào `eq(auditLogs.actorUserId, …)` ⇒ dò được lịch sử hành động của
 *     một UUID bất kỳ. Nặng hơn vế trên vì là oracle CÓ ĐIỀU KHIỂN.
 *   • `countTx` dùng CÙNG `buildWhere` ⇒ vá mỗi `findManyTx` thì `pagination.total` VẪN phát ra số
 *     hàng ngoài scope trong khi `data` sạch — oracle ĐẾM ĐƯỢC, im lặng.
 *   • `getCompanyDetail(companyId, id)` là CHIỀU THỨ HAI (0 vị từ scope), ca list xanh không chứng
 *     minh gì cho nó.
 *
 * ⚠️ MỘT cặp quyền, KHÔNG phải hai (khác WO-1). Route này KHÔNG chiếu `email`/`fullName` — `toDto`
 * chỉ trả `actorUserId` (UUID) — nên tầng bound-CỘT của KI-053/054 không áp dụng và fixture KHÔNG cần
 * cặp danh bạ `view:user`. Nếu bạn sắp thêm nó vào đây, hãy hỏi trước: nó bound cái gì ở route này?
 *
 * ⚠️ NGỮ NGHĨA `Own` Ở BẢNG NÀY = "hàng do TÔI GÂY RA" (`actor_user_id`), KHÁC `login_logs` (`Own` =
 * hàng VỀ tôi, bám `user_id`). `audit_logs` chỉ có MỘT cột người. Hệ quả có chủ đích: hàng
 * `actor_user_id IS NULL` (job máy/hệ thống — 360 hàng trên PROD) BIẾN MẤT khỏi vai `Own`, vì
 * `NULL = uuid` cho NULL chứ không TRUE. Ca `N1` ghim chiều này. Ai "sửa" thành
 * `OR actor_user_id IS NULL` là mở toang toàn bộ hàng hệ thống cho mọi vai `Own` — plan D3.
 *
 * LUẬT CA (memory `deny-cases-vacuous-without-allow-case`): mỗi vế DENY có vế ALLOW đối chứng. Ca
 * "0 hàng" một mình không phân biệt được "bị chặn đúng" với "route hỏng".
 *
 * ⚠️ CHỐNG NHIỄU: `audit_logs` là bảng ỨNG DỤNG TỰ GHI và lane DB dùng chung với suite khác — chính
 * `login()` của fixture cũng sinh hàng audit. Mọi hàng seed mang CÙNG `object_id = FIXTURE_OBJ` và
 * mọi lượt gọi kèm `?objectId=FIXTURE_OBJ` (filter `eq`, không phải prefix) ⇒ tập hàng xác định.
 * Mọi hằng đếm suy từ FIXTURE, không lấy từ response.
 *
 * Gate `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
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
 * ⚠️ LITERAL CÓ CHỦ ĐÍCH — ĐỪNG import hằng số của `src/**` vào đây (cùng lý do đã ghi ở
 * `audit-log-row-scope.int-spec.ts` của WO-1). Spec seed grant theo cặp NÀY rồi gọi route thật; nếu
 * nó đọc chính hằng số mà guard/service đọc thì hai vế không bao giờ lệch được và pin mất tác dụng.
 *
 * `isSensitive: true` phải khớp catalog thật (`view:audit-log` SENSITIVE, mig 0340) — sai cờ thì
 * `seedPermissionCatalog` NÉM.
 */
const AUDIT_LOG_PAIR = ["view", "audit-log"] as const;

/** Số hàng seed TAY mang `FIXTURE_OBJ` — hằng của fixture, KHÔNG đọc ngược từ response (⟲R1-B4). */
const SEEDED_ROWS_TOTAL = 3;
const SEEDED_ROWS_OF_OWN = 1;

type AuditRow = { id: string; actorUserId: string | null; action: string };
type Listed = { status: number; rows: AuditRow[]; total: number };

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe.skipIf(!hasLaneDb)(
  "S10-SEC-AUDITLOGROW-2 — KI-072 vị từ scope chặn TẬP HÀNG `audit_logs` (đường COMPANY)",
  () => {
    const direct = directPool();
    let app: INestApplication;
    let A: SeededTenant;

    /** Neo cô lập: mọi hàng seed của suite này mang `object_id` NÀY. */
    const FIXTURE_OBJ = randomUUID();
    const TAG = `AROW2-${randomUUID().slice(0, 8)}`;

    /** `view:audit-log@Company` — hình dạng SA/company-admin/QLCC của PROD. Đối chứng ALLOW. */
    let uCompany = "";
    /** `view:audit-log@Own` — hình dạng lỗ. */
    let uOwn = "";
    /** `view:audit-log@Team` — lattice không định nghĩa membership trên `audit_logs` ⇒ 0 hàng. */
    let uTeam = "";
    /** KHÔNG grant. Là ACTOR của hàng ngoài scope của `uOwn`. */
    let uOther = "";
    /** KHÔNG grant. Ca 403 ở guard — bản vá KHÔNG được nới route. */
    let uNoGrant = "";

    let tokCompany = "";
    let tokOwn = "";
    let tokTeam = "";
    let tokNoGrant = "";

    /** id ba hàng seed — R3/A4 gọi thẳng `/:id` trên hàng của `uOther`. */
    let rowOfOwn = "";
    let rowOfOther = "";
    let rowNullActor = "";

    async function grant(
      userId: string,
      dataScope: "Own" | "Team" | "Company",
      label: string,
    ): Promise<void> {
      const roleId = await seedRole(direct, A.companyId, `arow2-${label}-${userId.slice(0, 8)}`);
      const permId = await seedPermissionCatalog(
        direct,
        AUDIT_LOG_PAIR[0],
        AUDIT_LOG_PAIR[1],
        true,
      );
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

    /** Chèn 1 hàng audit RAW (direct pool, bypass RLS) — khuôn `audit-list-filter.int-spec.ts:73-86`. */
    async function insertAudit(action: string, actorUserId: string | null): Promise<string> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO audit_logs (company_id, action, object_type, object_id, actor_user_id)
         VALUES ($1, $2, 'user', $3, $4)
         RETURNING id`,
        [A.companyId, action, FIXTURE_OBJ, actorUserId],
      );
      return r.rows[0].id;
    }

    /** GET list — LUÔN neo `objectId` để tập hàng xác định; `limit=100` tường minh (mặc định 50). */
    async function list(token: string, extraQuery = ""): Promise<Listed> {
      const res = await api(app)
        .get(`/foundation/audit-logs?objectId=${FIXTURE_OBJ}&limit=100&offset=0${extraQuery}`)
        .set(bearer(token));
      return {
        status: res.status,
        rows: (res.body?.data ?? []) as AuditRow[],
        total: (res.body?.pagination?.total ?? -1) as number,
      };
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      A = await seedCompany(direct, `ar2${randomUUID().slice(0, 6)}`);
      const pw = await new PasswordService().hash(PASSWORD);

      const mkUser = async (label: string): Promise<[string, string]> => {
        const email = `${label}-${randomUUID().slice(0, 8)}@arow2.test`;
        const id = await seedUser(direct, A.companyId, email, pw);
        return [id, email];
      };

      const [idCompany, emailCompany] = await mkUser("co");
      const [idOwn, emailOwn] = await mkUser("own");
      const [idTeam, emailTeam] = await mkUser("team");
      const [idOther] = await mkUser("other");
      const [idNoGrant, emailNoGrant] = await mkUser("nogrant");
      uCompany = idCompany;
      uOwn = idOwn;
      uTeam = idTeam;
      uOther = idOther;
      uNoGrant = idNoGrant;

      await grant(uCompany, "Company", "co");
      await grant(uOwn, "Own", "own");
      await grant(uTeam, "Team", "team");
      // uOther / uNoGrant CỐ Ý không có cặp nào.

      rowOfOwn = await insertAudit(`${TAG}-own`, uOwn);
      rowOfOther = await insertAudit(`${TAG}-other`, uOther);
      rowNullActor = await insertAudit(`${TAG}-sys`, null);

      tokCompany = await login(emailCompany);
      tokOwn = await login(emailOwn);
      tokTeam = await login(emailTeam);
      tokNoGrant = await login(emailNoGrant);
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      if (A?.companyId) await cleanupTenants(direct, [A.companyId]);
      await direct?.end();
    });

    // ── VẾ RED — phải ĐỎ trên cây trước bản vá ────────────────────────────────────────────────────

    it("R1 🔴 `view:audit-log@Own` chỉ đọc được hàng audit DO CHÍNH MÌNH gây ra", async () => {
      const r = await list(tokOwn);
      expect(r.status).toBe(200);
      // KHÔNG dùng `every` một mình: mảng rỗng làm `every` đúng một cách vô nghĩa (⟲R1-B1). Ca A2 giữ
      // sàn "≥1 hàng"; ở đây assert cả hai chiều cho chắc.
      expect(r.rows.length).toBe(SEEDED_ROWS_OF_OWN);
      expect(r.rows.every((row) => row.actorUserId === uOwn)).toBe(true);
      expect(r.rows.map((row) => row.id)).not.toContain(rowOfOther);
    });

    it("R2 🔴 `?actorUserId=<người khác>` là phép GIAO với vị từ scope ⇒ 0 hàng VÀ total 0 (HTTP 200)", async () => {
      const r = await list(tokOwn, `&actorUserId=${uOther}`);
      // 200 chứ KHÔNG 403: 403 ở đây phân biệt "ngoài scope" với "không có hàng" ⇒ oracle tồn-tại (D4).
      expect(r.status).toBe(200);
      expect(r.rows).toHaveLength(0);
      // Vế `total`: `countForActorTx` phải đi qua CÙNG vị từ — `data` sạch mà `total` vẫn phát số hàng
      // ngoài scope là oracle ĐẾM ĐƯỢC và im lặng (V3).
      expect(r.total).toBe(0);
    });

    it("R3 🔴 `/:id` của hàng NGOÀI scope ⇒ 404 (cùng mã với cross-tenant miss, không phải 403)", async () => {
      const res = await api(app).get(`/foundation/audit-logs/${rowOfOther}`).set(bearer(tokOwn));
      // 404 chứ KHÔNG 403 (D5): phân biệt được "tồn tại nhưng của người khác" là oracle single-row.
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("N1 🔴 vai `Own` KHÔNG thấy hàng `actor_user_id IS NULL` (job máy) — ngữ nghĩa D3", async () => {
      const r = await list(tokOwn);
      expect(r.status).toBe(200);
      // ⟲FULL-gate: chốt ĐỘ DÀI TRƯỚC hai phủ định. `[].not.toContain(x)` và `[].some(...)===false`
      // đều đúng một cách vô nghĩa trên mảng rỗng, nên nếu route hỏng thành "luôn 0 hàng" thì ca này
      // xanh mà không kiểm gì. Không dựa vào ca A1 ở `it` khác để cứu — mỗi ca phải tự vệ được.
      expect(r.rows.length).toBe(SEEDED_ROWS_OF_OWN);
      expect(r.rows.map((row) => row.id)).not.toContain(rowNullActor);
      expect(r.rows.some((row) => row.actorUserId === null)).toBe(false);
    });

    it("R4 🔴 KHÔNG neo `objectId` — nhánh request MẶC ĐỊNH của production cũng bound", async () => {
      // ⚠️ CA NÀY TỒN TẠI VÌ MỘT ĐỘT BIẾN SỐNG SÓT (FULL gate, security-reviewer).
      // `buildWhereForActor` có HAI nhánh: `scoped ? and(rowCond, scoped) : rowCond`. Mọi ca khác đi
      // qua `list()`, mà `list()` LUÔN nối `?objectId=` (neo chống nhiễu ⟲R1-C7) ⇒ 100% ca chỉ chạm
      // nhánh `scoped` truthy. Đột biến `: sql\`true\`` ở nhánh KHÔNG-filter cho 12/12 XANH trong khi
      // mở toang `GET /foundation/audit-logs` không tham số — đúng lời gọi FE bắn ở lần tải đầu.
      // Chính cái neo chống nhiễu đẻ ra vùng mù này.
      //
      // Ca này KHÔNG neo `objectId` nên miễn nhiễm với nhiễu lane-DB theo một cách khác: hàng của
      // suite khác mang actor KHÁC, nên `every(actorUserId === uOwn)` vẫn là phát biểu đúng và chặt.
      const res = await api(app)
        .get("/foundation/audit-logs?limit=100&offset=0")
        .set(bearer(tokOwn));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = (res.body?.data ?? []) as AuditRow[];
      expect(rows.length).toBeGreaterThanOrEqual(1); // chống xanh-RỖNG
      expect(rows.every((row) => row.actorUserId === uOwn)).toBe(true);
    });

    it("T1 🔴 `view:audit-log@Team` ⇒ 0 hàng + total 0 (lattice không định nghĩa membership ở bảng này)", async () => {
      const r = await list(tokTeam);
      expect(r.status).toBe(200);
      expect(r.rows).toHaveLength(0);
      expect(r.total).toBe(0);
    });

    // ── VẾ ALLOW — thiếu là mọi ca DENY ở trên xanh-RỖNG ──────────────────────────────────────────

    it("A1 ✅ `view:audit-log@Company` thấy ĐỦ cả ba hàng (kể cả hàng NULL actor)", async () => {
      const r = await list(tokCompany);
      expect(r.status).toBe(200);
      const ids = r.rows.map((row) => row.id);
      expect(ids).toContain(rowOfOwn);
      expect(ids).toContain(rowOfOther);
      expect(ids).toContain(rowNullActor);
    });

    it("A2 ✅ vai `Own` VẪN thấy hàng của chính mình (0 hàng ≠ route hỏng)", async () => {
      const r = await list(tokOwn);
      expect(r.status).toBe(200);
      expect(r.rows.length).toBeGreaterThanOrEqual(1);
      expect(r.rows.map((row) => row.id)).toContain(rowOfOwn);
    });

    it("A3 ✅ vai `Own` + `?actorUserId=<chính mình>` ⇒ phép giao KHÔNG chặn oan", async () => {
      const r = await list(tokOwn, `&actorUserId=${uOwn}`);
      expect(r.status).toBe(200);
      expect(r.rows.map((row) => row.id)).toEqual([rowOfOwn]);
      expect(r.total).toBe(SEEDED_ROWS_OF_OWN);
    });

    it("A4 ✅ `Company` GET `/:id` của hàng người khác ⇒ 200 (đối chứng cho R3)", async () => {
      const res = await api(app)
        .get(`/foundation/audit-logs/${rowOfOther}`)
        .set(bearer(tokCompany));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.id).toBe(rowOfOther);
    });

    // ── VẾ TỔNG — `pagination.total` khác 0 (⟲R1-B4: mọi ca total ở trên đều `=== 0`) ─────────────

    it("C1 ✅ vai `Own` — `total` === số hàng data === hằng fixture (không đọc ngược từ response)", async () => {
      const r = await list(tokOwn);
      expect(r.status).toBe(200);
      expect(r.total).toBe(SEEDED_ROWS_OF_OWN);
      expect(r.total).toBe(r.rows.length);
    });

    it("C2 ✅ vai `Company` — `total` === 3 (hằng fixture)", async () => {
      const r = await list(tokCompany);
      expect(r.status).toBe(200);
      expect(r.total).toBe(SEEDED_ROWS_TOTAL);
      expect(r.total).toBe(r.rows.length);
    });

    // ── KHÔNG hồi quy tầng guard ──────────────────────────────────────────────────────────────────

    it("G1 thiếu cặp GATE `view:audit-log` ⇒ vẫn 403 (bản vá KHÔNG nới route)", async () => {
      const res = await api(app)
        .get(`/foundation/audit-logs?objectId=${FIXTURE_OBJ}&limit=100&offset=0`)
        .set(bearer(tokNoGrant));
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(uNoGrant).not.toBe("");
    });
  },
);
