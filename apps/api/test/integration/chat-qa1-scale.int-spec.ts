/**
 * S7-CHAT-QA-1 — §21 nhóm "Hiệu năng" ở QUY MÔ (SPEC-15 §19).
 *
 * Món này được BE-4 CỐ Ý hoãn sang WO QA với lý do ghi trong bàn giao 03/08: *"đo trên lane vài trăm
 * hàng là vô nghĩa, còn assert planner chọn đích danh `idx_chat_messages_search` là ĐỎ OAN trên chính
 * hành vi tối ưu"*. File này tôn trọng cả hai vế đó.
 *
 * ┌─ BA THỨ FILE NÀY CỐ Ý **KHÔNG** LÀM ────────────────────────────────────────────────────────────┐
 * │ 1. KHÔNG assert `EXPLAIN` chọn index nào. Planner đổi kế hoạch khi thống kê đổi là hành vi ĐÚNG; │
 * │    ghim tên index = test đỏ oan mỗi lần dữ liệu đổi hình (memory `pg-planner-index-assert-trap`).│
 * │ 2. KHÔNG assert ngưỡng mili-giây tuyệt đối. Máy CI/dev chia sẻ CPU với Docker + 3 dịch vụ khác;  │
 * │    `expect(ms).toBeLessThan(800)` là máy sinh flake, và flake dạy người ta bỏ qua màu đỏ.        │
 * │ 3. KHÔNG tuyên bố "đạt §19 @ 1 triệu tin". Lane này gieo 50.000 tin. Ngưỡng 800ms @ ~1 triệu là  │
 * │    NỢ đo ở môi trường có dữ liệu thật — ghi thẳng ra, không đóng dấu bằng dòng không ai chạy     │
 * │    (memory `wo-status-auto-ledger`).                                                            │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * VẬY FILE NÀY CHỨNG MINH GÌ — ba mệnh đề CỨNG, đúng/sai rõ ràng, không phụ thuộc tốc độ máy:
 *   (A) Ranh giới membership KHÔNG rão theo quy mô. §20 ca 5 ở 50k tin, nhiễu 20 phòng ngoài phạm vi.
 *   (B) Danh sách phòng vẫn ĐÚNG 1 truy vấn khi công ty có 50k tin (N+1 thường lộ ra theo quy mô).
 *   (C) Phân trang keyset không sót/không lặp trên tập lớn — cửa sổ trượt, không offset.
 * Số mili-giây có được ghi lại, nhưng chỉ `console.log` làm SỐ THAM CHIẾU cho evidence, KHÔNG assert.
 *
 * ⚠️ Gieo bằng MỘT câu `generate_series` — 50.000 round-trip qua HTTP sẽ mất hàng chục phút và không
 * đo thêm được gì. Đường GHI đã có 273 ca khác lo; ở đây cần KHỐI LƯỢNG, không cần đường ghi.
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
import { DatabaseService } from "../../src/db/db.service";
import { ChatRoomsRepository } from "../../src/chat/chat-rooms.repository";
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
const LOGIN_PW = "Passw0rd!chatqa1s";

/** Quy mô gieo. 50k đủ để index có ý nghĩa mà vẫn gieo xong dưới ~10s bằng generate_series. */
const TOTAL_MESSAGES = 50_000;
const INSIDE_ROOMS = 5;
const OUTSIDE_ROOMS = 20;

/** Từ khoá CHỈ nằm ở phòng NGOÀI phạm vi — thấy nó trong kết quả là rò, không cần suy luận thêm. */
const SECRET_OUTSIDE = "sấmsétngoàiphạmvi";
/** Từ khoá chỉ nằm trong phòng actor là thành viên — đối chứng dương. */
const SECRET_INSIDE = "cầuvồngtrongphạmvi";

type Scope = "Own" | "Team" | "Department" | "Company";
const CHAT_PAIRS: [string, string, Scope][] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
];

