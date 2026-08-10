/**
 * S7-CALL-RT-1 — `/ws-call`: allowlist ĐÓNG 8 sự kiện · relay SDP/ICE không đọc-không lưu · chuông đến.
 *
 * Nguồn chuẩn: `DECISIONS-07` §3.1 (R1–R4) · §4 · SPEC-15 §5.1c · §12 (**CHAT-ERR-030**).
 *
 * ⚠️ CHỦ THỂ KHÔNG PHẢI SUPER ADMIN — SA giữ toàn bộ catalog nên mọi cổng quyền đều "đạt" với họ; test
 * bằng SA là tautology (memory `superadmin-not-a-canonical-role`). Mọi actor ở đây là role THƯỜNG.
 *
 * WS thật (`socket.io-client` qua cổng TCP thật) + REST thật (`supertest`) + DB thật. GATE CỨNG
 * `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`).
 */

import "reflect-metadata";

// ⚠️ Đặt TRƯỚC khi AppModule compile: `ChatCallsService` đọc trần lời mời MỘT LẦN lúc dựng provider
// (sửa `process.env` sau `app.init()` là vô tác dụng — bài học đã ghi ở `S7-CALL-BE-1` §5c).
process.env.CHAT_CALL_INVITE_MAX_PER_MIN = "40";
process.env.REALTIME_ENABLED = "true";

import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHAT_CALL_SDP_MAX_LENGTH,
  WS_CALL_NAMESPACE,
  WS_EVENTS,
  WS_NAMESPACE,
} from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { loadEnv } from "../../src/config/env.schema";
import { setupWebSocketAdapter } from "../../src/realtime/setup-websocket-adapter";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
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
const LOGIN_PW = "Passw0rd!callrt1";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/** Bộ cặp đủ để: đọc phòng (vào được `/ws`), quản lý thành viên, và GỌI. */
const CALL_FULL: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
  ["call", "chat-room", "Company"],
];

/** Mọi cặp trên TRỪ `('call','chat-room')` — dựng người "thành viên phòng nhưng không được gọi". */
const NO_CALL_PAIR: PairGrant[] = CALL_FULL.filter(
  ([a, r]) => !(a === "call" && r === "chat-room"),
);

