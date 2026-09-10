/**
 * S17-CHAT-UX2-BE-2 — `CHAT-API-031` `GET /chat/rooms/:id/links` trên đường THẬT
 * (SPEC-15 §15b · API-13 §5.1d(4)(5)(6) · CHAT-DEC-025).
 *
 * Phủ đúng những mệnh đề mà unit test KHÔNG chứng minh nổi vì chúng nói về SQL/HTTP thật:
 *   • **membership là hàng rào**, không phải cặp quyền — người ngoài có ĐỦ cặp vẫn 404;
 *   • **oversight KHÔNG được miễn `assertMember`** (BLOCKING 2): actor có `('view','chat-oversight')`
 *     mà không thuộc phòng nhận 404 y hệt người lạ, và **không có** đường `/chat/oversight/…/links`;
 *   • cross-tenant ⇒ 404 (RLS + `assertMember` cùng chiều);
 *   • tin **thu hồi** và tin **`system`** vắng mặt — hai vị từ khác nhau, ghi bởi hai câu lệnh khác nhau;
 *   • **chạm trần quét** (BLOCKING 4) đo trên dữ liệu thật, kèm ca ÂM;
 *   • con trỏ mang **vân phòng** ⇒ dùng chéo phòng là 400, không phải một trang cắt sai lặng lẽ.
 *
 * ⚠️ **CHỐNG XANH-RỖNG.** Mỗi ca deny có ca ALLOW đối chứng assert MÃ TRẠNG THÁI CHÍNH XÁC
 * (`toBe(200)`, KHÔNG `.not.toBe(403)` — vế phủ định nuốt luôn 500,
 * memory `allow-counter-case-not-403-lets-500-through`).
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
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
const LOGIN_PW = "Passw0rd!s17be2links";
const UNKNOWN_ROOM = "00000000-0000-4000-8000-0000000000fd";

/** Trần quét của `ChatLinksService` — con số này là hợp đồng của API-13 §5.1d(6). */
const SCAN_CAP = 50;

/** Tên hiển thị của người gửi — ca 7 so ĐÚNG chuỗi này, không so `!== null`. */
const OWNER_NAME = "Nguyễn Người Gửi";

type Scope = "Own" | "Team" | "Department" | "Company";
/**
 * `[action, resource, scope, isSensitive]`.
 *
 * ⚠️ Vế `isSensitive` PHẢI khớp catalog TOÀN CỤC (`permissions` không có `company_id` nên
 * `cleanupTenants` không dọn nó). Truyền sai là đòi ĐỔI cờ của một cặp sản phẩm — fixture guard chặn,
 * và nếu không chặn thì nó đóng dấu vĩnh viễn lên lane DB dùng chung
 * (memory `test-fixture-stamps-global-permission-catalog`).
 */
const PAIRS: [string, string, Scope, boolean][] = [
  ["view", "chat-room", "Company", false],
  ["create", "chat-room", "Company", false],
  ["manage", "chat-member", "Company", false],
  ["send", "chat-message", "Company", false],
  // Thu hồi là cặp RIÊNG (API-13 §5.1) — thiếu nó thì ca "tin thu hồi vắng mặt" ăn 403 `deny-default`
  // và ta đi sửa nhầm chỗ.
  ["recall", "chat-message", "Company", false],
];

interface LinkRow {
  messageId: string;
  roomSeq: number;
  linkIndex: number;
  url: string;
  senderId: string;
  senderName: string | null;
  createdAt: string;
}

interface LinksBody {
  data: LinkRow[];
  nextCursor: string | null;
  truncated: boolean;
}

