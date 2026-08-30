import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DASH_CANONICAL_ROLES } from "../../src/dashboard/dashboard-widget-catalog.const";
import { NOTI_CANONICAL_ROLES } from "../../src/foundation/seed/notification-event-catalog.const";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S11-ROOM-DB-1 (mig 0552 · 0553 · 0554 · 0555) — CHỐT HỒI QUY cho nền dữ liệu ROOM (DB-16 §6/§9 · SPEC-14 §11/§17/§18).
 *
 * VÌ SAO FILE NÀY TỒN TẠI. Migration tự verify bằng khối DO/RAISE EXCEPTION, nhưng verify đó chỉ chạy ĐÚNG MỘT LẦN lúc
 * migrate. Sau khi merge, một WO sau `GRANT DELETE ON room_bookings`, `GRANT UPDATE ON room_bookings` cấp bảng, bỏ
 * predicate `Confirmed` khỏi EXCLUDE, hay grant `manage:room` cho employee — KHÔNG có gì đỏ: `tenant-isolation`/
 * `rls-registry` không phủ column-GRANT/EXCLUDE, `xtenant-fk-ratchet` chỉ phủ HÌNH DẠNG FK.
 * (mirror `s11-asset-db1-invariants.int-spec.ts`; memory `reviewers-pass-real-bugs` + `tests-can-pin-a-hole-open`.)
 *
 * NƠI CHẠY: gate `hasDb`, KHÔNG gate `LANE_DB` — chạy THẬT trên CI (DATABASE_URL + DIRECT_URL ở cấp job).
 *
 * QUY TẮC: mọi ca ÂM assert `err.code` + `err.constraint` ĐÍCH DANH và có ĐỐI CHỨNG DƯƠNG trên CÙNG constraint (ca C2
 * "kề nhau OK / huỷ rồi đặt lại OK" mới chứng minh predicate + '[)' của EXCLUDE, không chỉ tên). Mọi mutation chạy
 * trong tx ROLLBACK, trừ ca race C3 (phải COMMIT một bên mới có race thật — dọn bằng owner ngay sau).
 */
