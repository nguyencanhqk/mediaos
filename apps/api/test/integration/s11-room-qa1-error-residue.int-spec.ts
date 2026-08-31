/**
 * S11-ROOM-QA-1 — mã lỗi / `kind` CÒN SÓT sau `S11-ROOM-BE-1` (SPEC-14 §21 hàng "Validate: **10** mã
 * lỗi §12, mỗi `kind` ≥ 1 ca" + hàng "Trùng lịch: giao nhau đầu/cuối/bao trùm/bị bao trùm").
 *
 * ĐO 30/08/2026 trên bề mặt test ROOM sau BE-1 — bốn lỗ, mỗi lỗ một mục dưới đây:
 *
 *   A. **ROOM-ERR-003 chưa có ca RIÊNG**. 404 xuất hiện rải rác ở `room-be1-scope` mục D (chéo tenant),
 *      nhưng KHÔNG ca nào chứng minh điều SPEC-14 §12 thực sự hứa: *"không thuộc company **hoặc** không
 *      tồn tại (kể cả phòng đã xoá mềm) — **cùng một phản hồi** (chống dò chéo tenant)"*. Ba nguồn 404
 *      khác nhau phải cho ra phản hồi GIỐNG HỆT; chỉ cần một nguồn kèm thêm `details` hay đổi câu chữ là
 *      404 trở thành oracle: kẻ dò phân biệt được "id này có thật ở công ty khác" với "id bịa".
 *   B. **`too-many-attendees` là `kind` DUY NHẤT của ROOM-ERR-006 không có ca** (3 kind kia đã có ở
 *      `room-be1-booking`) — và khi đi đo thì lộ ra nó **không thể có ca 422**: Zod đã cắt ở biên bằng
 *      đúng cùng ngưỡng, nên trên dây là `400 VALIDATION-ERR-001`, LỆCH với SPEC-14 §12. Xem mục B.
 *   C. **ROOM-ERR-010 mới có vế 403**. `room-be1-scope` mục B đo `book-on-behalf-denied`; hai `kind`
 *      của vế **422** (`organizer-not-found` · `organizer-inactive` — chỉ tới được khi scope `book` =
 *      **Company**) chưa có ca nào.
 *   D. **ROOM-ERR-002 `range-too-wide` mới có nửa luật**. BE-1 đo cửa sổ > 31 ngày; nửa còn lại của
 *      chính `kind` đó (`to ≤ from`) chưa được đo trên đường tra cứu.
 *   E. **Hình dạng giao nhau**: BE-1 có ĐÚNG MỘT hình (B bắt đầu giữa lượt A) + ca kề nhau. §21 đòi bốn
 *      hình (đầu · cuối · bao trùm · bị bao trùm). Bốn hình đi qua bốn nhánh `&&` khác nhau của
 *      `tstzrange`, và `nextFreeFrom` được tính từ chúng.
 *
 * Mỗi mục DENY có ca ALLOW đối chứng ở ngay cạnh (`deny-cases-vacuous-without-allow-case`).
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOM_MAX_ATTENDEES } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
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
const LOGIN_PW = loginPasswordFixture("s11roomqa3");

/** khuôn `office-admin` — `book`@Company là điều kiện CẦN để chạm được vế 422 của ROOM-ERR-010. */
const ROOM_COMPANY: Array<[string, string, "Own" | "Company"]> = [
  ["access", "room", "Own"],
  ["view", "room", "Company"],
  ["book", "room", "Company"],
  ["cancel", "room-booking", "Company"],
  ["manage", "room", "Company"],
];

type ErrDetail = { field: string; message: string; rule?: string };
const kindOf = (r: request.Response): string | undefined =>
  (r.body?.error?.details as ErrDetail[] | undefined)?.find((d) => d.field === "kind")?.message;

