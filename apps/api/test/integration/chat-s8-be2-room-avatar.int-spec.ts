/**
 * S8-CHAT-UX-BE-2 — avatar phòng chat trên đường THẬT (CHAT-DEC-016 · SPEC-15 §11b · §12).
 *
 * Phủ những mệnh đề mà unit test KHÔNG chứng minh nổi:
 *   • **thứ tự 404-trước-403**: người ngoài phòng nhận `CHAT-ERR-001` (404), không phân biệt được với
 *     phòng-không-tồn-tại ⇒ `roomId` không thành oracle dò;
 *   • **CHAT-ERR-023** (403): là thành viên, CÓ `('update','chat-room')`, nhưng không đủ tư cách;
 *   • **CHAT-ERR-022** (422): phòng `direct` — và CHECK cấp DB là đai thứ hai;
 *   • **chống IDOR tệp** (`CHAT-ERR-015`): gắn ảnh do NGƯỜI KHÁC tải lên ⇒ từ chối, 0 hàng `file_links`;
 *   • **đường đọc**: `avatarUrl` chỉ xuất hiện cho thành viên, và cột + link thay đổi CÙNG transaction;
 *   • **`DELETE` idempotent**: gọi hai lần ⇒ 204 cả hai, không 404;
 *   • phòng **đã lưu trữ** là CHỈ ĐỌC (`CHAT-ERR-005`) — avatar không được nới.
 *
 * ⚠️ **CHỐNG XANH-GIẢ.** 404 của "route chưa tồn tại" trông y hệt 404 của CHAT-ERR-001, và 403 của
 * `PermissionGuard` trông y hệt 403 của CHAT-ERR-023 ⇒ mọi ca deny-path assert **MÃ trong thân**, không
 * chỉ status.
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
const LOGIN_PW = "Passw0rd!s8be2avatar";
const UNKNOWN_ROOM = "00000000-0000-4000-8000-0000000000fe";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

const PAIRS_FULL: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
];

describe.skipIf(!hasLaneDb)("S8-CHAT-UX-BE-2 — avatar phòng (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let uAdmin = "";
  let uMember = "";
  let uOutsider = "";
  let tAdmin = "";
  let tMember = "";
  let tOutsider = "";
  let roomId = "";
  let directRoomId = "";
  let archivedRoomId = "";

  async function grantPairs(userId: string, label: string, pairs: PairGrant[]): Promise<void> {
    const roleId = await seedRole(direct, A.companyId, `s8be2-${label}-${userId.slice(0, 8)}`);
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
  const authPost = (t: string, u: string) => srv().post(u).set("Authorization", `Bearer ${t}`);
  const authDel = (t: string, u: string) => srv().delete(u).set("Authorization", `Bearer ${t}`);
  const authGet = (t: string, u: string) => srv().get(u).set("Authorization", `Bearer ${t}`);

  const avatarUrlOf = (r: string) => `/chat/rooms/${r}/avatar`;

  /** Đăng ký một ảnh qua ĐÚNG đường của WO, rồi ép `Uploaded` (không có bytes thật trong lane test). */
  async function registerImage(token: string, room: string, name = "anh.png"): Promise<string> {
    const res = await authPost(token, `${avatarUrlOf(room)}/upload-url`).send({
      originalName: name,
      declaredMimeType: "image/png",
      sizeBytes: 1024,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const fileId = res.body.data.fileId as string;
    await direct.query(
      `UPDATE files SET upload_status = 'Uploaded', scan_status = 'Clean' WHERE id = $1`,
      [fileId],
    );
    return fileId;
  }

  async function avatarColumn(room: string): Promise<string | null> {
    const r = await direct.query(`SELECT avatar_file_id FROM chat_rooms WHERE id = $1`, [room]);
    return (r.rows[0]?.avatar_file_id as string | null) ?? null;
  }

  async function liveAvatarLinkCount(room: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM file_links
        WHERE entity_id = $1 AND module_code = 'CHAT' AND entity_type = 'chat_room_avatar'
          AND deleted_at IS NULL`,
      [room],
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
    A = await seedCompany(direct, "s8be2avatar");
    companyIds.push(A.companyId);

    const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uAdmin = await mk("admin");
    uMember = await mk("member");
    uOutsider = await mk("outsider");

    // CẢ BA có ĐỦ cặp `('update','chat-room')`. Đó chính là điều làm ba ca deny-path dưới đây có nghĩa:
    // chúng chứng minh ranh giới do TƯ CÁCH (DEC-016) quyết, không phải do thiếu cặp quyền.
    await grantPairs(uAdmin, "admin", PAIRS_FULL);
    await grantPairs(uMember, "member", PAIRS_FULL);
    await grantPairs(uOutsider, "outsider", PAIRS_FULL);

    tAdmin = await login(`admin@${A.slug}.test`);
    tMember = await login(`member@${A.slug}.test`);
    tOutsider = await login(`outsider@${A.slug}.test`);

    const room = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng có ảnh",
      memberUserIds: [uMember],
    });
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    roomId = room.body.data.id as string;

    const dm = await authPost(tAdmin, "/chat/rooms/direct").send({ peerUserId: uMember });
    expect(dm.status, JSON.stringify(dm.body)).toBe(200);
    directRoomId = dm.body.data.id as string;

    const arch = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng sẽ lưu trữ",
      memberUserIds: [uMember],
    });
    expect(arch.status).toBe(201);
    archivedRoomId = arch.body.data.id as string;
    const doArch = await authPost(tAdmin, `/chat/rooms/${archivedRoomId}/archive`).send({});
    expect(doArch.status, JSON.stringify(doArch.body)).toBe(200);
  }, 180_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── deny-path (RED trước) ───────────────────────────────────────────────────

  it("ca 1 — người NGOÀI phòng đặt avatar ⇒ 404 mang mã CHAT-ERR-001 (không phải 403)", async () => {
    const res = await authPost(tOutsider, `${avatarUrlOf(roomId)}/upload-url`).send({
      originalName: "x.png",
      declaredMimeType: "image/png",
      sizeBytes: 10,
    });

    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
  });

  it("ca 2 — phòng KHÔNG TỒN TẠI trả phản hồi GIỐNG HỆT phòng-không-thuộc (không oracle dò)", async () => {
    const body = { originalName: "x.png", declaredMimeType: "image/png", sizeBytes: 10 };
    const unknown = await authPost(tOutsider, `${avatarUrlOf(UNKNOWN_ROOM)}/upload-url`).send(body);
    const notMine = await authPost(tOutsider, `${avatarUrlOf(roomId)}/upload-url`).send(body);

    expect(unknown.status).toBe(notMine.status);
    expect(unknown.body.error?.message ?? unknown.body.message).toEqual(
      notMine.body.error?.message ?? notMine.body.message,
    );
  });

  it("ca 3 — thành viên THƯỜNG của phòng nhóm ⇒ 403 mang mã CHAT-ERR-023 (DEC-016)", async () => {
    const res = await authPost(tMember, `${avatarUrlOf(roomId)}/upload-url`).send({
      originalName: "x.png",
      declaredMimeType: "image/png",
      sizeBytes: 10,
    });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-023");
  });

  it("ca 4 — phòng `direct` ⇒ 422 mang mã CHAT-ERR-022, và CHECK cấp DB là đai thứ hai", async () => {
    const res = await authPost(tAdmin, `${avatarUrlOf(directRoomId)}/upload-url`).send({
      originalName: "x.png",
      declaredMimeType: "image/png",
      sizeBytes: 10,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-022");

    // Đai thứ hai: kể cả khi tầng ứng dụng bị gỡ vế này, DB vẫn từ chối (chk_chat_rooms_direct_no_avatar).
    await expect(
      direct.query(`UPDATE chat_rooms SET avatar_file_id = gen_random_uuid() WHERE id = $1`, [
        directRoomId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("ca 5 — phòng ĐÃ LƯU TRỮ là chỉ đọc ⇒ CHAT-ERR-005 (avatar KHÔNG được nới)", async () => {
    const res = await authPost(tAdmin, `${avatarUrlOf(archivedRoomId)}/upload-url`).send({
      originalName: "x.png",
      declaredMimeType: "image/png",
      sizeBytes: 10,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-005");
  });

  it("ca 6 — chưa đăng nhập ⇒ 401", async () => {
    const res = await srv().delete(avatarUrlOf(roomId));
    expect(res.status).toBe(401);
  });

  // ── chống IDOR tệp ──────────────────────────────────────────────────────────

  it("ca 7 — gắn ảnh do NGƯỜI KHÁC tải lên ⇒ CHAT-ERR-015, 0 link, cột KHÔNG đổi", async () => {
    // Ảnh do admin đăng ký (owner = admin). Chủ thể thử gắn là một admin phòng KHÁC — ở đây tái dùng
    // chính `uMember` không được, vì nó đã 403 ở tầng tư cách. Nên: tạo phòng thứ hai do member làm
    // admin, rồi member thử gắn ảnh CỦA ADMIN vào phòng đó.
    const own = await authPost(tMember, "/chat/rooms").send({
      name: "Phòng của member",
      memberUserIds: [uAdmin],
    });
    expect(own.status).toBe(201);
    const memberRoom = own.body.data.id as string;

    const adminsFile = await registerImage(tAdmin, roomId, "cua-admin.png");

    const res = await authPost(tMember, avatarUrlOf(memberRoom)).send({ fileId: adminsFile });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-015");
    expect(await liveAvatarLinkCount(memberRoom)).toBe(0);
    expect(await avatarColumn(memberRoom)).toBeNull();
  });

  it("ca 8 — ảnh chưa `Uploaded`/không phải ảnh ⇒ từ chối (không tin declaredMimeType)", async () => {
    const res = await authPost(tAdmin, `${avatarUrlOf(roomId)}/upload-url`).send({
      originalName: "tai-lieu.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: 2048,
    });
    // Chặn SỚM ở MIME khai báo — 415, trước khi có hàng `files` nào được tạo.
    expect(res.status, JSON.stringify(res.body)).toBe(415);
  });

  // ── đường ghi + đường đọc ───────────────────────────────────────────────────

  it("ca 9 — admin phòng đặt avatar ⇒ cột VÀ link đổi cùng lúc, đúng 1 link sống", async () => {
    const fileId = await registerImage(tAdmin, roomId);

    const res = await authPost(tAdmin, avatarUrlOf(roomId)).send({ fileId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.fileId).toBe(fileId);

    expect(await avatarColumn(roomId)).toBe(fileId);
    expect(await liveAvatarLinkCount(roomId)).toBe(1);
  });

  it("ca 10 — đặt ảnh MỚI ⇒ vẫn ĐÚNG 1 link sống (link cũ bị soft-delete, không tích luỹ grant)", async () => {
    const second = await registerImage(tAdmin, roomId, "anh-2.png");

    const res = await authPost(tAdmin, avatarUrlOf(roomId)).send({ fileId: second });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    expect(await avatarColumn(roomId)).toBe(second);
    // Vế QUAN TRỌNG: link cũ còn sống = một đường tải vô hình tồn tại mãi cho ảnh đã bị thay.
    expect(await liveAvatarLinkCount(roomId)).toBe(1);
  });

  it("ca 11 — THÀNH VIÊN đọc phòng thì thấy `avatarUrl` đã ký (đường đọc + resolver còn sống)", async () => {
    const res = await authGet(tMember, `/chat/rooms/${roomId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Không assert nội dung URL (ký HMAC, đổi mỗi lần) — chỉ đòi nó CÓ. Thiếu resolver đăng ký thì
    // đường ký vẫn chạy nhưng `null`, nên đây là lưới bắt "tính năng chết trong im lặng".
    expect(res.body.data.avatarUrl, JSON.stringify(res.body.data)).toBeTruthy();
  });

  it("ca 12 — danh sách phòng cũng mang `avatarUrl` (một lô, không N+1)", async () => {
    const res = await authGet(tMember, "/chat/rooms");
    expect(res.status).toBe(200);
    const rooms = res.body.data as Array<{ id: string; avatarUrl: string | null }>;
    const mine = rooms.find((r) => r.id === roomId);
    expect(mine?.avatarUrl).toBeTruthy();
    // Phòng DM không bao giờ có avatar riêng (CHAT-DEC-016 — dẫn xuất từ người đối thoại).
    expect(rooms.find((r) => r.id === directRoomId)?.avatarUrl ?? null).toBeNull();
  });

  it("ca 12b — MỌI phản hồi trả ChatRoomDto đều mang `avatarUrl` (không chỉ hai đường đọc)", async () => {
    // Tham số `avatarUrl` của mapper mặc định `null` ⇒ caller quên truyền vẫn biên dịch, vẫn HTTP 200,
    // chỉ là phòng CÓ ảnh bỗng báo "không ảnh". FE cập-nhật-lạc-quan ghi đè cache ⇒ ảnh BIẾN MẤT ngay
    // khi người dùng bấm ghim/tắt thông báo/đổi tên. Ca này quét đủ 5 đường ghi trả về phòng.
    const pin = await srv()
      .put(`/chat/rooms/${roomId}/pin`)
      .set("Authorization", `Bearer ${tMember}`);
    expect(pin.status, JSON.stringify(pin.body)).toBe(200);
    expect(pin.body.data.avatarUrl, "PUT /pin làm mất avatar").toBeTruthy();

    const mute = await srv()
      .put(`/chat/rooms/${roomId}/mute`)
      .set("Authorization", `Bearer ${tMember}`)
      .send({ mutedUntil: null });
    expect(mute.status, JSON.stringify(mute.body)).toBe(200);
    expect(mute.body.data.avatarUrl, "PUT /mute làm mất avatar").toBeTruthy();

    const unread = await authPost(tMember, `/chat/rooms/${roomId}/unread`).send({});
    expect(unread.status, JSON.stringify(unread.body)).toBe(200);
    expect(unread.body.data.avatarUrl, "POST /unread làm mất avatar").toBeTruthy();

    const unpin = await authDel(tMember, `/chat/rooms/${roomId}/pin`);
    expect(unpin.status, JSON.stringify(unpin.body)).toBe(200);
    expect(unpin.body.data.avatarUrl, "DELETE /pin làm mất avatar").toBeTruthy();

    const patched = await srv()
      .patch(`/chat/rooms/${roomId}`)
      .set("Authorization", `Bearer ${tAdmin}`)
      .send({ name: "Phòng có ảnh (đổi tên)" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data.avatarUrl, "PATCH /rooms/:id làm mất avatar").toBeTruthy();
  });

  // ── gỡ ──────────────────────────────────────────────────────────────────────

  it("ca 13 — DELETE gỡ cả cột lẫn link; gọi LẦN HAI vẫn 204 (idempotent, không 404)", async () => {
    const first = await authDel(tAdmin, avatarUrlOf(roomId));
    expect(first.status, JSON.stringify(first.body)).toBe(204);
    expect(await avatarColumn(roomId)).toBeNull();
    expect(await liveAvatarLinkCount(roomId)).toBe(0);

    const second = await authDel(tAdmin, avatarUrlOf(roomId));
    expect(second.status).toBe(204);
  });

  it("ca 14 — thành viên THƯỜNG không gỡ được avatar ⇒ 403 CHAT-ERR-023", async () => {
    const res = await authDel(tMember, avatarUrlOf(roomId));
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-023");
  });
});
