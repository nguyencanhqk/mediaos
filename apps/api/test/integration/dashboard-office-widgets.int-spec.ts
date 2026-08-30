/**
 * S11-OFFICE-DASH-1 — 2 widget DASH của wave OFFICE (SPEC-13 §116 AS-10 · SPEC-14 §121 RM-08, mig 0558):
 * `asset-summary` (ASSET_SUMMARY) và `room-today` (ROOM_TODAY).
 *
 * BA RÀNG BUỘC ĐƯỢC CHỨNG Ở ĐÂY (không phải ở FE — FE chỉ có gate PHỤ theo CẶP):
 *
 *  1. SÀN SCOPE của ASSET_SUMMARY. CẢ 4 role canonical đều có cặp ('view','asset') (mig 0550), chỉ khác
 *     SCOPE. SPEC-13 §482 chốt "nhân viên thường KHÔNG thấy widget (KHÔNG gọi API)" trong khi Asset Manager
 *     PHẢI thấy — mà cả hai dùng chung dashboard_type 'Employee'. Suite này đo CẢ HAI TẦNG ép sàn:
 *     đường METADATA (GET /dashboard/me — widget bị omit ⇒ FE không mount ⇒ không gọi API) VÀ đường DATA
 *     (GET /dashboard/widgets/asset-summary ⇒ 403). Đo một tầng là chưa đủ: đổi tầng kia mà lưới vẫn xanh
 *     đúng là cái bẫy `asset-guards-pairs-in-two-layers` đã cắn.
 *
 *  2. MỘT CÔNG THỨC, MỘT CON SỐ. Widget PHẢI khớp endpoint gốc của module (GET /assets/summary ·
 *     GET /me/room-bookings?date=…) — đối chiếu TRỰC TIẾP với endpoint đó cho CÙNG người gọi, không so với
 *     hằng số chép tay (memory `reused-method-must-be-actor-scoped`).
 *
 *  3. "HÔM NAY" THEO MÚI GIỜ CÔNG TY (SPEC-14 §83), không theo đồng hồ máy chạy test. Fixture lượt đặt gieo
 *     THẲNG bằng SQL ở giờ tường 08:00–09:00 local NGÀY HÔM NAY: đặt qua API cần thời điểm TƯƠNG LAI, mà một
 *     lượt "+60 phút" chạy lúc 23:30 sẽ rơi sang NGÀY MAI ⇒ ca ALLOW rỗng tuỳ giờ chạy CI (memory
 *     `ci-red-can-depend-on-time-of-day`). Gieo theo giờ tường loại hẳn phụ thuộc đó.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`) — chỉ chạy trên DB cô lập lane.
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
import { DatabaseService } from "../../src/db/db.service";
import { DashboardConfigSeeder } from "../../src/dashboard/dashboard-config.seeder";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
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
const LOGIN_PW = "Passw0rd!officedash1";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [string, string, Scope];

/** Mọi actor cần cặp này để qua @RequirePermission của DashboardWidgetDataController + resolver /me. */
const DASH_BASE: PairGrant[] = [
  ["read", "dashboard", "Company"],
  ["view-employee", "dashboard", "Own"],
];

