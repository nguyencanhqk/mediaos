/**
 * S8-CHAT-UX-BE-3 — thả cảm xúc trên đường THẬT (CHAT-API-022a/022b · CHAT-DEC-018).
 *
 * Phủ 6 mệnh đề mà unit test KHÔNG chứng minh nổi:
 *   • deny-path: react tin ở phòng KHÔNG thuộc ⇒ **404 mang mã CHAT-ERR-001**, và tin-lạ trả phản hồi
 *     GIỐNG HỆT (không thành oracle dò trên trục TIN);
 *   • idempotent THẬT ở DB: `PUT` hai lần ⇒ đếm hàng = **1** (unique 4 cột + ON CONFLICT DO NOTHING);
 *   • `DELETE` khi chưa thả ⇒ **204**, không 404;
 *   • CHECK emoji cấp DB còn sống (đai thứ ba, sau Zod và service);
 *   • **KHÔNG N+1**: đọc một trang 20 tin gọi `aggregateForMessages` ĐÚNG MỘT lần, và lần đó mang
 *     TOÀN BỘ id của trang;
 *   • cô lập tenant: 0 hàng reaction rò giữa hai công ty.
 *
 * ⚠️ **CHỐNG XANH-GIẢ.** 404 của "route chưa tồn tại" trông y hệt 404 của CHAT-ERR-001 ⇒ mọi ca
 * deny-path assert MÃ trong thân, không chỉ status.
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { ChatReactionsRepository } from "../../src/chat/chat-reactions.repository";
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
const LOGIN_PW = "Passw0rd!s8be3react";
const UNKNOWN_MSG = "00000000-0000-4000-8000-0000000000fd";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

const PAIRS_FULL: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
  ["recall", "chat-message", "Company"],
  ["pin", "chat-message", "Company"],
];

/** Thiếu ĐÚNG `send:chat-message` — chủ thể của ca 403 (đọc được phòng nhưng không được ghi). */
const PAIRS_NO_SEND: PairGrant[] = PAIRS_FULL.filter(
  ([a, r]) => !(a === "send" && r === "chat-message"),
);

