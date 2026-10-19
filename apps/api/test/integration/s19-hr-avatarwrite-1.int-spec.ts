/**
 * S19-HR-AVATARWRITE-1 — đường GHI `employee_profiles.avatar_url` chỉ còn W1 (`/me/avatar`) + W2 (endpoint
 * ảnh của HR), cả hai đã kiểm tệp. Plan `docs/plans/S19-HR-AVATARWRITE-1.md` §6.
 *
 * Bất biến:
 *   1. Giá trị khác NULL trong `avatar_url` chỉ do W1/W2 ghi ⇒ `POST/PATCH /employees` chỉ nhận lệnh GỠ
 *      (`avatarUrl: null`); MỌI chuỗi ⇒ 400 `VALIDATION-ERR-001`, không ghi gì (R1–R5, A4).
 *   2. Đường đọc không trả chuỗi người dùng cung cấp làm URL ảnh (R6).
 *   3. Duyệt đề nghị sửa hồ sơ fail-closed trên MỘT tập = `changedFields` ∪ khoá `newValues` cho kiểm cho
 *      phép, cổng nhạy cảm, áp cột và lịch sử (R7–R9, R8b, R8c).
 *   4. Mọi lần cột ảnh từ khác-NULL về NULL đều có một hàng audit `avatar-remove` (R13, A1b).
 *
 * ┌─ MỌI CA TỪ CHỐI ĐỀU CÓ NEO DƯƠNG ──────────────────────────────────────────────────────────────┐
 * │ R1–R5 đứng cạnh A1–A3 (cùng actor, cùng route ⇒ 201/200 thật); R6 khẳng định 200 + đúng `id`  │
 * │ trước khi khẳng định `avatarUrl === null`; R7–R8c đứng cạnh A5 (cùng service, cùng người duyệt │
 * │ ⇒ Approved + ghi cột thật). Không neo thì một 403/404 hay một fixture hỏng làm ca TỪ CHỐI xanh  │
 * │ rỗng.                                                                                           │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Ca service (R7–R9, R8b, R8c, A5) lấy `ProfileChangeRequestService`/`Repository` THẬT từ DI của app đã
 * dựng bằng `applyMainPipeline` — đi qua `PermissionService.can()` + `withTenant` (RLS thật), không mock.
 * Hàng đề nghị «cũ» (R8, R8b, R8c) chèn bằng direct pool: đó là hình dạng dữ liệu mà zod/`createRequest`
 * không còn tạo ra được, nhưng `approveRequest` vẫn phải từ chối.
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
 */

