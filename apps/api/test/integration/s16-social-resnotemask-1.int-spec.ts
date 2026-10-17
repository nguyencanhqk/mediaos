/**
 * S16-SOCIAL-RESNOTEMASK-1 — `SOCIAL-API-028` che `resolutionNote` theo ĐÚNG vị từ đang che `reporter`
 * (D13-a / SOC-DEC-011). Plan `docs/plans/S16-SOCIAL-RESNOTEMASK-1.md` §6.
 *
 * Bất biến: `resolutionNote` lộ ⇔ `reporter` lộ ⇔ `SocialAccessService.isCompany(actor.routeScope)`.
 * Che = `null`, khoá LUÔN có mặt (tập khoá đóng). `note` (chữ của chính người báo cáo) KHÔNG che —
 * quyết định đã ký SOC-DEC-011, ghim bằng A-4.
 *
 * ┌─ MỌI CA TỪ CHỐI ĐỀU CÓ NEO DƯƠNG ──────────────────────────────────────────────────────────────┐
 * │ D-1/D-2 assert người đọc VẪN thấy hàng của mình trước khi assert trường bị che; D-1b neo trên   │
 * │ CHÍNH phản hồi (có hàng `resolved` mà DB thật sự có ghi chú) — không có neo thì một hàng đợi    │
 * │ rỗng hay một fixture không ghi được ghi chú làm mọi vế `toBeNull()` xanh rỗng.                 │
 * │ D-3 (cross-tenant) KHÔNG THỂ đỏ trên mã cũ: RLS + `company_id` đã loại hàng của A khỏi B từ    │
 * │ trước bản vá ⇒ ca này là lưới phạm vi hàng, có neo dương «hrB thấy hàng của B».                │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Chuỗi đánh dấu (N = `note`, R/R_Y = `resolutionNote`) sinh lúc chạy từ `randomUUID()` — không literal.
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
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
const LOGIN_PW = "Passw0rd!socialresmask";

type PairKey =
  | "view:feed"
  | "create:feed-post"
  | "create:feed-comment"
  | "manage:feed-post"
  | "manage:feed-news"
  | "view:feed-report"
  | "manage:feed-report";

const BASE: PairKey[] = ["view:feed", "create:feed-post", "create:feed-comment"];
const MODERATOR: PairKey[] = [...BASE, "view:feed-report", "manage:feed-report"];
const HR: PairKey[] = [...MODERATOR, "manage:feed-post"];
const AUTHOR: PairKey[] = [...BASE, "manage:feed-post", "manage:feed-news"];
/** company-admin: ĐỌC hàng đợi ở Company, không xử lý. */
const READER: PairKey[] = [...BASE, "view:feed-report"];

type Item = {
  id: string;
  status: string;
  reporter: unknown;
  note: string | null;
  resolutionNote: string | null;
};