describe.skipIf(!hasLaneDb)("S11-ROOM-QA-1 mã lỗi & kind còn sót (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tA = "";
  let tB = "";
  let inactiveUser = "";
  /** 51 người khác organizer — đủ để vượt trần 50 và để dựng ca ALLOW đúng 50. */
  const crowd: string[] = [];

  let roomOverlap = "";
  let roomBigA = "";
  let roomB = "";
  let bookingB = "";

  const http = () => request(app.getHttpServer());
  const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
  const del = (t: string, u: string) => http().delete(u).set("Authorization", `Bearer ${t}`);

  let slotCounter = 0;
  /** Slot tương lai không trùng nhau — mục nào cần giao nhau thì tự dựng khung riêng từ `base()`. */
  const base = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000);
  function nextSlot(durMin = 60): { startsAt: string; endsAt: string } {
    const start = base(600 + slotCounter * 180);
    slotCounter += 1;
    return {
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + durMin * 60_000).toISOString(),
    };
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function grantCompany(companyId: string, userId: string, label: string) {
    const roleId = await seedRole(direct, companyId, `roomqa3-${label}`);
    for (const [action, resource, scope] of ROOM_COMPANY) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function newRoom(t: string, name: string, capacity = 10): Promise<string> {
    const res = await post(t, "/rooms").send({ name, capacity });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function book(
    t: string,
    roomId: string,
    slot: { startsAt: string; endsAt: string },
    extra: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return post(t, "/room-bookings").send({ roomId, title: "Họp QA", ...slot, ...extra });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "roomqa3a");
    B = await seedCompany(direct, "roomqa3b");
    companyIds.push(A.companyId, B.companyId);

    const ua = await seedUser(direct, A.companyId, `oa@${A.slug}.test`, hash);
    const ub = await seedUser(direct, B.companyId, `ob@${B.slug}.test`, hash);
    await grantCompany(A.companyId, ua, "a");
    await grantCompany(B.companyId, ub, "b");
    tA = await login(A.slug, `oa@${A.slug}.test`);
    tB = await login(B.slug, `ob@${B.slug}.test`);

    // `users_status_chk` = active|invited|suspended|locked — 'suspended' là giá trị ≠ active hợp lệ.
    inactiveUser = await seedUser(direct, A.companyId, `inactive@${A.slug}.test`, hash);
    await direct.query("UPDATE users SET status='suspended' WHERE id=$1", [inactiveUser]);

    for (let i = 0; i < ROOM_MAX_ATTENDEES + 1; i += 1) {
      crowd.push(await seedUser(direct, A.companyId, `crowd${i}@${A.slug}.test`, hash));
    }

    roomOverlap = await newRoom(tA, "Phòng Giao Nhau");
    roomBigA = await newRoom(tA, "Phòng Đông Người", 200);
    roomB = await newRoom(tB, "Phòng của B");
    const bb = await book(tB, roomB, nextSlot());
    expect(bb.status, JSON.stringify(bb.body)).toBe(201);
    bookingB = bb.body.data.id;
  }, 240_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── A. ROOM-ERR-003 — sentinel PHẢI giống hệt nhau từ mọi nguồn ───────────────────────────────

  describe("A. ROOM-ERR-003 sentinel: 3 nguồn 404 ⇒ MỘT phản hồi (chống dò chéo tenant)", () => {
    /** Chỉ giữ phần hợp đồng của lỗi — `requestId`/`timestamp` (nếu có) đổi mỗi request, không phải oracle. */
    const shape = (r: request.Response) => ({
      status: r.status,
      code: r.body?.error?.code,
      message: r.body?.error?.message,
      details: r.body?.error?.details ?? null,
    });

    it("GET /rooms/:id — id bịa · id của công ty KHÁC · phòng đã XOÁ MỀM ⇒ ba phản hồi bằng nhau", async () => {
      const soft = await newRoom(tA, "Phòng Sẽ Xoá Mềm");
      expect((await del(tA, `/rooms/${soft}`)).status).toBe(204);

      const ghost = shape(await get(tA, `/rooms/${randomUUID()}`));
      const cross = shape(await get(tA, `/rooms/${roomB}`));
      const deleted = shape(await get(tA, `/rooms/${soft}`));

      expect(ghost.status, JSON.stringify(ghost)).toBe(404);
      expect(ghost.code).toBe("ROOM-ERR-NOT-FOUND");
      // Nếu một nguồn kèm `details` hoặc đổi câu chữ ⇒ 404 thành oracle phân biệt "có thật ở nơi khác".
      expect(cross, "404 chéo tenant KHÁC 404 id-bịa ⇒ rò sự tồn tại").toEqual(ghost);
      expect(deleted, "404 phòng xoá mềm KHÁC 404 id-bịa ⇒ rò sự tồn tại").toEqual(ghost);

      // ALLOW đối chứng: phòng CÓ THẬT của chính mình ⇒ 200 (nếu không, ba ca trên xanh-rỗng).
      expect((await get(tA, `/rooms/${roomOverlap}`)).status).toBe(200);
    });

    it("GET /room-bookings/:id — id bịa · lượt của công ty KHÁC ⇒ hai phản hồi bằng nhau", async () => {
      const ghost = shape(await get(tA, `/room-bookings/${randomUUID()}`));
      const cross = shape(await get(tA, `/room-bookings/${bookingB}`));
      expect(ghost.status).toBe(404);
      expect(ghost.code).toBe("ROOM-ERR-NOT-FOUND");
      expect(cross, "404 lượt chéo tenant KHÁC 404 id-bịa ⇒ rò sự tồn tại").toEqual(ghost);

      // ALLOW đối chứng: chính B đọc lượt của B ⇒ 200 — chứng minh `bookingB` là id THẬT, không phải
      // "một chuỗi bất kỳ" (nếu không, ca chéo-tenant chỉ đang đo lại ca id-bịa).
      expect((await get(tB, `/room-bookings/${bookingB}`)).status).toBe(200);
    });
  });

  // ── B. ROOM-ERR-006 `too-many-attendees` ──────────────────────────────────────────────────────

  /**
   * PHÁT HIỆN CỦA WO (đo 30/08/2026): trần người tham dự bị gác ở **HAI TẦNG ĐÚNG BẰNG NHAU** —
   * `attendeeUserIds: z.array(...).max(ROOM_MAX_ATTENDEES)` ở Zod (contracts `room.ts`) và
   * `if (attendees.length > ROOM_MAX_ATTENDEES) throw attendeeError("too-many-attendees")` ở service
   * (`room-bookings.service.ts`). Vì hai ngưỡng BẰNG NHAU và controller là caller DUY NHẤT của
   * `RoomBookingsService.create` (đo bằng grep: không job/bridge nào gọi), nhánh service **không thể
   * chạm tới qua HTTP**: pipe trả `400 VALIDATION-ERR-001` trước.
   *
   * ⇒ SPEC-14 §12 ghi `too-many-attendees` là `kind` của **ROOM-ERR-006 (422)**, nhưng trên dây nó là
   * **400 VALIDATION-ERR-001**. Ca dưới đo SỰ THẬT chứ không đo lời hứa (`ui-promises-backend-never-
   * reads` ở chiều tài liệu); §12 được đính chính cùng PR này, và census `room-error-code-census`
   * xếp kind này vào `BOUNDARY_ONLY` — nếu một ngày nhánh service chạm được thật (ai đó gọi service
   * ngoài HTTP, hoặc hạ trần Zod), cổng đó ĐỎ và buộc bổ sung ca runtime, không im lặng.
   *
   * KHÔNG gỡ `.max()` ở Zod để "cho 422 ra": trần ở BIÊN là thứ chặn mảng khổng lồ trước khi bất kỳ
   * việc gì chạy. Cũng KHÔNG gỡ nhánh service — nó là tầng hai cho caller không qua pipe.
   */
  describe("B. trần người tham dự — chặn ở BIÊN Zod (400), không phải ROOM-ERR-006 (422)", () => {
    it(`${ROOM_MAX_ATTENDEES + 1} người ⇒ 400 VALIDATION-ERR-001 tại biên; đúng ${ROOM_MAX_ATTENDEES} ⇒ 201`, async () => {
      const over = await book(tA, roomBigA, nextSlot(), {
        attendeeUserIds: crowd.slice(0, ROOM_MAX_ATTENDEES + 1),
      });
      expect(over.status, JSON.stringify(over.body)).toBe(400);
      expect(over.body?.error?.code).toBe("VALIDATION-ERR-001");
      const detail = (over.body?.error?.details as ErrDetail[]).find(
        (d) => d.field === "attendeeUserIds",
      );
      expect(detail, "400 phải chỉ đúng trường vượt trần").toBeTruthy();
      expect(detail!.rule).toBe("too_big");
      // Vế NEO: nhánh 422 của service KHÔNG bao giờ ra dây ở đường HTTP. Nếu một ngày nó ra được,
      // ca này ĐỎ và bắt cập nhật cả SPEC-14 §12 lẫn census — không trôi im lặng.
      expect(over.body?.error?.code).not.toBe("ROOM-ERR-006");

      // ALLOW đối chứng ở ĐÚNG biên: 50 người (phòng 200 chỗ ⇒ không rơi vào ROOM-ERR-007).
      const at = await book(tA, roomBigA, nextSlot(), {
        attendeeUserIds: crowd.slice(0, ROOM_MAX_ATTENDEES),
      });
      expect(at.status, JSON.stringify(at.body)).toBe(201);
      expect(at.body.data.attendees?.length ?? at.body.data.headcount - 1).toBe(ROOM_MAX_ATTENDEES);
    });

    it("hai ngưỡng PHẢI đúng bằng nhau — lệch là mở lỗ hoặc đẻ mã lỗi chết", () => {
      // Zod < service ⇒ nhánh service chết hẳn (như hiện nay, có chủ ý, đã ghi chú).
      // Zod > service ⇒ mảng lớn hơn trần lọt qua biên rồi mới 422 — tốn công vô ích ở tầng dưới.
      const contractsMax = ROOM_MAX_ATTENDEES;
      const serviceSrc = fs.readFileSync(
        path.join(__dirname, "..", "..", "src", "rooms", "room-bookings.service.ts"),
        "utf8",
      );
      expect(
        serviceSrc.includes("attendees.length > ROOM_MAX_ATTENDEES"),
        "tầng service không còn dùng CHÍNH hằng ROOM_MAX_ATTENDEES ⇒ hai trần có thể trôi khỏi nhau",
      ).toBe(true);
      expect(contractsMax).toBe(50); // SPEC-14 §12 ROOM-ERR-006
    });
  });

  // ── C. ROOM-ERR-010 vế 422 (chỉ tới được khi book@Company) ─────────────────────────────────────

  describe("C. ROOM-ERR-010 vế 422 — đặt hộ cho organizer không hợp lệ", () => {
    it("organizerUserId là id bịa ⇒ 422 organizer-not-found (KHÔNG 403, KHÔNG 404)", async () => {
      const res = await book(tA, roomOverlap, nextSlot(), { organizerUserId: randomUUID() });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body?.error?.code).toBe("ROOM-ERR-010");
      expect(kindOf(res)).toBe("organizer-not-found");
    });

    it("organizerUserId thuộc công ty KHÁC ⇒ cùng mã organizer-not-found (không thành oracle)", async () => {
      const otherCompanyUser = await direct.query(
        "SELECT id FROM users WHERE company_id = $1 LIMIT 1",
        [B.companyId],
      );
      const res = await book(tA, roomOverlap, nextSlot(), {
        organizerUserId: otherCompanyUser.rows[0].id,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(kindOf(res), "organizer chéo tenant phải TRÙNG mã với id bịa").toBe(
        "organizer-not-found",
      );
    });

    it("organizerUserId là user status ≠ active ⇒ 422 organizer-inactive", async () => {
      const res = await book(tA, roomOverlap, nextSlot(), { organizerUserId: inactiveUser });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body?.error?.code).toBe("ROOM-ERR-010");
      expect(kindOf(res)).toBe("organizer-inactive");
    });

    it("ALLOW đối chứng: đặt hộ organizer HỢP LỆ ⇒ 201 và organizer ≠ người bấm", async () => {
      const res = await book(tA, roomOverlap, nextSlot(), { organizerUserId: crowd[0] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const organizerId = res.body.data.organizer?.userId ?? res.body.data.organizerUserId;
      expect(organizerId).toBe(crowd[0]);
    });
  });

  // ── D. ROOM-ERR-002 `range-too-wide` — nửa luật còn lại ────────────────────────────────────────

  describe("D. ROOM-ERR-002 range-too-wide: nhánh `to ≤ from` (BE-1 mới đo nhánh > 31 ngày)", () => {
    const q = (from: Date, to: Date) =>
      `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;

    it("to < from ⇒ 422 range-too-wide", async () => {
      const res = await get(tA, `/room-bookings?${q(base(2880), base(1440))}`);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body?.error?.code).toBe("ROOM-ERR-002");
      expect(kindOf(res)).toBe("range-too-wide");
    });

    it("to = from (cửa sổ RỖNG) ⇒ 422 range-too-wide", async () => {
      const t0 = base(1440);
      const res = await get(tA, `/room-bookings?${q(t0, t0)}`);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(kindOf(res)).toBe("range-too-wide");
    });

    it("ALLOW đối chứng: cửa sổ hợp lệ 1 ngày ⇒ 200", async () => {
      const res = await get(tA, `/room-bookings?${q(base(1440), base(2880))}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  });

  // ── E. ROOM-ERR-001 — bốn hình dạng giao nhau + hai hình KHÔNG giao ───────────────────────────

  describe("E. ROOM-ERR-001: 4 hình giao nhau ⇒ 409 · 2 hình không giao ⇒ 201", () => {
    /** Lượt neo: [T+3000′, T+3120′) trên phòng riêng để bốn hình dưới đo trên cùng một nền. */
    let anchorStart = 0;
    let roomShapes = "";

    beforeAll(async () => {
      roomShapes = await newRoom(tA, "Phòng Hình Giao Nhau");
      anchorStart = Date.now() + 3000 * 60_000;
      const res = await book(tA, roomShapes, {
        startsAt: new Date(anchorStart).toISOString(),
        endsAt: new Date(anchorStart + 120 * 60_000).toISOString(),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    const at = (min: number) => new Date(anchorStart + min * 60_000).toISOString();

    it.each([
      // [nhãn, phút bắt đầu, phút kết thúc] — mốc tính theo lượt neo [0, 120).
      ["giao ĐẦU (bắt đầu trước, kết thúc trong)", -60, 60],
      ["giao CUỐI (bắt đầu trong, kết thúc sau)", 60, 180],
      ["BAO TRÙM lượt neo", -60, 180],
      ["BỊ BAO TRÙM trong lượt neo", 30, 90],
    ])("%s ⇒ 409 ROOM-ERR-001", async (_label, from, to) => {
      const res = await book(tA, roomShapes, { startsAt: at(from), endsAt: at(to) });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body?.error?.code).toBe("ROOM-ERR-001");
      // Ghim luôn NHÃN `kind` — FE rẽ nhánh theo nó (SPEC-14 §14), đổi nhãn là hỏng UI trong im lặng.
      expect(kindOf(res)).toBe("overlap");
      // `conflicts` là bằng chứng lượt neo ĐÚNG là thứ chặn — không phải một lượt lạc nào khác.
      const conflicts = (res.body?.error?.details as ErrDetail[]).find(
        (d) => d.field === "conflicts",
      );
      expect(conflicts, "ROOM-ERR-001 thiếu details.conflicts").toBeTruthy();
      expect(JSON.parse(conflicts!.message)).toHaveLength(1);
    });

    it.each([
      // Biên nửa-mở `[start, end)`: chạm mép KHÔNG phải giao nhau.
      ["kề TRƯỚC (kết thúc đúng lúc lượt neo bắt đầu)", -60, 0],
      ["kề SAU (bắt đầu đúng lúc lượt neo kết thúc)", 120, 180],
    ])("%s ⇒ 201 (đầu-đóng-cuối-mở)", async (_label, from, to) => {
      const res = await book(tA, roomShapes, { startsAt: at(from), endsAt: at(to) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });
  // ── F. Ghim NHÃN `kind` cho 3 mã đã có ca nhưng chưa ai neo nhãn ─────────────────────────────
  //
  // `over-capacity` · `room-has-upcoming` (và `overlap` ở mục E) ĐƯỢC chạy ở `room-be1-booking`, nhưng
  // các ca đó assert `capacity`/`headcount`/`upcomingCount` — KHÔNG assert `kind`. Census
  // `room-error-code-census` bắt được đúng chỗ này: đổi nhãn `over-capacity` → `overCapacity` sẽ làm FE
  // rơi vào nhánh mặc định mà toàn bộ lưới BE vẫn xanh (`ui-promises-backend-never-reads` chiều ngược).

  describe("F. nhãn kind của ROOM-ERR-007 / ROOM-ERR-008", () => {
    it("vượt sức chứa ⇒ 422 ROOM-ERR-007 kind `over-capacity` (+ capacity/headcount); vừa khít ⇒ 201", async () => {
      const small = await newRoom(tA, "Phòng Hai Chỗ", 2);
      const over = await book(tA, small, nextSlot(), {
        attendeeUserIds: [crowd[1], crowd[2]],
      });
      expect(over.status, JSON.stringify(over.body)).toBe(422);
      expect(over.body?.error?.code).toBe("ROOM-ERR-007");
      expect(kindOf(over)).toBe("over-capacity");
      const d = over.body?.error?.details as ErrDetail[];
      expect(d.find((x) => x.field === "capacity")?.message).toBe("2");
      expect(d.find((x) => x.field === "headcount")?.message).toBe("3");

      // ALLOW đối chứng: headcount = capacity vừa khít ⇒ 201 (biên KHÔNG phải vi phạm).
      const fit = await book(tA, small, nextSlot(), { attendeeUserIds: [crowd[1]] });
      expect(fit.status, JSON.stringify(fit.body)).toBe(201);
    });

    it("vô hiệu phòng còn lịch ⇒ 409 ROOM-ERR-008 kind `room-has-upcoming` (+ upcomingCount); huỷ xong ⇒ 200", async () => {
      const room = await newRoom(tA, "Phòng Còn Lịch");
      const b = await book(tA, room, nextSlot());
      expect(b.status, JSON.stringify(b.body)).toBe(201);

      const blocked = await http()
        .patch(`/rooms/${room}`)
        .set("Authorization", `Bearer ${tA}`)
        .send({ isActive: false });
      expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
      expect(blocked.body?.error?.code).toBe("ROOM-ERR-008");
      expect(kindOf(blocked)).toBe("room-has-upcoming");
      expect(
        (blocked.body?.error?.details as ErrDetail[]).find((x) => x.field === "upcomingCount")
          ?.message,
      ).toBe("1");

      // ALLOW đối chứng: huỷ lượt rồi vô hiệu ⇒ 200 (chứng minh 409 đến từ LỊCH, không phải từ PATCH).
      expect((await post(tA, `/room-bookings/${b.body.data.id}/cancel`).send({})).status).toBe(200);
      const ok = await http()
        .patch(`/rooms/${room}`)
        .set("Authorization", `Bearer ${tA}`)
        .send({ isActive: false });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    });
  });
});
