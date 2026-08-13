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
import type { Namespace } from "socket.io";
import request from "supertest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { CallSignallingGateway } from "../../src/realtime/call-signalling.gateway";
import { ChatCallSignalService } from "../../src/chat/chat-call-signal.service";
import { PermissionService } from "../../src/permission/permission.service";
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
  let uBurst = "";
  let uQuota = "";
  // ─── S7-CALL-QA-1 — mỗi NHÓM ca mới một người RIÊNG ────────────────────────
  // ⚠️ KHÔNG dùng lại `uCaller`/`uCallee`: trần bắt tay là 30/phút/NGƯỜI
  // (`chat-call-signal-deny.ts:128`) và `uCaller` đã dùng ~8 lần trong <60 s. Thêm ~10 ca nữa lên cùng
  // người là chạm trần ⇒ **đỏ ngẫu nhiên ở ca KHÁC** (memory `per-user-rate-limit-throttles-own-int-spec`).
  let uFilter = "";
  let uLadder = "";
  let uLife = "";
  let uClock = "";
  let uClockPeer = "";
  let uRemove = "";
  let uRemovePeer = "";
  let uLocked = "";
  let uClassC = "";
  let uTwo = "";
  let uTwoPeer = "";
  // ─── S7-CALL-RT-FIX-2 ───────────────────────────────────────────────────────
  // Người NGOÀI phòng, chưa từng được mời — ca ĐỐI CHỨNG 1b (§5.2), thứ DUY NHẤT ép được ranh giới
  // lớp B ở nhánh mà `wasCallParticipant` vừa sửa.
  let uOutsider = "";
  let uMedia = "";
  let uMediaPeer = "";
  // Ba người dùng cho các ca CHỈ-REST (trạng thái DB sau khi rời/bị gỡ). Không nối socket ⇒ không tiêu
  // trần bắt tay 30/phút ⇒ dùng lại được cho NHIỀU ca, mỗi ca một PHÒNG riêng.
  let uExit = "";
  let uExitPeer = "";
  let uExitThird = "";
  let tCaller = "";
  let tCallee = "";
  let tLate = "";
  let tNoCall = "";
  let tB = "";
  let tBurst = "";
  let tQuota = "";
  let tFilter = "";
  let tLadder = "";
  let tClock = "";
  let tClockPeer = "";
  let tRemove = "";
  let tRemovePeer = "";
  let tLocked = "";
  let tClassC = "";
  let tTwo = "";
  let tTwoPeer = "";
  let tOutsider = "";
  let tMedia = "";
  let tMediaPeer = "";
  let tExit = "";
  let tExitPeer = "";
  let tExitThird = "";

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
      "call:pong",
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

  // ─── S7-CALL-RT-FIX-2 — đọc TRẠNG THÁI DB sau khi rời/bị gỡ khỏi phòng ──────

  /** Hàng participant của MỘT cuộc gọi, đủ để phân biệt `left` (có `left_at`) với `missed` (không). */
  async function participantsOf(
    callId: string,
  ): Promise<
    { user_id: string; outcome: string | null; joined_at: Date | null; left_at: Date | null }[]
  > {
    const res = await direct.query(
      `SELECT user_id, outcome, joined_at, left_at FROM chat_call_participants
        WHERE call_id = $1 ORDER BY user_id`,
      [callId],
    );
    return res.rows;
  }

  /** Dòng audit `chat.call.participant_closed` của một tenant (append-only ⇒ chỉ tăng). */
  async function participantClosedAudit(companyId: string): Promise<
    {
      object_id: string;
      actor_user_id: string | null;
      new_values: Record<string, unknown> | null;
    }[]
  > {
    // ⚠️ Cột là `new_values` (đường v2 của `AuditService.record`), KHÔNG phải `after` (đường v1 mà vài
    // int-spec AUTH đang đọc). Đọc nhầm cột trả `null` ⇒ một assert nội dung XANH-RỖNG.
    const res = await direct.query(
      `SELECT object_id, actor_user_id, new_values FROM audit_logs
        WHERE company_id = $1 AND action = 'chat.call.participant_closed' ORDER BY created_at`,
      [companyId],
    );
    return res.rows;
  }

  async function callStatus(callId: string): Promise<string> {
    const res = await direct.query(`SELECT status FROM chat_calls WHERE id = $1`, [callId]);
    return res.rows[0]?.status as string;
  }

  const removeMember = (token: string, roomId: string, userId: string) =>
    request(app.getHttpServer())
      .delete(`/chat/rooms/${roomId}/members/${userId}`)
      .set("Authorization", `Bearer ${token}`);

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
    // Hai ca hạn mức đốt bucket của chính người thực hiện ⇒ phải có người RIÊNG, nếu không chúng làm
    // các ca khác đỏ ở chỗ khó đoán (`per-user-rate-limit-throttles-own-int-spec`).
    uBurst = await mk("burst");
    uQuota = await mk("quota");
    uFilter = await mk("filter");
    uLadder = await mk("ladder");
    uLife = await mk("life");
    uClock = await mk("clock");
    uClockPeer = await mk("clockpeer");
    uRemove = await mk("remove");
    uRemovePeer = await mk("removepeer");
    uLocked = await mk("locked");
    uClassC = await mk("classc");
    uTwo = await mk("two");
    uTwoPeer = await mk("twopeer");
    uOutsider = await mk("outsider");
    uMedia = await mk("media");
    uMediaPeer = await mk("mediapeer");
    uExit = await mk("exit");
    uExitPeer = await mk("exitpeer");
    uExitThird = await mk("exitthird");
    uB = await seedUser(direct, B.companyId, `bob@${B.slug}.test`, hash);

    await grantPairs(A.companyId, uCaller, "caller", CALL_FULL);
    await grantPairs(A.companyId, uCallee, "callee", CALL_FULL);
    await grantPairs(A.companyId, uLate, "late", CALL_FULL);
    await grantPairs(A.companyId, uNoCall, "nocall", NO_CALL_PAIR);
    await grantPairs(A.companyId, uBurst, "burst", CALL_FULL);
    await grantPairs(A.companyId, uQuota, "quota", CALL_FULL);
    await grantPairs(B.companyId, uB, "b", CALL_FULL);
    for (const [id, label] of [
      [uFilter, "filter"],
      [uLadder, "ladder"],
      [uLife, "life"],
      [uClock, "clock"],
      [uClockPeer, "clockpeer"],
      [uRemove, "remove"],
      [uRemovePeer, "removepeer"],
      [uLocked, "locked"],
      [uClassC, "classc"],
      [uTwo, "two"],
      [uTwoPeer, "twopeer"],
      [uOutsider, "outsider"],
      [uMedia, "media"],
      [uMediaPeer, "mediapeer"],
      [uExit, "exit"],
      [uExitPeer, "exitpeer"],
      [uExitThird, "exitthird"],
    ] as const) {
      await grantPairs(A.companyId, id, label, CALL_FULL);
    }

    tCaller = await login(A.slug, `caller@${A.slug}.test`);
    tCallee = await login(A.slug, `callee@${A.slug}.test`);
    tLate = await login(A.slug, `late@${A.slug}.test`);
    tNoCall = await login(A.slug, `nocall@${A.slug}.test`);
    tBurst = await login(A.slug, `burst@${A.slug}.test`);
    tQuota = await login(A.slug, `quota@${A.slug}.test`);
    tFilter = await login(A.slug, `filter@${A.slug}.test`);
    tLadder = await login(A.slug, `ladder@${A.slug}.test`);
    tClock = await login(A.slug, `clock@${A.slug}.test`);
    tClockPeer = await login(A.slug, `clockpeer@${A.slug}.test`);
    tRemove = await login(A.slug, `remove@${A.slug}.test`);
    tRemovePeer = await login(A.slug, `removepeer@${A.slug}.test`);
    tLocked = await login(A.slug, `locked@${A.slug}.test`);
    tClassC = await login(A.slug, `classc@${A.slug}.test`);
    tTwo = await login(A.slug, `two@${A.slug}.test`);
    tTwoPeer = await login(A.slug, `twopeer@${A.slug}.test`);
    tOutsider = await login(A.slug, `outsider@${A.slug}.test`);
    tMedia = await login(A.slug, `media@${A.slug}.test`);
    tMediaPeer = await login(A.slug, `mediapeer@${A.slug}.test`);
    tExit = await login(A.slug, `exit@${A.slug}.test`);
    tExitPeer = await login(A.slug, `exitpeer@${A.slug}.test`);
    tExitThird = await login(A.slug, `exitthird@${A.slug}.test`);
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

  // ─── D6 — hai hàng rào chống bơm bảng append-only ────────────────────────────

  it("CA burst (V4) — 12 khung vi phạm KHÔNG await giữa các lần ⇒ ĐÚNG 1 hàng an ninh", async () => {
    // ⚠️ Ca này đo một bất biến THỨ TỰ ĐỒNG BỘ, không phải một hành vi: `socket.io#onevent` gọi MỌI
    // listener `onAny` **đồng bộ** cho từng gói trong cùng một lượt đọc. Nếu cờ `violated` được đặt SAU
    // một `await`, cả 12 khung chạy hết trước khi lần ghi đầu tiên resolve ⇒ 12 hàng append-only từ MỘT
    // kết nối, và `disconnect()` tới quá muộn.
    //
    // Vì thế PHẢI `emit` liên tiếp KHÔNG await giữa các lần — thêm `await` vào vòng lặp là ca test tự
    // làm mình xanh.
    const before = (await securityEvents(A.companyId)).filter((e) => e.user_id === uBurst).length;
    const rec = await connectCall(tBurst);
    for (let i = 0; i < 12; i += 1) rec.socket.emit(`call:evil-${i}`, { i });
    await settle(900);

    expect(rec.disconnected).toBe(true);
    const rows = (await securityEvents(A.companyId)).filter((e) => e.user_id === uBurst);
    expect(rows.length, "trần 1 hàng/kết nối").toBe(before + 1);
  });

  it("CA 10 — 7 kết nối liên tiếp cùng vi phạm ⇒ ≤5 hàng (trần theo NGƯỜI)", async () => {
    // Lớp thứ HAI của D6: cờ 1-hàng/kết-nối không chặn được kẻ nối lại vòng lặp. Không có ca này thì
    // đường ghi `user_security_events` (append-only, KHÔNG có job dọn) chỉ còn một hàng rào có bằng chứng.
    const before = (await securityEvents(A.companyId)).filter((e) => e.user_id === uQuota).length;

    for (let i = 0; i < 7; i += 1) {
      const rec = await connectCall(tQuota);
      rec.socket.emit("call:evil", { i });
      await settle(350);
      expect(rec.disconnected, `lần ${i}: vượt trần vẫn PHẢI ngắt`).toBe(true);
    }

    const rows = (await securityEvents(A.companyId)).filter((e) => e.user_id === uQuota);
    const written = rows.length - before;
    // Ngắt thì lần nào cũng ngắt; GHI thì dừng ở trần. Hai vế phải tách nhau — nếu vượt trần mà cũng
    // thôi ngắt thì hàng rào tự mở cửa cho kẻ đã chạm trần.
    expect(written, "ghi tối đa CHAT_CALL_VIOLATION_MAX_PER_MIN = 5").toBeLessThanOrEqual(5);
    expect(written, "positive control: có ghi thật, không phải 0 vì lý do khác").toBeGreaterThan(0);
  });

  it("CA V5 — ack do CLIENT gắn không bao giờ nhận dữ liệu; chỉ `call:ping` trả về, đúng 1 khoá", async () => {
    // ⚠️ Giá trị TRẢ VỀ của handler là một đường ra THẬT: `io-adapter.js` gọi `ack(response)` (ack lấy từ
    // đối số cuối của khung do CLIENT gửi) hoặc `socket.emit(response.event, response.data)`. Cả hai
    // KHÔNG đi qua `RealtimeEmitterService`. Một handler lỡ `return access`/`return participants` là rò
    // thẳng `visibleFromSeq`/`mutedUntil` của actor, hoặc `outcome`/`joinedAt` của NGƯỜI KHÁC.
    const room = await newRoom(tCaller, "R-ack", [uCallee]);
    const callId = await invite(tCaller, room);
    const a = await connectCall(tCaller);
    a.socket.emit("call:join", { callId });
    await settle(250);

    const acks: unknown[] = [];
    const ack = (v: unknown): void => {
      acks.push(v);
    };
    a.socket.emit("call:join", { callId }, ack);
    a.socket.emit("call:leave", { callId }, ack);
    a.socket.emit("call:sdp-offer", { callId, toUserId: uCallee, sdp: sdpFixture() }, ack);
    a.socket.emit("call:sdp-answer", { callId, toUserId: uCallee, sdp: sdpFixture() }, ack);
    a.socket.emit("call:ice-candidate", { callId, toUserId: uCallee, candidate: "c1" }, ack);
    a.socket.emit("call:media-state", { callId, micOn: true, camOn: false }, ack);
    a.socket.emit("call:screen-state", { callId, sharing: false }, ack);
    await settle(600);

    expect(acks, "7 handler không-ping KHÔNG được trả gì qua ack").toEqual([]);

    a.socket.emit("call:ping", { callId }, ack);
    const pong = await a.waitFor("call:pong");
    expect(Object.keys(pong), "pong đúng MỘT khoá").toEqual(["callId"]);
    expect(pong.callId).toBe(callId);
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

  // ═══ S7-CALL-QA-1 — nhóm A/B/C/D ═══════════════════════════════════════════════════════════════════
  //
  // Đo 11/08/2026: `call-signalling.gateway.ts` branch **68.67%**, `call-signalling.filter.ts` **21.73%
  // stmts** (thân `catch()` chưa từng chạy) ⇒ vế "gateway signalling CAO HƠN 80" của `done_when` #3 CHƯA
  // đạt. Các ca dưới đây lấp phần int dựng được; phần int KHÔNG dựng được nằm ở
  // `src/realtime/call-signalling.{gateway,filter}.spec.ts` (nhóm B4/B5/C2/D1–D4).

  /** Ký token THẬT bằng chính secret của harness — KHÔNG gõ literal (gitleaks). */
  function signToken(userId: string, email: string, opts: { expiresIn?: number } = {}): string {
    const payload = { sub: userId, companyId: A.companyId, email, aud: "tenant" };
    const secret = loadEnv().JWT_SECRET;
    // Thắt kiểu ở BIÊN, không ép kiểu: `JWT_SECRET` là optional trong env schema. Thiếu nó thì mọi ca
    // nhóm B/C1 dựng token sai secret ⇒ tất cả trả `"unauthorized"` và **xanh oan** (đúng bẫy mà §2
    // nhóm B cảnh báo). Dừng ồn ào là cách duy nhất phân biệt "harness hỏng" với "gateway từ chối đúng".
    if (!secret) throw new Error("harness: thiếu JWT_SECRET — không ký được token, ca sẽ xanh oan");
    return opts.expiresIn === undefined
      ? jwt.sign(payload, secret, { algorithm: "HS256" })
      : jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: opts.expiresIn });
  }

  /** Nối `/ws-call` ở mức THÔ (tự chọn `auth`/header) — dùng cho thang từ chối nhóm B. */
  function rawCallSocket(opts: {
    auth?: Record<string, unknown>;
    headers?: Record<string, string>;
  }): ClientSocket {
    const socket = ioClient(`http://127.0.0.1:${port}/${WS_CALL_NAMESPACE}`, {
      auth: opts.auth ?? {},
      extraHeaders: opts.headers,
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    openClients.push(socket);
    return socket;
  }

  async function refusedRaw(opts: {
    auth?: Record<string, unknown>;
    headers?: Record<string, string>;
  }): Promise<string> {
    const socket = rawCallSocket(opts);
    return new Promise<string>((resolve, reject) => {
      socket.on("connect_error", (err: Error) => resolve(err.message));
      socket.on("connect", () => reject(new Error("handshake ĐÁNG LẼ phải bị từ chối")));
      setTimeout(() => reject(new Error("hết giờ chờ connect_error")), 3000);
    });
  }

  /** Nối và KỲ VỌNG đi qua — trả về chính socket (đã connected). */
  async function expectRawConnects(opts: {
    auth?: Record<string, unknown>;
    headers?: Record<string, string>;
  }): Promise<ClientSocket> {
    const socket = rawCallSocket(opts);
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", (e: Error) =>
        reject(new Error(`ĐÁNG LẼ phải nối được, lại bị từ chối: ${e.message}`)),
      );
      setTimeout(() => reject(new Error("hết giờ chờ connect")), 3000);
    });
    return socket;
  }

  /**
   * Làm CŨ trạng thái phiên phía SERVER của một user — thay cho việc dịch đồng hồ.
   *
   * ┌─ VÌ SAO KHÔNG DÙNG `vi.setSystemTime` NHƯ PLAN §3.2 ĐỀ RA ──────────────────────────────────────┐
   * │ Đo được 11/08/2026, có nguồn: `socket.io-client@4.8.3/build/cjs/socket.js:271` tính             │
   * │   `isConnected = this.connected && !this.io.engine._hasPingExpired()`                            │
   * │ và `engine.io-client@6.6.5/build/cjs/socket.js:393-404` `_hasPingExpired()` so **`Date.now() >   │
   * │ _pingTimeoutTime`** (mốc dựng từ `pingInterval + pingTimeout`, mặc định 45 s).                    │
   * │                                                                                                  │
   * │ ⇒ Mọi `emit()` SAU một cú nhảy `Date` lớn hơn 45 s: gói bị đẩy vào `sendBuffer` và **KHÔNG BAO   │
   * │ GIỜ RỜI MÁY**, còn client tự đóng với lý do `"ping timeout"`. Tức ca "dịch đồng hồ rồi gửi khung"│
   * │ đo TRANSPORT CỦA CHÍNH NÓ, không đo `accept()` — bản đầu của C3 XANH OAN đúng như thế, và C4 thì │
   * │ đỏ với `can()` **chưa từng được gọi**. Oracle thứ hai của C4 (plan §2) là thứ bắt được.          │
   * │                                                                                                  │
   * │ Dịch đồng hồ vẫn dùng được cho hẹn giờ THUẦN SERVER; nó chỉ hỏng khi client phải GỬI. Ở đây làm  │
   * │ cũ đúng hai trường mà bước (2)/(3) của `accept()` đọc — cùng hiệu ứng "thời gian đã trôi", không │
   * │ đụng vào đồng hồ của socket.io.                                                                  │
   * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  function ageServerState(
    rec: Recorder,
    mutate: (state: { tokenExpSec: number; permissionCheckedAtMs: number }) => void,
  ): void {
    // ⚠️ Khoá theo **socket id**, KHÔNG theo userId: một người có thể có NHIỀU socket còn sống trong file
    // này (vd `uClassC` giữ socket của D5, vì D5 chứng minh nó KHÔNG bị ngắt). `find()` theo userId trả
    // socket ĐẦU TIÊN ⇒ làm cũ NHẦM phiên, khung của phiên đang đo không bao giờ chạm nhánh cần đo, và
    // ca đỏ ở một chỗ không liên quan. (Đã cắn đúng một lần ở C4b, 11/08.)
    const ns = (app.get(CallSignallingGateway) as unknown as { server: Namespace }).server;
    const target = [...ns.sockets.values()].find((s) => s.id === rec.socket.id);
    expect(target, `không tìm thấy socket server-side id=${rec.socket.id}`).toBeTruthy();
    const state = (
      target!.data as { state: { tokenExpSec: number; permissionCheckedAtMs: number } }
    ).state;
    expect(state, "socket phải có state do middleware dựng").toBeTruthy();
    mutate(state);
  }

  // ─── nhóm A — filter CÂM ─────────────────────────────────────────────────────

  it("A1 — handler NÉM ⇒ client nhận **0 khung** (kể cả `exception`) và socket bị NGẮT", async () => {
    // ⚠️ Tính chất cần chứng minh là "**KHÔNG có** khung nào", nên phải bắt bằng `onAny` chứ KHÔNG dùng
    // `wrap()` (nó chỉ `on()` ~9 tên cố định) — danh sách đóng làm ca xanh oan với mọi tên khung tương
    // lai (`error`, `call:error`, …).
    //
    // ⚠️ `vi.spyOn(instance)` chứ KHÔNG `overrideProvider`: int-spec này dựng MỘT app cho cả file
    // (`beforeAll`), nên override là toàn-file ⇒ giết 17 ca đang có.
    //
    // Vì sao đáng đo: `BaseWsExceptionFilter` mặc định `includeCause: true` sẽ echo lại tên sự kiện +
    // CHÍNH payload client vừa gửi và GIỮ socket sống — (1) oracle phân biệt "handler ném" với "bỏ im
    // lặng", (2) khung echo mang chính `sdp`/`candidate` = vi phạm R3. Gỡ `@UseFilters` hôm nay không
    // làm đỏ bài nào TRƯỚC ca này.
    const spy = vi
      .spyOn(app.get(ChatCallSignalService), "resolveSignalAccess")
      .mockRejectedValueOnce(new Error("bơm lỗi hạ tầng vào handler"));
    try {
      const rec = await connectCall(tFilter);
      const seen: string[] = [];
      rec.socket.onAny((name: string) => seen.push(name));

      rec.socket.emit("call:ping", { callId: randomUUID() });
      await settle(700);

      expect(seen, "0 khung — không `exception`, không gì cả").toEqual([]);
      expect(rec.disconnected, "handler ném ⇒ NGẮT, không giữ phiên không mô tả được").toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  // ─── nhóm B — thang TỪ CHỐI handshake ────────────────────────────────────────
  //
  // 🔴 B1/B2/B3 đều trả CÙNG chuỗi `"unauthorized"` (gateway `:202`/`:214`/`:222`) và `connect_error`
  // chỉ mang `err.message` ⇒ **thông điệp KHÔNG phân biệt nổi các nấc**. Bằng chứng nghiệm thu của nhóm
  // này vì thế là **delta coverage theo DÒNG** (200-203 · 212-215 · 218-223 đi từ 0 → >0), cộng với ca
  // ĐỐI CHỨNG "khác đúng một bit" ở B2b. Không có hai thứ đó thì cả ba ca xanh rỗng.

  it("B1 — KHÔNG có token ⇒ `unauthorized`", async () => {
    expect(await refusedRaw({ auth: {} })).toBe("unauthorized");
  });

  it("B2 — token hợp lệ nhưng THIẾU `exp` ⇒ `unauthorized` (fail-CLOSED)", async () => {
    // `jwt.verify` cho qua một token KHÔNG có `exp` — và ở kênh này "vô hạn" nghĩa là một phiên
    // signalling không bao giờ phải xác thực lại. Token ký bằng ĐÚNG secret + đủ `email`/`companyId`,
    // nên nấc duy nhất nó có thể trượt là `typeof claims.exp !== "number"`.
    const noExp = signToken(uLadder, `ladder@${A.slug}.test`);
    expect(await refusedRaw({ auth: { token: noExp } })).toBe("unauthorized");
  });

  it("B2b — ĐỐI CHỨNG khác ĐÚNG một bit: cùng payload + `expiresIn` ⇒ NỐI ĐƯỢC", async () => {
    // Cặp tối thiểu (plan §2 nhóm B). Không có ca này, một token B2 dựng sai (sai secret, thiếu `email`
    // — `token.service.ts:115` bắt buộc `typeof decoded.email === "string"`) vẫn cho `"unauthorized"` ⇒
    // B2 xanh trong khi dòng 212-215 CHƯA TỪNG chạy. CA 13b không dùng lại được: khác fixture.
    const withExp = signToken(uLadder, `ladder@${A.slug}.test`, { expiresIn: 900 });
    const socket = await expectRawConnects({ auth: { token: withExp } });
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  it("B3 — token rác / sai chữ ký ⇒ `unauthorized`", async () => {
    expect(await refusedRaw({ auth: { token: "khong-phai-jwt" } })).toBe("unauthorized");
    const wrongSecret = jwt.sign(
      { sub: uLadder, companyId: A.companyId, email: `ladder@${A.slug}.test`, aud: "tenant" },
      ["secret", "sai", "hoan", "toan", "khong-phai-cua-he"].join("-"),
      { algorithm: "HS256", expiresIn: 900 },
    );
    expect(await refusedRaw({ auth: { token: wrongSecret } })).toBe("unauthorized");
  });

  it("B6 — token rút qua header `Authorization: Bearer` (đường thứ HAI) cũng nối được", async () => {
    // `extraHeaders` được engine.io-client đổ vào options của `ws` ở Node. Ca kỳ vọng NỐI ĐƯỢC nên
    // không có rủi ro xanh-oan: dựng sai thì đỏ ngay.
    const socket = await expectRawConnects({ headers: { Authorization: `Bearer ${tLadder}` } });
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  // ─── nhóm C1 — hẹn giờ hết hạn token ─────────────────────────────────────────

  it("C1 — token tới hạn giữa phiên IM LẶNG ⇒ socket bị NGẮT (bản vá HIGH của FULL gate RT-1)", async () => {
    // Đây là bản vá mà security-reviewer yêu cầu 10/08: một socket nối xong rồi im lặng tuyệt đối
    // KHÔNG bao giờ đi qua `accept()`, nhưng vẫn NHẬN mọi SDP/ICE bắn tới `callUserRoomName` của mình.
    // Trước bản vá, đường cắt DUY NHẤT là `severUserSessions` (khoá/xoá tài khoản). Bản vá có **0 test**
    // trước ca này.
    //
    // ⚠️ Ca này chờ THẬT (~4 s) chứ không dịch đồng hồ: `setTimeout` là đường đang đo, fake nó đi thì
    // ca rỗng. Vẫn dưới `testTimeout`.
    const shortLived = signToken(uLife, `life@${A.slug}.test`, { expiresIn: 3 });
    const rec = await connectCall(shortLived);
    expect(rec.socket.connected, "nối được trước đã — nếu không, ca dưới rỗng").toBe(true);

    await settle(4000);

    expect(rec.disconnected, "hết hạn token ⇒ hẹn giờ phải CẮT phiên im lặng").toBe(true);
  }, 15_000);

  // ─── nhóm D5/D6 ──────────────────────────────────────────────────────────────

  it("D5 — LỚP C: 5 sự kiện không-relay từ người KHÔNG có hàng participant ⇒ im lặng, socket SỐNG", async () => {
    // `classifyMissingParticipant` xếp `join/leave/ping/media-state/screen-state` vào `race` (KHÔNG phải
    // `probe`) vì hai ca THẬT xảy ra hằng ngày: (1) người được mời thứ 21 trở đi bị `CHAT_CALL_MAX_INVITEES`
    // cắt — họ là thành viên phòng hợp lệ, FE của họ vẫn thử `call:join`; (2) khung tới sau khi cuộc gọi
    // vừa kết thúc. Xếp chúng vào `probe` là mỗi cuộc gọi bình thường ghi thêm vài hàng vào một bảng
    // append-only KHÔNG có job dọn, và ngắt một người dùng hợp lệ.
    const room = await newRoom(tCaller, "R-classc", [uCallee]);
    const callId = await invite(tCaller, room);
    await authPost(tCaller, `/chat/rooms/${room}/members`).send({
      userId: uClassC,
      role: "member",
    });

    const victim = await connectCall(tCallee);
    victim.socket.emit("call:join", { callId });
    await settle(200);
    victim.clear();

    const before = (await securityEvents(A.companyId)).filter((e) => e.user_id === uClassC).length;
    const outsider = await connectCall(tClassC);
    outsider.socket.emit("call:join", { callId });
    outsider.socket.emit("call:leave", { callId });
    outsider.socket.emit("call:ping", { callId });
    outsider.socket.emit("call:media-state", { callId, micOn: true, camOn: true });
    outsider.socket.emit("call:screen-state", { callId, sharing: true });
    await settle(700);

    expect(outsider.disconnected, "lớp C KHÔNG ngắt người dùng hợp lệ").toBe(false);
    expect(outsider.events, "và KHÔNG trả gì — kể cả `call:pong`").toEqual([]);
    expect(victim.events, "không relay sang người trong cuộc gọi").toEqual([]);
    expect((await securityEvents(A.companyId)).filter((e) => e.user_id === uClassC).length).toBe(
      before,
    );
  });

  it("D6 — socket ở HAI cuộc gọi rớt ⇒ **CẢ HAI** phòng nhận `peer-left`", async () => {
    // Bất biến `joinedCallIds` là `Set` (gateway `:92-96`) hiện chỉ sống trong docblock: partial unique
    // index chỉ chặn MỘT cuộc gọi sống mỗi PHÒNG, nên một người ở hai phòng tham gia được hai cuộc gọi
    // cùng lúc. Đổi `Set` → biến đơn hôm nay không làm đỏ bài nào, và hỏng IM LẶNG: người ma treo trong
    // cuộc gọi VÀO TRƯỚC trên UI của bên kia.
    const room1 = await newRoom(tTwo, "R-two-1", [uTwoPeer]);
    const room2 = await newRoom(tTwo, "R-two-2", [uTwoPeer]);
    const call1 = await invite(tTwo, room1);
    const call2 = await invite(tTwo, room2);

    const two = await connectCall(tTwo);
    const peer = await connectCall(tTwoPeer);
    for (const id of [call1, call2]) {
      two.socket.emit("call:join", { callId: id });
      peer.socket.emit("call:join", { callId: id });
    }
    await settle(500);
    peer.clear();

    two.socket.disconnect();
    await settle(700);

    const left = peer.events
      .filter((e) => e.name === "call:peer-left" && e.payload.userId === uTwo)
      .map((e) => e.payload.callId as string);
    expect([...left].sort(), "thiếu MỘT trong hai = người ma treo trong cuộc gọi kia").toEqual(
      [call1, call2].sort(),
    );
  });

  // ─── C5/C6 — hai lỗ chưa ai canh (ĐO trước, kết luận sau — owner chốt 11/08) ──

  it("C5 — gỡ thành viên khỏi phòng GIỮA cuộc gọi: đo CẢ HAI chiều", async () => {
    // `chat-call-signal.service.ts:87-91` suy `activeUserIds`/`participantUserIds` **chỉ từ
    // `chat_call_participants.outcome`** — không từ membership phòng hiện tại, không từ cặp quyền. Hai
    // chiều đều đáng đo, và ca này KHÔNG phán quyết: kết luận ghi ở plan §5 (owner chốt).
    const room = await newRoom(tRemovePeer, "R-remove", [uRemove]);
    const callId = await invite(tRemovePeer, room);

    const victim = await connectCall(tRemove);
    const peer = await connectCall(tRemovePeer);
    victim.socket.emit("call:join", { callId });
    peer.socket.emit("call:join", { callId });
    await settle(400);
    victim.clear();

    // Gỡ khỏi phòng = `SET left_at` (CHAT-API-007d). S7-CALL-RT-FIX-2: nay nó đóng LUÔN hàng
    // participant của cuộc gọi đang sống, trong CÙNG transaction.
    const del = await removeMember(tRemovePeer, room, uRemove);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    await settle(200);

    // (1) CHIỀU NHẬN — người đã bị gỡ có còn nhận SDP/ICE không?
    const beforeVictim = (await securityEvents(A.companyId)).filter(
      (e) => e.user_id === uRemove,
    ).length;
    const beforePeer = (await securityEvents(A.companyId)).filter(
      (e) => e.user_id === uRemovePeer,
    ).length;
    peer.socket.emit("call:ice-candidate", { callId, toUserId: uRemove, candidate: "sau-khi-go" });
    await settle(600);
    const stillReceives = victim.events.some((e) => e.name === "call:ice-candidate");

    // (2) CHIỀU GỬI — FE của họ vẫn trickle ICE (WebRTC tự làm, không cần thao tác người).
    victim.socket.emit("call:ice-candidate", {
      callId,
      toUserId: uRemovePeer,
      candidate: "trickle",
    });
    await settle(600);
    const punished =
      (await securityEvents(A.companyId)).filter((e) => e.user_id === uRemove).length >
      beforeVictim;

    // ┌─ TRIPWIRE `S7-CALL-RT-FIX-2` — hành vi ĐO ĐƯỢC 11/08/2026, và nó SAI cả hai chiều ────────────┐
    // │ **characterization test**: khẳng định hành vi HIỆN TẠI để nó không trôi tiếp trong im lặng.    │
    // │ Cơ chế (đã truy tới nguồn, không suy đoán):                                                    │
    // │   • `resolveSignalAccess` (`chat-call-signal.service.ts:79-84`) gọi `assertCallAccess`, hàm này │
    // │     ném `NotFoundException` khi actor **không (còn) là thành viên phòng** ⇒ trả `null`.        │
    // │   • `accept()` thấy `!access` ⇒ `classifyMissingParticipant('call:ice-candidate') = 'probe'` ⇒ │
    // │     ghi `user_security_events` + NGẮT.                                                         │
    // │   • Nhưng `activeUserIds` của NGƯỜI CÒN LẠI suy từ `chat_call_participants` — bảng này KHÔNG bị│
    // │     `left_at` của phòng chạm tới ⇒ `assertPeer` vẫn cho relay SDP/ICE **TỚI** người đã bị gỡ.  │
    // │                                                                                                │
    // │ Hệ quả: chiều RÒ (họ vẫn nhận IP nội bộ + mốc thời gian của bên kia) thì MỞ, còn chiều VÔ HẠI  │
    // │ (browser của họ tự trickle ICE — không cần một thao tác người nào) thì bị đóng dấu "dò cửa" +  │
    // │ một hàng VĨNH VIỄN trong bảng append-only KHÔNG có job dọn. Đúng lớp lỗi mà CA 9 đã vá cho     │
    // │ đường `hangup`, nhưng đường "gỡ thành viên" thì chưa ai vá.                                    │
    // │                                                                                                │
    // │ Owner chốt 11/08 "đo trước, kết luận sau" ⇒ kết luận: **KHÔNG chấp nhận được, leo owner**.     │
    // │ WO vá = `S7-CALL-RT-FIX-2` (backlog). Khi bản vá land, 2 assert dưới ĐỎ ⇒ lật thành hành vi    │
    // │ đúng trong CÙNG PR. Xem plan §5 mục 7.                                                         │
    // └────────────────────────────────────────────────────────────────────────────────────────────────┘
    //
    // ✅ **ĐÃ LẬT — `S7-CALL-RT-FIX-2` đã land.** Docblock cơ chế ở trên GIỮ NGUYÊN: nó là hồ sơ vì sao
    // ca này tồn tại. Ba khẳng định dưới nay đo HÀNH VI ĐÚNG, không còn là tripwire.
    expect(
      stillReceives,
      "chiều RÒ phải ĐÓNG: người đã bị gỡ KHÔNG được nhận SDP/ICE của bên kia nữa",
    ).toBe(false);
    expect(
      punished,
      "KHÔNG được ghi hàng an ninh: trickle ICE là do WebRTC tự làm, họ không phải người dò cửa",
    ).toBe(false);
    expect(victim.disconnected, "…và KHÔNG được ngắt kết nối của họ").toBe(false);

    // ┌─ C2 (BLOCK vòng review 1) — hai assert dưới NGĂN một bản vá SAI vẫn xanh ──────────────────────┐
    // │ Ba assert trên đều đo NẠN NHÂN. Một hiện thực sai kiểu "lọc người bị gỡ khỏi CẢ                │
    // │ `activeUserIds` LẪN `participantUserIds`" làm cả ba XANH — trong khi `assertPeer` rơi xuống    │
    // │ `deny()` và ghi hàng an ninh + NGẮT **NGƯỜI Ở LẠI**. Nạn nhân bị CHUYỂN chứ không bị xoá, và   │
    // │ không assert nào ở trên nhìn thấy điều đó.                                                      │
    // │ ⇒ Người bị gỡ phải rơi khỏi `activeUserIds` NHƯNG Ở LẠI `participantUserIds` — đúng hình dạng  │
    // │ mà người vừa gác máy đang có (lớp C ở `assertPeer:699`).                                        │
    // └────────────────────────────────────────────────────────────────────────────────────────────────┘
    const afterPeer = (await securityEvents(A.companyId)).filter(
      (e) => e.user_id === uRemovePeer,
    ).length;
    expect(
      afterPeer - beforePeer,
      "NGƯỜI Ở LẠI không được bị phạt — họ chỉ bắn ICE cho một peer vừa biến mất",
    ).toBe(0);
    expect(peer.disconnected, "…và người ở lại KHÔNG được bị ngắt").toBe(false);
  });

  // ─── S7-CALL-RT-FIX-2 — ca ĐỐI CHỨNG + trạng thái DB ────────────────────────

  /**
   * 🔴 Ca **1b** của §5.2 — thứ DUY NHẤT ép được ranh giới lớp B ở nhánh mà `wasCallParticipant` sửa.
   *
   * Ca 1a ("CÒN là thành viên phòng, chưa từng được mời") đã có: **CA 3** ở trên — ở đó `access ≠ null`
   * nên `wasCallParticipant` KHÔNG chạy. Chỉ ca này (`access === null` VÀ không có hàng participant) đi
   * qua đúng dòng code mới. Thiếu nó, đột biến *"`wasCallParticipant` luôn trả `true`"* — tức mở toang
   * lớp B thành lớp C cho MỌI người ngoài — vẫn xanh toàn bộ (`deny-cases-vacuous-without-allow-case`).
   */
  it("FIX2/1b — người NGOÀI phòng, CHƯA TỪNG được mời ⇒ VẪN lớp B (ghi + ngắt)", async () => {
    const room = await newRoom(tRemovePeer, "R-outsider", [uCallee]);
    const callId = await invite(tRemovePeer, room);

    const outsider = await connectCall(tOutsider);
    const before = (await securityEvents(A.companyId)).filter(
      (e) => e.user_id === uOutsider,
    ).length;

    outsider.socket.emit("call:ice-candidate", { callId, toUserId: uCallee, candidate: "probe" });
    await settle(600);

    const after = (await securityEvents(A.companyId)).filter((e) => e.user_id === uOutsider).length;
    expect(after - before, "người ngoài đẩy ICE vào cuộc gọi người khác VẪN phải bị ghi").toBe(1);
    expect(outsider.disconnected, "…và VẪN phải bị ngắt").toBe(true);
  });

  /**
   * 🔴 Ca **4** của §5.2 — `evictFromCallRoom`.
   *
   * `call:media-state`/`call:screen-state` broadcast thẳng vào `callRoomName` và **KHÔNG** đi qua
   * `assertPeer`, nên đóng `chat_call_participants` một mình KHÔNG chặn được chúng: socket nạn nhân vẫn
   * ở trong room chung. C5 (chỉ đo `ice-candidate`) sẽ XANH trong khi lỗ này còn mở — đây là ca duy nhất
   * canh vế `socketsLeave`.
   */
  it("FIX2/4 — sau khi bị gỡ, nạn nhân KHÔNG còn nhận `call:media-state` (socket bị kéo khỏi room cuộc gọi)", async () => {
    const room = await newRoom(tMediaPeer, "R-media", [uMedia]);
    const callId = await invite(tMediaPeer, room);

    const victim = await connectCall(tMedia);
    const peer = await connectCall(tMediaPeer);
    victim.socket.emit("call:join", { callId });
    peer.socket.emit("call:join", { callId });
    await settle(400);

    // POSITIVE CONTROL: TRƯỚC khi gỡ, media-state PHẢI tới — nếu không, ca dưới xanh RỖNG.
    victim.clear();
    peer.socket.emit("call:media-state", { callId, micOn: false, camOn: true });
    await settle(500);
    expect(
      victim.events.some((e) => e.name === "call:media-state"),
      "ĐỐI CHỨNG: khi còn trong phòng thì media-state phải tới",
    ).toBe(true);

    const del = await removeMember(tMediaPeer, room, uMedia);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    await settle(300);

    victim.clear();
    peer.socket.emit("call:media-state", { callId, micOn: true, camOn: false });
    peer.socket.emit("call:screen-state", { callId, sharing: true });
    await settle(600);

    expect(
      victim.events.some((e) => e.name === "call:media-state" || e.name === "call:screen-state"),
      "đã bị gỡ khỏi phòng mà vẫn theo dõi được mic/cam/chia-sẻ-màn-hình theo thời gian thực",
    ).toBe(false);
  });

  it("FIX2 — người CÒN LẠI nhận `call:peer-left` đúng `callId` khi peer bị gỡ khỏi phòng", async () => {
    const room = await newRoom(tMediaPeer, "R-peerleft", [uMedia]);
    const callId = await invite(tMediaPeer, room);

    const victim = await connectCall(tMedia);
    const peer = await connectCall(tMediaPeer);
    victim.socket.emit("call:join", { callId });
    peer.socket.emit("call:join", { callId });
    await settle(400);
    peer.clear();

    const del = await removeMember(tMediaPeer, room, uMedia);
    expect(del.status, JSON.stringify(del.body)).toBe(200);

    const payload = await peer.waitFor("call:peer-left", 3000);
    expect(payload).toEqual({ callId, userId: uMedia });
  });

  /**
   * 🔴 §5.3 ca 1 — **ca quan trọng nhất của cả WO.** Kết cục phải theo TỪNG HÀNG.
   *
   * `'left'` = "đã VÀO rồi rời". Gán nó cho người chưa bấm nhận (`joined_at IS NULL`) là đóng dấu "đã
   * nghe máy rồi cúp" lên người CHƯA BAO GIỜ nhấc máy — và **không sửa lại được**: bốn kết cục là HẤP
   * THỤ, bảng không có DELETE (mig `0546` khối C). Ghi cứng `'left'` cho cả lô làm ca này ĐỎ.
   */
  it("FIX2/§5.3-1 — kết cục theo TỪNG HÀNG: đã accept ⇒ `left`+`left_at`; đang đổ chuông ⇒ `missed`, `left_at` NULL", async () => {
    const room = await newRoom(tExitPeer, "R-outcome", [uExit, uExitThird]);
    const callId = await invite(tExitPeer, room);

    // `uExit` NHẬN máy (⇒ `joined_at` có); `uExitThird` để nguyên đang đổ chuông (`joined_at IS NULL`).
    const acc = await authPost(tExit, `/chat/calls/${callId}/accept`).send({});
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);

    expect(await removeMember(tExitPeer, room, uExit)).toMatchObject({ status: 200 });
    expect(await removeMember(tExitPeer, room, uExitThird)).toMatchObject({ status: 200 });

    const rows = await participantsOf(callId);
    const joined = rows.find((r) => r.user_id === uExit);
    const ringing = rows.find((r) => r.user_id === uExitThird);

    expect(joined?.outcome, "người đã nhấc máy rồi bị gỡ = đã VÀO rồi rời").toBe("left");
    expect(joined?.left_at, "`left` mà `left_at IS NULL` tự nó là một sự KHÔNG NHẤT QUÁN").not.toBe(
      null,
    );

    expect(ringing?.outcome, "người CHƯA nhấc máy KHÔNG được đóng dấu `left`").toBe("missed");
    expect(ringing?.left_at, "cuộc gọi NHỠ không có mốc rời").toBe(null);
    expect(ringing?.joined_at, "…và họ chưa từng vào").toBe(null);
  });

  /**
   * 🔴 **Đột biến `j` của §5.4 — vế `accepted_at` của vị từ KÉP.** Lỗ này ĐÃ XẢY RA THẬT: bản đầu chỉ
   * xét `joined_at !== null`, và `security-reviewer` (13/08) bắt được ở vòng FULL gate.
   *
   * `insertParticipants` đặt `joined_at = now` cho **NGƯỜI KHỞI TẠO ngay lúc MỜI** (họ "tự vào cuộc gọi
   * của chính mình"), nên MỌI cuộc gọi còn `ringing` đã sẵn có một hàng `joined_at` khác NULL trong khi
   * **chưa ai nói chuyện với ai**. Chỉ xét `joined_at` ⇒ người khởi tạo bị đóng dấu `'left'` + `left_at`
   * — kết cục HẤP THỤ, bảng không có DELETE ⇒ **SAI VĨNH VIỄN**, đúng thứ §0.3 dựng cả WO này để tránh.
   *
   * ⚠️ Ca này là detector ở tầng INT; trước đó nó chỉ có ở tầng unit (stub repo), tức vế "`joined_at`
   * thật sự được đặt lúc mời" — tiền đề khiến lỗ tồn tại — chưa từng được đo trên DB thật.
   *
   * Ba assert TIỀN ĐỀ ở dưới không phải trang trí: thiếu chúng, một ngày `insertParticipants` thôi đặt
   * `joined_at` lúc mời thì ca vẫn XANH trong khi nó đã hết đo cái gì cả.
   */
  it("FIX2/§5.4-j — NGƯỜI KHỞI TẠO rời phòng lúc cuộc gọi còn `ringing` ⇒ `missed`, KHÔNG phải `left`", async () => {
    const room = await newRoom(tExitPeer, "R-initiator-ringing", [uExit, uExitThird]);
    // `uExit` là người KHỞI TẠO (không phải admin phòng — để `removeMember` của admin đi được).
    const callId = await invite(tExit, room);

    // ── TIỀN ĐỀ: đúng ô `joined_at NOT NULL` + `accepted_at NULL` mà đột biến `j` nhắm tới ──
    const beforeRow = (await participantsOf(callId)).find((r) => r.user_id === uExit);
    expect(
      beforeRow?.joined_at,
      "tiền đề: `insertParticipants` đặt `joined_at` cho NGƯỜI KHỞI TẠO ngay lúc mời",
    ).not.toBe(null);
    const acceptedAt = (
      await direct.query(`SELECT accepted_at FROM chat_calls WHERE id = $1`, [callId])
    ).rows[0]?.accepted_at;
    expect(acceptedAt, "tiền đề: chưa ai nhấc máy ⇒ `chat_calls.accepted_at` VẪN NULL").toBe(null);
    expect(await callStatus(callId), "tiền đề: cuộc gọi còn SỐNG").toBe("ringing");

    expect(await removeMember(tExitPeer, room, uExit)).toMatchObject({ status: 200 });

    const row = (await participantsOf(callId)).find((r) => r.user_id === uExit);
    expect(
      row?.outcome,
      "người khởi tạo CHƯA nói chuyện với ai — `left` là đóng dấu 'đã vào rồi rời' lên họ, VĨNH VIỄN",
    ).toBe("missed");
    expect(row?.left_at, "cuộc gọi NHỠ không có mốc rời").toBe(null);
    // `joined_at` VẪN còn — chứng minh ca đi qua đúng nhánh KÉP (nếu vị từ chỉ xét `joined_at` thì với
    // cùng dữ liệu này kết cục đã là `left`), chứ không phải qua nhánh "chưa từng vào" của §5.3-1.
    expect(row?.joined_at, "…và hàng vẫn giữ `joined_at` của lúc mời").not.toBe(null);
  });

  it("FIX2/§5.3-3 — gỡ người KHÔNG ở trong cuộc gọi nào ⇒ 0 hàng audit `participant_closed`", async () => {
    const room = await newRoom(tExitPeer, "R-nocallmember", [uExit]);
    const callId = await invite(tExitPeer, room);

    // `uExitThird` vào phòng SAU khi cuộc gọi bắt đầu ⇒ thành viên hợp lệ, KHÔNG có hàng participant.
    const add = await authPost(tExitPeer, `/chat/rooms/${room}/members`).send({
      userId: uExitThird,
      role: "member",
    });
    expect(add.status, JSON.stringify(add.body)).toBe(200);

    const before = (await participantClosedAudit(A.companyId)).length;
    expect(await removeMember(tExitPeer, room, uExitThird)).toMatchObject({ status: 200 });

    expect(
      (await participantClosedAudit(A.companyId)).length - before,
      "không có gì để đóng thì không được ghi audit",
    ).toBe(0);
    expect(
      (await participantsOf(callId)).some((r) => r.user_id === uExitThird),
      "…và tuyệt đối không được CHÈN một hàng participant mới",
    ).toBe(false);
  });

  /**
   * 🔴 §5.3 ca 4 — cửa vào THỨ HAI. `POST /chat/rooms/:id/leave` đi qua cùng `setMemberLeft`, nên một
   * bản vá chỉ chạm `removeMember` để hở đúng một nửa lỗ.
   */
  it("FIX2/§5.3-4 — cửa `POST /rooms/:id/leave` (rời TỰ NGUYỆN) đóng phần tham gia y hệt", async () => {
    const room = await newRoom(tExitPeer, "R-leave", [uExit]);
    const callId = await invite(tExitPeer, room);
    const acc = await authPost(tExit, `/chat/calls/${callId}/accept`).send({});
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);

    const before = (await participantClosedAudit(A.companyId)).length;
    const left = await authPost(tExit, `/chat/rooms/${room}/leave`).send({});
    expect(left.status, JSON.stringify(left.body)).toBe(200);

    const row = (await participantsOf(callId)).find((r) => r.user_id === uExit);
    expect(row?.outcome).toBe("left");
    expect(row?.left_at).not.toBe(null);

    const audits = await participantClosedAudit(A.companyId);
    expect(audits.length - before, "cửa `leave` cũng phải để lại dấu vết").toBe(1);
    const last = audits[audits.length - 1];
    expect(last?.object_id).toBe(callId);
    // Ở cửa này người BẤM và người BỊ ĐÓNG là MỘT — khác `removeMember`, nơi đó là hai người.
    expect(last?.actor_user_id).toBe(uExit);
    expect(last?.new_values).toMatchObject({ userId: uExit, roomId: room, reason: "room_exit" });
  });

  /**
   * 🔴 Đột biến `i` của §5.4 — vế `c.status IN CHAT_CALL_LIVE_STATUSES` của `findOpenParticipantCallsInRoom`.
   *
   * Đó là thứ DUY NHẤT chặn việc đóng lại hàng của một cuộc gọi ĐÃ XONG (ghi đè lịch sử + một dòng audit
   * cho mỗi cuộc gọi cũ). Bỏ vế lọc ⇒ ca này ĐỎ.
   */
  it("FIX2/§5.4-i — gỡ người SAU KHI cuộc gọi đã kết thúc ⇒ 0 hàng audit, kết cục cũ KHÔNG bị ghi đè", async () => {
    const room = await newRoom(tExitPeer, "R-ended", [uExit]);
    const callId = await invite(tExitPeer, room);

    // ⚠️ **DỰNG ĐÚNG trạng thái "hàng CÒN MỞ trên cuộc gọi ĐÃ KẾT THÚC"** — nếu không ca này xanh-rỗng.
    // Dựng bằng `cancel` là SAI: nó đóng mọi hàng `outcome IS NULL` ⇒ vế lọc `outcome` của B1 một mình
    // đã trả 0 hàng, và ca sẽ XANH kể cả khi vế `status IN LIVE` bị gỡ (đã ĐO: đột biến `i` không bị bắt).
    // Đường tới được: `accept` ⇒ `outcome='accepted'`, mà `closeOpenParticipants` chỉ quét
    // `outcome IS NULL` ⇒ sau khi bên kia `hangup`, hàng của người đã nhận máy VẪN là `'accepted'`
    // (tức vẫn nằm trong tập "chưa ngã ngũ") trong khi cuộc gọi đã `ended`. Chỉ vế `status` chặn được nó.
    const acc = await authPost(tExit, `/chat/calls/${callId}/accept`).send({});
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    const hang = await authPost(tExitPeer, `/chat/calls/${callId}/hangup`).send({});
    expect(hang.status, JSON.stringify(hang.body)).toBe(200);
    expect(await callStatus(callId), "tiền đề: cuộc gọi đã kết thúc").toBe("ended");

    const outcomeBefore = (await participantsOf(callId)).find((r) => r.user_id === uExit)?.outcome;
    expect(outcomeBefore, "tiền đề: hàng của người đã nhận máy VẪN chưa ngã ngũ").toBe("accepted");

    const before = (await participantClosedAudit(A.companyId)).length;
    expect(await removeMember(tExitPeer, room, uExit)).toMatchObject({ status: 200 });

    expect(
      (await participantClosedAudit(A.companyId)).length - before,
      "cuộc gọi đã xong thì không có gì để đóng",
    ).toBe(0);
    expect(
      (await participantsOf(callId)).find((r) => r.user_id === uExit)?.outcome,
      "kết cục của một cuộc gọi đã kết thúc là LỊCH SỬ — không được ghi đè",
    ).toBe(outcomeBefore);
  });

  /**
   * 🔴 **H7 — cuộc gọi MA khoá phòng. LỖ CÓ SẴN TỪ TRƯỚC, CỐ Ý KHÔNG vá ở WO này** (plan §7 mục 4).
   *
   * Bản vá đóng phần THAM GIA nhưng KHÔNG kết thúc cuộc gọi: ghi `chat_calls.status` từ đường THÀNH VIÊN
   * là kéo bề mặt ghi vòng đời ra ngoài `ChatCallsService` — đúng hàng rào R4 của `DECISIONS-07`, cần
   * chữ ký owner chứ không phải một quyết định lẻ trong lúc vá.
   *
   * Đã đo: lỗ KHÔNG do bản vá đẻ ra — hôm nay gỡ người đang gọi cũng làm họ hết `hangup` nổi (404 vì hết
   * là thành viên) và cuộc gọi kẹt y hệt. Ca này ĐÓNG ĐINH hành vi hiện tại để nó không trôi trong im
   * lặng. Có KI riêng trỏ tới đây.
   */
  it("FIX2/H7 — gỡ người khỏi phòng KHÔNG kết thúc cuộc gọi: status vẫn `active` và phòng bị khoá (409)", async () => {
    const room = await newRoom(tExitPeer, "R-ghost", [uExit]);
    const callId = await invite(tExitPeer, room);
    const acc = await authPost(tExit, `/chat/calls/${callId}/accept`).send({});
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(await callStatus(callId)).toBe("active");

    expect(await removeMember(tExitPeer, room, uExit)).toMatchObject({ status: 200 });

    expect(await callStatus(callId), "HÀNH VI HIỆN TẠI (KI): cuộc gọi KHÔNG tự kết thúc").toBe(
      "active",
    );
    // …và partial unique `chat_calls_one_live_per_room_uq` khoá phòng: mọi `invite` sau là 409.
    const again = await authPost(tExitPeer, `/chat/rooms/${room}/calls`).send({ kind: "audio" });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
  });

  it("C6 — tài khoản bị KHOÁ vẫn mở được phiên `/ws-call` MỚI bằng access-token còn hạn", async () => {
    // `handshake()` (`gateway:198-244`) chỉ kiểm chữ ký + `exp` + cặp quyền — **không đọc trạng thái
    // user, không đọc `user_sessions`**. `severUserSessions` chỉ cắt socket ĐANG SỐNG tại thời điểm
    // khoá (CA 19): người bị khoá lúc offline, hoặc nối lại sau đó, đi lọt. Khoá thường KHÔNG gỡ role
    // (memory `lock-no-revoke`) ⇒ `permissions.can` vẫn ALLOW.
    //
    // ĐO trước, kết luận sau (owner chốt 11/08) — kết luận ở plan §5.
    await direct.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [uLocked]);
    await direct.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'test-lock'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [uLocked],
    );
    app.get(RealtimeEmitterService).severUserSessions(A.companyId, uLocked);
    await settle(300);

    const socket = await expectRawConnects({ auth: { token: tLocked } });
    expect(socket.connected, "khoá tài khoản KHÔNG chặn phiên /ws-call MỚI (token ≤900 s)").toBe(
      true,
    );
    socket.disconnect();
  });

  // ─── C3/C4 — DỊCH ĐỒNG HỒ. BẮT BUỘC ĐẶT CUỐI FILE ────────────────────────────
  //
  // ⚠️ Vệ sinh dịch-đồng-hồ (plan §3.2), cả ba đều bắt buộc:
  //   1. `vi.useRealTimers()` trong `finally`;
  //   2. **KHÔNG gọi REST nào** khi đồng hồ đang lệch — token ký ra sẽ mang `exp` tương lai, còn `now()`
  //      của PG thì không lệch;
  //   3. đặt CUỐI file — socket của các ca trước vẫn nằm trong `openClients`, một khung gửi trên chúng
  //      trong cửa sổ lệch sẽ bị ngắt ở bước (2) của `accept()` và làm **đỏ ca khác**.
  // Chỉ fake `Date` (`toFake:['Date']`) — giữ `setTimeout` THẬT cho socket.io và cho hẹn giờ hết hạn.

  it("C3 — token hết hạn phát hiện lại ở `accept()` (bước 2) ⇒ ngắt khi GỬI khung", async () => {
    // ⚠️ KHÔNG dùng token TTL ngắn ở đây: hẹn giờ `299-302` đặt đúng tại `exp` và sau connect thì
    // `disconnect(true)` chạy THẬT ⇒ hẹn giờ luôn thắng, socket không còn để gửi khung ⇒ ca bất khả/flaky.
    // (Đường hẹn-giờ được đo riêng ở C1.)
    const room = await newRoom(tClock, "R-clock3", [uCallee]);
    const callId = await invite(tClock, room);
    const rec = await connectCall(tClock);
    rec.socket.emit("call:join", { callId });
    await settle(300);

    // LÀM CŨ trạng thái phía SERVER thay vì dịch đồng hồ — xem docblock `ageServerState`.
    ageServerState(rec, (s) => {
      s.tokenExpSec = Math.floor(Date.now() / 1000) - 1;
    });

    let why = "";
    rec.socket.on("disconnect", (reason: string) => (why = reason));
    rec.socket.emit("call:ping", { callId });
    await settle(700);

    expect(rec.disconnected, "quá `exp` ⇒ bước (2) của accept() phải ngắt").toBe(true);
    // 🔴 ORACLE THỨ HAI — bắt buộc: "socket chết" một mình KHÔNG chứng minh SERVER cắt nó. Chính assert
    // thiếu vế này đã làm bản đầu của ca này XANH OAN (client tự chết vì "ping timeout", khung chưa hề
    // rời máy — xem `ageServerState`).
    expect(why, "phải là SERVER cắt, không phải transport tự chết").toBe("io server disconnect");
  });

  it("C4 — THU HỒI cặp quyền giữa cuộc gọi ⇒ hỏi lại DB sau TTL ảnh chụp rồi NGẮT", async () => {
    const room = await newRoom(tClockPeer, "R-clock4", [uCallee]);
    const callId = await invite(tClockPeer, room);
    const rec = await connectCall(tClockPeer);
    rec.socket.emit("call:join", { callId });
    await settle(300);

    // (1) Thu hồi ở DB — role riêng của chính user này (`grantPairs` tạo role theo user).
    await direct.query(
      `DELETE FROM role_permissions rp
        USING user_roles ur, permissions p
        WHERE rp.role_id = ur.role_id AND ur.user_id = $1
          AND rp.permission_id = p.id AND p.action = 'call' AND p.resource_type = 'chat-room'`,
      [uClockPeer],
    );
    // (2) Invalidation TƯỜNG MINH: `permission.cache.ts:12 CACHE_TTL_SEC = 300` — không gọi thì `can()`
    // vẫn trả kết quả CŨ tới 5 phút và ca này đo cache chứ không đo thu hồi.
    // ⚠️ Token DI `"CACHED_PERMISSION_REPO"` là const module-local (`permission.module.ts:35`), không
    // export — lấy bằng chuỗi là đường DUY NHẤT từ test.
    await app
      .get<{ invalidateUser(c: string, u: string): Promise<void> }>("CACHED_PERMISSION_REPO")
      .invalidateUser(A.companyId, uClockPeer);

    // 🔴 ORACLE THỨ HAI (bắt buộc): "socket bị ngắt" MỘT MÌNH là xanh-vì-nhầm-nấc — `accept()` chạy bước
    // (2) TRƯỚC bước (3), nên nếu access-token của actor còn dưới 61 s thì 585-589 ngắt và ca vẫn xanh
    // trong khi 592-604 CHƯA TỪNG chạy. Điều kiện tiên quyết: token của actor còn > 61 s (login ở
    // `beforeAll`, TTL 900 s ⇒ thoả).
    // (3) Làm CŨ ảnh chụp quyền — `PERMISSION_SNAPSHOT_TTL_MS = 60_000` (`gateway:71`) là hằng CỨNG,
    // không env; chờ thật thì vượt `testTimeout`, còn dịch đồng hồ thì khung không rời máy
    // (xem `ageServerState`).
    ageServerState(rec, (s) => {
      s.permissionCheckedAtMs = Date.now() - 61_000;
    });

    // 🔴 ORACLE THỨ HAI (bắt buộc): "socket bị ngắt" MỘT MÌNH là xanh-vì-nhầm-nấc — `accept()` chạy bước
    // (2) TRƯỚC bước (3), nên một ca ngắt vì token hết hạn (585-589) vẫn xanh trong khi 592-604 CHƯA
    // TỪNG chạy. Ở đây ta chỉ làm cũ ĐÚNG `permissionCheckedAtMs`, và còn đếm `can()` theo ĐỐI SỐ.
    const canSpy = vi.spyOn(PermissionService.prototype, "can");
    let reChecks: unknown[] = [];
    let why = "";
    rec.socket.on("disconnect", (reason: string) => (why = reason));
    try {
      rec.socket.emit("call:ping", { callId });
      await settle(800);

      // ⚠️ ĐỌC `mock.calls` **TRƯỚC** `mockRestore()`: `mockRestore` = `mockReset` + khôi phục bản gốc,
      // mà `mockReset` **XOÁ SẠCH `mock.calls`**. Đọc sau khi restore luôn cho mảng RỖNG ⇒ ca đỏ oan
      // (đã cắn đúng một lần ở lượt chạy đầu 11/08) — hoặc tệ hơn, xanh oan nếu assert là `toBe(0)`.
      // Đếm theo ĐỐI SỐ, không đếm tổng: mọi request REST trong ca cũng gọi `can()`.
      reChecks = canSpy.mock.calls.filter(([arg]) => {
        const a = arg as { action?: string; resourceType?: string; userId?: string };
        return a.action === "call" && a.resourceType === "chat-room" && a.userId === uClockPeer;
      });
    } finally {
      canSpy.mockRestore();
    }

    expect(reChecks.length, "ảnh chụp quá TTL ⇒ PHẢI hỏi lại DB (nhánh 592-604)").toBeGreaterThan(
      0,
    );
    expect(rec.disconnected, "…và cặp quyền đã bị thu hồi ⇒ NGẮT").toBe(true);
    expect(why, "phải là SERVER cắt, không phải transport tự chết").toBe("io server disconnect");
  });

  it("C4b — ĐỐI CHỨNG: ảnh chụp quá TTL nhưng quyền CÒN ⇒ hỏi lại, socket SỐNG, ảnh chụp được LÀM MỚI", async () => {
    // Cặp tối thiểu của C4: khác đúng một bit (không thu hồi gì). Thiếu ca này thì C4 xanh kể cả với một
    // bản "hết TTL ⇒ ngắt luôn, khỏi hỏi" — tức mọi cuộc gọi dài hơn 60 s đều rụng, và không test nào
    // bắt được. Nó cũng là ca DUY NHẤT chạy dòng 603-604 (làm mới ảnh chụp sau khi hỏi lại).
    const countPair = (spy: { mock: { calls: unknown[][] } }): number =>
      spy.mock.calls.filter(([arg]) => {
        const a = arg as { action?: string; resourceType?: string; userId?: string };
        return a.action === "call" && a.resourceType === "chat-room" && a.userId === uClassC;
      }).length;

    const room = await newRoom(tClassC, "R-snap", [uCallee]);
    const callId = await invite(tClassC, room);
    const rec = await connectCall(tClassC);
    rec.socket.emit("call:join", { callId });
    await settle(300);

    ageServerState(rec, (s) => {
      s.permissionCheckedAtMs = Date.now() - 61_000;
    });

    const canSpy = vi.spyOn(PermissionService.prototype, "can");
    try {
      rec.socket.emit("call:ping", { callId });
      const pong = await rec.waitFor("call:pong");
      expect(pong.callId, "quyền còn ⇒ khung được xử lý bình thường").toBe(callId);

      const afterFirst = countPair(canSpy);
      expect(afterFirst, "ảnh chụp quá TTL ⇒ PHẢI hỏi lại DB").toBeGreaterThan(0);
      expect(rec.disconnected, "…nhưng quyền CÒN ⇒ KHÔNG ngắt").toBe(false);

      // Ảnh chụp đã được làm mới (603-604) ⇒ khung kế tiếp KHÔNG được hỏi lại DB. Thiếu vế này thì một
      // bản "quên gán `permissionCheckedAtMs`" sẽ hỏi DB ở MỌI khung — 2 round-trip mỗi ICE candidate,
      // đúng thứ ảnh chụp sinh ra để tránh — mà vẫn xanh.
      rec.socket.emit("call:ping", { callId });
      await settle(500);
      expect(countPair(canSpy), "trong TTL mới ⇒ KHÔNG hỏi lại").toBe(afterFirst);
    } finally {
      canSpy.mockRestore();
    }
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