describe.skipIf(!hasLaneDb)("S7-CHAT-QA-1 — hiệu năng ở quy mô (SPEC-15 §19 · §21)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let uActor = "";
  let uOther = "";
  let tActor = "";
  const insideRooms: string[] = [];
  const outsideRooms: string[] = [];

  const authGet = (t: string, u: string) =>
    request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function grantPairs(companyId: string, userId: string, label: string): Promise<void> {
    const roleId = await seedRole(direct, companyId, `qa1s-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of CHAT_PAIRS) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  /** Gieo phòng nhóm THẲNG vào DB (superuser) — cần khối lượng, không cần đường ghi. */
  async function seedRoom(name: string, code: string, members: string[]): Promise<string> {
    const r = await direct.query(
      `INSERT INTO chat_rooms (company_id, room_type, name, room_code, sync_source, created_by)
       VALUES ($1,'group',$2,$3,'manual',$4) RETURNING id`,
      [A.companyId, name, code, uActor],
    );
    const roomId = r.rows[0].id as string;
    for (const m of members) {
      await direct.query(
        `INSERT INTO chat_room_members (company_id, room_id, user_id, role)
         VALUES ($1,$2,$3,'member') ON CONFLICT DO NOTHING`,
        [A.companyId, roomId, m],
      );
    }
    return roomId;
  }

  /**
   * Gieo `n` tin vào `roomId` bằng MỘT câu. `room_seq` phải liên tục từ 1 trong từng phòng
   * (`uq_chat_messages_room_seq`), nên lấy thẳng từ `generate_series`.
   */
  async function seedMessages(roomId: string, sender: string, n: number, body: string) {
    await direct.query(
      `INSERT INTO chat_messages (company_id, room_id, sender_id, body, room_seq, created_at)
       SELECT $1, $2, $3, $4 || ' #' || g, g,
              now() - (($5::int - g) * interval '1 second')
         FROM generate_series(1, $5::int) AS g`,
      [A.companyId, roomId, sender, body, n],
    );
  }

  function ms(started: bigint): number {
    return Number(process.hrtime.bigint() - started) / 1e6;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);

    A = await seedCompany(direct, "chatqa1s");
    companyIds.push(A.companyId);

    uActor = await seedUser(direct, A.companyId, `actor@${A.slug}.test`, hash);
    uOther = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);
    await grantPairs(A.companyId, uActor, "actor");
    await grantPairs(A.companyId, uOther, "other");
    tActor = await login(A.slug, `actor@${A.slug}.test`);

    const perRoom = Math.floor(TOTAL_MESSAGES / (INSIDE_ROOMS + OUTSIDE_ROOMS));

    for (let i = 0; i < INSIDE_ROOMS; i += 1) {
      const id = await seedRoom(`Trong phạm vi ${i}`, `QA1S-I${i}`, [uActor, uOther]);
      insideRooms.push(id);
      await seedMessages(id, uOther, perRoom, `báo cáo nội bộ ${SECRET_INSIDE}`);
    }
    for (let i = 0; i < OUTSIDE_ROOMS; i += 1) {
      const id = await seedRoom(`Ngoài phạm vi ${i}`, `QA1S-O${i}`, [uOther]);
      outsideRooms.push(id);
      await seedMessages(id, uOther, perRoom, `báo cáo mật ${SECRET_OUTSIDE}`);
    }

    // Con trỏ phòng phải khớp dữ liệu vừa gieo, nếu không `unreadCount` (phép trừ) ra số vô nghĩa.
    await direct.query(
      `UPDATE chat_rooms r
          SET last_message_seq = (SELECT max(room_seq) FROM chat_messages m WHERE m.room_id = r.id)
        WHERE r.company_id = $1`,
      [A.companyId],
    );

    const total = await direct.query(
      `SELECT count(*)::int AS n FROM chat_messages WHERE company_id = $1`,
      [A.companyId],
    );
    // Nếu gieo hụt, mọi kết luận "ở quy mô" bên dưới là nói quá — dừng ngay tại đây.
    expect(total.rows[0].n, "số tin đã gieo").toBeGreaterThanOrEqual(45_000);
    console.log(
      `[qa1-scale] đã gieo ${total.rows[0].n} tin / ${INSIDE_ROOMS + OUTSIDE_ROOMS} phòng`,
    );
  }, 600_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ══════════════ (A) ranh giới membership KHÔNG rão theo quy mô ══════════════

  it("§20 ca 5 @ 50k tin: từ khoá CHỈ có ở 20 phòng ngoài phạm vi → 0 kết quả", async () => {
    const t0 = process.hrtime.bigint();
    const res = await authGet(tActor, `/chat/search?q=${encodeURIComponent(SECRET_OUTSIDE)}`);
    const elapsed = ms(t0);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = (res.body.data as { data: { roomId: string }[] }).data;
    expect(rows, "một hàng lọt ra ở đây là rò toàn bộ 20 phòng ngoài phạm vi").toEqual([]);
    console.log(`[qa1-scale] /chat/search (deny, 0 hit) = ${elapsed.toFixed(0)}ms`);
  });

  it("ĐỐI CHỨNG DƯƠNG: từ khoá trong phòng mình là thành viên → CÓ kết quả, và MỌI hàng thuộc phòng mình", async () => {
    // Không có ca này thì ca trên xanh cả khi `/chat/search` hỏng hoàn toàn (luôn trả rỗng).
    const t0 = process.hrtime.bigint();
    const res = await authGet(
      tActor,
      `/chat/search?q=${encodeURIComponent(SECRET_INSIDE)}&limit=50`,
    );
    const elapsed = ms(t0);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = (res.body.data as { data: { roomId: string }[] }).data;
    expect(rows.length, "phải tìm ra tin trong phòng mình").toBeGreaterThan(0);
    expect(
      rows.filter((r) => !insideRooms.includes(r.roomId)),
      "mọi hàng phải thuộc phòng actor là thành viên",
    ).toEqual([]);
    console.log(`[qa1-scale] /chat/search (allow, ${rows.length} hit) = ${elapsed.toFixed(0)}ms`);
  });

  // ══════════════ (B) N+1 không xuất hiện theo quy mô ══════════════

  it("§19: danh sách phòng vẫn ĐÚNG 1 truy vấn SELECT khi công ty có 50k tin / 25 phòng", async () => {
    const db = app.get(DatabaseService);
    const repo = app.get(ChatRoomsRepository);
    let selectCalls = 0;

    const rows = await db.withTenant(A.companyId, async (tx) => {
      const counting = new Proxy(tx as object, {
        get(target, prop, receiver) {
          if (prop === "select") selectCalls += 1;
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof tx;
      return repo.listRoomsForUser(counting, A.companyId, uActor, { archived: false });
    });

    expect(rows.length, "actor là thành viên đúng 5 phòng").toBe(INSIDE_ROOMS);
    expect(selectCalls, `số truy vấn SELECT cho ${rows.length} phòng ở quy mô 50k tin`).toBe(1);
  });

  it("§19: /chat/rooms qua HTTP ở quy mô — trả đủ 5 phòng, unreadCount là SỐ (không null)", async () => {
    const t0 = process.hrtime.bigint();
    const res = await authGet(tActor, "/chat/rooms");
    const elapsed = ms(t0);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // ⚠️ Hình dạng envelope KHÁC nhau theo route: `/chat/rooms` và `/messages` trả MẢNG TRẦN ở
    // `data`, chỉ `/chat/search` mới bọc `{ data, meta }`. Đọc nhầm hình dạng là ZodError/undefined
    // dù HTTP 200 (memory `apifetch-drops-pagination-bare-array`).
    const rows = res.body.data as { id: string; unreadCount: number }[];
    expect(rows.length).toBe(INSIDE_ROOMS);
    for (const r of rows) expect(typeof r.unreadCount, `unreadCount của ${r.id}`).toBe("number");
    console.log(`[qa1-scale] GET /chat/rooms = ${elapsed.toFixed(0)}ms`);
  });

  // ══════════════ (C) phân trang keyset trên tập lớn ══════════════

  it("§13.1: /messages lát 50 tin GẦN NHẤT trên phòng 2.000 tin — tăng dần trong trang, không trùng", async () => {
    const room = insideRooms[0];
    const t0 = process.hrtime.bigint();
    const res = await authGet(tActor, `/chat/rooms/${room}/messages?limit=50`);
    const elapsed = ms(t0);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as { id: string; roomSeq: number }[];
    expect(rows.length).toBe(50);
    expect(new Set(rows.map((r) => r.id)).size, "không tin nào lặp trong một trang").toBe(50);

    // ⚠️ HỢP ĐỒNG THẬT (đo, không đoán): API lấy 50 tin MỚI NHẤT rồi trả theo thứ tự **TĂNG DẦN** —
    // đúng thứ tự đọc trên màn hình. `chat-be2-messages` ca "con trỏ beforeSeq/afterSeq" đã đóng đinh
    // (`toEqual([3, 4])`). Viết assert "giảm dần" theo trực giác là ĐỎ OAN trên hành vi đúng.
    const seqs = rows.map((r) => Number(r.roomSeq));
    expect(
      seqs.every((s, i) => i === 0 || seqs[i - 1] < s),
      "roomSeq phải TĂNG dần trong trang",
    ).toBe(true);

    // Và phải là lát CUỐI của phòng, không phải lát đầu — "50 tin gần nhất" là hợp đồng của §13.1.
    const maxSeq = await direct.query(
      `SELECT max(room_seq)::int AS n FROM chat_messages WHERE room_id = $1`,
      [room],
    );
    expect(seqs[seqs.length - 1], "tin cuối trang mặc định = tin mới nhất phòng").toBe(
      maxSeq.rows[0].n,
    );
    console.log(`[qa1-scale] GET /messages?limit=50 = ${elapsed.toFixed(0)}ms`);
  });

  it("§13.1: lật 3 trang bằng beforeSeq trên tập lớn — không sót, không lặp", async () => {
    const room = insideRooms[0];
    const seen: number[] = [];
    let cursor: number | undefined;

    for (let page = 0; page < 3; page += 1) {
      const qs = cursor === undefined ? "limit=50" : `limit=50&beforeSeq=${cursor}`;
      const res = await authGet(tActor, `/chat/rooms/${room}/messages?${qs}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data as { roomSeq: number }[];
      expect(rows.length, `trang ${page + 1}`).toBe(50);
      seen.push(...rows.map((r) => Number(r.roomSeq)));
      // Trang trả TĂNG dần ⇒ tin CŨ NHẤT của trang là phần tử ĐẦU. Lấy nhầm phần tử cuối (tin mới
      // nhất) thì trang sau trùng gần hết trang trước — và test vẫn "chạy", chỉ ra số lạ.
      cursor = Number(rows[0].roomSeq);
    }

    expect(new Set(seen).size, "150 tin qua 3 trang phải KHÁC NHAU hoàn toàn").toBe(150);
    // Liên tục = không sót: 3 trang liền kề trên phòng gieo seq liên tục phải là một dải ĐẶC.
    const min = Math.min(...seen);
    const max = Math.max(...seen);
    expect(max - min, "dải seq của 150 tin liền kề").toBe(149);
  });
});