describe.skipIf(!hasLaneDb)(
  "S17-CHAT-UX2-BE-2 — CHAT-API-031 /links (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let uOwner = "";
    let uMate = "";
    let uOutsider = "";
    let uWatcher = "";
    let uB = "";
    let tOwner = "";
    let tOutsider = "";
    let tWatcher = "";
    let tB = "";

    let room = "";

    const srv = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => srv().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => srv().post(u).set("Authorization", `Bearer ${t}`);

    async function grantPairs(
      companyId: string,
      userId: string,
      label: string,
      extra: [string, string, Scope, boolean][] = [],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `s17be2-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope, sensitive] of [...PAIRS, ...extra]) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await srv()
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function createGroup(token: string, name: string, members: string[]): Promise<string> {
      const res = await authPost(token, "/chat/rooms").send({ name, memberUserIds: members });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    }

    async function send(token: string, roomId: string, body: string): Promise<string> {
      const res = await authPost(token, `/chat/rooms/${roomId}/messages`).send({
        body,
        clientMessageId: randomUUID(),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.id as string;
    }

    /**
     * Cắm N tin THẲNG DB, `room_seq` LIÊN TỤC tiếp sau tin cuối + bump `chat_rooms.last_message_seq`.
     *
     * ⚠️ Cả hai vế đều bắt buộc, không phải vệ sinh: `s7-chat-db1-invariants.int-spec.ts` gác
     * "room_seq liên tục từ 1 trong TỪNG phòng", và `last_message_seq` là nguồn của phép trừ đếm chưa
     * đọc. Cắm lệch là dựng ra một trạng thái đường sản xuất không bao giờ tạo được.
     *
     * Không đi qua `POST …/messages` vì ca chạm trần cần >50 tin = >50 transaction cho một ca chỉ cần ĐỦ
     * HÀNG; và `message_type='system'` thì KHÔNG có đường API nào sinh ra (đo 09/09/2026: 0 writer).
     */
    async function seedMessages(
      roomId: string,
      rows: readonly { body: string; messageType?: string; recalled?: boolean }[],
    ): Promise<void> {
      for (const r of rows) {
        const bumped = await direct.query<{ last_message_seq: string }>(
          `UPDATE chat_rooms SET last_message_seq = COALESCE(last_message_seq, 0) + 1, last_message_at = now()
          WHERE id = $1 AND company_id = $2 RETURNING last_message_seq`,
          [roomId, A.companyId],
        );
        expect(bumped.rowCount, "không bump được last_message_seq").toBe(1);
        await direct.query(
          `INSERT INTO chat_messages (company_id, room_id, sender_id, body, message_type, room_seq, recalled_at, recalled_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            A.companyId,
            roomId,
            uOwner,
            r.body,
            r.messageType ?? "text",
            Number(bumped.rows[0].last_message_seq),
            r.recalled ? new Date() : null,
            r.recalled ? uOwner : null,
          ],
        );
      }
    }

    async function links(
      token: string,
      roomId: string,
      query: Record<string, string | number> = {},
    ): Promise<LinksBody> {
      const qs = new URLSearchParams(
        Object.entries(query).map(([k, v]): [string, string] => [k, String(v)]),
      ).toString();
      const res = await authGet(token, `/chat/rooms/${roomId}/links${qs ? `?${qs}` : ""}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data as LinksBody;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      // S18-QA-SUPERTESTLISTEN-1 — supertest đóng server dùng chung khi request ĐẦU về nếu chỉ `init()`.
      await app.listen(0);

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "s17be2links");
      B = await seedCompany(direct, "s17be2other");
      companyIds.push(A.companyId, B.companyId);

      const mkA = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
      uOwner = await mkA("owner");
      uMate = await mkA("mate");
      uOutsider = await mkA("outsider");
      uWatcher = await mkA("watcher");
      uB = await seedUser(direct, B.companyId, `b@${B.slug}.test`, hash);

      // `seedUser` KHÔNG set `full_name` ⇒ `users.full_name` NULL. Đặt tên thật cho người gửi để ca 7
      // so được ĐÚNG CHUỖI: assert `senderName !== null` trên một fixture vốn luôn null là ca xanh-RỖNG
      // (nó xanh y hệt cả khi DTO bỏ hẳn khoá này).
      await direct.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [OWNER_NAME, uOwner]);

      await grantPairs(A.companyId, uOwner, "owner");
      await grantPairs(A.companyId, uMate, "mate");
      // Người ngoài có ĐỦ cặp — chỉ KHÔNG phải thành viên. Đó là điều làm ca 404 có nghĩa.
      await grantPairs(A.companyId, uOutsider, "outsider");
      // «Người giám sát» có THÊM `view:chat-oversight` — cặp mạnh nhất của module. Nếu nó mở được
      // `/links` của phòng mình không thuộc thì BLOCKING 2 đã vỡ.
      // `view:chat-oversight` là cặp NHẠY CẢM trong catalog chính tắc — truyền đúng cờ `true`,
      // KHÔNG ghi đè (đo được: fixture guard chặn ngay).
      await grantPairs(A.companyId, uWatcher, "watcher", [
        ["view", "chat-oversight", "Company", true],
      ]);
      await grantPairs(B.companyId, uB, "b");

      tOwner = await login(A.slug, `owner@${A.slug}.test`);
      tOutsider = await login(A.slug, `outsider@${A.slug}.test`);
      tWatcher = await login(A.slug, `watcher@${A.slug}.test`);
      tB = await login(B.slug, `b@${B.slug}.test`);

      room = await createGroup(tOwner, "Phòng liên kết", [uMate]);
    }, 240_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.close();
    });

    // ── deny-path: membership là hàng rào (BLOCKING 2) ───────────────────────────────────────────────

    describe("ca 1-5 — membership, oversight, cross-tenant", () => {
      it("ca 1 — ALLOW đối chứng: THÀNH VIÊN gọi ⇒ ĐÚNG 200", async () => {
        // Assert mã CHÍNH XÁC. `.not.toBe(403)` sẽ nuốt luôn 500 và biến ca này thành xanh rỗng.
        const res = await authGet(tOwner, `/chat/rooms/${room}/links`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("ca 2 — người NGOÀI phòng (có ĐỦ cặp quyền) ⇒ 404 CHAT-ERR-001", async () => {
        const res = await authGet(tOutsider, `/chat/rooms/${room}/links`);
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
      });

      it("ca 3 — [crown] oversight KHÔNG miễn assertMember: `view:chat-oversight` + không thuộc phòng ⇒ 404", async () => {
        // API-13 §5.1d(4). Nếu ca này ra 200 thì `/links` đã thành cổng xem trước nội dung tin toàn công ty.
        const res = await authGet(tWatcher, `/chat/rooms/${room}/links`);
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
      });

      it("ca 4 — KHÔNG có đường `/chat/oversight/rooms/:id/links` (404 định tuyến)", async () => {
        const res = await authGet(tWatcher, `/chat/oversight/rooms/${room}/links`);
        expect(res.status).toBe(404);
      });

      it("ca 5 — cross-tenant: user công ty B gọi phòng của A ⇒ 404, KHÔNG rò một dòng nào", async () => {
        const res = await authGet(tB, `/chat/rooms/${room}/links`);
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain("http");
      });

      it("ca 6 — phòng không tồn tại ⇒ 404 GIỐNG HỆT ca không-thành-viên (không có oracle)", async () => {
        const unknown = await authGet(tOwner, `/chat/rooms/${UNKNOWN_ROOM}/links`);
        const notMember = await authGet(tOutsider, `/chat/rooms/${room}/links`);
        expect(unknown.status).toBe(404);
        expect(unknown.body.error?.message).toBe(notMember.body.error?.message);
      });
    });

    // ── nội dung: cái gì được trích, cái gì KHÔNG ────────────────────────────────────────────────────

    describe("ca 7-11 — vị từ nội dung", () => {
      let contentRoom = "";

      beforeAll(async () => {
        contentRoom = await createGroup(tOwner, "Nội dung liên kết", [uMate]);
        await seedMessages(contentRoom, [
          { body: "tin thường không có gì" },
          { body: "hai link https://a.vn/x và https://b.vn/y" },
          { body: "javascript:alert(1) và data:text/html;base64,AA==" },
          { body: "https://da-thu-hoi.vn/bi-mat", recalled: true },
          { body: "https://tin-he-thong.vn/x", messageType: "system" },
          { body: "cuối https://cuoi.vn/z." },
        ]);
      });

      it("ca 7 — trích đúng link, mới nhất trước, `linkIndex` theo thứ tự trong tin", async () => {
        const res = await links(tOwner, contentRoom);
        expect(res.data.map((l) => l.url)).toEqual([
          "https://cuoi.vn/z",
          "https://a.vn/x",
          "https://b.vn/y",
        ]);
        expect(res.data.map((l) => l.linkIndex)).toEqual([0, 0, 1]);
        expect(res.data[0].senderId).toBe(uOwner);
        expect(res.data[0].senderName).toBe(OWNER_NAME);
      });

      it("ca 8 — tin ĐÃ THU HỒI không xuất hiện, DÙ body còn nguyên trong DB", async () => {
        const res = await links(tOwner, contentRoom);
        expect(JSON.stringify(res.data)).not.toContain("da-thu-hoi");

        const raw = await direct.query<{ body: string }>(
          `SELECT body FROM chat_messages WHERE room_id = $1 AND recalled_at IS NOT NULL`,
          [contentRoom],
        );
        // Đối chứng: che ở SERVER, không phải "dữ liệu vốn không có".
        expect(raw.rows[0]?.body).toContain("da-thu-hoi");
      });

      it("ca 9 — tin `message_type='system'` không xuất hiện", async () => {
        const res = await links(tOwner, contentRoom);
        expect(JSON.stringify(res.data)).not.toContain("tin-he-thong");
      });

      it("ca 10 — `javascript:` / `data:` KHÔNG thành liên kết", async () => {
        const res = await links(tOwner, contentRoom);
        expect(JSON.stringify(res.data)).not.toContain("javascript:");
        expect(JSON.stringify(res.data)).not.toContain("data:text/html");
      });

      it("ca 11 — thành viên KHÁC của phòng thấy CÙNG tập liên kết", async () => {
        const tMate = await login(A.slug, `mate@${A.slug}.test`);
        const mine = await links(tOwner, contentRoom);
        const theirs = await links(tMate, contentRoom);
        expect(theirs.data.map((l) => l.url)).toEqual(mine.data.map((l) => l.url));
      });
    });

    // ── chạm trần quét (BLOCKING 4) ─────────────────────────────────────────────────────────────────

    describe("ca 12-15 — [crown] trần quét + `truncated`", () => {
      let capRoom = "";

      beforeAll(async () => {
        capRoom = await createGroup(tOwner, "Phòng chạm trần", [uMate]);
        // room_seq = 1 mang liên kết DUY NHẤT; SCAN_CAP+9 tin nhiễu nằm ĐÈ lên nó.
        await seedMessages(capRoom, [{ body: "https://sau-day-noise.vn/x" }]);
        await seedMessages(
          capRoom,
          Array.from({ length: SCAN_CAP + 9 }, (_, i) => ({ body: `tin nhiễu ${i}` })),
        );
      });

      it("ca 12 — quá trần với 0 liên kết ⇒ trang RỖNG nhưng `truncated: true` + `nextCursor` khác null", async () => {
        // Hợp đồng §5.1d(6): trang rỗng ở đây KHÔNG được đọc thành "phòng không có liên kết nào".
        const res = await links(tOwner, capRoom);
        expect(res.data).toEqual([]);
        expect(res.truncated).toBe(true);
        expect(res.nextCursor).not.toBeNull();
      });

      it("ca 13 — lật con trỏ chạm-trần ra được trang sau, KHÔNG treo và KHÔNG lặp chỗ cũ", async () => {
        const p1 = await links(tOwner, capRoom);
        const p2 = await links(tOwner, capRoom, { cursor: p1.nextCursor as string });
        expect(p2.data.map((l) => l.url)).toEqual(["https://sau-day-noise.vn/x"]);
        expect(p2.truncated).toBe(false);
        expect(p2.nextCursor).toBeNull();
      });

      it("ca 14 — ca ÂM: phòng ít tin ⇒ `truncated: false` + `nextCursor: null`", async () => {
        // Neo chống "truncated luôn true": không có ca âm thì một hiện thực trả `true` mọi lúc vẫn xanh.
        const small = await createGroup(tOwner, "Phòng nhỏ", [uMate]);
        await send(tOwner, small, "chỉ một https://nho.vn/x");
        const res = await links(tOwner, small);
        expect(res.data).toHaveLength(1);
        expect(res.truncated).toBe(false);
        expect(res.nextCursor).toBeNull();
      });

      it("ca 15 — phòng RỖNG (0 tin) ⇒ trang rỗng, `truncated: false`, `nextCursor: null`", async () => {
        const empty = await createGroup(tOwner, "Phòng chưa có tin", [uMate]);
        const res = await links(tOwner, empty);
        expect(res).toMatchObject({ data: [], truncated: false, nextCursor: null });
      });
    });

    // ── phân trang + con trỏ ────────────────────────────────────────────────────────────────────────

    describe("ca 16-20 — phân trang, vân phòng, validate", () => {
      let pageRoom = "";

      beforeAll(async () => {
        pageRoom = await createGroup(tOwner, "Phòng phân trang", [uMate]);
        await seedMessages(pageRoom, [{ body: "https://a.vn https://b.vn https://c.vn" }]);
      });

      it("ca 16 — 1 tin 3 liên kết, `limit=2` ⇒ trang 2 ra ĐÚNG liên kết thứ 3", async () => {
        const p1 = await links(tOwner, pageRoom, { limit: 2 });
        expect(p1.data.map((l) => l.url)).toEqual(["https://a.vn", "https://b.vn"]);
        expect(p1.nextCursor).not.toBeNull();

        const p2 = await links(tOwner, pageRoom, { limit: 2, cursor: p1.nextCursor as string });
        expect(p2.data.map((l) => l.url)).toEqual(["https://c.vn"]);
        expect(p2.nextCursor).toBeNull();
      });

      it("ca 17 — [crown] con trỏ của PHÒNG KHÁC ⇒ 400 CHAT-ERR-016 (không phải trang cắt sai lặng lẽ)", async () => {
        const p1 = await links(tOwner, pageRoom, { limit: 2 });
        const res = await authGet(
          tOwner,
          `/chat/rooms/${room}/links?cursor=${encodeURIComponent(p1.nextCursor as string)}`,
        );
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-016");
      });

      it("ca 18 — con trỏ rác ⇒ 400 (KHÔNG im lặng rơi về trang đầu)", async () => {
        const res = await authGet(tOwner, `/chat/rooms/${pageRoom}/links?cursor=khong-hop-le`);
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain("CHAT-ERR-016");
      });

      it("ca 19 — `limit=51` vượt trần ⇒ 400 validation", async () => {
        const res = await authGet(tOwner, `/chat/rooms/${pageRoom}/links?limit=51`);
        expect(res.status).toBe(400);
      });

      it("ca 20 — `limit=50` (đúng trần) ⇒ 200 — biên không lệch một đơn vị", async () => {
        const res = await authGet(tOwner, `/chat/rooms/${pageRoom}/links?limit=50`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("ca 21 — `:id` không phải UUID ⇒ 400 (ParseUUIDPipe), không phải 500", async () => {
        const res = await authGet(tOwner, "/chat/rooms/khong-phai-uuid/links");
        expect(res.status).toBe(400);
      });
    });
  },
);