describe.skipIf(!hasLaneDb)("S16-SOCIAL-RESNOTEMASK-1 che resolutionNote (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  const N = `n-${randomUUID()}`;
  const R = `r-${randomUUID()}`;
  const R_Y = `ry-${randomUUID()}`;

  let tHr = "";
  let tAdmin = "";
  let tMgrX = "";
  let tMgrY = "";
  let tHrB = "";

  let reportX = "";
  let reportY = "";
  let reportB = "";
  /** Phản hồi `029` khi HR xử lý `reportX` — ca A-3. */
  let resolveXBody: { data: Item } | null = null;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  async function seedOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, parent_id, head_user_id, status)
       VALUES ($1, $2, NULL, NULL, 'active') RETURNING id`,
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Khuôn be1b `makeMember`: `reportScope` chỉ áp cho cặp `feed-report`, còn lại Company. */
  async function makeMember(
    tenant: SeededTenant,
    label: string,
    pairs: readonly PairKey[],
    hash: string,
    orgUnitId: string | null,
    reportScope: "Company" | "Department" = "Company",
  ): Promise<string> {
    const email = `${label}@${tenant.slug}.test`;
    const userId = await seedUser(direct, tenant.companyId, email, hash);
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, work_type, employee_code)
       VALUES ($1, $2, $3, 'active', 'offline', $4)`,
      [tenant.companyId, userId, orgUnitId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    const roleId = await seedRole(
      direct,
      tenant.companyId,
      `srm-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const key of pairs) {
      const [action, resource] = key.split(":") as [string, string];
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      const scope = resource === "feed-report" ? reportScope : "Company";
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);
    return login(tenant.slug, email);
  }

  async function createPost(token: string, body: Record<string, unknown>): Promise<string> {
    const res = await post(token, "/social/posts").send({ type: "share", ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function createReport(token: string, postId: string, note?: string): Promise<string> {
    const res = await post(token, "/social/reports").send({
      targetType: "post",
      targetId: postId,
      reason: "spam",
      ...(note ? { note } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function queue(token: string, qs = ""): Promise<{ items: Item[]; raw: string }> {
    const res = await get(token, `/social/reports?limit=100${qs}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { items: res.body.data.data as Item[], raw: JSON.stringify(res.body) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    await app.init();
    await app.listen(0);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "srnmaska");
    B = await seedCompany(direct, "srnmaskb");
    companyIds.push(A.companyId, B.companyId);

    const unitX = await seedOrgUnit(A.companyId, "Đơn vị X");
    const unitY = await seedOrgUnit(A.companyId, "Đơn vị Y");

    tHr = await makeMember(A, "hr", HR, hash, null, "Company");
    tAdmin = await makeMember(A, "cadmin", READER, hash, null, "Company");
    tMgrX = await makeMember(A, "mgrx", MODERATOR, hash, unitX, "Department");
    tMgrY = await makeMember(A, "mgry", MODERATOR, hash, unitY, "Department");
    const tAuthorX = await makeMember(A, "authorx", AUTHOR, hash, unitX);
    const tAuthorY = await makeMember(A, "authory", AUTHOR, hash, unitY);
    const tEmpX = await makeMember(A, "empx", BASE, hash, unitX);
    const tEmpY = await makeMember(A, "empy", BASE, hash, unitY);
    tHrB = await makeMember(B, "hrb", MODERATOR, hash, null, "Company");
    const tEmpB = await makeMember(B, "empb", BASE, hash, null);

    // Bài `audience:'org_unit'` — bài `company` (org_unit_id NULL) nằm ngoài tầm manager (be1b N-D6-a).
    const postX = await createPost(tAuthorX, {
      audience: "org_unit",
      orgUnitId: unitX,
      body: "Bài X",
    });
    const postY = await createPost(tAuthorY, {
      audience: "org_unit",
      orgUnitId: unitY,
      body: "Bài Y",
    });
    const postB = await createPost(tHrB, { audience: "company", body: "Bài tenant B" });

    reportX = await createReport(tEmpX, postX, N);
    reportY = await createReport(tEmpY, postY);
    reportB = await createReport(tEmpB, postB);

    const rx = await patch(tHr, `/social/reports/${reportX}`).send({
      status: "resolved",
      resolutionNote: R,
    });
    expect(rx.status, JSON.stringify(rx.body)).toBe(200);
    resolveXBody = rx.body as { data: Item };
    const ry = await patch(tHr, `/social/reports/${reportY}`).send({
      status: "resolved",
      resolutionNote: R_Y,
    });
    expect(ry.status, JSON.stringify(ry.body)).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    if (companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // ══════════════ TỪ CHỐI — scope hẹp hơn Company ══════════════

  describe("028 — manager @Department", () => {
    it.each([
      ["", "mặc định"],
      ["&status=resolved", "?status=resolved"],
    ])("D-1: manager X thấy hàng X nhưng resolutionNote bị che bằng null (%s → %s)", async (qs) => {
      const { items, raw } = await queue(tMgrX, qs);
      const row = items.find((x) => x.id === reportX);
      expect(row, "manager X VẪN phải thấy hàng báo cáo của đơn vị mình (neo dương)").toBeTruthy();
      expect(row!.reporter, "D13-a: reporter bị che").toBeNull();
      expect(Object.keys(row!)).toContain("resolutionNote");
      expect(row!.resolutionNote, "resolutionNote phải che cùng vị từ với reporter").toBeNull();
      expect(raw).not.toContain(R);
    });

    it("D-1b: mọi hàng của manager X — reporter null ⇒ resolutionNote null (neo trên chính phản hồi)", async () => {
      const { items } = await queue(tMgrX);
      const resolvedIds = items.filter((x) => x.status === "resolved").map((x) => x.id);
      expect(resolvedIds.length, "phản hồi phải có ≥ 1 hàng resolved").toBeGreaterThan(0);
      const withNote = await direct.query(
        `SELECT id FROM feed_reports WHERE id = ANY($1::uuid[]) AND resolution_note IS NOT NULL`,
        [resolvedIds],
      );
      expect(
        withNote.rowCount,
        "≥ 1 hàng resolved trong phản hồi phải CÓ ghi chú ở DB",
      ).toBeGreaterThan(0);

      for (const it of items) {
        if (it.reporter === null) expect(it.resolutionNote, `hàng ${it.id}`).toBeNull();
      }
    });

    it("D-2: manager Y thấy hàng Y (che) và KHÔNG thấy hàng X / ghi chú của X", async () => {
      const { items, raw } = await queue(tMgrY);
      const row = items.find((x) => x.id === reportY);
      expect(row, "manager Y VẪN phải thấy hàng báo cáo của đơn vị mình (neo dương)").toBeTruthy();
      expect(row!.reporter).toBeNull();
      expect(row!.resolutionNote, "resolutionNote phải che cùng vị từ với reporter").toBeNull();
      expect(raw).not.toContain(R_Y);
      expect(items.some((x) => x.id === reportX)).toBe(false);
      expect(raw).not.toContain(R);
    });

    it("A-4: manager X VẪN thấy note của người báo cáo (SOC-DEC-011 — không che note)", async () => {
      const { items } = await queue(tMgrX);
      const row = items.find((x) => x.id === reportX);
      expect(row).toBeTruthy();
      expect(row!.note).toBe(N);
    });
  });

  describe("028 — cross-tenant", () => {
    it("D-3: hrB thấy hàng của B (neo dương), không thấy hàng X hay ghi chú của A", async () => {
      const { items, raw } = await queue(tHrB);
      expect(
        items.some((x) => x.id === reportB),
        "hrB phải thấy hàng của tenant B",
      ).toBe(true);
      expect(items.some((x) => x.id === reportX)).toBe(false);
      expect(raw).not.toContain(R);
    });
  });

  // ══════════════ CHO PHÉP — scope Company ══════════════

  describe("028/029 — Company thấy đủ", () => {
    it("A-1: HR @Company thấy resolutionNote nguyên văn + reporter", async () => {
      const { items } = await queue(tHr);
      const row = items.find((x) => x.id === reportX);
      expect(row).toBeTruthy();
      expect(row!.reporter).not.toBeNull();
      expect(row!.resolutionNote).toBe(R);
    });

    it("A-2: company-admin @Company thấy resolutionNote nguyên văn", async () => {
      const { items } = await queue(tAdmin);
      const row = items.find((x) => x.id === reportX);
      expect(row).toBeTruthy();
      expect(row!.resolutionNote).toBe(R);
    });

    it("A-3: phản hồi 029 của HR chở resolutionNote nguyên văn", () => {
      expect(resolveXBody?.data.id).toBe(reportX);
      expect(resolveXBody?.data.resolutionNote).toBe(R);
    });
  });
});
