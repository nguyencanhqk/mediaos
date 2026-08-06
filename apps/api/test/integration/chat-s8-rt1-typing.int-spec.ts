/**
 * S8-CHAT-UX-RT-1 — CHAT-API-023 `POST /chat/rooms/:id/typing` trên đường THẬT (CHAT-DEC-017).
 *
 * Phủ 4 mệnh đề mà unit test KHÔNG chứng minh nổi vì chúng nói về pipeline guard + DB thật:
 *   • deny-path: không-thành-viên ⇒ 404 **mang mã CHAT-ERR-001**, thiếu cặp `send:chat-message` ⇒ 403;
 *   • phòng-lạ và phòng-không-thuộc trả PHẢN HỒI GIỐNG HỆT NHAU (không thành oracle dò);
 *   • 0 ghi DB · 0 audit (đếm `audit_logs` + `chat_messages` trước/sau);
 *   • route ĐÃ gắn `PermissionGuard` — guard là opt-in per-route ở dự án này, quên là route MỞ, im lặng.
 *
 * ⚠️ **CHỐNG XANH-GIẢ.** Một 404 từ "route không tồn tại" trông y hệt 404 của CHAT-ERR-001. Ca deny-path
 * vì vậy assert **mã lỗi trong thân phản hồi**, không chỉ status; và ca positive (204) là bằng chứng RED
 * thật sự — trước khi có route nó trả 404.
 *
 * GATE CỨNG `hasDb && LANE_DB`.
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
import { ChatRoomsRepository } from "../../src/chat/chat-rooms.repository";
import { DatabaseService } from "../../src/db/db.service";
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
const LOGIN_PW = "Passw0rd!s8rt1typing";
const UNKNOWN_ROOM = "00000000-0000-4000-8000-0000000000ff";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/** Bộ ĐỦ — dùng cho người tạo phòng và người gõ hợp lệ. */
const PAIRS_FULL: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
];

/**
 * Bộ THIẾU đúng một cặp: `send:chat-message`. Đây là chủ thể của ca 403 — người ĐỌC được phòng (nên
 * không thể trả 404 để giấu) nhưng không được phép báo "đang gõ".
 */
const PAIRS_NO_SEND: PairGrant[] = PAIRS_FULL.filter(
  ([a, r]) => !(a === "send" && r === "chat-message"),
);

