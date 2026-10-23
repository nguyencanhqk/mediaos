/**
 * S17-CHAT-RTROOMOPS-1 — room-op CHAT/CALL với id KHÔNG chuẩn tắc (plan `docs/plans/S17-CHAT-RTROOMOPS-1.md`
 * §6, ca R-1…R-5 · A-1 · A-2).
 *
 * Bất biến đo: tên room là CHUỖI dựng từ id. `ParseUUIDPipe` (route) và Zod `uuid()` (khung `/ws-call`)
 * nhận uuid chữ HOA và trả nguyên văn; Postgres so uuid không phân biệt hoa thường nên lời ghi DB vẫn
 * thành công. Gateway join room bằng id đọc từ DB/JWT (chữ thường). Room-op/emit dựng từ id route/khung
 * phải ra CÙNG tên room đó — nếu không, người đã rời/bị gỡ Ở LẠI room (fail-OPEN) hoặc tin phát vào một
 * room không ai ở (fail-closed).
 *
 * Mọi ca khẳng định TRƯỚC: HTTP 2xx + trạng thái DB; RỒI mới đo membership PHÍA SERVER
 * (`nsp.local.in(room).fetchSockets()`, khuôn E11m của BE-2C) — RED không thể đến từ 404/422. «Nhận 0 sự
 * kiện» luôn đi SAU một neo dương trên chính socket đó (tin phát sau ở phòng neo).
 *
 * ⚠️ Actor là vai THƯỜNG (không super-admin). Boot qua `applyMainPipeline` + `setupWebSocketAdapter` +
 * `listen(0)` như PROD. GATE CỨNG `hasDb && LANE_DB`. File chạy TUẦN TỰ — thứ tự ca CÓ ý nghĩa.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import type { Namespace } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WS_EVENTS } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { loadEnv } from "../../src/config/env.schema";
import { callRoomName, chatRoomName } from "../../src/realtime/rooms";
import { setupWebSocketAdapter } from "../../src/realtime/setup-websocket-adapter";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import {
  CALL_FULL_PAIRS,
  callNamespace,
  connectCallSocket,
  connectChatReady,
  countEvents,
  inRoom,
  joinCallReady,
  waitForEvent,
  type WsRecorder,
} from "../helpers/chat-call-fixture";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";
import { becomes, gatewayNamespace, seedActor } from "../helpers/social-group-rooms-fixture";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd!", "rtro", "ops"].join("-");
const up = (s: string): string => s.toUpperCase();

interface Who {
  userId: string;
  token: string;
}

describe.skipIf(!hasLaneDb)(
  "S17-CHAT-RTROOMOPS-1 · room-op CHAT/CALL — id chữ HOA (WS thật + DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let ws: Namespace;
    let callNsp: Namespace;
    let port = 0;
    let A: SeededTenant;
    const companyIds: string[] = [];
    const open: ClientSocket[] = [];

    // Adm tạo mọi phòng (admin phòng) và mời gọi. V* = người bị gỡ · P* = người ở lại · L5 = người tự rời.
    let Adm: Who;
    let V1: Who;
    let P1: Who;
    let V2: Who;
    let U4: Who;
    let L5: Who;
    let P5: Who;
    let V6: Who;
    /** Phòng neo: chứa V1 + L5 — tin ở đây là NEO DƯƠNG cho ca «nhận 0 tin». */
    let AN = "";
    let R1 = "";
    let R2 = "";
    let R4 = "";
    let R5 = "";
    let R6 = "";
    let call2 = "";
    /** Socket sống qua nhiều ca. */
    const sock: Record<string, WsRecorder> = {};

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

    async function actor(label: string, hash: string): Promise<Who> {
      const { userId, email } = await seedActor(direct, A, label, hash, CALL_FULL_PAIRS);
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return { userId, token: res.body.data.accessToken as string };
    }

    async function newRoom(name: string, members: readonly Who[]): Promise<string> {
      const res = await http()
        .post("/chat/rooms")
        .set(auth(Adm.token))
        .send({ name, memberUserIds: members.map((m) => m.userId) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    }

    async function send(roomIdInRoute: string, body: string): Promise<string> {
      const res = await http()
        .post(`/chat/rooms/${roomIdInRoute}/messages`)
        .set(auth(Adm.token))
        .send({ body, clientMessageId: randomUUID() });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.id as string;
    }

    async function invite(roomId: string): Promise<string> {
      const res = await http()
        .post(`/chat/rooms/${roomId}/calls`)
        .set(auth(Adm.token))
        .send({ kind: "audio" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    }

    const removeMember = (roomIdInRoute: string, userIdInRoute: string) =>
      http().delete(`/chat/rooms/${roomIdInRoute}/members/${userIdInRoute}`).set(auth(Adm.token));

    async function leftAt(roomId: string, userId: string): Promise<Date | null> {
      const r = await direct.query(
        `SELECT left_at FROM chat_room_members WHERE room_id = $1 AND user_id = $2`,
        [roomId, userId],
      );
      return (r.rows[0]?.left_at as Date | null | undefined) ?? null;
    }

    async function participantOutcome(callId: string, userId: string): Promise<string | null> {
      const r = await direct.query(
        `SELECT outcome FROM chat_call_participants WHERE call_id = $1 AND user_id = $2`,
        [callId, userId],
      );
      return (r.rows[0]?.outcome as string | null | undefined) ?? null;
    }

    /** Room phía server của socket — chỉ để thông điệp ĐỎ nói được socket đang ở room NÀO. */
    async function roomsOf(nsp: Namespace, rec: WsRecorder): Promise<string[]> {
      const all = await nsp.local.fetchSockets();
      return [...(all.find((s) => s.id === rec.socket.id)?.rooms ?? [])];
    }

    /** Neo dương: Adm gửi một tin ở phòng neo (chữ thường), chờ MỌI socket trong `recs` nhận được. */
    async function anchor(recs: readonly WsRecorder[]): Promise<void> {
      const id = await send(AN, "neo");
      for (const rec of recs) await waitForEvent(rec, WS_EVENTS.CHAT_MESSAGE, "id", id);
    }

    const chatReady = (who: Who, roomId: string) =>
      connectChatReady(port, ws, who.token, chatRoomName(A.companyId, roomId), open);
    const inChat = (roomId: string, rec: WsRecorder) =>
      inRoom(ws, chatRoomName(A.companyId, roomId), rec);
    const inCall = (callId: string, rec: WsRecorder) =>
      inRoom(callNsp, callRoomName(A.companyId, callId), rec);

    beforeAll(async () => {
      process.env.REALTIME_ENABLED = "true";
      direct = directPool();
      A = await seedCompany(direct, "rtroops");
      companyIds.push(A.companyId);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = applyMainPipeline(moduleRef.createNestApplication());
      // ĐÚNG lời gọi của `main.ts` — WS đi qua adapter production (in-memory local · Valkey ở CI).
      await setupWebSocketAdapter(app as never, loadEnv());
      await app.listen(0);
      port = (app.getHttpServer().address() as AddressInfo).port;
      ws = gatewayNamespace(app);
      callNsp = callNamespace(app);

      const hash = await app.get(PasswordService).hash(LOGIN_PW);
      Adm = await actor("adm", hash);
      V1 = await actor("v1", hash);
      P1 = await actor("p1", hash);
      V2 = await actor("v2", hash);
      U4 = await actor("u4", hash);
      L5 = await actor("l5", hash);
      P5 = await actor("p5", hash);
      V6 = await actor("v6", hash);

      // Mọi phòng tạo TRƯỚC khi nối socket ⇒ gateway join chúng lúc connect (id đọc DB, chữ thường).
      AN = await newRoom("rtro neo", [V1, L5]);
      R1 = await newRoom("rtro r1", [V1, P1]);
      R2 = await newRoom("rtro r2", [V2]);
      R4 = await newRoom("rtro r4", [U4]);
      R5 = await newRoom("rtro r5", [L5, P5]);
      R6 = await newRoom("rtro r6", [V6]);
      // ⚓ id thật sự đổi khi viết HOA — nếu không, mọi ca chữ HOA dưới đây xanh-rỗng.
      for (const id of [R1, R2, R4, R5, V1.userId, V2.userId, A.companyId]) {
        expect(up(id), `id ${id} không có chữ hex a–f`).not.toBe(id);
      }
    }, 180_000);

    afterAll(async () => {
      while (open.length) open.pop()?.disconnect();
      if (app) await app.close();
      if (direct) {
        await cleanupTenants(direct, companyIds);
        await direct.end();
      }
    });

    it("🔒 R-1 gỡ thành viên với id phòng + id người dùng CHỮ HOA ⇒ socket `/ws` người bị gỡ RỜI phòng chat", async () => {
      sock.v1 = await chatReady(V1, R1);
      sock.p1 = await chatReady(P1, R1);

      const res = await removeMember(up(R1), up(V1.userId));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await leftAt(R1, V1.userId), "DB: V1 đã rời R1 (left_at)").not.toBeNull();

      expect(
        await becomes(async () => !(await inChat(R1, sock.v1))),
        `R-1: V1 PHẢI rời room phòng chat; room hiện có: ${(await roomsOf(ws, sock.v1)).join(" ")}`,
      ).toBe(true);
    });

    it("🔒 R-3a sau R-1, tin mới gửi bằng id phòng chữ thường ⇒ người ở lại nhận đúng 1, người bị gỡ 0", async () => {
      const m = await send(R1, "sau khi gỡ");
      await waitForEvent(sock.p1, WS_EVENTS.CHAT_MESSAGE, "id", m);
      await anchor([sock.v1]);

      expect(countEvents(sock.p1, WS_EVENTS.CHAT_MESSAGE, "id", m)).toBe(1);
      expect(
        countEvents(sock.v1, WS_EVENTS.CHAT_MESSAGE, "id", m),
        "R-3a: người đã bị gỡ KHÔNG được nhận tin mới của phòng",
      ).toBe(0);
    });

    it("🔒 R-3b gửi tin với id phòng CHỮ HOA ⇒ người ở lại VẪN nhận `chat:message`", async () => {
      const m = await send(up(R1), "id phòng chữ hoa");

      expect(
        await becomes(async () => countEvents(sock.p1, WS_EVENTS.CHAT_MESSAGE, "id", m) > 0),
        "R-3b: tin phải tới room phòng chuẩn tắc",
      ).toBe(true);
    });

    it("🔒 R-2 gỡ thành viên (id CHỮ HOA) GIỮA cuộc gọi ⇒ socket `/ws-call` người bị gỡ RỜI room cuộc gọi", async () => {
      call2 = await invite(R2);
      sock.v2c = await connectCallSocket(port, V2.token, open);
      sock.admc = await connectCallSocket(port, Adm.token, open);
      await joinCallReady(callNsp, sock.v2c, A.companyId, call2);
      await joinCallReady(callNsp, sock.admc, A.companyId, call2);

      const res = await removeMember(up(R2), up(V2.userId));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await leftAt(R2, V2.userId), "DB: V2 đã rời R2").not.toBeNull();
      expect(
        await participantOutcome(call2, V2.userId),
        "DB: phần tham gia cuộc gọi của V2 đã đóng",
      ).not.toBeNull();

      expect(
        await becomes(async () => !(await inCall(call2, sock.v2c))),
        `R-2: V2 PHẢI rời room cuộc gọi; room hiện có: ${(await roomsOf(callNsp, sock.v2c)).join(" ")}`,
      ).toBe(true);
    });

    it("🔒 R-4 `call:join` với `callId` CHỮ HOA ⇒ socket vào room cuộc gọi CHUẨN TẮC", async () => {
      const callId = await invite(R4);
      const u4c = await connectCallSocket(port, U4.token, open);

      u4c.socket.emit("call:join", { callId: up(callId) });

      expect(
        await becomes(() => inCall(callId, u4c)),
        `R-4: phải ở room cuộc gọi chuẩn tắc; room hiện có: ${(await roomsOf(callNsp, u4c)).join(" ")}`,
      ).toBe(true);
    });

    it("🔒 R-5 tự rời phòng (2 thiết bị) với id phòng CHỮ HOA ⇒ cả 2 socket rời; người ở lại nhận đúng 1 `left`; tin sau đó không tới người đã rời", async () => {
      sock.l5a = await chatReady(L5, R5);
      sock.l5b = await chatReady(L5, R5);
      sock.p5 = await chatReady(P5, R5);

      const res = await http()
        .post(`/chat/rooms/${up(R5)}/leave`)
        .set(auth(L5.token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await leftAt(R5, L5.userId), "DB: L5 đã rời R5").not.toBeNull();

      expect(
        await becomes(async () => !(await inChat(R5, sock.l5a)) && !(await inChat(R5, sock.l5b))),
        `R-5: CẢ HAI socket của L5 phải rời room phòng; room hiện có: ${(await roomsOf(ws, sock.l5a)).join(" ")}`,
      ).toBe(true);
      expect(
        await becomes(async () => countEvents(sock.p5, WS_EVENTS.CHAT_ROOM, "action", "left") > 0),
        "R-5: người ở lại phải nhận `chat:room` action=left",
      ).toBe(true);
      expect(countEvents(sock.p5, WS_EVENTS.CHAT_ROOM, "action", "left")).toBe(1);

      const m = await send(R5, "sau khi rời");
      await waitForEvent(sock.p5, WS_EVENTS.CHAT_MESSAGE, "id", m);
      await anchor([sock.l5a, sock.l5b]);
      expect(
        countEvents(sock.l5a, WS_EVENTS.CHAT_MESSAGE, "id", m) +
          countEvents(sock.l5b, WS_EVENTS.CHAT_MESSAGE, "id", m),
        "R-5: người đã tự rời KHÔNG được nhận tin mới của phòng",
      ).toBe(0);
    });

    it("A-1 ALLOW: người ở lại VẪN ở room phòng chat và room cuộc gọi sau R-1/R-2/R-5", async () => {
      expect(await inChat(R1, sock.p1), "P1 ở R1").toBe(true);
      expect(await inCall(call2, sock.admc), "Adm ở room cuộc gọi của R2").toBe(true);
      expect(await inChat(R5, sock.p5), "P5 ở R5").toBe(true);
    });

    it("A-2 ALLOW: cùng luồng với id CHỮ THƯỜNG ⇒ người bị gỡ rời phòng (đường đúng không đổi)", async () => {
      const v6 = await chatReady(V6, R6);

      const res = await removeMember(R6, V6.userId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await leftAt(R6, V6.userId)).not.toBeNull();

      expect(await becomes(async () => !(await inChat(R6, v6)))).toBe(true);
    });
  },
);
