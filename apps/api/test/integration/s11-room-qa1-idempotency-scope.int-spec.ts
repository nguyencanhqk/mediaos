/**
 * S11-ROOM-QA-1 — BIÊN của `@Idempotent()` trên `POST /room-bookings` (SPEC-14 §12 cuối · §21 hàng
 * "Idempotent"), phần `room-be1-booking.int-spec.ts` CHƯA đo.
 *
 * BE-1 đã phủ: replay đúng envelope + header `Idempotency-Replayed`, `KEY_REUSED` (cùng khoá, payload
 * khác), và "huỷ rồi đặt lại với khoá MỚI". Không lặp lại ở đây. Còn thiếu ĐÚNG các vế sau, mà §21
 * nêu đích danh ("khác user/company cùng key → không phát lại chéo") hoặc SPEC-14 §14 bắt FE rẽ nhánh
 * theo (`IN_PROGRESS` ‖ `INVALID_KEY`):
 *
 *   · `INVALID_KEY`  — khoá quá dài ⇒ 409, KHÔNG chạy nghiệp vụ (0 lượt sinh ra);
 *   · `IN_PROGRESS`  — bấm-đúp khi request đầu CHƯA xong ⇒ 409 IN_PROGRESS, **không** ROOM-ERR-001;
 *   · KHÔNG phát lại CHÉO — cùng chuỗi khoá nhưng khác **người gọi** / khác **công ty** ⇒ mỗi bên chạy
 *     nghiệp vụ của mình. Đây là BẤT BIẾN #1 đi qua đường CACHE: khoá interceptor băm
 *     `companyId + userId + method + path + key`; thiếu một vế là hai người đọc được phản hồi của nhau;
 *   · lỗi ⇒ NHẢ khoá — request hỏng không được "đóng băng" khoá.
 *
 * VÌ SAO VẾ `IN_PROGRESS` QUAN TRỌNG VỚI ROOM HƠN VỚI ASSET: SPEC-14 §14 buộc FE phân biệt ba mã 409
 * (`ROOM-ERR-001` khung bận · `IN_PROGRESS` đang gửi · `KEY_REUSED` sinh khoá mới) — cùng HTTP status,
 * ba hành vi UI khác nhau. Nếu bấm-đúp trả về `ROOM-ERR-001` thay vì `IN_PROGRESS`, người dùng thấy
 * "phòng đã bận" cho chính lượt MÌNH đang đặt.
 *
 * GATE CỨNG `hasDb && LANE_DB`. Store idempotency dùng Valkey THẬT (khoá băm có companyId của tenant
 * dựng-rồi-xoá ⇒ không giẫm môi trường khác dù Valkey dùng chung — memory
 * `valkey-shared-across-all-envs-no-channel-prefix`).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IDEMPOTENCY_ERROR_CODES,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
} from "@mediaos/contracts";
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
const LOGIN_PW = loginPasswordFixture("s11roomqa2");

/** 5 cặp §9e ở khuôn `office-admin` (access@Own, còn lại @Company). */
const ROOM_ALL: Array<[string, string, "Own" | "Company"]> = [
  ["access", "room", "Own"],
  ["view", "room", "Company"],
  ["book", "room", "Company"],
  ["cancel", "room-booking", "Company"],
  ["manage", "room", "Company"],
];