describe.skipIf(!hasLaneDb)("S7-CALL-RT-1 — signalling `/ws-call` (WS thật + DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let port: number;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  const openClients: ClientSocket[] = [];

  let uCaller = "";
  let uCallee = "";
  let uLate = "";
  let uNoCall = "";
  let uB = "";
  let tCaller = "";
  let tCallee = "";
  let tLate = "";
  let tNoCall = "";
  let tB = "";

  const settle = (ms = 250): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: PairGrant[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `callrt1-${label}-${userId.slice(0, 8)}`);
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

  const authPost = (t: string, u: string) =>
    request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

  async function newRoom(token: string, name: string, members: string[]): Promise<string> {
    const res = await authPost(token, "/chat/rooms").send({ name, memberUserIds: members });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function invite(token: string, roomId: string): Promise<string> {
    const res = await authPost(token, `/chat/rooms/${roomId}/calls`).send({ kind: "audio" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  /** Bộ thu sự kiện của MỘT socket — ghi mọi khung để assert cả CÓ lẫn KHÔNG. */
  interface Recorder {
    socket: ClientSocket;
    events: { name: string; payload: Record<string, unknown> }[];
    disconnected: boolean;
    clear(): void;
    waitFor(name: string, ms?: number): Promise<Record<string, unknown>>;
  }

  /** Nối `/ws-call`. `expectFail=true` ⇒ trả về lỗi handshake thay vì Recorder. */
  async function connectCall(token: string): Promise<Recorder> {
    const socket = ioClient(`http://127.0.0.1:${port}/${WS_CALL_NAMESPACE}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    return wrap(socket, [
      "call:sdp-offer",
      "call:sdp-answer",
      "call:ice-candidate",
      "call:media-state",
      "call:screen-state",
      "call:peer-joined",
      "call:peer-left",
      "exception", // ⚠️ khung của filter mặc định Nest — PHẢI không bao giờ tới (V6)
    ]);
  }

  /** Nối `/ws` (kênh CHAT/NOTI) — nơi chuông đến. */
  async function connectChat(token: string): Promise<Recorder> {
    const socket = ioClient(`http://127.0.0.1:${port}/${WS_NAMESPACE}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    return wrap(socket, [WS_EVENTS.CHAT_CALL, WS_EVENTS.NOTIFICATION_NEW]);
  }

  async function wrap(socket: ClientSocket, names: string[]): Promise<Recorder> {
    openClients.push(socket);
    const events: { name: string; payload: Record<string, unknown> }[] = [];
    const rec: Recorder = {
      socket,
      events,
      disconnected: false,
      clear: () => (events.length = 0),
      waitFor: async (name, ms = 2000) => {
        const start = Date.now();
        while (Date.now() - start < ms) {
          const hit = events.find((e) => e.name === name);
          if (hit) return hit.payload;
          await settle(20);
        }
        throw new Error(
          `hết giờ chờ ${name}; đã nhận: ${events.map((e) => e.name).join(",") || "(rỗng)"}`,
        );
      },
    };
    for (const name of names) {
      socket.on(name, (payload: Record<string, unknown>) => events.push({ name, payload }));
    }
    socket.on("disconnect", () => (rec.disconnected = true));
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", reject);
    });
    // Handshake đã join room TRƯỚC `next()` (V9), nhưng vẫn để một nhịp cho adapter Valkey đồng bộ.
    await settle(150);
    return rec;
  }

  /** Nối và KỲ VỌNG bị từ chối ở handshake — trả về thông điệp lỗi. */
  async function expectConnectRefused(token: string): Promise<string> {
    const socket = ioClient(`http://127.0.0.1:${port}/${WS_CALL_NAMESPACE}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    openClients.push(socket);
    return new Promise<string>((resolve, reject) => {
      socket.on("connect_error", (err: Error) => resolve(err.message));
      socket.on("connect", () => reject(new Error("handshake ĐÁNG LẼ phải bị từ chối")));
      setTimeout(() => reject(new Error("hết giờ chờ connect_error")), 3000);
    });
  }

  /** Đếm hàng theo TENANT (int-spec chạy song song cùng lane ⇒ đếm toàn bảng là flake). */
  async function countRows(table: string, companyId: string): Promise<number> {
    const res = await direct.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE company_id = $1`,
      [companyId],
    );
    return res.rows[0].n as number;
  }

  async function securityEvents(
    companyId: string,
  ): Promise<{ user_id: string; payload: Record<string, unknown> }[]> {
    const res = await direct.query(
      `SELECT user_id, payload FROM user_security_events
        WHERE company_id = $1 AND event_type = 'CALL_SIGNALLING_VIOLATION' ORDER BY created_at`,
      [companyId],
    );
    return res.rows;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await setupWebSocketAdapter(app as never, loadEnv());
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "callrt1a");
    B = await seedCompany(direct, "callrt1b");
    companyIds.push(A.companyId, B.companyId);

    const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uCaller = await mk("caller");
    uCallee = await mk("callee");
    uLate = await mk("late");
    uNoCall = await mk("nocall");
    uB = await seedUser(direct, B.companyId, `bob@${B.slug}.test`, hash);

    await grantPairs(A.companyId, uCaller, "caller", CALL_FULL);
    await grantPairs(A.companyId, uCallee, "callee", CALL_FULL);
    await grantPairs(A.companyId, uLate, "late", CALL_FULL);
    await grantPairs(A.companyId, uNoCall, "nocall", NO_CALL_PAIR);
    await grantPairs(B.companyId, uB, "b", CALL_FULL);

    tCaller = await login(A.slug, `caller@${A.slug}.test`);
    tCallee = await login(A.slug, `callee@${A.slug}.test`);
    tLate = await login(A.slug, `late@${A.slug}.test`);
    tNoCall = await login(A.slug, `nocall@${A.slug}.test`);
    tB = await login(B.slug, `bob@${B.slug}.test`);
  }, 180_000);

  afterAll(async () => {
    while (openClients.length) openClients.pop()?.disconnect();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
    await app?.close();
  });

  // ─── R1/D2 — cổng handshake ──────────────────────────────────────────────────

  it("CA 13 — thiếu cặp `('call','chat-room')` ⇒ handshake BỊ TỪ CHỐI (fail-CLOSED)", async () => {
    const msg = await expectConnectRefused(tNoCall);
    expect(msg).toBe("forbidden");
  });

  it("CA 13b — POSITIVE CONTROL: người CÓ cặp nối được (nếu không, ca trên xanh rỗng)", async () => {
    const rec = await connectCall(tCaller);
    expect(rec.socket.connected).toBe(true);
    rec.socket.disconnect();
  });

  it("CA 15 — R1 chiều ngược: `/ws` KHÔNG nhận tín hiệu gọi (0 relay, 0 sự kiện an ninh)", async () => {
    const room = await newRoom(tCaller, "R-ws", [uCallee]);
    const callId = await invite(tCaller, room);

    const before = (await securityEvents(A.companyId)).length;
    const chat = await connectChat(tCaller);
    const callee = await connectCall(tCallee);

    // `/ws` không có `@SubscribeMessage` nào — khung này rơi vào hư không, KHÔNG được relay và cũng
    // KHÔNG được ghi sự kiện an ninh (không có `onAny` ở namespace đó; grep tĩnh không chứng minh nổi).
    chat.socket.emit("call:sdp-offer", { callId, toUserId: uCallee, sdp: sdpFixture() });
    await settle(400);

    expect(callee.events).toEqual([]);
    expect(chat.socket.connected).toBe(true);
    expect((await securityEvents(A.companyId)).length).toBe(before);
  });

  // ─── R3 — relay, và bằng chứng "không ghi gì" ────────────────────────────────

  it("CA 7/8/17 — hai người TRONG cuộc gọi trao đổi được; `fromUserId` do SERVER gán, bộ khoá CHÍNH XÁC", async () => {
    const room = await newRoom(tCaller, "R-relay", [uCallee]);
    const callId = await invite(tCaller, room);

    const a = await connectCall(tCaller);
    const b = await connectCall(tCallee);
    a.socket.emit("call:join", { callId });
    b.socket.emit("call:join", { callId });
    await settle(300);

    // Người vào sau được báo cho người đã ở trong phiên.
    const joined = a.events.find(
      (e) => e.name === "call:peer-joined" && e.payload.userId === uCallee,
    );
    expect(joined, "A phải thấy B vào phiên").toBeTruthy();

    const sdp = sdpFixture();
    // Client CỐ Ý nhét `fromUserId` giả — Zod strip, server gán id THẬT.
    a.socket.emit("call:sdp-offer", {
      callId,
      toUserId: uCallee,
      sdp,
      fromUserId: uLate,
    });
    const offer = await b.waitFor("call:sdp-offer");
    expect(Object.keys(offer).sort()).toEqual(["callId", "fromUserId", "sdp"]);
    expect(offer.fromUserId).toBe(uCaller);
    expect(offer.sdp).toBe(sdp);

    b.socket.emit("call:sdp-answer", { callId, toUserId: uCaller, sdp });
    const answer = await a.waitFor("call:sdp-answer");
    expect(answer.fromUserId).toBe(uCallee);

    b.socket.emit("call:ice-candidate", {
      callId,
      toUserId: uCaller,
      candidate: "candidate:1 1 UDP",
    });
    const ice = await a.waitFor("call:ice-candidate");
    expect(Object.keys(ice).sort()).toEqual(["callId", "candidate", "fromUserId"]);
  });

  it("CA 6 — MỘT phiên signalling đủ 8 sự kiện sinh **0 hàng DB** (bằng chứng R3)", async () => {
    const room = await newRoom(tCaller, "R-nowrite", [uCallee]);
    const callId = await invite(tCaller, room);

    const snapshot = async () => ({
      calls: await countRows("chat_calls", A.companyId),
      participants: await countRows("chat_call_participants", A.companyId),
      audit: await countRows("audit_logs", A.companyId),
      security: await countRows("user_security_events", A.companyId),
    });

    const a = await connectCall(tCaller);
    const b = await connectCall(tCallee);
    a.socket.emit("call:join", { callId });
    b.socket.emit("call:join", { callId });
    await settle(300);

    const before = await snapshot();

    a.socket.emit("call:sdp-offer", { callId, toUserId: uCallee, sdp: sdpFixture() });
    b.socket.emit("call:sdp-answer", { callId, toUserId: uCaller, sdp: sdpFixture() });
    for (let i = 0; i < 3; i += 1) {
      a.socket.emit("call:ice-candidate", { callId, toUserId: uCallee, candidate: `cand-${i}` });
    }
    a.socket.emit("call:media-state", { callId, micOn: false, camOn: true });
    a.socket.emit("call:screen-state", { callId, sharing: true });
    a.socket.emit("call:ping", { callId });
    a.socket.emit("call:leave", { callId });
    await settle(500);

    expect(await snapshot()).toEqual(before);
    expect(a.socket.connected, "phiên hợp lệ KHÔNG bị ngắt").toBe(true);
  });

  it("CA ALLOW trickle — 40 ICE candidate liên tiếp KHÔNG bị bỏ khung nào (trần không bóp chết cuộc gọi)", async () => {
    const room = await newRoom(tCaller, "R-trickle", [uCallee]);
    const callId = await invite(tCaller, room);
    const a = await connectCall(tCaller);
    const b = await connectCall(tCallee);
    a.socket.emit("call:join", { callId });
    b.socket.emit("call:join", { callId });
    await settle(300);
    b.clear();

    for (let i = 0; i < 40; i += 1) {
      a.socket.emit("call:ice-candidate", { callId, toUserId: uCallee, candidate: `cand-${i}` });
    }
    await settle(800);
    expect(b.events.filter((e) => e.name === "call:ice-candidate")).toHaveLength(40);
  });

  // ─── R2 + lớp A/B/C ──────────────────────────────────────────────────────────

  it("CA 3 — người NGOÀI cuộc gọi (thành viên phòng, ĐỦ quyền) emit sdp-offer ⇒ 0 relay + 1 sự kiện an ninh + NGẮT", async () => {
    // ⚠️ `uLate` phải có ĐỦ cặp `('call','chat-room')`, nếu không handshake chặn trước và ca này đo nhầm
    // hàng rào (đúng lỗi mà `S7-CALL-BE-1` §5b đã phải viết lại một ca vì nó).
    const room = await newRoom(tCaller, "R-outsider", [uCallee]);
    const callId = await invite(tCaller, room);

    // Vào phòng SAU khi cuộc gọi bắt đầu ⇒ là thành viên phòng nhưng KHÔNG có hàng participant.
    const add = await authPost(tCaller, `/chat/rooms/${room}/members`).send({
      userId: uLate,
      role: "member",
    });
    expect(add.status, JSON.stringify(add.body)).toBe(200);

    const victim = await connectCall(tCallee);
    victim.socket.emit("call:join", { callId });
    await settle(200);
    victim.clear();

    const before = (await securityEvents(A.companyId)).filter((e) => e.user_id === uLate).length;
    const intruder = await connectCall(tLate);
    intruder.socket.emit("call:sdp-offer", { callId, toUserId: uCallee, sdp: sdpFixture() });
    await settle(600);

    expect(victim.events, "KHÔNG relay cho ai").toEqual([]);
    expect(intruder.disconnected, "socket dò cửa phải bị NGẮT").toBe(true);

    const rows = (await securityEvents(A.companyId)).filter((e) => e.user_id === uLate);
    expect(rows.length).toBe(before + 1);
    const payload = rows[rows.length - 1].payload;
    expect(payload).toEqual({
      ns: "ws-call",
      event: "call:sdp-offer",
      reason: "not_participant",
      code: "CHAT-ERR-030",
    });
  });

  it("CA 16 — `toUserId` là thành viên phòng nhưng ∉ cuộc gọi ⇒ không relay", async () => {
    const room = await newRoom(tCaller, "R-peer", [uCallee]);
    const callId = await invite(tCaller, room);
    await authPost(tCaller, `/chat/rooms/${room}/members`).send({ userId: uLate, role: "member" });

    const late = await connectCall(tLate);
    const a = await connectCall(tCaller);
    a.socket.emit("call:sdp-offer", { callId, toUserId: uLate, sdp: sdpFixture() });
    await settle(500);

    expect(late.events).toEqual([]);
    expect(a.disconnected, "người gửi cố relay RA NGOÀI cuộc gọi ⇒ bị ngắt").toBe(true);
  });

  it("CA 4 — cross-tenant: `callId` của công ty A + socket công ty B ⇒ 0 relay, 0 hàng đổi ở A", async () => {
    const room = await newRoom(tCaller, "R-tenant", [uCallee]);
    const callId = await invite(tCaller, room);

    const victim = await connectCall(tCallee);
    victim.socket.emit("call:join", { callId });
    await settle(200);
    victim.clear();

    const beforeA = await countRows("user_security_events", A.companyId);
    const intruder = await connectCall(tB);
    intruder.socket.emit("call:sdp-offer", { callId, toUserId: uCallee, sdp: sdpFixture() });
    await settle(600);

    expect(victim.events).toEqual([]);
    expect(intruder.disconnected).toBe(true);
    // Dấu vết ghi ở tenant CỦA KẺ GỬI, không phải tenant nạn nhân — và A không đổi hàng nào.
    expect(await countRows("user_security_events", A.companyId)).toBe(beforeA);
    expect(
      (await securityEvents(B.companyId)).filter((e) => e.user_id === uB).length,
    ).toBeGreaterThan(0);
  });

  it("CA 5 — sự kiện NGOÀI allowlist ⇒ CHAT-ERR-030 + ngắt; tên sự kiện bị lọc thành `unknown`", async () => {
    const rec = await connectCall(tCallee);
    const before = (await securityEvents(A.companyId)).filter((e) => e.user_id === uCallee).length;

    rec.socket.emit("call:evil", { anything: "x" });
    await settle(600);

    expect(rec.disconnected).toBe(true);
    const rows = (await securityEvents(A.companyId)).filter((e) => e.user_id === uCallee);
    expect(rows.length).toBe(before + 1);
    expect(rows[rows.length - 1].payload).toEqual({
      ns: "ws-call",
      event: "unknown",
      reason: "not_allowlisted",
      code: "CHAT-ERR-030",
    });
  });

  it("CA 5b/V3 — `sdp` vượt trần ⇒ ngắt, và payload forensic KHÔNG chứa một byte SDP nào", async () => {
    const room = await newRoom(tCaller, "R-toolong", [uCallee]);
    const callId = await invite(tCaller, room);

    const rec = await connectCall(tCaller);
    const marker = "MARKER-SDP-DO-NOT-STORE";
    const huge = marker + "x".repeat(CHAT_CALL_SDP_MAX_LENGTH + 1);
    rec.socket.emit("call:sdp-offer", { callId, toUserId: uCallee, sdp: huge });
    await settle(700);

    expect(rec.disconnected).toBe(true);
    const rows = (await securityEvents(A.companyId)).filter((e) => e.user_id === uCaller);
    const last = rows[rows.length - 1];
    expect(last.payload).toMatchObject({ reason: "too_long", code: "CHAT-ERR-030" });
    // ⚠️ Vế QUAN TRỌNG NHẤT của ca này: lưu SDP vào bảng append-only làm `CHAT-DEC-020` hết hiệu lực.
    expect(JSON.stringify(last.payload)).not.toContain(marker);
    const dump = await direct.query(
      `SELECT payload::text AS t FROM user_security_events WHERE company_id = $1`,
      [A.companyId],
    );
    for (const row of dump.rows) expect(row.t).not.toContain(marker);
  });

  it("CA 9 — LỚP C: ICE tới SAU khi cuộc gọi kết thúc ⇒ bỏ im lặng, 0 sự kiện an ninh, socket VẪN SỐNG", async () => {
    const room = await newRoom(tCaller, "R-race", [uCallee]);
    const callId = await invite(tCaller, room);

    const a = await connectCall(tCaller);
    a.socket.emit("call:join", { callId });
    await settle(200);

    const hang = await authPost(tCaller, `/chat/calls/${callId}/hangup`).send({});
    expect(hang.status, JSON.stringify(hang.body)).toBe(200);

    const before = (await securityEvents(A.companyId)).filter((e) => e.user_id === uCaller).length;
    a.socket.emit("call:ice-candidate", { callId, toUserId: uCallee, candidate: "late-cand" });
    await settle(500);

    // Đây là ca DUY NHẤT chứng minh lớp B và lớp C thật sự tách nhau.
    //
    // ⚠️ Ca này ĐÃ ĐỎ một lần và đó là một BUG THẬT, không phải test sai: sau `hangup`,
    // `setParticipantOutcome` ghi `outcome='left'` cho actor ⇒ họ rơi khỏi `activeUserIds` ⇒ vị từ ban
    // đầu (`actorIsActive`) xếp NGƯỜI VỪA GÁC MÁY vào nhóm dò cửa. Vá bằng vị từ thứ hai
    // (`actorIsParticipant`, xem `chat-call-signal.service.ts`).
    expect(a.disconnected, "người dùng hợp lệ KHÔNG bị ngắt vì một khung đến muộn").toBe(false);
    expect((await securityEvents(A.companyId)).filter((e) => e.user_id === uCaller).length).toBe(
      before,
    );

    // Vế ĐỐI CHỨNG — chống nới lỏng quá tay: người CHƯA TỪNG được mời vẫn là lớp B trên chính cuộc gọi
    // đã kết thúc đó. Thiếu vế này, một bản vá "cuộc gọi chết thì bỏ qua hết" sẽ xanh, và nó mở đúng
    // một oracle "cuộc gọi này còn sống không" cho người ngoài.
    await authPost(tCaller, `/chat/rooms/${room}/members`).send({ userId: uLate, role: "member" });
    const beforeLate = (await securityEvents(A.companyId)).filter(
      (e) => e.user_id === uLate,
    ).length;
    const late = await connectCall(tLate);
    late.socket.emit("call:ice-candidate", { callId, toUserId: uCaller, candidate: "probe-cand" });
    await settle(600);

    expect(late.disconnected, "người ngoài vẫn bị ngắt dù cuộc gọi đã kết thúc").toBe(true);
    expect((await securityEvents(A.companyId)).filter((e) => e.user_id === uLate).length).toBe(
      beforeLate + 1,
    );
  });

  // ─── vế B — chuông đến trên `/ws` ────────────────────────────────────────────

  it("CA 11 — mời ⇒ người được gọi nhận `chat:call{ringing}` trên `/ws`; người NGOÀI phòng: 0 sự kiện", async () => {
    const callee = await connectChat(tCallee);
    const stranger = await connectChat(tLate);
    const room = await newRoom(tCaller, "R-ring", [uCallee]);

    const callId = await invite(tCaller, room);
    const evt = await callee.waitFor(WS_EVENTS.CHAT_CALL);

    expect(evt).toMatchObject({ callId, roomId: room, action: "ringing", status: "ringing" });
    expect(Object.keys(evt).sort()).toEqual([
      "action",
      "callId",
      "initiatorUserId",
      "kind",
      "roomId",
      "startedAt",
      "status",
    ]);
    expect(stranger.events.filter((e) => e.name === WS_EVENTS.CHAT_CALL)).toEqual([]);

    // Mốc kết thúc cũng phải tới — nếu không FE treo khung "đang gọi" vĩnh viễn.
    callee.clear();
    await authPost(tCallee, `/chat/calls/${callId}/reject`).send({});
    const ended = await callee.waitFor(WS_EVENTS.CHAT_CALL);
    expect(ended).toMatchObject({ callId, action: "rejected", status: "rejected" });
  });

  // ─── V1 — `/ws-call` nằm trong đường thu hồi phiên ───────────────────────────

  it("CA 19 — thu hồi phiên cắt CẢ `/ws-call` (khoá tài khoản không được để socket gọi sống sót)", async () => {
    const rec = await connectCall(tCallee);
    expect(rec.socket.connected).toBe(true);

    // Gọi thẳng cổng mà đường khoá/xoá tài khoản dùng (`AuthUsersService.lock` → `severUserSessions`).
    // Đo tại cổng đó thay vì qua REST vì ca này chứng minh MỘT tính chất: cổng phủ cả hai namespace.
    app.get(RealtimeEmitterService).severUserSessions(A.companyId, uCallee);
    await settle(400);

    expect(rec.disconnected, "socket /ws-call phải bị đóng cùng phiên").toBe(true);
  });
});

/**
 * Chuỗi SDP giả — GHÉP CHUỖI, không viết literal high-entropy: literal như thế trip rule gitleaks
 * `generic-api-key` và làm ĐỎ OAN mọi PR của nhánh, kể cả sau khi đã sửa (leak nằm trong lịch sử nhánh —
 * memory `gitleaks-join-not-enough-amend-required`).
 */
function sdpFixture(): string {
  return ["v=0", `o=- ${randomUUID()} 2 IN IP4 127.0.0.1`, "s=-", "t=0 0", "a=sendrecv"].join(
    "\r\n",
  );
}
