/**
 * S11-ROOM-QA-1 — MA TRẬN QUYỀN PER-PAIR của ROOM (SPEC-14 §11 · §21 hàng "Deny-path (RED trước)").
 *
 * VÌ SAO CÓ FILE NÀY KHI `room-be1-scope.int-spec.ts` MỤC A ĐÃ CÓ DENY.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Mục A của spec BE-1 đo ĐÚNG BỐN ô (một route đại diện mỗi cặp) bằng những chủ thể thiếu NHIỀU cặp
 * cùng lúc (`vo` thiếu cả `book` lẫn `manage`, `np` thiếu tất cả). Phép đo đó chứng minh "thiếu quyền
 * thì bị chặn", KHÔNG chứng minh **route được gác bằng ĐÚNG cặp**: nếu `GET /rooms/:id/bookings` lỡ
 * khai `@RequirePermission("manage","room")`, `vo` vẫn 403 (nó thiếu cả hai) ⇒ lưới xanh trong khi cặp
 * đã lệch, và 8 trong 13 route ROOM chưa từng có ô deny nào của riêng nó.
 *
 * PHÉP ĐO Ở ĐÂY = A/B **CÙNG MỘT REQUEST**, chỉ đổi CHỦ THỂ:
 *   · `full`   giữ đủ 5 cặp §9e (access@Own, 4 cặp còn lại @Company — khuôn `office-admin`);
 *   · `no-<P>` giữ 4 cặp, THIẾU ĐÚNG cặp P.
 * Với mỗi route trong **13 route** của 3 controller: `no-<P>` ⇒ **403**, `full` ⇒ **KHÔNG 403** (route
 * đọc ⇒ đúng **200**). Hai vế chạy cùng URL + cùng body ⇒ chênh lệch duy nhất là cặp quyền.
 *
 * CHỦ THỂ = role DỰNG TRONG TEST, KHÔNG super-admin (`superadmin-not-a-canonical-role`: SA có `*:*` nên
 * mọi ca deny thành tautology).
 *
 * KHÔNG GÂY TÁC DỤNG PHỤ: route ghi bắn vào UUID **không tồn tại** / body rỗng ⇒ qua guard rồi dừng ở
 * pipe/service (400/404). Guard chạy TRƯỚC pipe (Nest: guards → interceptors → pipes) nên vế 403 không
 * phụ thuộc body — đó cũng là lý do A/B dùng CHUNG body.
 *
 * MỤC C LÀ PHẦN CÓ GIÁ TRỊ NHẤT. ROOM gác cặp ở **HAI TẦNG** (giống ASSET —
 * `asset-guards-pairs-in-two-layers`): `@RequirePermission` trên controller **và** `RoomAccessService.
 * resolve*Actor` gọi `dataScope.resolveAndAssert(...)` trong service. Lệch MỘT tầng ⇒ đường HTTP vẫn
 * 403 (tầng kia chặn) ⇒ mục A/B **mù**. ROOM khác ASSET ở chỗ tầng service KHÔNG nhận cặp theo tham số
 * (`assertCan(u,"a","r")`) mà gói trong 4 resolver có tên; vì thế mục C phải đi **ba chặng** —
 * route → phương thức service → resolver → cặp — rồi mới so được với decorator. Đối chiếu bằng tập
 * (như ASSET) là KHÔNG đủ ở đây: 4 resolver phủ đúng 4 cặp nên tập luôn khớp kể cả khi một route trỏ
 * nhầm resolver.
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
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
const LOGIN_PW = loginPasswordFixture("s11roomqa1");

const ROOM_SRC = path.join(__dirname, "..", "..", "src", "rooms");

/** Khoá cặp quyền dạng "action:resource" — cũng là nhãn chủ thể `no-<khoá>`. */
type PairKey = "view:room" | "book:room" | "cancel:room-booking" | "manage:room";

/** `access:room` là cổng NAV (SPEC-14 §11) — không route nào khai; ca "nav-only" nằm ở mục D. */
const ACCESS_PAIR: [string, string] = ["access", "room"];
const ROUTE_PAIRS: PairKey[] = ["view:room", "book:room", "cancel:room-booking", "manage:room"];