describe.skipIf(!hasLaneDb)("S11-ROOM-QA-1 idempotency — biên + cô lập chủ thể", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tA1 = ""; // công ty A, người gọi #1
  let tA2 = ""; // công ty A, người gọi #2
  let tB1 = ""; // công ty B
  let roomA1 = "";
  let roomA2 = "";
  let roomA3 = "";
  let roomB = "";

  const http = () => request(app.getHttpServer());
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
  const code = (r: request.Response) => r.body?.error?.code as string | undefined;

  let slotCounter = 0;
  /** Slot tương lai KHÔNG BAO GIỜ trùng nhau trong cả file — chống-trùng nghiệp vụ không được lẫn vào phép đo. */
  function nextSlot(): { startsAt: string; endsAt: string } {
    const start = new Date(Date.now() + (180 + slotCounter * 120) * 60_000);
    slotCounter += 1;
    return {
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
    };
  }

  async function grantAll(companyId: string, userId: string, label: string) {
    const roleId = await seedRole(direct, companyId, `roomqa2-${label}`);
    for (const [action, resource, scope] of ROOM_ALL) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function newRoom(t: string, name: string): Promise<string> {
    const res = await post(t, "/rooms").send({ name, capacity: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  /** Đếm lượt `Confirmed` của một phòng — nghiệm bằng DB, không bằng phản hồi HTTP. */
  async function confirmedCount(roomId: string): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM room_bookings WHERE room_id = $1 AND status = 'Confirmed'",
      [roomId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Server THẬT: ca IN_PROGRESS giữ hai request cùng lúc — app chỉ `init()` sẽ đóng socket dùng chung
    // khi request đầu tiên trả về (memory `supertest-closes-shared-server-on-first-response`).
    await app.listen(0);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "roomqa2a");
    B = await seedCompany(direct, "roomqa2b");
    companyIds.push(A.companyId, B.companyId);

    const a1 = await seedUser(direct, A.companyId, `a1@${A.slug}.test`, hash);
    const a2 = await seedUser(direct, A.companyId, `a2@${A.slug}.test`, hash);
    const b1 = await seedUser(direct, B.companyId, `b1@${B.slug}.test`, hash);
    await grantAll(A.companyId, a1, "a1");
    await grantAll(A.companyId, a2, "a2");
    await grantAll(B.companyId, b1, "b1");
    tA1 = await login(A.slug, `a1@${A.slug}.test`);
    tA2 = await login(A.slug, `a2@${A.slug}.test`);
    tB1 = await login(B.slug, `b1@${B.slug}.test`);

    roomA1 = await newRoom(tA1, "Phòng Idem 1");
    roomA2 = await newRoom(tA1, "Phòng Idem 2");
    roomA3 = await newRoom(tA1, "Phòng Idem 3");
    roomB = await newRoom(tB1, "Phòng Idem B");
  }, 180_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  it("khoá quá dài ⇒ 409 INVALID_KEY và KHÔNG chạy nghiệp vụ (0 lượt)", async () => {
    const before = await confirmedCount(roomA1);
    const res = await post(tA1, "/room-bookings")
      .set(IDEMPOTENCY_HEADER, "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))
      .send({ roomId: roomA1, title: "Khoá quá dài", ...nextSlot() });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(code(res)).toBe(IDEMPOTENCY_ERROR_CODES.INVALID_KEY);
    // Vế QUAN TRỌNG: chặn ở interceptor ⇒ handler chưa từng chạy.
    expect(await confirmedCount(roomA1)).toBe(before);

    // ALLOW đối chứng: đúng độ dài tối đa (biên = HỢP LỆ) ⇒ chạy bình thường. Thiếu vế này thì ca trên
    // xanh cả khi mọi khoá đều bị từ chối (`deny-cases-vacuous-without-allow-case`).
    const ok = await post(tA1, "/room-bookings")
      .set(IDEMPOTENCY_HEADER, "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH))
      .send({ roomId: roomA1, title: "Khoá dài tối đa", ...nextSlot() });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await confirmedCount(roomA1)).toBe(before + 1);
  });

  /**
   * TẤT ĐỊNH, KHÔNG ĐUA. Bắn hai request song song rồi `if (loser) … else …` là ca **có thể không bao
   * giờ chạy nhánh mình định đo**: nếu request đầu xong trước, nhánh IN_PROGRESS im lặng biến mất và
   * lưới vẫn xanh.
   *
   * Cách ép: giữ **khoá hàng** trên `meeting_rooms` bằng một transaction của pool owner. Handler đặt
   * phòng mở tx rồi `lockAliveByIdTx` = `SELECT … FOR UPDATE` trên đúng hàng đó (SPEC-14 §13.2 bước 2)
   * ⇒ request #1 đứng lại NGAY TRONG handler, SAU khi interceptor đã ghi khoá idempotency. Request #2
   * vì thế CHẮC CHẮN gặp trạng thái in-flight.
   */
  it("bấm-đúp khi request đầu CHƯA xong ⇒ 409 IN_PROGRESS (KHÔNG phải ROOM-ERR-001) và chỉ 1 lượt", async () => {
    const before = await confirmedCount(roomA2);
    const slot = nextSlot();
    const key = `roomqa1-inflight-${roomA2}`;
    const fire = () =>
      post(tA1, "/room-bookings")
        .set(IDEMPOTENCY_HEADER, key)
        .send({ roomId: roomA2, title: "Bấm đúp", ...slot });

    const locker = await direct.connect();
    let first: request.Response | null = null;
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM meeting_rooms WHERE id = $1 FOR UPDATE", [roomA2]);

      // #1 chạy vào handler rồi TREO ở FOR UPDATE (không await).
      const p1 = fire().then(
        (r) => (first = r),
        () => null,
      );
      await new Promise((r) => setTimeout(r, 300)); // đủ để #1 qua interceptor + kẹt ở khoá hàng

      const r2 = await fire();
      expect(r2.status, JSON.stringify(r2.body)).toBe(409);
      // Ba mã 409 khác nhau ⇒ ba hành vi FE khác nhau (SPEC-14 §14): phải là IN_PROGRESS, không phải
      // "phòng đã bận" cho chính lượt mình đang gửi.
      expect(code(r2)).toBe(IDEMPOTENCY_ERROR_CODES.IN_PROGRESS);
      expect(code(r2)).not.toBe("ROOM-ERR-001");

      await locker.query("ROLLBACK");
      await p1;
    } finally {
      locker.release();
    }

    // #1 vẫn đi tới đích sau khi khoá được nhả ⇒ ĐÚNG một lượt, không mất và không nhân đôi.
    expect(await confirmedCount(roomA2)).toBe(before + 1);
    if (first) expect((first as request.Response).status).toBe(201);
  });

  it("CÙNG chuỗi khoá, KHÁC người gọi trong cùng công ty ⇒ không phát lại chéo", async () => {
    const key = ["roomqa1", "shared", "across-users"].join("-");
    const r1 = await post(tA1, "/room-bookings")
      .set(IDEMPOTENCY_HEADER, key)
      .send({ roomId: roomA3, title: "A1 đặt", ...nextSlot() });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);

    const r2 = await post(tA2, "/room-bookings")
      .set(IDEMPOTENCY_HEADER, key)
      .send({ roomId: roomA3, title: "A2 đặt", ...nextSlot() });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.headers["idempotency-replayed"]).toBeUndefined();
    expect(r2.body.data.id).not.toBe(r1.body.data.id);
    // Phản hồi của A2 phải là lượt của A2 — không phải bản sao envelope của A1.
    expect(r2.body.data.title).toBe("A2 đặt");
    expect(r2.body.data.organizer?.userId ?? r2.body.data.organizerUserId).not.toBe(
      r1.body.data.organizer?.userId ?? r1.body.data.organizerUserId,
    );
  });

  it("CÙNG chuỗi khoá, KHÁC công ty ⇒ không phát lại chéo (BẤT BIẾN #1 qua đường cache)", async () => {
    const key = ["roomqa1", "shared", "across-companies"].join("-");
    const ra = await post(tA1, "/room-bookings")
      .set(IDEMPOTENCY_HEADER, key)
      .send({ roomId: roomA3, title: "Công ty A", ...nextSlot() });
    expect(ra.status, JSON.stringify(ra.body)).toBe(201);

    const rb = await post(tB1, "/room-bookings")
      .set(IDEMPOTENCY_HEADER, key)
      .send({ roomId: roomB, title: "Công ty B", ...nextSlot() });
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);
    expect(rb.headers["idempotency-replayed"]).toBeUndefined();
    expect(rb.body.data.id).not.toBe(ra.body.data.id);
    expect(rb.body.data.title).toBe("Công ty B");
    // Lượt của B nằm ở phòng của B — nếu cache phát lại chéo, id phòng sẽ là của A.
    expect(rb.body.data.room?.id ?? rb.body.data.roomId).toBe(roomB);
  });

  it("handler LỖI ⇒ nhả khoá: retry CÙNG khoá + CÙNG payload chạy THẬT lại, không phát lại lỗi đã cache", async () => {
    const key = ["roomqa1", "release", "after-error"].join("-");
    const ghostRoom = "00000000-0000-4000-8000-0000000000fe";
    const slot = nextSlot();
    const body = { roomId: ghostRoom, title: "Phòng ma", ...slot };

    const bad1 = await post(tA1, "/room-bookings").set(IDEMPOTENCY_HEADER, key).send(body);
    expect(bad1.status, JSON.stringify(bad1.body)).toBe(404);
    expect(code(bad1)).toBe("ROOM-ERR-NOT-FOUND");

    const bad2 = await post(tA1, "/room-bookings").set(IDEMPOTENCY_HEADER, key).send(body);
    expect(bad2.status).toBe(404);
    // Lỗi KHÔNG được cache ⇒ lần 2 là lần chạy THẬT, không mang header phát lại.
    expect(bad2.headers["idempotency-replayed"]).toBeUndefined();

    // Và khoá vẫn dùng được cho payload KHÁC ⇒ đúng KEY_REUSED (không phải "khoá chết").
    const reuse = await post(tA1, "/room-bookings")
      .set(IDEMPOTENCY_HEADER, key)
      .send({ roomId: roomA3, title: "Payload khác", ...nextSlot() });
    expect([201, 409]).toContain(reuse.status);
    if (reuse.status === 409) expect(code(reuse)).toBe(IDEMPOTENCY_ERROR_CODES.KEY_REUSED);
  });
});