describe.skipIf(!hasDb)("S11-ROOM-DB-1 · bất biến nền dữ liệu ROOM (mig 0552–0555)", () => {
  const direct = directPool();
  const app = appPool(3);
  const worker = workerPool(1);

  let A: SeededTenant;
  let B: SeededTenant;
  let orgA: string;
  let attA: string;
  let orgB: string;
  let roomA1: string; // có lượt nền bA1 [T+1h, T+2h)
  let roomA2: string; // trống — dùng cho INSERT đối chứng
  let roomB: string;
  let bA1: string; // Confirmed, roomA1, [T+1h, T+2h)
  let bB1: string;
  let attRowA: string;
  /** Mốc giờ nền: 30 ngày tới — tránh đụng lượt của spec khác (khác company nên EXCLUDE cũng không chạm). */
  const T = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const at = (h: number) => new Date(T.getTime() + h * 3600 * 1000).toISOString();

  type Outcome = { code: string | null; constraint?: string; message?: string };

  async function withRole<T>(
    pool: Pool,
    companyId: string | null,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await pool.connect();
    let restored = true;
    try {
      await c.query("BEGIN");
      if (companyId) {
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      }
      return await fn(c);
    } finally {
      try {
        await c.query("ROLLBACK");
      } catch {
        restored = false;
      }
      c.release(restored ? undefined : true);
    }
  }

  /** Chạy MỘT chuỗi câu lệnh dưới role trong tx (rollback); trả mã lỗi PG của câu ĐẦU TIÊN hỏng. */
  async function attemptSeq(
    companyId: string | null,
    steps: Array<[string, unknown[]?]>,
    pool: Pool = app,
  ): Promise<Outcome> {
    return withRole(pool, companyId, async (c) => {
      try {
        for (const [sql, params] of steps) await c.query(sql, params ?? []);
        return { code: null };
      } catch (e) {
        const err = e as { code?: string; constraint?: string; message?: string };
        return { code: err.code ?? "UNKNOWN", constraint: err.constraint, message: err.message };
      }
    });
  }
  const attempt = (
    companyId: string | null,
    sql: string,
    params: unknown[] = [],
    pool: Pool = app,
  ) => attemptSeq(companyId, [[sql, params]], pool);

  const INS_BOOKING = `INSERT INTO room_bookings (company_id, room_id, title, starts_at, ends_at, organizer_user_id, booked_by_user_id)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)`;
  const CANCEL_OK = `UPDATE room_bookings SET status='Cancelled', cancelled_at=now(), cancelled_by=$2, cancel_reason='đối chứng',
                     updated_at=now(), updated_by=$2 WHERE id=$1 AND status='Confirmed'`;

  beforeAll(async () => {
    A = await seedCompany(direct, "roomA");
    B = await seedCompany(direct, "roomB");
    orgA = await seedUser(direct, A.companyId, `room-org-${A.slug}@x.test`);
    attA = await seedUser(direct, A.companyId, `room-att-${A.slug}@x.test`);
    orgB = await seedUser(direct, B.companyId, `room-org-${B.slug}@x.test`);

    const mkRoom = async (companyId: string, name: string) =>
      (
        await direct.query(
          `INSERT INTO meeting_rooms (company_id, name, capacity, equipment) VALUES ($1, $2, 8, '{TV,"Bảng trắng"}') RETURNING id`,
          [companyId, name],
        )
      ).rows[0].id as string;
    roomA1 = await mkRoom(A.companyId, `Mercury-${A.slug}`);
    roomA2 = await mkRoom(A.companyId, `Venus-${A.slug}`);
    roomB = await mkRoom(B.companyId, `Mars-${B.slug}`);

    const mkBooking = async (
      companyId: string,
      roomId: string,
      org: string,
      from: number,
      to: number,
    ) =>
      (
        await direct.query(`${INS_BOOKING} RETURNING id`, [
          companyId,
          roomId,
          `Họp ${randomUUID().slice(0, 6)}`,
          at(from),
          at(to),
          org,
          org,
        ])
      ).rows[0].id as string;
    bA1 = await mkBooking(A.companyId, roomA1, orgA, 1, 2);
    bB1 = await mkBooking(B.companyId, roomB, orgB, 1, 2);
    attRowA = (
      await direct.query(
        `INSERT INTO room_booking_attendees (company_id, booking_id, user_id) VALUES ($1, $2, $3) RETURNING id`,
        [A.companyId, bA1, attA],
      )
    ).rows[0].id as string;
  }, 60_000);

  afterAll(async () => {
    await cleanupTenants(direct, [A?.companyId, B?.companyId].filter(Boolean) as string[]);
    await direct.end();
    await app.end();
    await worker.end();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // A. BẤT BIẾN #2 — sổ không xoá / UPDATE cấp cột, ép ở TẦNG DB bằng GRANT
  // ─────────────────────────────────────────────────────────────────────────────
  describe("A. GRANT: 2 sổ không DELETE; room_bookings UPDATE cấp cột; attendees chỉ INSERT; phòng không DELETE; worker chỉ SELECT", () => {
    it("A1 app role KHÔNG DELETE được room_bookings / room_booking_attendees / meeting_rooms — 42501 (đối chứng INSERT + soft-delete OK)", async () => {
      for (const [table, id] of [
        ["room_bookings", bA1],
        ["room_booking_attendees", attRowA],
        ["meeting_rooms", roomA2],
      ] as const) {
        const r = await attempt(A.companyId, `DELETE FROM ${table} WHERE id=$1`, [id]);
        expect(r.code, `${table}: DELETE phải bị chặn bởi GRANT`).toBe("42501");
      }
      const ins = await attemptSeq(A.companyId, [
        [INS_BOOKING, [A.companyId, roomA2, "đối chứng", at(10), at(11), orgA, orgA]],
        [
          `INSERT INTO room_booking_attendees (company_id, booking_id, user_id)
           SELECT $1, id, $2 FROM room_bookings WHERE room_id=$3 AND starts_at=$4`,
          [A.companyId, attA, roomA2, at(10)],
        ],
      ]);
      expect(ins.code, "INSERT lượt + attendee dưới app role phải OK").toBeNull();
      const soft = await attempt(
        A.companyId,
        `UPDATE meeting_rooms SET deleted_at=now(), deleted_by=$2 WHERE id=$1`,
        [roomA2, orgA],
      );
      expect(soft.code, "soft-delete phòng qua UPDATE phải OK").toBeNull();
    });

    it("A2 app role KHÔNG UPDATE được cột ngoài allowlist của room_bookings / bất kỳ cột attendees — 42501 (đối chứng huỷ 1 câu OK)", async () => {
      const denied: Array<[string, string, string]> = [
        ["room_bookings", "title = 'x'", bA1],
        ["room_bookings", "starts_at = starts_at", bA1],
        ["room_bookings", "room_id = room_id", bA1],
        ["room_bookings", "organizer_user_id = organizer_user_id", bA1],
        ["room_bookings", "booked_by_user_id = NULL", bA1],
        ["room_bookings", "description = 'x'", bA1],
        ["room_booking_attendees", "user_id = user_id", attRowA],
        ["room_booking_attendees", "booking_id = booking_id", attRowA],
      ];
      for (const [table, set, id] of denied) {
        const r = await attempt(A.companyId, `UPDATE ${table} SET ${set} WHERE id=$1`, [id]);
        expect(r.code, `${table} SET ${set}: phải 42501`).toBe("42501");
      }
      const ok = await attempt(A.companyId, CANCEL_OK, [bA1, orgA]);
      expect(ok.code, "huỷ = 1 câu UPDATE đủ cột trong allowlist phải OK").toBeNull();
    });

    it("A3 mediaos_worker: INSERT/UPDATE/DELETE 3 bảng → 42501; SELECT OK (job nhắc lịch chỉ đọc)", async () => {
      for (const [sql, params] of [
        [INS_BOOKING, [A.companyId, roomA2, "w", at(12), at(13), orgA, orgA]],
        ["UPDATE room_bookings SET updated_at=now() WHERE id=$1", [bA1]],
        ["DELETE FROM room_bookings WHERE id=$1", [bA1]],
        [
          "INSERT INTO room_booking_attendees (company_id, booking_id, user_id) VALUES ($1,$2,$3)",
          [A.companyId, bA1, orgA],
        ],
        ["DELETE FROM room_booking_attendees WHERE id=$1", [attRowA]],
        ["UPDATE meeting_rooms SET sort_order=1 WHERE id=$1", [roomA1]],
        ["DELETE FROM meeting_rooms WHERE id=$1", [roomA1]],
      ] as Array<[string, unknown[]]>) {
        const r = await attempt(A.companyId, sql, params, worker);
        expect(r.code, `worker: ${sql.slice(0, 40)}`).toBe("42501");
      }
      for (const t of ["room_bookings", "room_booking_attendees", "meeting_rooms"]) {
        const r = await attempt(A.companyId, `SELECT count(*) FROM ${t}`, [], worker);
        expect(r.code, `worker SELECT ${t}`).toBeNull();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // B. BẤT BIẾN #1 — composite tenant FK: không trỏ được sang hàng của tenant khác (KI-046)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("B. composite tenant FK (đích danh tên constraint) — đối chứng cùng tenant OK", () => {
    it("B1 room_bookings: room/organizer/booked_by của tenant B → 23503 đúng FK", async () => {
      const cases: Array<[string, unknown[], string]> = [
        [
          INS_BOOKING,
          [A.companyId, roomB, "x", at(30), at(31), orgA, orgA],
          "room_bookings_room_tenant_fk",
        ],
        [
          INS_BOOKING,
          [A.companyId, roomA2, "x", at(30), at(31), orgB, orgA],
          "room_bookings_organizer_tenant_fk",
        ],
        [
          INS_BOOKING,
          [A.companyId, roomA2, "x", at(30), at(31), orgA, orgB],
          "room_bookings_booked_by_tenant_fk",
        ],
      ];
      for (const [sql, params, con] of cases) {
        const r = await attempt(A.companyId, sql, params);
        expect(r.code, con).toBe("23503");
        expect(r.constraint).toBe(con);
      }
      const ok = await attempt(A.companyId, INS_BOOKING, [
        A.companyId,
        roomA2,
        "x",
        at(30),
        at(31),
        orgA,
        attA,
      ]);
      expect(ok.code, "cùng tenant, organizer ≠ booked_by (đặt hộ) phải OK").toBeNull();
    });

    it("B2 room_bookings: cancelled_by / updated_by của tenant B → 23503 (composite SET NULL (col) vẫn kiểm chéo tenant)", async () => {
      const r1 = await attempt(A.companyId, CANCEL_OK, [bA1, orgB]);
      expect(r1.code).toBe("23503");
      expect(r1.constraint).toBe("room_bookings_cancelled_by_tenant_fk");
      const r2 = await attempt(
        A.companyId,
        `UPDATE room_bookings SET updated_by=$2, updated_at=now() WHERE id=$1`,
        [bA1, orgB],
      );
      expect(r2.code).toBe("23503");
      expect(r2.constraint).toBe("room_bookings_updated_by_tenant_fk");
    });

    it("B3 room_booking_attendees: user của B → user_tenant_fk; booking của B → booking_tenant_fk", async () => {
      const INS = `INSERT INTO room_booking_attendees (company_id, booking_id, user_id) VALUES ($1, $2, $3)`;
      const r1 = await attempt(A.companyId, INS, [A.companyId, bA1, orgB]);
      expect(r1.code).toBe("23503");
      expect(r1.constraint).toBe("room_booking_attendees_user_tenant_fk");
      const r2 = await attempt(A.companyId, INS, [A.companyId, bB1, orgA]);
      expect(r2.code).toBe("23503");
      expect(r2.constraint).toBe("room_booking_attendees_booking_tenant_fk");
      const ok = await attempt(A.companyId, INS, [A.companyId, bA1, orgA]);
      expect(ok.code, "attendee cùng tenant phải OK").toBeNull();
    });

    it("B4 meeting_rooms: updated_by / deleted_by của tenant B → 23503 đích danh (FK *_by mới của 0552)", async () => {
      const r1 = await attempt(A.companyId, `UPDATE meeting_rooms SET updated_by=$2 WHERE id=$1`, [
        roomA2,
        orgB,
      ]);
      expect(r1.code).toBe("23503");
      expect(r1.constraint).toBe("meeting_rooms_updated_by_tenant_fk");
      const r2 = await attempt(
        A.companyId,
        `UPDATE meeting_rooms SET deleted_at=now(), deleted_by=$2 WHERE id=$1`,
        [roomA2, orgB],
      );
      expect(r2.code).toBe("23503");
      expect(r2.constraint).toBe("meeting_rooms_deleted_by_tenant_fk");
      // ĐỐI CHỨNG DƯƠNG cùng tenant (deny-cases-vacuous-without-allow-case): FK composite không được chặn cả A→A.
      const okSame = await attempt(A.companyId, `UPDATE meeting_rooms SET updated_by=$2 WHERE id=$1`, [
        roomA2,
        orgA,
      ]);
      expect(okSame.code, "updated_by cùng tenant phải OK").toBeNull();
      // created_by (FK 0052 + composite 0535): ca W4 của tenant-isolation KHÔNG còn chứng minh được cặp này sau
      // 0552 (nó chèn BẢN SAO hàng seed ⇒ uq_meeting_rooms_company_name_active nổ 23505 trước FK) — bằng chứng hành
      // vi chuyển về đây với TÊN PHÒNG DUY NHẤT (security-reviewer M1 / rls-tester). Composite bắn trước fkey vì
      // giá trị là user THẬT của B (fkey một-cột 0052 thấy users.id tồn tại và cho qua).
      const cb = await attempt(
        A.companyId,
        `INSERT INTO meeting_rooms (company_id, name, capacity, created_by) VALUES ($1, $2, 8, $3)`,
        [A.companyId, `cb-${randomUUID().slice(0, 8)}`, orgB],
      );
      expect(cb.code).toBe("23503");
      expect(cb.constraint).toBe("meeting_rooms_created_by_company_fk");
      const cbOk = await attempt(
        A.companyId,
        `INSERT INTO meeting_rooms (company_id, name, capacity, created_by) VALUES ($1, $2, 8, $3)`,
        [A.companyId, `cb-${randomUUID().slice(0, 8)}`, orgA],
      );
      expect(cbOk.code, "created_by cùng tenant phải OK").toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // C. CHỐT CUỐI chống trùng lịch — EXCLUDE gist (SPEC-14 §3.1)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("C. EXCLUDE room_bookings_no_overlap_excl — [starts_at, ends_at) · chỉ Confirmed · theo phòng", () => {
    it("C1 lượt chồng giờ cùng phòng → 23P01 room_bookings_no_overlap_excl (bao cả chồng một phần và bao trọn)", async () => {
      for (const [from, to] of [
        [1.5, 2.5],
        [0.5, 1.5],
        [0, 3],
        [1.25, 1.75],
      ]) {
        const r = await attempt(A.companyId, INS_BOOKING, [
          A.companyId,
          roomA1,
          "trùng",
          at(from),
          at(to),
          orgA,
          orgA,
        ]);
        expect(r.code, `[${from}, ${to}) phải 23P01`).toBe("23P01");
        expect(r.constraint).toBe("room_bookings_no_overlap_excl");
      }
    });

    it("C2 ĐỐI CHỨNG DƯƠNG: kề nhau OK · phòng khác OK · lượt Cancelled không chặn (predicate) · Cancelled mới vẫn chèn được", async () => {
      const adjacent = await attempt(A.companyId, INS_BOOKING, [
        A.companyId,
        roomA1,
        "kề",
        at(2),
        at(3),
        orgA,
        orgA,
      ]);
      expect(adjacent.code, "[2,3) kề [1,2) — '[)' nửa-mở phải OK").toBeNull();
      const before = await attempt(A.companyId, INS_BOOKING, [
        A.companyId,
        roomA1,
        "kề trước",
        at(0),
        at(1),
        orgA,
        orgA,
      ]);
      expect(before.code, "[0,1) kề [1,2) phải OK").toBeNull();
      const otherRoom = await attempt(A.companyId, INS_BOOKING, [
        A.companyId,
        roomA2,
        "phòng khác",
        at(1),
        at(2),
        orgA,
        orgA,
      ]);
      expect(otherRoom.code, "cùng khung giờ, phòng khác phải OK").toBeNull();
      const afterCancel = await attemptSeq(A.companyId, [
        [CANCEL_OK, [bA1, orgA]],
        [INS_BOOKING, [A.companyId, roomA1, "đặt lại khung đã huỷ", at(1), at(2), orgA, orgA]],
      ]);
      expect(
        afterCancel.code,
        "huỷ (1 câu UPDATE) rồi đặt lại đúng khung phải OK — predicate Confirmed",
      ).toBeNull();
      const insCancelled = await attempt(
        A.companyId,
        `INSERT INTO room_bookings (company_id, room_id, title, starts_at, ends_at, organizer_user_id, status, cancelled_at)
         VALUES ($1, $2, 'đã huỷ', $3, $4, $5, 'Cancelled', now())`,
        [A.companyId, roomA1, at(1), at(2), orgA],
      );
      expect(insCancelled.code, "hàng Cancelled chồng giờ không bị EXCLUDE chạm").toBeNull();
    });

    it("C3 RACE: 2 connection đặt cùng khung song song → đúng 1 Confirmed + 1 23P01 (COMMIT thật, dọn bằng owner)", async () => {
      const c1 = await app.connect();
      const c2 = await app.connect();
      const params = (title: string) => [A.companyId, roomA2, title, at(40), at(41), orgA, orgA];
      let winner: string | null = null;
      try {
        await c1.query("BEGIN");
        await c1.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        await c2.query("BEGIN");
        await c2.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        await c1.query(INS_BOOKING, params("race-1"));
        // c2 chèn cùng khung: GIST khoá predicate ⇒ chờ c1 quyết định, KHÔNG được vào trước.
        const p2: Promise<Outcome> = c2.query(INS_BOOKING, params("race-2")).then(
          (): Outcome => ({ code: null }),
          (e: { code?: string; constraint?: string }): Outcome => ({
            code: e.code ?? "UNKNOWN",
            constraint: e.constraint,
          }),
        );
        await c1.query("COMMIT");
        winner = "race-1";
        const r2 = await p2;
        expect(r2.code, "bên thua phải 23P01, KHÔNG được thành 2 lượt Confirmed").toBe("23P01");
        expect(r2.constraint).toBe("room_bookings_no_overlap_excl");
        await c2.query("ROLLBACK");
        const n = await direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM room_bookings WHERE company_id=$1 AND room_id=$2 AND starts_at=$3 AND status='Confirmed'`,
          [A.companyId, roomA2, at(40)],
        );
        expect(n.rows[0].n).toBe(1);
      } finally {
        await c1.query("ROLLBACK").catch(() => undefined);
        await c2.query("ROLLBACK").catch(() => undefined);
        c1.release();
        c2.release();
        if (winner) {
          await direct.query(
            `DELETE FROM room_bookings WHERE company_id=$1 AND room_id=$2 AND starts_at=$3`,
            [A.companyId, roomA2, at(40)],
          );
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // D. CHECK / UNIQUE ở DB — mirror hai chiều với contracts room.ts
  // ─────────────────────────────────────────────────────────────────────────────
  describe("D. CHECK/UNIQUE đích danh + đối chứng dương", () => {
    it("D1 room_bookings: time_order · status ngoài tập · cancel_pair (thiếu cancelled_at / Confirmed có cancelled_at / UPDATE tách 2 câu)", async () => {
      const bad = await attempt(A.companyId, INS_BOOKING, [
        A.companyId,
        roomA2,
        "x",
        at(50),
        at(50),
        orgA,
        orgA,
      ]);
      expect(bad.code).toBe("23514");
      expect(bad.constraint).toBe("chk_room_bookings_time_order");
      const badStatus = await attempt(
        A.companyId,
        `INSERT INTO room_bookings (company_id, room_id, title, starts_at, ends_at, organizer_user_id, status)
         VALUES ($1, $2, 'x', $3, $4, $5, 'Completed')`,
        [A.companyId, roomA2, at(50), at(51), orgA],
      );
      expect(badStatus.code, "Completed là DẪN XUẤT, không phải trạng thái lưu").toBe("23514");
      // "Completed" vi phạm CẢ chk_room_bookings_status LẪN cancel_pair (không nhánh nào khớp) — Postgres báo cái nào
      // kiểm trước, không cố định ⇒ chấp nhận cả hai, và pin ĐỊNH NGHĨA của chk_room_bookings_status từ catalog.
      expect(["chk_room_bookings_status", "chk_room_bookings_cancel_pair"]).toContain(badStatus.constraint);
      const statusDef = (
        await direct.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='room_bookings'::regclass AND conname='chk_room_bookings_status'`,
        )
      ).rows[0]?.def;
      expect(statusDef).toBe("CHECK (((status)::text = ANY ((ARRAY['Confirmed'::character varying, 'Cancelled'::character varying])::text[])))");
      const noCancelledAt = await attempt(
        A.companyId,
        `INSERT INTO room_bookings (company_id, room_id, title, starts_at, ends_at, organizer_user_id, status)
         VALUES ($1, $2, 'x', $3, $4, $5, 'Cancelled')`,
        [A.companyId, roomA2, at(50), at(51), orgA],
      );
      expect(noCancelledAt.code).toBe("23514");
      expect(noCancelledAt.constraint).toBe("chk_room_bookings_cancel_pair");
      const confirmedWithCancelledAt = await attempt(
        A.companyId,
        `INSERT INTO room_bookings (company_id, room_id, title, starts_at, ends_at, organizer_user_id, cancelled_at)
         VALUES ($1, $2, 'x', $3, $4, $5, now())`,
        [A.companyId, roomA2, at(50), at(51), orgA],
      );
      expect(confirmedWithCancelledAt.code).toBe("23514");
      expect(confirmedWithCancelledAt.constraint).toBe("chk_room_bookings_cancel_pair");
      // Tách 2 câu (status trước) ⇒ nổ giữa chừng — huỷ PHẢI là MỘT câu UPDATE (DB-16 §6.2).
      const twoSteps = await attemptSeq(A.companyId, [
        [`UPDATE room_bookings SET status='Cancelled' WHERE id=$1`, [bA1]],
        [`UPDATE room_bookings SET cancelled_at=now() WHERE id=$1`, [bA1]],
      ]);
      expect(twoSteps.code).toBe("23514");
      expect(twoSteps.constraint).toBe("chk_room_bookings_cancel_pair");
      const oneStep = await attempt(A.companyId, CANCEL_OK, [bA1, orgA]);
      expect(oneStep.code, "đối chứng: 1 câu UPDATE đủ cột OK").toBeNull();
    });

    it("D2 meeting_rooms: capacity 0 → chk_meeting_rooms_capacity · NULL → 23502 · tên trùng khác hoa/thường → uq (partial) · is_virtual → 42703", async () => {
      const INS = `INSERT INTO meeting_rooms (company_id, name, capacity) VALUES ($1, $2, $3)`;
      const zero = await attempt(A.companyId, INS, [A.companyId, "Zero", 0]);
      expect(zero.code).toBe("23514");
      expect(zero.constraint).toBe("chk_meeting_rooms_capacity");
      const nul = await attempt(A.companyId, INS, [A.companyId, "Null", null]);
      expect(nul.code, "capacity NOT NULL từ 0552").toBe("23502");
      const dup = await attempt(A.companyId, INS, [A.companyId, `MERCURY-${A.slug}`, 4]);
      expect(dup.code).toBe("23505");
      expect(dup.constraint).toBe("uq_meeting_rooms_company_name_active");
      const reuse = await attemptSeq(A.companyId, [
        [`UPDATE meeting_rooms SET deleted_at=now() WHERE id=$1`, [roomA1]],
        [INS, [A.companyId, `mercury-${A.slug}`, 4]],
      ]);
      expect(
        reuse.code,
        "đối chứng: soft-delete rồi tạo lại cùng tên (partial deleted_at IS NULL) OK",
      ).toBeNull();
      const sameNameOtherTenant = await attempt(B.companyId, INS, [
        B.companyId,
        `Mercury-${A.slug}`,
        4,
      ]);
      expect(sameNameOtherTenant.code, "unique theo company — tenant B dùng lại tên OK").toBeNull();
      const virtual = await attempt(
        A.companyId,
        `INSERT INTO meeting_rooms (company_id, name, capacity, is_virtual) VALUES ($1,'v',4,true)`,
        [A.companyId],
      );
      expect(virtual.code, "cột is_virtual đã gỡ (ROOM-DEC-001)").toBe("42703");
    });

    it("D3 attendees: trùng (booking, user) → 23505 uq_room_booking_attendees_booking_user", async () => {
      const r = await attempt(
        A.companyId,
        `INSERT INTO room_booking_attendees (company_id, booking_id, user_id) VALUES ($1,$2,$3)`,
        [A.companyId, bA1, attA],
      );
      expect(r.code).toBe("23505");
      expect(r.constraint).toBe("uq_room_booking_attendees_booking_user");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // E. RLS smoke (lưới đầy đủ ở tenant-isolation / rls-guards qua rls-registry)
  // ─────────────────────────────────────────────────────────────────────────────
  it("E1 không GUC ⇒ app role thấy 0 hàng room_bookings / attendees / meeting_rooms (FORCE RLS)", async () => {
    for (const t of ["room_bookings", "room_booking_attendees", "meeting_rooms"]) {
      const n = await withRole(
        app,
        null,
        async (c) => (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number,
      );
      expect(n, t).toBe(0);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // F. seed 0553/0554 — ma trận §9e · role office-admin · di sản đã dọn · audit CHECK
  // ─────────────────────────────────────────────────────────────────────────────
  describe("F. seed quyền / role / audit / di sản", () => {
    it("F1 22 grant đúng ma trận §9e; employee KHÔNG manage; hr cancel=Own; office-admin đúng thuộc tính và KHÔNG canonical", async () => {
      const rows = (
        await direct.query<{
          role: string;
          action: string;
          resource_type: string;
          data_scope: string;
        }>(
          `SELECT r.name AS role, p.action, p.resource_type, rp.data_scope
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.company_id IS NULL AND r.deleted_at IS NULL AND rp.effect = 'ALLOW'
              AND p.resource_type IN ('room', 'room-booking')
              AND r.name IN ('employee','manager','hr','company-admin','office-admin')
            ORDER BY r.name, p.action, p.resource_type`,
        )
      ).rows;
      expect(rows.length).toBe(22);
      const key = (r: (typeof rows)[number]) =>
        `${r.role}|${r.action}:${r.resource_type}@${r.data_scope}`;
      const expected = new Set<string>();
      for (const role of ["employee", "manager", "hr"]) {
        expected.add(`${role}|access:room@Own`);
        expected.add(`${role}|view:room@Company`);
        expected.add(`${role}|book:room@Own`);
        expected.add(`${role}|cancel:room-booking@Own`);
      }
      for (const role of ["company-admin", "office-admin"]) {
        expected.add(`${role}|access:room@Own`);
        expected.add(`${role}|view:room@Company`);
        expected.add(`${role}|book:room@Company`);
        expected.add(`${role}|cancel:room-booking@Company`);
        expected.add(`${role}|manage:room@Company`);
      }
      expect(new Set(rows.map(key))).toEqual(expected);

      const role = (
        await direct.query<{ id: string; is_system: boolean; requires_two_factor: boolean }>(
          `SELECT id, is_system, requires_two_factor FROM roles WHERE name='office-admin' AND company_id IS NULL AND deleted_at IS NULL`,
        )
      ).rows;
      expect(role.length).toBe(1);
      expect(role[0]).toEqual({
        id: "00000000-0000-0000-0000-000000000013",
        is_system: true,
        requires_two_factor: false,
      });
      expect(DASH_CANONICAL_ROLES as readonly string[]).not.toContain("office-admin");
      expect(NOTI_CANONICAL_ROLES as readonly string[]).not.toContain("office-admin");
      const perms = (
        await direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM permissions WHERE resource_type IN ('room','room-booking') AND is_sensitive = false`,
        )
      ).rows[0].n;
      expect(perms).toBe(5);
    });

    it("F2 di sản: 6 cặp meeting/meeting_room = 0 · 4 bảng meeting_* không còn · hàm trigger không còn · meeting_rooms còn", async () => {
      const legacy = (
        await direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM permissions WHERE resource_type IN ('meeting','meeting_room')`,
        )
      ).rows[0].n;
      expect(legacy).toBe(0);
      const regs = (
        await direct.query<{ t: string; ok: boolean }>(
          `SELECT t, to_regclass(t) IS NULL AS ok FROM unnest(ARRAY['meetings','meeting_attendees','meeting_notes','meeting_tasks']) AS t`,
        )
      ).rows;
      for (const r of regs) expect(r.ok, `${r.t} phải đã DROP (0553)`).toBe(true);
      const fn = (
        await direct.query<{ ok: boolean }>(
          `SELECT to_regproc('meetings_set_updated_at') IS NULL AS ok`,
        )
      ).rows[0].ok;
      expect(fn).toBe(true);
      const rooms = (
        await direct.query<{ ok: boolean }>(`SELECT to_regclass('meeting_rooms') IS NOT NULL AS ok`)
      ).rows[0].ok;
      expect(rooms).toBe(true);
    });

    it("F3 CHECK audit_logs.object_type chứa room_booking + meeting_room VÀ canary employee/user (NO-LOSS)", async () => {
      const def = (
        await direct.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='audit_logs'::regclass AND conname='audit_logs_object_type_chk'`,
        )
      ).rows[0].def;
      for (const v of ["room_booking", "meeting_room", "employee", "user"]) {
        expect(new RegExp(`[,{']${v}[',}]`).test(def), `CHECK phải chứa '${v}'`).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // G. NOTI 0555 — CHECK cả hai bảng + catalog
  // ─────────────────────────────────────────────────────────────────────────────
  describe("G. NOTI: CHECK ROOM/Room trên notifications + 3 event DedupeKey + 3 template", () => {
    it("G1 notifications nhận module_code='ROOM'/notification_type='Room' dưới app role; giá trị lạ → 23514 đích danh", async () => {
      const INS = `INSERT INTO notifications (company_id, user_id, body, module_code, notification_type) VALUES ($1, $2, 'x', $3, $4)`;
      const ok = await attempt(A.companyId, INS, [A.companyId, orgA, "ROOM", "Room"]);
      expect(ok.code, "vế notifications phải đã nới (lỗi 0507 quên vế này)").toBeNull();
      const badModule = await attempt(A.companyId, INS, [A.companyId, orgA, "XXX", "Room"]);
      expect(badModule.code).toBe("23514");
      expect(badModule.constraint).toBe("chk_notifications_module_code");
      const badType = await attempt(A.companyId, INS, [A.companyId, orgA, "ROOM", "Xxx"]);
      expect(badType.code).toBe("23514");
      expect(badType.constraint).toBe("chk_notifications_notification_type");
    });

    it("G2 3 event global DedupeKey/enabled/Room, is_system_event false/false/TRUE (reminder), priority Normal/High/High + 3 template", async () => {
      const ev = (
        await direct.query<{
          event_code: string;
          dedupe_strategy: string;
          default_priority: string;
          is_system_event: boolean;
        }>(
          `SELECT event_code, dedupe_strategy, default_priority, is_system_event FROM notification_events
            WHERE company_id IS NULL AND deleted_at IS NULL AND module_code='ROOM' AND notification_type='Room'
              AND is_enabled = true ORDER BY event_code`,
        )
      ).rows;
      expect(
        ev.map((r) => [r.event_code, r.default_priority, r.is_system_event, r.dedupe_strategy]),
      ).toEqual([
        ["ROOM_BOOKING_CANCELLED", "High", false, "DedupeKey"],
        ["ROOM_BOOKING_CONFIRMED", "Normal", false, "DedupeKey"],
        ["ROOM_BOOKING_REMINDER", "High", true, "DedupeKey"],
      ]);
      const tpl = (
        await direct.query<{
          template_code: string;
          target_url_template: string;
          variables_schema: unknown;
        }>(
          `SELECT t.template_code, t.target_url_template, t.variables_schema
             FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
            WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.company_id IS NULL AND e.module_code='ROOM'
              AND t.channel='IN_APP' AND t.locale='vi-VN' AND t.status='Active' AND t.is_default ORDER BY 1`,
        )
      ).rows;
      expect(tpl.map((t) => t.template_code)).toEqual([
        "ROOM_BOOKING_CANCELLED__IN_APP__vi-VN",
        "ROOM_BOOKING_CONFIRMED__IN_APP__vi-VN",
        "ROOM_BOOKING_REMINDER__IN_APP__vi-VN",
      ]);
      for (const t of tpl) {
        expect(t.target_url_template).toBe("/me/room-bookings?focus={booking_id}");
        expect(t.variables_schema).toBeTruthy();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // H. idempotency — chỉ 0554 + 0555 (0552/0553 là DDL/DROP có tiền kiểm, cố ý KHÔNG chạy lại)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("H. idempotency 0554 + 0555 (chạy lại NGUYÊN file qua owner)", () => {
    it("H1 chạy lại toàn bộ 0554 + 0555 ⇒ 0 exception, count roles/permissions/role_permissions/events/templates/audit_def KHÔNG đổi", async () => {
      const COUNTS = `
        SELECT
          (SELECT count(*) FROM roles WHERE name = 'office-admin' AND company_id IS NULL AND deleted_at IS NULL) AS roles,
          (SELECT count(*) FROM permissions WHERE resource_type IN ('room','room-booking'))                       AS perms,
          (SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            WHERE p.resource_type IN ('room','room-booking'))                                                     AS grants,
          (SELECT count(*) FROM notification_events
            WHERE company_id IS NULL AND deleted_at IS NULL AND module_code = 'ROOM')                            AS events,
          (SELECT count(*) FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
            WHERE t.company_id IS NULL AND t.deleted_at IS NULL AND e.company_id IS NULL AND e.module_code = 'ROOM') AS templates,
          (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'audit_logs_object_type_chk')      AS audit_def`;
      const before = (await direct.query(COUNTS)).rows[0];
      for (const file of [
        "0554_s11roomdb1_seed_role_perms_audit.sql",
        "0555_s11roomdb1_noti_room.sql",
      ]) {
        const sql = readFileSync(path.join(__dirname, "..", "..", "migrations", file), "utf8");
        for (const stmt of sql.split("--> statement-breakpoint")) {
          if (
            stmt
              .trim()
              .replace(/^--.*$/gm, "")
              .trim().length === 0
          )
            continue;
          await direct.query(stmt);
        }
      }
      const after = (await direct.query(COUNTS)).rows[0];
      expect(after).toEqual(before);
    });
  });
});