describe.skipIf(!hasLaneDb)("S11-OFFICE-DASH-1 — widget ASSET/ROOM (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  let seedRunner: MasterDataSeedRunner;

  let ouSales = "";
  let ouMkt = "";
  let amUser = "";
  let mgrUser = "";
  let empUser = "";
  let otherUser = "";
  let bareUser = "";
  let tAm = "";
  let tMgr = "";
  let tEmp = "";
  let tOther = "";
  let tBare = "";

  let empEmp = "";
  let roomId = "";
  let bkOwn = ""; // emp là organizer, hôm nay
  let bkInvited = ""; // other tổ chức, emp là attendee, hôm nay
  let bkForeign = ""; // other tổ chức, emp KHÔNG liên quan, hôm nay
  let bkTomorrow = ""; // emp tổ chức nhưng NGÀY MAI (local)
  let companyTz = "";

  async function seedOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function seedEmp(
    companyId: string,
    userId: string,
    orgUnitId: string,
    code: string,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status, employee_code)
       VALUES ($1,$2,$3,'active',$4) RETURNING id`,
      [companyId, userId, orgUnitId, code],
    );
    return r.rows[0].id as string;
  }

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: PairGrant[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `odash-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);

  /** Múi giờ công ty — CÙNG nguồn mà handler đọc (`companies.timezone`, mặc định Asia/Ho_Chi_Minh). */
  async function readCompanyTz(companyId: string): Promise<string> {
    const r = await direct.query<{ timezone: string | null }>(
      "SELECT timezone FROM companies WHERE id = $1",
      [companyId],
    );
    return r.rows[0]?.timezone ?? "Asia/Ho_Chi_Minh";
  }

  /**
   * Instant UTC của giờ tường `hh:00` NGÀY-HÔM-NAY-local (+ `dayOffset` ngày) theo tz công ty — tính bằng
   * chính PostgreSQL (`AT TIME ZONE`) để không phải dựng lại phép quy đổi ở JS và lệch với server.
   */
  async function wallClockToday(hour: number, dayOffset = 0): Promise<Date> {
    const r = await direct.query<{ ts: Date }>(
      `SELECT (((now() AT TIME ZONE $1)::date + ($2)::int) + make_time($3, 0, 0)) AT TIME ZONE $1 AS ts`,
      [companyTz, dayOffset, hour],
    );
    return r.rows[0].ts;
  }

  /** Ngày local `YYYY-MM-DD` của "bây giờ" theo tz công ty — do PostgreSQL tính, cùng nguồn với server. */
  async function localToday(): Promise<string> {
    const r = await direct.query<{ d: string }>(
      "SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d",
      [companyTz],
    );
    return r.rows[0].d;
  }

  /** Gieo lượt đặt THẲNG bằng SQL (bỏ qua luật "phải ở tương lai") — xem doc-block §3 đầu file. */
  async function seedBooking(
    companyId: string,
    v: {
      title: string;
      organizerUserId: string;
      startsAt: Date;
      endsAt: Date;
      attendees?: string[];
    },
  ): Promise<string> {
    const r = await direct.query<{ id: string }>(
      `INSERT INTO room_bookings
         (company_id, room_id, title, starts_at, ends_at, organizer_user_id, booked_by_user_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$6,'Confirmed') RETURNING id`,
      [companyId, roomId, v.title, v.startsAt, v.endsAt, v.organizerUserId],
    );
    const id = r.rows[0].id;
    for (const uid of v.attendees ?? []) {
      await direct.query(
        "INSERT INTO room_booking_attendees (company_id, booking_id, user_id) VALUES ($1,$2,$3)",
        [companyId, id, uid],
      );
    }
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "odash1a");
    B = await seedCompany(direct, "odash1b");
    companyIds.push(A.companyId, B.companyId);
    companyTz = await readCompanyTz(A.companyId);

    ouSales = await seedOrgUnit(A.companyId, "Kinh doanh ODASH1");
    ouMkt = await seedOrgUnit(A.companyId, "Marketing ODASH1");

    const mk = (name: string) => seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
    amUser = await mk("am"); // "Asset Manager": view:asset @Company
    mgrUser = await mk("mgr"); // trưởng đơn vị: view:asset @Department
    empUser = await mk("emp"); // nhân viên thường: view:asset @Own  ← PHẢI không thấy ASSET_SUMMARY
    otherUser = await mk("other");
    bareUser = await mk("bare"); // KHÔNG có view:asset lẫn view:room

    await seedEmp(A.companyId, amUser, ouSales, "NV-AM");
    await seedEmp(A.companyId, mgrUser, ouSales, "NV-MGR");
    empEmp = await seedEmp(A.companyId, empUser, ouSales, "NV-EMP");
    await seedEmp(A.companyId, otherUser, ouMkt, "NV-OTHER");
    await seedEmp(A.companyId, bareUser, ouMkt, "NV-BARE");

    await grantPairs(A.companyId, amUser, "am", [
      ...DASH_BASE,
      ["view", "asset", "Company"],
      ["create", "asset", "Company"],
      ["assign", "asset", "Company"],
      ["manage", "asset-category", "Company"],
      ["view", "room", "Company"],
      ["manage", "room", "Company"],
    ]);
    await grantPairs(A.companyId, mgrUser, "mgr", [
      ...DASH_BASE,
      ["view", "asset", "Department"],
      ["view", "room", "Company"],
    ]);
    await grantPairs(A.companyId, empUser, "emp", [
      ...DASH_BASE,
      ["view", "asset", "Own"],
      ["view", "room", "Company"],
    ]);
    await grantPairs(A.companyId, otherUser, "other", [...DASH_BASE, ["view", "room", "Company"]]);
    await grantPairs(A.companyId, bareUser, "bare", DASH_BASE);

    tAm = await login(A.slug, `am@${A.slug}.test`);
    tMgr = await login(A.slug, `mgr@${A.slug}.test`);
    tEmp = await login(A.slug, `emp@${A.slug}.test`);
    tOther = await login(A.slug, `other@${A.slug}.test`);
    tBare = await login(A.slug, `bare@${A.slug}.test`);

    // ── Fixture ASSET qua API THẬT (am @Company) ────────────────────────────────────────────────
    const cat = await post(tAm, "/asset-categories").send({
      code: "LAPTOP",
      name: "Laptop ODASH1",
      codePrefix: "LT",
    });
    expect(cat.status, JSON.stringify(cat.body)).toBe(201);
    const catId = cat.body.data.id as string;
    const assetIds: string[] = [];
    for (const name of ["MacBook O1", "MacBook O2", "MacBook O3"]) {
      const res = await post(tAm, "/assets").send({ categoryId: catId, name });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      assetIds.push(res.body.data.id as string);
    }
    // Cấp phát ĐÚNG MỘT tài sản cho nhân viên phòng Kinh doanh. KHÔNG có bước này thì ở scope Department
    // mọi tài sản đều "chưa ai giữ" ⇒ /assets/summary trả rỗng ⇒ ca ALLOW @Department xanh RỖNG (memory
    // `deny-cases-vacuous-without-allow-case`): nó sẽ không phân biệt nổi "scope đúng" với "handler hỏng".
    const assign = await post(tAm, `/assets/${assetIds[0]}/assign`).send({ employeeId: empEmp });
    expect(assign.status, JSON.stringify(assign.body)).toBe(201);

    // ── Fixture ROOM: phòng qua API thật; lượt đặt gieo SQL theo giờ tường (xem doc-block §3) ────
    const room = await post(tAm, "/rooms").send({ name: "Phòng ODASH1", capacity: 10 });
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    roomId = room.body.data.id as string;

    const h8 = await wallClockToday(8);
    const h9 = await wallClockToday(9);
    const h10 = await wallClockToday(10);
    const h11 = await wallClockToday(11);
    const h12 = await wallClockToday(12);
    const h13 = await wallClockToday(13);
    const t8 = await wallClockToday(8, 1);
    const t9 = await wallClockToday(9, 1);

    bkOwn = await seedBooking(A.companyId, {
      title: "Họp giao ban ODASH1",
      organizerUserId: empUser,
      startsAt: h8,
      endsAt: h9,
    });
    bkInvited = await seedBooking(A.companyId, {
      title: "Họp dự án ODASH1",
      organizerUserId: otherUser,
      startsAt: h10,
      endsAt: h11,
      attendees: [empUser],
    });
    bkForeign = await seedBooking(A.companyId, {
      title: "Họp riêng của OTHER ODASH1",
      organizerUserId: otherUser,
      startsAt: h12,
      endsAt: h13,
    });
    bkTomorrow = await seedBooking(A.companyId, {
      title: "Họp NGÀY MAI ODASH1",
      organizerUserId: empUser,
      startsAt: t8,
      endsAt: t9,
    });

    // Seeder default dashboard_widget_configs (company_id NOT NULL ⇒ runtime, không ở migration).
    const dbsvc = new DatabaseService();
    const registry = new MasterDataSeederRegistry();
    registry.register(new DashboardConfigSeeder());
    seedRunner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
    const outcomes = await seedRunner.reconcileCompany(A.companyId);
    expect(outcomes.find((o) => o.seedKey === "dash.default-configs")?.ok).toBe(true);
  }, 180_000);

  afterAll(async () => {
    if (direct) {
      await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])", [
        companyIds,
      ]);
      await direct.query("DELETE FROM room_booking_attendees WHERE company_id = ANY($1::uuid[])", [
        companyIds,
      ]);
      await direct.query("DELETE FROM room_bookings WHERE company_id = ANY($1::uuid[])", [
        companyIds,
      ]);
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ASSET_SUMMARY — sàn scope ép ở HAI tầng + parity với GET /assets/summary
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  describe("ASSET_SUMMARY — tầng DATA (GET /dashboard/widgets/asset-summary)", () => {
    it("RED: nhân viên có view:asset@Own ⇒ 403 (sàn scope Department, SPEC-13 §482)", async () => {
      const res = await get(tEmp, "/dashboard/widgets/asset-summary");
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("RED: user KHÔNG có view:asset ⇒ 403 (fail-closed, KHÔNG Degraded 200)", async () => {
      const res = await get(tBare, "/dashboard/widgets/asset-summary");
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("ALLOW @Company: 200 và số liệu KHỚP GET /assets/summary của CÙNG người gọi", async () => {
      const src = await get(tAm, "/assets/summary");
      expect(src.status, JSON.stringify(src.body)).toBe(200);
      const res = await get(tAm, "/dashboard/widgets/asset-summary");
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const w = res.body.data.data as {
        summary: { total: number; maintenanceDueSoon: number };
        byStatus: Record<string, number>;
        byCategory: Array<{ categoryId: string; total: number }>;
      };
      expect(w.byStatus).toEqual(src.body.data.byStatus);
      expect(w.summary.maintenanceDueSoon).toBe(src.body.data.maintenanceDueSoon);
      // `total` là tổng byStatus (KHÔNG phải tổng của byCategory đã bị cắt DASH_WIDGET_LIST_CAP).
      const expectedTotal = Object.values(
        src.body.data.byStatus as Record<string, number>,
      ).reduce<number>((s, n) => s + n, 0);
      expect(w.summary.total).toBe(expectedTotal);
      expect(expectedTotal, "fixture phải có tài sản — ca ALLOW không được rỗng").toBe(3);
    });

    it("ALLOW @Department: 200, KHỚP /assets/summary của CHÍNH actor đó và HẸP HƠN @Company", async () => {
      const src = await get(tMgr, "/assets/summary");
      expect(src.status, JSON.stringify(src.body)).toBe(200);
      const res = await get(tMgr, "/dashboard/widgets/asset-summary");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const w = res.body.data.data as {
        summary: { total: number };
        byStatus: Record<string, number>;
      };
      expect(w.byStatus).toEqual(src.body.data.byStatus);

      // Ca ALLOW phải CÓ dữ liệu (1 tài sản đã cấp cho nhân viên phòng Kinh doanh) — nếu rỗng thì phép so
      // "khớp nguồn" ở trên là hai vế cùng rỗng, chứng minh được 0 điều.
      const deptTotal = w.summary.total;
      expect(deptTotal, "ca ALLOW @Department không được rỗng").toBeGreaterThan(0);
      // …và HẸP HƠN @Company: scope KHÔNG bị nới lên khi đi qua widget.
      const company = await get(tAm, "/dashboard/widgets/asset-summary");
      expect(deptTotal).toBeLessThan(company.body.data.data.summary.total as number);
    });

    it("payload KHÔNG chứa trường tài chính (purchasePrice/supplier — SPEC-13 §18)", async () => {
      const res = await get(tAm, "/dashboard/widgets/asset-summary");
      const flat = JSON.stringify(res.body.data);
      expect(flat).not.toContain("purchasePrice");
      expect(flat).not.toContain("supplier");
    });
  });

  describe("ASSET_SUMMARY — tầng METADATA (GET /dashboard/me): omit ⇒ FE KHÔNG gọi API", () => {
    const codesOf = (body: unknown): string[] =>
      ((body as { data: { widgets: Array<{ widget_code: string }> } }).data.widgets ?? []).map(
        (w) => w.widget_code,
      );

    it("nhân viên (view:asset@Own): ASSET_SUMMARY VẮNG khỏi /dashboard/me", async () => {
      const res = await get(tEmp, "/dashboard/me");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(codesOf(res.body)).not.toContain("ASSET_SUMMARY");
    });

    it("Asset Manager (view:asset@Company): ASSET_SUMMARY CÓ trong /dashboard/me — cùng dashboard type 'Employee'", async () => {
      const res = await get(tAm, "/dashboard/me");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Cả hai actor đều resolve về dashboard 'Employee' (chỉ có view-employee:dashboard) ⇒ khác biệt DUY
      // NHẤT giữa hai ca trên là SCOPE, không phải dashboard_type / role.
      expect(res.body.data.dashboard_type).toBe("Employee");
      expect(codesOf(res.body)).toContain("ASSET_SUMMARY");
    });

    it("ROOM_TODAY CÓ cho cả hai (view:room@Company) — chứng sàn chỉ áp cho ASSET_SUMMARY", async () => {
      expect(codesOf((await get(tEmp, "/dashboard/me")).body)).toContain("ROOM_TODAY");
      expect(codesOf((await get(tAm, "/dashboard/me")).body)).toContain("ROOM_TODAY");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ROOM_TODAY — self-lock + "hôm nay" theo tz công ty + parity với /me/room-bookings
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  describe("ROOM_TODAY — GET /dashboard/widgets/room-today", () => {
    it("RED: user KHÔNG có view:room ⇒ 403", async () => {
      const res = await get(tBare, "/dashboard/widgets/room-today");
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("`date` = ngày hôm nay theo MÚI GIỜ CÔNG TY (không phải UTC/tz máy chạy test)", async () => {
      const res = await get(tEmp, "/dashboard/widgets/room-today");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.data.date).toBe(await localToday());
    });

    it("self-lock: chứa lượt MÌNH tổ chức + lượt MÌNH được mời, KHÔNG lượt của người khác", async () => {
      const res = await get(tEmp, "/dashboard/widgets/room-today");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.data.items as Array<{ id: string; myRole: string }>;
      const ids = items.map((i) => i.id);
      expect(ids).toContain(bkOwn);
      expect(ids).toContain(bkInvited);
      expect(ids).not.toContain(bkForeign);
      expect(items.find((i) => i.id === bkOwn)?.myRole).toBe("organizer");
      expect(items.find((i) => i.id === bkInvited)?.myRole).toBe("attendee");
      expect(JSON.stringify(res.body.data)).not.toContain("Họp riêng của OTHER ODASH1");
    });

    it("chỉ HÔM NAY: lượt NGÀY MAI (local) KHÔNG lọt vào widget", async () => {
      const res = await get(tEmp, "/dashboard/widgets/room-today");
      const ids = (res.body.data.data.items as Array<{ id: string }>).map((i) => i.id);
      expect(ids).not.toContain(bkTomorrow);
      expect(JSON.stringify(res.body.data)).not.toContain("Họp NGÀY MAI ODASH1");
    });

    it("khớp GET /me/room-bookings?date=<date của widget> — MỘT công thức, MỘT tập lượt", async () => {
      const res = await get(tEmp, "/dashboard/widgets/room-today");
      const date = res.body.data.data.date as string;
      const src = await get(tEmp, `/me/room-bookings?date=${date}`);
      expect(src.status, JSON.stringify(src.body)).toBe(200);
      const srcIds = (src.body.data as Array<{ id: string }>).map((b) => b.id).sort();
      const widgetIds = (res.body.data.data.items as Array<{ id: string }>).map((i) => i.id).sort();
      expect(res.body.data.data.summary.total).toBe(srcIds.length);
      expect(widgetIds).toEqual(srcIds);
      expect(srcIds.length, "ca ALLOW không được rỗng").toBeGreaterThan(0);
    });

    it("KHÔNG phơi tên người tham dự (chỉ attendeeCount) — dữ liệu mask-theo-người-xem không vào payload", async () => {
      const res = await get(tEmp, "/dashboard/widgets/room-today");
      const flat = JSON.stringify(res.body.data);
      expect(flat).not.toContain("displayName");
      expect(flat).not.toContain("attendees");
      const invited = (
        res.body.data.data.items as Array<{ id: string; attendeeCount: number }>
      ).find((i) => i.id === bkInvited);
      expect(invited?.attendeeCount).toBe(1);
    });

    it("người KHÔNG có lịch hôm nay ⇒ Empty (data null), KHÔNG lộ lượt của người khác", async () => {
      const res = await get(tMgr, "/dashboard/widgets/room-today");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("Empty");
      expect(res.body.data.data).toBeNull();
      const flat = JSON.stringify(res.body.data);
      expect(flat).not.toContain(bkOwn);
      expect(flat).not.toContain("Họp giao ban ODASH1");
    });

    it("cross-tenant: user công ty B ⇒ Empty, KHÔNG marker nào của công ty A", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const bUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
      await grantPairs(B.companyId, bUser, "b", [...DASH_BASE, ["view", "room", "Company"]]);
      const tB = await login(B.slug, `admin@${B.slug}.test`);
      const res = await get(tB, "/dashboard/widgets/room-today");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("Empty");
      const flat = JSON.stringify(res.body.data);
      expect(flat).not.toContain(bkOwn);
      expect(flat).not.toContain(roomId);
      expect(flat).not.toContain("Phòng ODASH1");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Catalog gộp — GET /dashboard/widgets omit widget ngoài quyền ở CẢ đường catalog
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  it("GET /dashboard/widgets: emp thấy ROOM_TODAY nhưng KHÔNG thấy ASSET_SUMMARY; am thấy cả hai", async () => {
    const codes = async (t: string) => {
      const res = await get(t, "/dashboard/widgets");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.data as Array<{ widget_code: string }>).map((w) => w.widget_code);
    };
    const empCodes = await codes(tEmp);
    expect(empCodes).toContain("ROOM_TODAY");
    expect(empCodes).not.toContain("ASSET_SUMMARY");

    const amCodes = await codes(tAm);
    expect(amCodes).toContain("ROOM_TODAY");
    expect(amCodes).toContain("ASSET_SUMMARY");
  });

  it("slug lạ vẫn 404 (không mở cửa hậu khi thêm 2 slug mới)", async () => {
    const res = await get(tAm, "/dashboard/widgets/asset-summaryy");
    expect([404, 400]).toContain(res.status);
  });
});