import { createHash, randomUUID } from "node:crypto";
import "reflect-metadata";
import { BadRequestException, ForbiddenException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { ProfileChangeRequestRepository } from "../../src/employees/profile-change-request.repository";
import { ProfileChangeRequestService } from "../../src/employees/profile-change-request.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
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
const LOGIN_PW = ["Passw0rd!", "avwrite"].join("");

/** Giá trị `avatarUrl` không phải lệnh gỡ — mọi dạng chuỗi đều phải bị từ chối như nhau. */
const JS_SCHEME_URL = ["javascript", "void(0)"].join(":");
const DATA_URI = ["data", "image/png;base64,AAAA"].join(":");
const FOREIGN_HTTP_URL = "https://example.invalid/avatar.png";
const RANDOM_UUID = randomUUID();

const VALIDATION_ERROR = "VALIDATION-ERR-001";
const FIELD_NOT_ALLOWED = "HR-ERR-040";

type Grant = { action: string; resourceType: string; sensitive: boolean };

const EMPLOYEE_WRITER: Grant[] = [
  { action: "read", resourceType: "employee", sensitive: false },
  { action: "create", resourceType: "employee", sensitive: false },
  { action: "update", resourceType: "employee", sensitive: false },
];
const REQUESTER: Grant[] = [
  { action: "create", resourceType: "profile-change-request", sensitive: false },
];
const APPROVER_NO_IDENTITY: Grant[] = [
  { action: "approve", resourceType: "profile-change-request", sensitive: false },
];
const APPROVER: Grant[] = [
  ...APPROVER_NO_IDENTITY,
  { action: "view-identity", resourceType: "employee", sensitive: true },
];

describe.skipIf(!hasLaneDb)("S19-HR-AVATARWRITE-1 đường ghi ảnh hồ sơ (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let svc: ProfileChangeRequestService;
  let repo: ProfileChangeRequestRepository;
  let db: DatabaseService;

  let token = "";
  let approverUid = "";
  let approverNoIdentityUid = "";

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

  async function grant(userId: string, label: string, grants: readonly Grant[]): Promise<void> {
    const roleId = await seedRole(direct, A.companyId, `avw-${label}-${randomUUID().slice(0, 6)}`);
    for (const g of grants) {
      const permId = await seedPermissionCatalog(direct, g.action, g.resourceType, g.sensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function freshUser(label: string, hash?: string): Promise<string> {
    return seedUser(
      direct,
      A.companyId,
      `${label}-${randomUUID().slice(0, 8)}@${A.slug}.test`,
      hash,
    );
  }

  /** Hồ sơ đích (direct pool, bỏ qua RLS — chỉ để dựng lưới thử). */
  async function seedProfile(
    avatarUrl: string | null,
    extra: { phone?: string; identityNumber?: string } = {},
  ): Promise<{ id: string; userId: string }> {
    const userId = await freshUser("target");
    const r = await direct.query(
      `INSERT INTO employee_profiles
         (company_id, user_id, status, work_type, employee_code, avatar_url, phone, identity_number)
       VALUES ($1, $2, 'active', 'offline', $3, $4, $5, $6) RETURNING id`,
      [
        A.companyId,
        userId,
        `AVW-${randomUUID().slice(0, 6)}`,
        avatarUrl,
        extra.phone ?? null,
        extra.identityNumber ?? null,
      ],
    );
    return { id: r.rows[0].id as string, userId };
  }

  async function profileRow(id: string): Promise<{
    avatar_url: string | null;
    phone: string | null;
    identity_number: string | null;
  }> {
    const r = await direct.query(
      "SELECT avatar_url, phone, identity_number FROM employee_profiles WHERE id = $1",
      [id],
    );
    return r.rows[0];
  }

  async function profileCountForUser(userId: string): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM employee_profiles WHERE company_id = $1 AND user_id = $2",
      [A.companyId, userId],
    );
    return r.rows[0].n as number;
  }

  async function avatarRemoveAudits(
    employeeId: string,
  ): Promise<Array<{ before: unknown; after: unknown; object_type: string }>> {
    const r = await direct.query(
      `SELECT before, after, object_type FROM audit_logs
       WHERE company_id = $1 AND action = 'avatar-remove' AND object_id = $2`,
      [A.companyId, employeeId],
    );
    return r.rows;
  }

  async function seedPcr(
    employeeId: string,
    requestedBy: string,
    changedFields: string[],
    newValues: Record<string, unknown>,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO profile_change_requests
         (company_id, employee_id, requested_by, status, old_values, new_values, changed_fields)
       VALUES ($1, $2, $3, 'Pending', '{}'::jsonb, $4::jsonb, $5::jsonb) RETURNING id`,
      [
        A.companyId,
        employeeId,
        requestedBy,
        JSON.stringify(newValues),
        JSON.stringify(changedFields),
      ],
    );
    return r.rows[0].id as string;
  }

  async function pcrStatus(id: string): Promise<string> {
    const r = await direct.query("SELECT status FROM profile_change_requests WHERE id = $1", [id]);
    return r.rows[0].status as string;
  }

  async function historyCount(requestId: string): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM employee_profile_change_histories WHERE request_id = $1",
      [requestId],
    );
    return r.rows[0].n as number;
  }

  async function pcrCountForEmployee(employeeId: string): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM profile_change_requests WHERE employee_id = $1",
      [employeeId],
    );
    return r.rows[0].n as number;
  }

  /** Khoá idempotency suy từ NỘI DUNG (cùng body ⇒ cùng khoá) — không ngẫu nhiên theo lần gửi. */
  function idemKey(body: Record<string, unknown>): string {
    return createHash("sha256").update(JSON.stringify(body)).digest("hex");
  }

  function postEmployee(body: Record<string, unknown>) {
    return auth(http().post("/employees")).set("Idempotency-Key", idemKey(body)).send(body);
  }

  function patchEmployee(id: string, body: Record<string, unknown>) {
    return auth(http().patch(`/employees/${id}`)).send(body);
  }

  async function expectRejected(
    run: () => Promise<unknown>,
    type: typeof BadRequestException | typeof ForbiddenException,
    code?: string,
  ): Promise<void> {
    let caught: unknown;
    try {
      await run();
    } catch (e) {
      caught = e;
    }
    expect(caught, "phải ném lỗi").toBeInstanceOf(type);
    if (code) expect((caught as Error).message).toContain(code);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);
    svc = app.get(ProfileChangeRequestService);
    repo = app.get(ProfileChangeRequestRepository);
    db = app.get(DatabaseService);

    direct = directPool();
    A = await seedCompany(direct, "avwrite");
    const hash = await new PasswordService().hash(LOGIN_PW);

    const writerEmail = `writer@${A.slug}.test`;
    const writerUid = await seedUser(direct, A.companyId, writerEmail, hash);
    await grant(writerUid, "writer", EMPLOYEE_WRITER);
    const login = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email: writerEmail, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    token = login.body.data.accessToken as string;

    approverUid = await freshUser("approver");
    await grant(approverUid, "approver", APPROVER);
    approverNoIdentityUid = await freshUser("approver-noid");
    await grant(approverNoIdentityUid, "approver-noid", APPROVER_NO_IDENTITY);
  });

  afterAll(async () => {
    if (direct && A) {
      await direct
        .query("DELETE FROM employee_profiles WHERE company_id = $1", [A.companyId])
        .catch(() => undefined);
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
    await app?.close();
  });

  // ── POST /employees ──────────────────────────────────────────────────────────────────────────────

  describe("POST /employees — chỉ nhận vắng hoặc null", () => {
    it.each([
      ["R1", JS_SCHEME_URL],
      ["R2", DATA_URI],
      ["R3", FOREIGN_HTTP_URL],
    ])("%s: avatarUrl dạng chuỗi ⇒ 400 VALIDATION-ERR-001, không hàng mới", async (_ca, value) => {
      const userId = await freshUser("post-deny");
      const res = await postEmployee({ userId, avatarUrl: value });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error.code).toBe(VALIDATION_ERROR);
      expect(await profileCountForUser(userId)).toBe(0);
    });

    it("A3: POST không avatarUrl ⇒ 201, cột NULL (neo dương cho R1–R3)", async () => {
      const userId = await freshUser("post-allow");
      const res = await postEmployee({ userId });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect((await profileRow(res.body.data.id as string)).avatar_url).toBeNull();
    });

    it("A3-null: POST avatarUrl null ⇒ 201, cột NULL", async () => {
      const userId = await freshUser("post-null");
      const res = await postEmployee({ userId, avatarUrl: null });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect((await profileRow(res.body.data.id as string)).avatar_url).toBeNull();
    });
  });

  // ── PATCH /employees/:id ─────────────────────────────────────────────────────────────────────────

  describe("PATCH /employees/:id — chỉ nhận lệnh gỡ", () => {
    it.each([
      ["R4", JS_SCHEME_URL],
      ["R5", FOREIGN_HTTP_URL],
      ["A4", RANDOM_UUID],
    ])("%s: avatarUrl dạng chuỗi ⇒ 400, cột KHÔNG đổi", async (_ca, value) => {
      const fileId = randomUUID();
      const target = await seedProfile(fileId);
      const res = await patchEmployee(target.id, { avatarUrl: value });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error.code).toBe(VALIDATION_ERROR);
      expect((await profileRow(target.id)).avatar_url).toBe(fileId);
    });

    it("A1: avatarUrl null trên cột = fileId ⇒ 200, cột NULL", async () => {
      const target = await seedProfile(randomUUID());
      const res = await patchEmployee(target.id, { avatarUrl: null });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await profileRow(target.id)).avatar_url).toBeNull();
    });

    it("R13: avatarUrl null trên cột = fileId ⇒ đúng 1 hàng audit avatar-remove", async () => {
      const fileId = randomUUID();
      const target = await seedProfile(fileId);
      const res = await patchEmployee(target.id, { avatarUrl: null });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = await avatarRemoveAudits(target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.object_type).toBe("employee");
      expect(rows[0]?.before).toEqual({ avatarUrl: fileId });
      expect(rows[0]?.after).toEqual({ avatarUrl: null });
    });

    it("A1b: avatarUrl null trên cột ĐÃ NULL ⇒ 200, 0 hàng audit avatar-remove", async () => {
      const target = await seedProfile(null);
      const res = await patchEmployee(target.id, { avatarUrl: null });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await avatarRemoveAudits(target.id)).toHaveLength(0);
    });

    it("A2: PATCH chỉ phone ⇒ 200, phone đổi, cột ảnh GIỮ", async () => {
      const fileId = randomUUID();
      const target = await seedProfile(fileId, { phone: "0900000001" });
      const res = await patchEmployee(target.id, { phone: "0900000002" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = await profileRow(target.id);
      expect(row.phone).toBe("0900000002");
      expect(row.avatar_url).toBe(fileId);
      expect(await avatarRemoveAudits(target.id)).toHaveLength(0);
    });
  });

  // ── Đường đọc ────────────────────────────────────────────────────────────────────────────────────

  it("R6: cột = http(s) ⇒ GET /hr/employees/:id trả avatarUrl null (neo: 200 + đúng id)", async () => {
    const target = await seedProfile(FOREIGN_HTTP_URL);
    const res = await auth(http().get(`/hr/employees/${target.id}`));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.id).toBe(target.id);
    expect(res.body.data.avatarUrl).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(FOREIGN_HTTP_URL);
  });

  // ── Đề nghị sửa hồ sơ (service THẬT từ DI) ───────────────────────────────────────────────────────

  describe("đề nghị sửa hồ sơ — một tập kiểm = tập áp", () => {
    it("R7: createRequest changedFields [avatar_file_id] (vượt zod) ⇒ HR-ERR-040, 0 đề nghị mới", async () => {
      const target = await seedProfile(null);
      await grant(target.userId, "req-r7", REQUESTER);
      await expectRejected(
        () =>
          svc.createRequest({ id: target.userId, companyId: A.companyId }, {
            changedFields: ["avatar_file_id"],
            newValues: { avatar_file_id: RANDOM_UUID },
          } as never),
        BadRequestException,
        FIELD_NOT_ALLOWED,
      );
      expect(await pcrCountForEmployee(target.id)).toBe(0);
    });

    it("R8: hàng cũ changed_fields [avatar_file_id, phone] ⇒ duyệt HR-ERR-040, vẫn Pending, không ghi gì", async () => {
      const target = await seedProfile(null, { phone: "0911000001" });
      const pcr = await seedPcr(target.id, target.userId, ["avatar_file_id", "phone"], {
        avatar_file_id: RANDOM_UUID,
        phone: "0911000002",
      });
      await expectRejected(
        () => svc.approveRequest({ id: approverUid, companyId: A.companyId }, pcr, {}),
        BadRequestException,
        FIELD_NOT_ALLOWED,
      );
      expect(await pcrStatus(pcr)).toBe("Pending");
      const row = await profileRow(target.id);
      expect(row.avatar_url).toBeNull();
      expect(row.phone).toBe("0911000001");
      expect(await historyCount(pcr)).toBe(0);
    });

    it("R8b: avatar_file_id CHỈ trong new_values ⇒ duyệt HR-ERR-040, vẫn Pending, không ghi gì", async () => {
      const target = await seedProfile(null, { phone: "0911000011" });
      const pcr = await seedPcr(target.id, target.userId, ["phone"], {
        phone: "0911000012",
        avatar_file_id: RANDOM_UUID,
      });
      await expectRejected(
        () => svc.approveRequest({ id: approverUid, companyId: A.companyId }, pcr, {}),
        BadRequestException,
        FIELD_NOT_ALLOWED,
      );
      expect(await pcrStatus(pcr)).toBe("Pending");
      const row = await profileRow(target.id);
      expect(row.avatar_url).toBeNull();
      expect(row.phone).toBe("0911000011");
      expect(await historyCount(pcr)).toBe(0);
    });

    it("R8c: identity_number CHỈ trong new_values, người duyệt thiếu view-identity ⇒ Forbidden, vẫn Pending", async () => {
      const target = await seedProfile(null, {
        phone: "0911000021",
        identityNumber: "070200000001",
      });
      const pcr = await seedPcr(target.id, target.userId, ["phone"], {
        phone: "0911000022",
        identity_number: "079100000002",
      });
      await expectRejected(
        () => svc.approveRequest({ id: approverNoIdentityUid, companyId: A.companyId }, pcr, {}),
        ForbiddenException,
      );
      expect(await pcrStatus(pcr)).toBe("Pending");
      const row = await profileRow(target.id);
      expect(row.identity_number).toBe("070200000001");
      expect(row.phone).toBe("0911000021");
    });

    it("R9: applyChangesToEmployeeTx với khoá avatar_file_id ⇒ cột không đổi", async () => {
      const target = await seedProfile(null);
      await db.withTenant(A.companyId, (tx) =>
        repo.applyChangesToEmployeeTx(tx, A.companyId, target.id, { avatar_file_id: RANDOM_UUID }),
      );
      expect((await profileRow(target.id)).avatar_url).toBeNull();
    });

    it("A5: đề nghị chỉ phone ⇒ tạo + duyệt Approved, phone ghi, 1 hàng lịch sử (neo dương R7–R8c)", async () => {
      const target = await seedProfile(null, { phone: "0911000031" });
      await grant(target.userId, "req-a5", REQUESTER);
      const created = await svc.createRequest(
        { id: target.userId, companyId: A.companyId },
        { changedFields: ["phone"], newValues: { phone: "0911000032" } },
      );
      expect(created.status).toBe("Pending");
      const approved = await svc.approveRequest(
        { id: approverNoIdentityUid, companyId: A.companyId },
        created.id,
        {},
      );
      expect(approved.status).toBe("Approved");
      expect((await profileRow(target.id)).phone).toBe("0911000032");
      expect(await historyCount(created.id)).toBe(1);
    });
  });
});