/** Bỏ comment trước khi quét source — docblock nhắc `@RequirePermission` KHÔNG phải route thật. */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readRoomSrc = (file: string): string =>
  strip(fs.readFileSync(path.join(ROOM_SRC, file), "utf8"));

const roomFiles = (suffix: string): string[] =>
  fs.readdirSync(ROOM_SRC).filter((n) => n.endsWith(suffix));

describe.skipIf(!hasLaneDb)("S11-ROOM-QA-1 ma trận quyền per-pair (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  /** token của chủ thể đủ 5 cặp. */
  let tFull = "";
  /** token theo cặp BỊ THIẾU. */
  const tMissing = new Map<PairKey, string>();

  // Fixture đọc — ALLOW đối chứng phải là 200 THẬT, không chỉ "khác 403".
  let roomId = "";
  let bookingId = "";
  let today = "";
  /** Cửa sổ hợp lệ cho từng nhóm route (luật giờ khác nhau — SPEC-14 §13.4). */
  let winShort = { from: "", to: "" }; // ≤ 8h — availability
  let winWeek = { from: "", to: "" }; // ≤ 31 ngày — lịch
  let winYear = { from: "", to: "" }; // ≤ 366 ngày — usage-summary

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));
  const del = (t: string, u: string) => auth(t)(http().delete(u));

  async function grantPairs(userId: string, label: string, pairs: Array<[string, string]>) {
    const roleId = await seedRole(direct, A.companyId, `roomqa-${label}`);
    for (const [action, resource] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      // `access` = cổng nav ⇒ Own theo §9e; 4 cặp còn lại @Company để scope không làm nhiễu phép đo QUYỀN
      // (scope Own/Company đã có spec riêng ở `room-be1-scope` mục B/C).
      const scope = action === "access" ? "Own" : "Company";
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "roomqa1");
    companyIds.push(A.companyId);

    const allPairs: Array<[string, string]> = [
      ACCESS_PAIR,
      ...ROUTE_PAIRS.map((k) => k.split(":") as [string, string]),
    ];

    const fullUser = await seedUser(direct, A.companyId, `full@${A.slug}.test`, hash);
    await grantPairs(fullUser, "full", allPairs);
    tFull = await login(`full@${A.slug}.test`);

    for (const missing of ROUTE_PAIRS) {
      const slug = missing.replace(":", "-");
      const email = `no-${slug}@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      await grantPairs(
        uid,
        `no-${slug}`,
        allPairs.filter(([a, r]) => `${a}:${r}` !== missing),
      );
      tMissing.set(missing, await login(email));
    }

    // Fixture qua API THẬT bằng chủ thể đủ quyền (không seed thẳng DB → giữ FK/audit đúng đường).
    const room = await post(tFull, "/rooms").send({ name: "Phòng QA Matrix", capacity: 10 });
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    roomId = room.body.data.id;

    const start = new Date(Date.now() + 3 * 60 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const booking = await post(tFull, "/room-bookings").send({
      roomId,
      title: "Họp QA Matrix",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });
    expect(booking.status, JSON.stringify(booking.body)).toBe(201);
    bookingId = booking.body.data.id;

    const day = 24 * 60 * 60_000;
    winShort = {
      from: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
      to: new Date(Date.now() + 10 * 60 * 60_000).toISOString(),
    };
    winWeek = {
      from: new Date(Date.now() - day).toISOString(),
      to: new Date(Date.now() + 7 * day).toISOString(),
    };
    winYear = {
      from: new Date(Date.now() - 30 * day).toISOString(),
      to: new Date(Date.now() + 30 * day).toISOString(),
    };
    today = new Date().toISOString().slice(0, 10);
  }, 180_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  /**
   * Bảng route ⇔ cặp. PHẢI phủ ĐỦ 13 route của 3 controller ROOM; mục C đối chiếu số lượng với
   * `@RequirePermission` đọc từ source để route thứ 14 mọc lên KHÔNG lọt lưới (khuôn
   * `route-census-runtime-gate`).
   *
   * `read: true` ⇒ ALLOW đối chứng đòi ĐÚNG 200 (đường đọc không được rơi vào 4xx khác vì lý do khác —
   * cửa sổ sai luật giờ chẳng hạn, mỗi nhóm route một luật, SPEC-14 §13.4).
   */
  type Row = {
    label: string;
    pair: PairKey;
    read?: boolean;
    exec: (t: string) => request.Test;
  };
  const ghost = () => randomUUID();
  const q = (w: { from: string; to: string }) =>
    `from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`;

  const rows = (): Row[] => [
    // ── view:room — 8 route đọc. §11 dùng CHÍNH cặp đọc cho cả lịch, chi tiết lượt và /me/room-bookings
    //    (KHÔNG tách cặp đọc own/all — `read-path-gate-pair-must-match-download-pair`).
    { label: "GET /rooms", pair: "view:room", read: true, exec: (t) => get(t, "/rooms") },
    {
      label: "GET /rooms/availability",
      pair: "view:room",
      read: true,
      exec: (t) => get(t, `/rooms/availability?${q(winShort)}`),
    },
    {
      label: "GET /rooms/usage-summary",
      pair: "view:room",
      read: true,
      exec: (t) => get(t, `/rooms/usage-summary?${q(winYear)}`),
    },
    {
      label: "GET /rooms/:id",
      pair: "view:room",
      read: true,
      exec: (t) => get(t, `/rooms/${roomId}`),
    },
    {
      label: "GET /rooms/:id/bookings",
      pair: "view:room",
      read: true,
      exec: (t) => get(t, `/rooms/${roomId}/bookings?${q(winWeek)}`),
    },
    {
      label: "GET /room-bookings",
      pair: "view:room",
      read: true,
      exec: (t) => get(t, `/room-bookings?${q(winWeek)}`),
    },
    {
      label: "GET /room-bookings/:id",
      pair: "view:room",
      read: true,
      exec: (t) => get(t, `/room-bookings/${bookingId}`),
    },
    {
      label: "GET /me/room-bookings",
      pair: "view:room",
      read: true,
      exec: (t) => get(t, `/me/room-bookings?date=${today}`),
    },

    // ── ghi: body rỗng / id ma ⇒ qua guard rồi dừng ở pipe hoặc service, KHÔNG đổi dữ liệu.
    { label: "POST /rooms", pair: "manage:room", exec: (t) => post(t, "/rooms").send({}) },
    {
      label: "PATCH /rooms/:id",
      pair: "manage:room",
      exec: (t) => patch(t, `/rooms/${ghost()}`).send({ name: "Đổi tên QA" }),
    },
    {
      label: "DELETE /rooms/:id",
      pair: "manage:room",
      exec: (t) => del(t, `/rooms/${ghost()}`),
    },
    {
      label: "POST /room-bookings",
      pair: "book:room",
      exec: (t) => post(t, "/room-bookings").send({}),
    },
    {
      label: "POST /room-bookings/:id/cancel",
      pair: "cancel:room-booking",
      exec: (t) => post(t, `/room-bookings/${ghost()}/cancel`).send({}),
    },
  ];

  // ── A. DENY: chủ thể thiếu ĐÚNG một cặp ⇒ 403 trên mọi route khai cặp đó ───────────────────────

  describe("A. thiếu ĐÚNG một cặp ⇒ 403 trên đúng nhóm route của cặp đó", () => {
    it.each(rows().map((r) => [r.label, r.pair] as const))(
      "%s ⇒ 403 cho chủ thể thiếu %s",
      async (label, pair) => {
        const row = rows().find((r) => r.label === label)!;
        const res = await row.exec(tMissing.get(pair)!);
        expect(res.status, `${label} | ${JSON.stringify(res.body)}`).toBe(403);
      },
    );
  });

  // ── B. ALLOW đối chứng: CÙNG request, chủ thể đủ 5 cặp ⇒ KHÔNG 403 ─────────────────────────────
  //
  // Không có mục này thì mọi ô ở A đều xanh-rỗng: một route hỏng/không tồn tại cũng "403" nếu bị chặn
  // vì lý do khác (memory `deny-cases-vacuous-without-allow-case`).

  describe("B. ALLOW đối chứng cùng request ⇒ KHÔNG 403 (đọc = đúng 200)", () => {
    it.each(rows().map((r) => [r.label] as const))(
      "%s ⇒ không 403 cho chủ thể đủ quyền",
      async (label) => {
        const row = rows().find((r) => r.label === label)!;
        const res = await row.exec(tFull);
        expect(res.status, `${label} | ${JSON.stringify(res.body)}`).not.toBe(403);
        if (row.read) expect(res.status, `${label} | ${JSON.stringify(res.body)}`).toBe(200);
      },
    );

    it("chủ thể thiếu-một-cặp KHÔNG bị hỏng toàn cục: vẫn dùng được route của cặp khác", async () => {
      // Chứng minh 403 ở A đến từ ĐÚNG cặp thiếu, không phải "user này hỏng/không có quyền gì".
      for (const [pair, token] of tMissing) {
        // Thiếu `view` ⇒ đối chứng bằng route GHI (body rỗng ⇒ 400 ở pipe, KHÔNG 403); còn lại dùng GET /rooms.
        const res =
          pair === "view:room"
            ? await post(token, "/room-bookings").send({})
            : await get(token, "/rooms");
        expect(res.status, `no-${pair} | ${JSON.stringify(res.body)}`).not.toBe(403);
      }
    });
  });

  // ── C. Census hai tầng ────────────────────────────────────────────────────────────────────────

  describe("C. census — không route ROOM nào nằm ngoài ma trận, và hai tầng gác CÙNG một cặp", () => {
    /** Cặp khai bằng decorator, đếm theo cặp. */
    function declaredPairs(): Map<string, number> {
      const out = new Map<string, number>();
      for (const f of roomFiles(".controller.ts")) {
        for (const m of readRoomSrc(f).matchAll(
          /@RequirePermission\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g,
        )) {
          const key = `${m[1]}:${m[2]}`;
          out.set(key, (out.get(key) ?? 0) + 1);
        }
      }
      return out;
    }

    it("mỗi @RequirePermission trong src/rooms/*.controller.ts có đúng số hàng ma trận tương ứng", () => {
      const declared = declaredPairs();
      const covered = new Map<string, number>();
      for (const r of rows()) covered.set(r.pair, (covered.get(r.pair) ?? 0) + 1);

      expect(
        [...declared.keys()].sort(),
        "cặp quyền khai trên controller ≠ cặp có trong ma trận",
      ).toEqual([...covered.keys()].sort());
      for (const [pair, n] of declared) {
        expect(
          covered.get(pair),
          `cặp ${pair}: ${n} route khai nhưng ma trận có ${covered.get(pair)}`,
        ).toBe(n);
      }
      // Tổng route ROOM (13, S11-ROOM-BE-1: 8 + 4 + 1) — số neo để route mới không lọt im lặng.
      expect([...declared.values()].reduce((a, b) => a + b, 0)).toBe(rows().length);
      expect(rows().length).toBe(13);
    });

    /**
     * LỆCH MỘT TẦNG. `@RequirePermission` và `RoomAccessService` là hai cổng độc lập cho cùng một
     * route; đổi một bên thì đường HTTP vẫn 403 nhờ bên kia ⇒ A/B ở trên KHÔNG nhìn thấy. Tầng service
     * còn là cổng DUY NHẤT khi ai đó gọi service từ job/bridge (không qua guard) — đúng lý do
     * `RoomBookingReminderJobHandler` tồn tại — nên lệch ở đây là lỗ thật, không phải chuyện thẩm mỹ.
     *
     * Ba chặng: route (decorator + `this.<prop>.<method>`) → phương thức service → `resolve*Actor` →
     * cặp mà resolver đó `resolveAndAssert`. So từng route, KHÔNG so bằng tập: 4 resolver phủ đúng 4
     * cặp nên phép so tập luôn khớp kể cả khi một route trỏ nhầm resolver (bẫy
     * `same-builder-twice-makes-unit-spec-vacuous` ở dạng census).
     */
    it("mỗi route: cặp ở decorator KHỚP cặp mà resolver của service assert (chống lệch một-tầng)", () => {
      // (1) resolver → cặp, đọc từ room-access.service.ts (hằng ROOM/ROOM_BOOKING resolve tại chỗ).
      const accessSrc = readRoomSrc("room-access.service.ts");
      const consts = new Map<string, string>();
      for (const m of accessSrc.matchAll(/^const (\w+) = "([^"]+)";$/gm)) consts.set(m[1], m[2]);
      expect(consts.get("ROOM"), "hằng ROOM đổi tên/biến mất").toBe("room");
      expect(consts.get("ROOM_BOOKING"), "hằng ROOM_BOOKING đổi tên/biến mất").toBe("room-booking");

      const resolverPair = new Map<string, string>();
      const segs = accessSrc.split(/\basync\s+(resolve\w+Actor)\s*\(/);
      for (let i = 1; i < segs.length; i += 2) {
        const m = segs[i + 1].match(
          /resolveAndAssert\(\s*user\.id,\s*user\.companyId,\s*"([^"]+)",\s*(\w+)\s*,?\s*\)/,
        );
        expect(
          m,
          `${segs[i]} không có resolveAndAssert — resolver không còn là cổng ASSERT`,
        ).not.toBe(null);
        resolverPair.set(segs[i], `${m![1]}:${consts.get(m![2]) ?? m![2]}`);
      }
      expect(resolverPair.size, "số resolver assert của RoomAccessService").toBe(4);

      // (2) tên class service → file, để nối `this.<prop>` (kiểu ở constructor) về đúng source.
      const classFile = new Map<string, string>();
      for (const f of roomFiles(".service.ts")) {
        for (const m of readRoomSrc(f).matchAll(/export class (\w+)/g)) classFile.set(m[1], f);
      }

      // (3) mỗi route: cặp decorator + phương thức service được uỷ nhiệm.
      let checked = 0;
      for (const cf of roomFiles(".controller.ts")) {
        const src = readRoomSrc(cf);
        const propClass = new Map<string, string>();
        for (const m of src.matchAll(/private\s+readonly\s+(\w+):\s*(\w+)/g))
          propClass.set(m[1], m[2]);

        const chunks = src.split(/@RequirePermission\(/).slice(1);
        for (const chunk of chunks) {
          const pm = chunk.match(/^\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/);
          expect(pm, `${cf}: @RequirePermission không đọc được cặp`).not.toBe(null);
          const declaredPair = `${pm![1]}:${pm![2]}`;

          const dm = chunk.match(/this\.(\w+)\.(\w+)\(/);
          expect(dm, `${cf}/${declaredPair}: không tìm thấy lời gọi service`).not.toBe(null);
          const svcClass = propClass.get(dm![1]);
          const svcFile = classFile.get(svcClass ?? "");
          expect(svcFile, `${cf}: prop ${dm![1]} không map được về file service`).toBeTruthy();

          const svcSrc = readRoomSrc(svcFile!);
          const parts = svcSrc.split(/\basync\s+(\w+)\s*\(/);
          let body: string | undefined;
          for (let i = 1; i < parts.length; i += 2) if (parts[i] === dm![2]) body = parts[i + 1];
          expect(body, `${svcFile}: không tìm thấy phương thức ${dm![2]}`).toBeTruthy();

          const rm = body!.match(/this\.access\.(resolve\w+Actor)\(/);
          expect(
            rm,
            `${svcFile}#${dm![2]} (${declaredPair}) KHÔNG gọi resolver nào — mất tầng gác thứ hai`,
          ).not.toBe(null);
          expect(
            resolverPair.get(rm![1]),
            `${cf} ${declaredPair} → ${svcClass}#${dm![2]} → ${rm![1]}: hai tầng gác LỆCH cặp`,
          ).toBe(declaredPair);
          checked += 1;
        }
      }
      // Tự-kiểm: đã đi hết 13 route, không "xanh vì vòng lặp rỗng".
      expect(checked, "số route được đối chiếu hai tầng").toBe(rows().length);
    });
  });

  // ── D. `access:room` là cổng NAV, KHÔNG gác API ────────────────────────────────────────────────

  describe("D. access:room = cổng nav (SPEC-14 §11), không phải cổng API", () => {
    it("thiếu access nhưng có view ⇒ GET /rooms vẫn 200 (nav do FE gác); thiếu view ⇒ 403", async () => {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `no-access@${A.slug}.test`;
      const uid = await seedUser(direct, A.companyId, email, hash);
      await grantPairs(
        uid,
        "no-access",
        ROUTE_PAIRS.map((k) => k.split(":") as [string, string]),
      );
      const t = await login(email);
      const res = await get(t, "/rooms");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Vế đối: cổng THẬT của đường đọc là `view` — nhắc lại ở đây để cặp nav/API không lẫn.
      expect((await get(tMissing.get("view:room")!, "/rooms")).status).toBe(403);
    });
  });
});