describe.skipIf(!hasLaneDb)(
  "S8-CHAT-UX-RT-1 — CHAT-API-023 đang gõ (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
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
    let archivedRoomId = "";

    async function grantPairs(userId: string, label: string, pairs: PairGrant[]): Promise<void> {
      const roleId = await seedRole(direct, A.companyId, `s8rt1-${label}-${userId.slice(0, 8)}`);
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

    const typingUrl = (id: string) => `/chat/rooms/${id}/typing`;
    const authPost = (t: string, u: string) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

    async function countRows(table: "audit_logs" | "chat_messages"): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE company_id = $1`,
        [A.companyId],
      );
      return r.rows[0].n as number;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "s8rt1typing");
      companyIds.push(A.companyId);

      const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
      uOwner = await mk("owner");
      uMate = await mk("mate");
      uNoSend = await mk("nosend");
      uOutsider = await mk("outsider");

      await grantPairs(uOwner, "owner", PAIRS_FULL);
      await grantPairs(uMate, "mate", PAIRS_FULL);
      await grantPairs(uNoSend, "nosend", PAIRS_NO_SEND);
      // Người ngoài có ĐỦ cặp quyền — chỉ KHÔNG phải thành viên phòng. Đây là điều làm ca 404 có nghĩa:
      // nó chứng minh membership là hàng rào, chứ không phải cặp quyền đang chặn.
      await grantPairs(uOutsider, "outsider", PAIRS_FULL);

      tOwner = await login(`owner@${A.slug}.test`);
      tMate = await login(`mate@${A.slug}.test`);
      tNoSend = await login(`nosend@${A.slug}.test`);
      tOutsider = await login(`outsider@${A.slug}.test`);

      const room = await authPost(tOwner, "/chat/rooms").send({
        name: "Phòng gõ thử",
        memberUserIds: [uMate, uNoSend],
      });
      expect(room.status, JSON.stringify(room.body)).toBe(201);
      roomId = room.body.data.id as string;

      const archived = await authPost(tOwner, "/chat/rooms").send({
        name: "Phòng đã lưu trữ",
        memberUserIds: [uMate],
      });
      expect(archived.status, JSON.stringify(archived.body)).toBe(201);
      archivedRoomId = archived.body.data.id as string;
      const arch = await authPost(tOwner, `/chat/rooms/${archivedRoomId}/archive`).send({});
      expect(arch.status, JSON.stringify(arch.body)).toBe(200);
    }, 120_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.close();
    });

    // ── deny-path (RED trước) ─────────────────────────────────────────────────────

    it("ca 1: KHÔNG phải thành viên ⇒ 404 mang mã CHAT-ERR-001 (không phải 404 của route lạ)", async () => {
      const res = await authPost(tOutsider, typingUrl(roomId)).send({});

      expect(res.status).toBe(404);
      // Mã lỗi trong thân là thứ phân biệt "route không tồn tại" với "phòng không thuộc về bạn" — thiếu
      // assert này thì ca test XANH cả khi route chưa được viết.
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
    });

    it("ca 2: phòng KHÔNG TỒN TẠI trả phản hồi GIỐNG HỆT phòng-không-thuộc (không oracle dò)", async () => {
      const unknown = await authPost(tOutsider, typingUrl(UNKNOWN_ROOM)).send({});
      const notMine = await authPost(tOutsider, typingUrl(roomId)).send({});

      expect(unknown.status).toBe(notMine.status);
      expect(unknown.body.error?.code ?? unknown.body.code).toEqual(
        notMine.body.error?.code ?? notMine.body.code,
      );
    });

    it("ca 3: là thành viên nhưng THIẾU cặp send:chat-message ⇒ 403 (không phải 404)", async () => {
      // 403 đúng ở đây: người này đã đọc được phòng, giấu sự tồn tại của nó không che được gì.
      const res = await authPost(tNoSend, typingUrl(roomId)).send({});

      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("ca 4: chưa đăng nhập ⇒ 401 (pipeline guard toàn cục chạy trước)", async () => {
      const res = await request(app.getHttpServer()).post(typingUrl(roomId)).send({});

      expect(res.status).toBe(401);
    });

    // ── đường chạy được ───────────────────────────────────────────────────────────

    it("ca 5: thành viên đủ quyền ⇒ 204 KHÔNG THÂN (bằng chứng RED: trước khi có route là 404)", async () => {
      const res = await authPost(tMate, typingUrl(roomId)).send({});

      expect(res.status, JSON.stringify(res.body)).toBe(204);
      expect(res.body).toEqual({});
    });

    it("ca 6: 🔒 0 GHI DB · 0 AUDIT — 5 ping liên tiếp không đẻ một hàng nào", async () => {
      const auditBefore = await countRows("audit_logs");
      const msgBefore = await countRows("chat_messages");

      for (let i = 0; i < 5; i++) {
        const res = await authPost(tMate, typingUrl(roomId)).send({});
        expect(res.status).toBe(204);
      }

      expect(await countRows("audit_logs"), "typing KHÔNG được ghi audit").toBe(auditBefore);
      expect(await countRows("chat_messages"), "typing KHÔNG được ghi tin nhắn").toBe(msgBefore);
    });

    it("ca 7: phòng đã lưu trữ ⇒ vẫn 204 (không mã lỗi mới cho việc mỹ thuật)", async () => {
      const res = await authPost(tMate, typingUrl(archivedRoomId)).send({});

      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    it("ca 8: roomId không phải UUID ⇒ 400 từ ParseUUIDPipe, không lọt xuống service", async () => {
      const res = await authPost(tMate, typingUrl("khong-phai-uuid")).send({});

      expect(res.status).toBe(400);
    });

    // ── presence: truy vấn peer DM chạy trên SQL THẬT ───────────────────────────
    //
    // `listDirectPeerUserIds` là self-join có `alias()`. Đúng họ truy vấn mà một lỗi tham chiếu làm nó
    // LUÔN trả rỗng trong khi SQL vẫn hợp lệ (memory `drizzle-sql-template-renders-columns-unqualified`)
    // — rỗng ở đây nghĩa là `chat:presence` không bao giờ tới ai, IM LẶNG. Chỉ Postgres thật chứng minh nổi.
    describe("listDirectPeerUserIds (nguồn người nhận chat:presence)", () => {
      let repo: ChatRoomsRepository;
      let db: DatabaseService;

      beforeAll(async () => {
        repo = app.get(ChatRoomsRepository);
        db = app.get(DatabaseService);
        const dm = await authPost(tOwner, "/chat/rooms/direct").send({ peerUserId: uMate });
        expect(dm.status, JSON.stringify(dm.body)).toBe(200);
      });

      const peersOf = (userId: string) =>
        db.withTenant(A.companyId, (tx) => repo.listDirectPeerUserIds(tx, A.companyId, userId));

      it("ca 9: trả ĐÚNG người kia của phòng direct (positive control — không phải luôn rỗng)", async () => {
        expect(await peersOf(uOwner)).toEqual([uMate]);
      });

      it("ca 10: quan hệ HAI CHIỀU — cả hai phía thấy nhau", async () => {
        expect(await peersOf(uMate)).toContain(uOwner);
      });

      it("ca 11: KHÔNG bao giờ tự trả chính mình", async () => {
        expect(await peersOf(uOwner)).not.toContain(uOwner);
      });

      it("ca 12: 🔒 phòng NHÓM không sinh peer — presence chỉ đi theo DM (CHAT-FUNC-021)", async () => {
        // `uNoSend` chung phòng NHÓM với owner nhưng KHÔNG có DM nào. Nếu vị từ `room_type='direct'`
        // trôi, người này lọt vào danh sách và presence fan-out ra cả phòng phòng-ban — biến trạng thái
        // online thành bảng chấm công thời gian thực mà SPEC-15 không cấp phép.
        expect(await peersOf(uNoSend)).toEqual([]);
      });

      it("ca 13: không có phòng direct nào ⇒ rỗng (emitter bỏ qua, không phát cả namespace)", async () => {
        expect(await peersOf(uOutsider)).toEqual([]);
      });
    });
  },
);