describe.skipIf(!hasLaneDb)("S8-CHAT-UX-BE-3 — thả cảm xúc (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let reactionsRepo: ChatReactionsRepository;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let uOwner = "";
  let uMate = "";
  let uNoSend = "";
  let uOutsider = "";
  let tOwner = "";
  let tMate = "";
  let tNoSend = "";
  let tOutsider = "";
  let roomId = "";
  let msgId = "";
  let recalledMsgId = "";
  /** Tin trong phòng ĐÃ LƯU TRỮ — chủ thể của ca đường-ghi-bị-đóng-băng. */
  let archivedMsgId = "";

  async function grantPairs(userId: string, label: string, pairs: PairGrant[]): Promise<void> {
    const roleId = await seedRole(direct, A.companyId, `s8be3-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  const srv = () => request(app.getHttpServer());
  const authPut = (t: string, u: string) => srv().put(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) => srv().post(u).set("Authorization", `Bearer ${t}`);
  const authDel = (t: string, u: string) => srv().delete(u).set("Authorization", `Bearer ${t}`);
  const authGet = (t: string, u: string) => srv().get(u).set("Authorization", `Bearer ${t}`);

  const reactUrl = (m: string, e: string) => `/chat/messages/${m}/reactions/${e}`;

  async function sendMessage(token: string, room: string, body: string, cid: string) {
    const res = await authPost(token, `/chat/rooms/${room}/messages`).send({
      body,
      clientMessageId: cid,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  async function reactionRowCount(messageId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM chat_message_reactions WHERE message_id = $1`,
      [messageId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    reactionsRepo = app.get(ChatReactionsRepository, { strict: false });

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s8be3react");
    B = await seedCompany(direct, "s8be3other");
    companyIds.push(A.companyId, B.companyId);

    const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uOwner = await mk("owner");
    uMate = await mk("mate");
    uNoSend = await mk("nosend");
    uOutsider = await mk("outsider");

    await grantPairs(uOwner, "owner", PAIRS_FULL);
    await grantPairs(uMate, "mate", PAIRS_FULL);
    await grantPairs(uNoSend, "nosend", PAIRS_NO_SEND);
    // Người ngoài có ĐỦ cặp quyền — chỉ KHÔNG phải thành viên. Đó là điều làm ca 404 có nghĩa.
    await grantPairs(uOutsider, "outsider", PAIRS_FULL);

    tOwner = await login(`owner@${A.slug}.test`);
    tMate = await login(`mate@${A.slug}.test`);
    tNoSend = await login(`nosend@${A.slug}.test`);
    tOutsider = await login(`outsider@${A.slug}.test`);

    const room = await authPost(tOwner, "/chat/rooms").send({
      name: "Phòng cảm xúc",
      memberUserIds: [uMate, uNoSend],
    });
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    roomId = room.body.data.id as string;

    msgId = await sendMessage(
      tOwner,
      roomId,
      "tin để thả cảm xúc",
      "aaaaaaaa-0000-4000-8000-000000000001",
    );
    recalledMsgId = await sendMessage(
      tOwner,
      roomId,
      "tin sẽ bị thu hồi",
      "aaaaaaaa-0000-4000-8000-000000000002",
    );
    const recall = await authPost(tOwner, `/chat/messages/${recalledMsgId}/recall`).send({});
    expect(recall.status, JSON.stringify(recall.body)).toBe(200);

    const archivedRoom = await authPost(tOwner, "/chat/rooms").send({
      name: "Phòng sẽ lưu trữ",
      memberUserIds: [uMate],
    });
    expect(archivedRoom.status).toBe(201);
    const archivedRoomId = archivedRoom.body.data.id as string;
    archivedMsgId = await sendMessage(
      tOwner,
      archivedRoomId,
      "tin trong phòng sắp đóng",
      "aaaaaaaa-0000-4000-8000-000000000003",
    );
    const arch = await authPost(tOwner, `/chat/rooms/${archivedRoomId}/archive`).send({});
    expect(arch.status, JSON.stringify(arch.body)).toBe(200);
  }, 180_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── deny-path (RED trước) ───────────────────────────────────────────────────

  it("ca 1 — react tin ở phòng KHÔNG thuộc ⇒ 404 mang mã CHAT-ERR-001", async () => {
    const res = await authPut(tOutsider, reactUrl(msgId, "like")).send({});

    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
    expect(await reactionRowCount(msgId)).toBe(0);
  });

  it("ca 2 — tin KHÔNG TỒN TẠI trả phản hồi GIỐNG HỆT tin-không-thuộc (không oracle dò)", async () => {
    const unknown = await authPut(tOutsider, reactUrl(UNKNOWN_MSG, "like")).send({});
    const notMine = await authPut(tOutsider, reactUrl(msgId, "like")).send({});

    expect(unknown.status).toBe(notMine.status);
    expect(unknown.body.error?.message ?? unknown.body.message).toEqual(
      notMine.body.error?.message ?? notMine.body.message,
    );
  });

  it("ca 3 — là thành viên nhưng THIẾU cặp send:chat-message ⇒ 403 (không phải 404)", async () => {
    const res = await authPut(tNoSend, reactUrl(msgId, "like")).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("ca 4 — chưa đăng nhập ⇒ 401", async () => {
    const res = await srv().put(reactUrl(msgId, "like")).send({});
    expect(res.status).toBe(401);
  });

  // ── idempotent THẬT ở DB ────────────────────────────────────────────────────

  it("ca 5 — PUT hai lần ⇒ ĐÚNG 1 hàng trong DB (unique 4 cột + ON CONFLICT DO NOTHING)", async () => {
    const first = await authPut(tMate, reactUrl(msgId, "like")).send({});
    const second = await authPut(tMate, reactUrl(msgId, "like")).send({});

    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    // Đếm hàng THẬT — hai lần 200 không nói gì về số hàng.
    expect(await reactionRowCount(msgId)).toBe(1);
    expect(second.body.data).toEqual([{ emoji: "like", count: 1, mine: true }]);
  });

  it("ca 6 — cùng người thả NHIỀU emoji khác nhau trên cùng tin ⇒ nhiều hàng, không đè nhau", async () => {
    const love = await authPut(tMate, reactUrl(msgId, "love")).send({});
    expect(love.status).toBe(200);

    expect(await reactionRowCount(msgId)).toBe(2);
    // Sắp theo emoji ⇒ thứ tự ỔN ĐỊNH giữa các lần tải (thanh cảm xúc không nhảy chỗ mỗi lần cuộn).
    expect(love.body.data).toEqual([
      { emoji: "like", count: 1, mine: true },
      { emoji: "love", count: 1, mine: true },
    ]);
  });

  it("ca 7 — `mine` đúng theo TỪNG NGƯỜI: count dùng chung, mine thì không", async () => {
    const owner = await authPut(tOwner, reactUrl(msgId, "like")).send({});
    expect(owner.status).toBe(200);

    const forOwner = (owner.body.data as { emoji: string; count: number; mine: boolean }[]).find(
      (r) => r.emoji === "like",
    );
    expect(forOwner).toEqual({ emoji: "like", count: 2, mine: true });

    // Cùng một tin, nhìn bằng con mắt người thứ ba (chưa thả `like`) ⇒ count vẫn 2, mine = false.
    const page = await authGet(tNoSend, `/chat/rooms/${roomId}/messages`);
    expect(page.status).toBe(200);
    const msg = (page.body.data as { id: string; reactions?: unknown[] }[]).find(
      (m) => m.id === msgId,
    );
    expect(msg?.reactions).toEqual(
      expect.arrayContaining([{ emoji: "like", count: 2, mine: false }]),
    );
  });

  it("ca 8 — DELETE khi CHƯA thả ⇒ 204, KHÔNG 404", async () => {
    // `tMate` — người CÓ đủ quyền và ĐANG ở trong phòng, chỉ là chưa từng thả `haha`. Dùng `tNoSend`
    // ở đây sẽ đo nhầm thứ khác: người đó thiếu `send:chat-message` nên nhận 403 từ `PermissionGuard`,
    // và ca test sẽ nói về cổng QUYỀN chứ không về tính idempotent của đường gỡ.
    const res = await authDel(tMate, reactUrl(msgId, "haha")).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(204);
  });

  it("ca 9 — DELETE gỡ đúng hàng của MÌNH, không đụng của người khác", async () => {
    const before = await reactionRowCount(msgId);
    const res = await authDel(tMate, reactUrl(msgId, "like")).send({});

    expect(res.status).toBe(204);
    expect(await reactionRowCount(msgId)).toBe(before - 1);

    // `like` của owner còn nguyên.
    const r = await direct.query(
      `SELECT user_id FROM chat_message_reactions WHERE message_id = $1 AND emoji = 'like'`,
      [msgId],
    );
    expect(r.rows.map((x) => x.user_id)).toEqual([uOwner]);
  });

  // ── đường GHI chặt, đường GỠ nới ────────────────────────────────────────────

  it("ca 10 — react tin ĐÃ THU HỒI ⇒ 422 CHAT-ERR-024", async () => {
    const res = await authPut(tMate, reactUrl(recalledMsgId, "like")).send({});

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-024");
    expect(await reactionRowCount(recalledMsgId)).toBe(0);
  });

  it("ca 11 — react trong phòng ĐÃ LƯU TRỮ ⇒ 422 CHAT-ERR-005; nhưng BỎ thả vẫn 204", async () => {
    const blocked = await authPut(tMate, reactUrl(archivedMsgId, "like")).send({});
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain("CHAT-ERR-005");

    // Đường GỠ cố ý KHÔNG bị chặn — nếu không, một cảm xúc thả nhầm ngay trước khi phòng đóng sẽ dính
    // vĩnh viễn, không có đường sửa qua API.
    const gone = await authDel(tMate, reactUrl(archivedMsgId, "like")).send({});
    expect(gone.status).toBe(204);
  });

  it("ca 12 — emoji NGOÀI bộ đóng ⇒ 422 CHAT-ERR-025", async () => {
    const res = await authPut(tMate, reactUrl(msgId, "fire")).send({});

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-025");
  });

  it("ca 13 — CHECK cấp DB còn sống: ghi thẳng emoji lạ ⇒ 23514 (đai thứ ba, sau Zod + service)", async () => {
    // Đường API đã chặn ở ca 12. Ca này chứng minh đai DƯỚI vẫn còn: gỡ Zod đi thì DB vẫn từ chối.
    await expect(
      direct.query(
        `INSERT INTO chat_message_reactions (company_id, message_id, user_id, emoji)
         VALUES ($1, $2, $3, 'fire')`,
        [A.companyId, msgId, uMate],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  // ── tin đã thu hồi che luôn cảm xúc ─────────────────────────────────────────

  it("ca 14 — cảm xúc thả TRƯỚC khi thu hồi biến mất khỏi DTO (cùng lớp che với body)", async () => {
    const target = await sendMessage(
      tOwner,
      roomId,
      "tin có cảm xúc rồi mới thu hồi",
      "aaaaaaaa-0000-4000-8000-000000000004",
    );
    expect((await authPut(tMate, reactUrl(target, "wow")).send({})).status).toBe(200);
    expect(await reactionRowCount(target)).toBe(1);

    expect((await authPost(tOwner, `/chat/messages/${target}/recall`).send({})).status).toBe(200);

    const page = await authGet(tMate, `/chat/rooms/${roomId}/messages`);
    const msg = (page.body.data as { id: string; body: unknown; reactions?: unknown[] }[]).find(
      (m) => m.id === target,
    );
    expect(msg?.body).toBeNull();
    expect(msg?.reactions).toEqual([]);
    // Hàng vẫn nằm trong DB — che ở DTO, KHÔNG xoá dữ liệu vì một thao tác hiển thị.
    expect(await reactionRowCount(target)).toBe(1);
  });

  // ── không N+1 ───────────────────────────────────────────────────────────────

  it("ca 15 — trang 20 tin: aggregateForMessages gọi ĐÚNG MỘT lần, mang TOÀN BỘ id của trang", async () => {
    for (let i = 0; i < 20; i += 1) {
      await sendMessage(
        tOwner,
        roomId,
        `tin lô ${i}`,
        `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`,
      );
    }

    // Đo trên CHÍNH instance repo mà app đang dùng (lấy từ DI container), không phải trên pool riêng
    // của test — đó là điểm khác biệt giữa một phép đo thật và một con số trang trí.
    const spy = vi.spyOn(reactionsRepo, "aggregateForMessages");
    try {
      const page = await authGet(tMate, `/chat/rooms/${roomId}/messages?limit=20`);
      expect(page.status, JSON.stringify(page.body)).toBe(200);
      const msgs = page.body.data as { id: string; recalledAt: string | null }[];
      expect(msgs.length).toBe(20);

      // MỘT lần gọi cho cả trang. N+1 sẽ cho 20.
      expect(spy).toHaveBeenCalledTimes(1);

      // …và lần gọi đó mang đủ id của mọi tin CHƯA thu hồi trong trang (tin đã thu hồi bị loại khỏi lô
      // từ trước — DTO của chúng luôn `reactions: []`). Thiếu vế này thì "1 lần gọi" vẫn có thể là 1
      // lần gọi cho 1 tin, còn 19 tin kia im lặng mất cảm xúc.
      const idsAsked = spy.mock.calls[0][2] as readonly string[];
      const liveIds = msgs.filter((m) => m.recalledAt === null).map((m) => m.id);
      expect([...idsAsked].sort()).toEqual([...liveIds].sort());
    } finally {
      spy.mockRestore();
    }
  });

  // ── cô lập tenant ───────────────────────────────────────────────────────────

  it("ca 16 — cô lập: 0 hàng reaction nào thuộc công ty B", async () => {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM chat_message_reactions WHERE company_id = $1`,
      [B.companyId],
    );
    expect(r.rows[0].n).toBe(0);
  });
});
