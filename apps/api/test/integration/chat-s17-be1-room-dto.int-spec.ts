/**
 * S17-CHAT-UX2-BE-1 — DTO phòng v2 trên đường THẬT (CHAT-DEC-022/023/025 · SPEC-15 §15b · API-13 §5.1d).
 *
 * Phủ đúng những mệnh đề mà unit test KHÔNG chứng minh nổi vì chúng nói về SQL thật:
 *   • **KHÔNG N+1** — 200 phòng vẫn chỉ ĐÚNG MỘT câu chạm `chat_rooms`, đo bằng cách đếm query ở tầng
 *     driver `pg` (không phải đo thời gian — `slow-probe-manufactures-timeout-red`);
 *   • **vị từ đi được trên `idx_chat_messages_room_seq`** — EXPLAIN trên CHÍNH câu SQL đã bắt được;
 *   • che thu hồi + cắt excerpt xảy ra ở SERVER (đọc `body` gốc thẳng trong DB để đối chứng);
 *   • `peer` chỉ ở `direct`, avatar ký MỘT LÔ cho cả trang, `isActive` đúng ở CẢ HAI ca (khoá tài
 *     khoản · nghỉ việc) — hai ca này chạm hai bảng khác nhau và không suy ra được từ nhau;
 *   • `kind=image|file` lọc Ở SQL, kể cả MIME viết HOA;
 *   • deny-path: không-thành-viên ⇒ 404 mang mã CHAT-ERR-001 · cross-tenant ⇒ 0 hàng.
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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { AvatarPresignService } from "../../src/foundation/files/avatar-presign.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  captureQueries,
  queriesFromTable,
  type CapturedQuery,
} from "../helpers/query-capture";
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
const LOGIN_PW = "Passw0rd!s17be1dto";
const UNKNOWN_ROOM = "00000000-0000-4000-8000-0000000000fe";

/** Số phòng của ca N+1. Đủ lớn để một bản N+1 lộ ra ngay ở số đếm, không phải ở đồng hồ. */
const BULK_ROOMS = 200;

type Scope = "Own" | "Team" | "Department" | "Company";
const PAIRS: [string, string, Scope][] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
  // ⚠️ `send`/`recall`/`pin` × `chat-message` là BA cặp KHÁC nhau (API-13 §5.1) — thiếu cặp `recall`
  // thì ca thu hồi ăn 403 `deny-default` và ta sẽ đi sửa nhầm chỗ.
  ["recall", "chat-message", "Company"],
];

describe.skipIf(!hasLaneDb)("S17-CHAT-UX2-BE-1 — DTO phòng v2 (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let uOwner = "";
  let uMate = "";
  let uOutsider = "";
  let uLocked = "";
  let uResigned = "";
  let uB = "";
  let tOwner = "";
  let tOutsider = "";
  let tB = "";

  /** Phòng nhóm owner+mate — chủ thể của masking `lastMessage` và của deny-path. */
  let groupRoom = "";
  /** DM owner↔mate — chủ thể của `peer`. */
  let dmMate = "";
  let dmLocked = "";
  let dmResigned = "";
  /** Phòng DẪN XUẤT (`department`) cắm thẳng DB — `peer` NULL ở loại phòng không phải `direct`. */
  let derivedRoom = "";

  const srv = () => request(app.getHttpServer());
  const authGet = (t: string, u: string) => srv().get(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) => srv().post(u).set("Authorization", `Bearer ${t}`);

  async function grantPairs(companyId: string, userId: string, label: string): Promise<void> {
    const roleId = await seedRole(direct, companyId, `s17be1-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of PAIRS) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
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

  async function openDirect(token: string, peerUserId: string): Promise<string> {
    const res = await authPost(token, "/chat/rooms/direct").send({ peerUserId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  async function send(
    token: string,
    roomId: string,
    body: string,
    fileIds: string[] = [],
  ): Promise<string> {
    const res = await authPost(token, `/chat/rooms/${roomId}/messages`).send({
      body,
      clientMessageId: randomUUID(),
      ...(fileIds.length > 0 ? { fileIds } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  async function insertFile(companyId: string, ownerId: string, mime: string, name: string) {
    const fileId = randomUUID();
    await direct.query(
      `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
         storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,1024,'MinIO',$6,'Private','Uploaded','Clean',$7,$7)`,
      [fileId, companyId, name, `${fileId}-${name}`, mime, `${companyId}/files/${fileId}`, ownerId],
    );
    return fileId;
  }

  /**
   * Cắm một hàng `chat_rooms` THẲNG DB — **và bump `sequence_counters` đúng số phòng đã cắm.**
   *
   * ⚠️ Bump KHÔNG phải vệ sinh: `s7-chat-db1-invariants.int-spec.ts` gác bất biến
   * `sequence_counters.current_value >= số phòng có room_code` cho **MỌI công ty trong DB** (chống
   * `23505` ở phòng kế tiếp). Cắm phòng mà không bump là dựng ra một trạng thái mà đường sản xuất
   * (`ChatRoomCodeService.allocate`) KHÔNG BAO GIỜ tạo được, và lane DB dùng chung sẽ làm ca bất biến
   * kia ĐỎ — đỏ đúng, ở một file không liên quan gì tới WO này.
   *
   * Không đi qua `POST /chat/rooms` vì hai lý do: phòng dẫn xuất (`department`) KHÔNG có đường API, và
   * 200 lần POST là 200 transaction cho một ca chỉ cần ĐỦ HÀNG.
   */
  async function insertRoomDirect(
    values: {
      roomType: "group" | "department";
      name: string;
      code: string;
      orgUnitId?: string;
    },
    memberUserIds: string[],
  ): Promise<string> {
    const roomId = randomUUID();
    if (values.roomType === "department") {
      await direct.query(
        `INSERT INTO chat_rooms (id, company_id, room_type, name, room_code, org_unit_id, sync_source,
           synced_at, created_by)
         VALUES ($1,$2,'department',$3,$4,$5,'department', now(), $6)`,
        [roomId, A.companyId, values.name, values.code, values.orgUnitId, uOwner],
      );
    } else {
      await direct.query(
        `INSERT INTO chat_rooms (id, company_id, room_type, name, room_code, created_by)
         VALUES ($1,$2,'group',$3,$4,$5)`,
        [roomId, A.companyId, values.name, values.code, uOwner],
      );
    }
    for (const uid of memberUserIds) {
      await direct.query(
        `INSERT INTO chat_room_members (id, company_id, room_id, user_id, role, added_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), A.companyId, roomId, uid, uid === uOwner ? "admin" : "member", uOwner],
      );
    }
    const bumped = await direct.query(
      `UPDATE sequence_counters SET current_value = current_value + 1, updated_at = now()
        WHERE company_id = $1 AND sequence_key = 'chat_room' AND deleted_at IS NULL`,
      [A.companyId],
    );
    // Hàng counter do `ChatRoomCodeService.allocate` tạo ở lần `POST /chat/rooms` ĐẦU TIÊN. Ca này chạy
    // sau `beforeAll` (đã tạo phòng qua API) nên hàng phải có — assert để một thay đổi thứ tự sau này
    // không âm thầm bỏ qua việc bump.
    expect(bumped.rowCount, "thiếu hàng sequence_counters chat_room — bump không có tác dụng").toBe(1);
    return roomId;
  }

  /** Phòng của actor, tra theo id — luôn đi qua CHAT-API-001 để đo ĐÚNG cái DTO người dùng nhận. */
  async function roomFromList(token: string, roomId: string) {
    const res = await authGet(token, "/chat/rooms");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const found = (res.body.data as { id: string }[]).find((r) => r.id === roomId);
    expect(found, `không thấy phòng ${roomId} trong danh sách`).toBeDefined();
    return found as Record<string, unknown>;
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
    A = await seedCompany(direct, "s17be1dto");
    B = await seedCompany(direct, "s17be1other");
    companyIds.push(A.companyId, B.companyId);

    const mkA = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uOwner = await mkA("owner");
    uMate = await mkA("mate");
    uOutsider = await mkA("outsider");
    uLocked = await mkA("locked");
    uResigned = await mkA("resigned");
    uB = await seedUser(direct, B.companyId, `b@${B.slug}.test`, hash);

    for (const [id, label] of [
      [uOwner, "owner"],
      [uMate, "mate"],
      // Người ngoài có ĐỦ cặp quyền — chỉ KHÔNG phải thành viên. Đó là điều làm ca 404 có nghĩa: nó
      // chứng minh MEMBERSHIP là hàng rào, không phải cặp quyền đang chặn.
      [uOutsider, "outsider"],
      [uLocked, "locked"],
      [uResigned, "resigned"],
    ] as const) {
      await grantPairs(A.companyId, id, label);
    }
    await grantPairs(B.companyId, uB, "b");

    tOwner = await login(A.slug, `owner@${A.slug}.test`);
    tOutsider = await login(A.slug, `outsider@${A.slug}.test`);
    tB = await login(B.slug, `b@${B.slug}.test`);

    groupRoom = await createGroup(tOwner, "Phòng DTO v2", [uMate]);
    dmMate = await openDirect(tOwner, uMate);
    dmLocked = await openDirect(tOwner, uLocked);
    dmResigned = await openDirect(tOwner, uResigned);

    // ── Phòng DẪN XUẤT cắm thẳng DB ─────────────────────────────────────────────────────────────
    // KHÔNG có đường API tạo phòng dẫn xuất (chúng do job đồng bộ dựng — CHAT-DEC-003), nhưng vế
    // "peer NULL ở mọi loại KHÁC direct" phải được đo trên một loại KHÁC `group`: nhánh trong mapper là
    // `roomType !== 'direct'`, và một ca chỉ phủ `group` sẽ xanh y hệt nếu ai đó đổi thành
    // `roomType === 'group' ? null : …`.
    //
    // Chọn `department` chứ không `project`: neo của `project` là `ref_id` với FK sang `projects`, tức
    // phải gieo thêm cả một hàng dự án (và dây phụ thuộc của nó) chỉ để đo một nhánh mapper. `org_units`
    // là bảng nền, gieo một hàng là đủ. Bộ neo tuân `chk_chat_rooms_type_anchor` +
    // `chk_chat_rooms_sync_source` (mig 0538): `department` ⇒ org_unit_id NOT NULL, direct_key/ref_id NULL.
    const orgUnitId = randomUUID();
    await direct.query(
      `INSERT INTO org_units (id, company_id, name, type, code) VALUES ($1,$2,'Phòng Kỹ thuật','department',$3)`,
      [orgUnitId, A.companyId, `OU-${orgUnitId.slice(0, 8)}`],
    );
    derivedRoom = await insertRoomDirect(
      {
        roomType: "department",
        name: "Phòng Kỹ thuật",
        code: `DEP-${orgUnitId.slice(0, 8)}`,
        orgUnitId,
      },
      [uOwner, uMate],
    );
  }, 240_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── lastMessage: che + cắt Ở SERVER (CHAT-DEC-022) ──────────────────────────────────────────────

  it("ca 1 — phòng CHƯA CÓ TIN ⇒ `lastMessage: null` (không phải object rỗng)", async () => {
    const empty = await createGroup(tOwner, "Phòng rỗng", []);
    const room = await roomFromList(tOwner, empty);
    expect(room.lastMessage).toBeNull();
  });

  it("ca 2 — tin có CẢ chữ LẪN tệp ⇒ `kind:'text'` thắng, `attachmentCount` VẪN > 0", async () => {
    const f1 = await insertFile(A.companyId, uOwner, "image/png", "a.png");
    const f2 = await insertFile(A.companyId, uOwner, "application/pdf", "b.pdf");
    const room = await createGroup(tOwner, "Chữ + tệp", [uMate]);
    await send(tOwner, room, "báo cáo tuần", [f1, f2]);

    const dto = await roomFromList(tOwner, room);
    expect(dto.lastMessage).toMatchObject({
      kind: "text",
      excerpt: "báo cáo tuần",
      attachmentCount: 2,
      senderId: uOwner,
    });
  });

  it("ca 3 — tin CHỈ có tệp ⇒ `kind:'file'` + `excerpt: null`", async () => {
    const f = await insertFile(A.companyId, uOwner, "image/png", "c.png");
    const room = await createGroup(tOwner, "Chỉ tệp", [uMate]);
    await send(tOwner, room, "", [f]);

    const dto = await roomFromList(tOwner, room);
    expect(dto.lastMessage).toMatchObject({ kind: "file", excerpt: null, attachmentCount: 1 });
  });

  it("ca 4 — tin ĐÃ THU HỒI ⇒ `kind:'recalled'` + `excerpt: null`, DÙ body còn nguyên trong DB", async () => {
    const room = await createGroup(tOwner, "Thu hồi", [uMate]);
    const secret = "NOI-DUNG-DA-THU-HOI-KHONG-DUOC-RA-KHOI-SERVER";
    const msgId = await send(tOwner, room, secret);
    const recall = await authPost(tOwner, `/chat/messages/${msgId}/recall`).send({});
    expect(recall.status, JSON.stringify(recall.body)).toBe(200);

    // Bản gốc VẪN nằm trong DB (append-only, cho tranh chấp nội bộ — SPEC-15 §13.6). Đối chứng này là
    // thứ làm ca có nghĩa: nó chứng minh che xảy ra ở TẦNG RA, không phải vì dữ liệu đã mất.
    const raw = await direct.query(`SELECT body FROM chat_messages WHERE id = $1`, [msgId]);
    expect(raw.rows[0].body).toBe(secret);

    const dto = await roomFromList(tOwner, room);
    expect(dto.lastMessage).toMatchObject({ kind: "recalled", excerpt: null });
    expect(JSON.stringify(dto)).not.toContain(secret);
  });

  it("ca 5 — tin `message_type='system'` ⇒ `kind:'system'` (không rơi vào nhánh 'text')", async () => {
    // ⚠️ Gieo THẲNG DB, không qua API — ĐO NGÀY 09/09/2026: **chưa writer nào sinh tin `system`**.
    // SPEC-15 hứa tin hệ thống cho thêm/bớt thành viên và `chk_chat_messages_type` đã nhận giá trị đó,
    // nhưng `POST /chat/rooms/:id/members` hiện KHÔNG ghi tin nào (grep `messageType: "system"` trong
    // `apps/api/src/chat/**` ra 0 writer). Ca này vì thế khoá ĐƯỜNG ĐỌC lại trước: khi WO sau nối dây
    // writer, nhánh mapper đã có ca canh sẵn thay vì được "phát hiện" bằng mắt trên UI.
    const room = await createGroup(tOwner, "Hệ thống", [uMate]);
    await direct.query(
      `INSERT INTO chat_messages (id, company_id, room_id, sender_id, body, message_type, room_seq)
       VALUES ($1,$2,$3,$4,$5,'system',1)`,
      [randomUUID(), A.companyId, room, uOwner, "Nguyễn An đã thêm Trần Bình vào phòng"],
    );
    await direct.query(
      `UPDATE chat_rooms SET last_message_at = now(), last_message_seq = 1 WHERE id = $1`,
      [room],
    );

    const dto = await roomFromList(tOwner, room);
    expect(dto.lastMessage).toMatchObject({
      kind: "system",
      // Nội dung tin hệ thống do SERVER sinh (không phải lời người dùng) nên VẪN hiện — FE dùng `kind`
      // để vẽ chữ xám, không phải để ẩn.
      excerpt: "Nguyễn An đã thêm Trần Bình vào phòng",
    });
  });

  it("ca 6 — body 500 ký tự ⇒ excerpt cắt Ở SERVER còn ≤120 grapheme", async () => {
    const room = await createGroup(tOwner, "Cắt dài", [uMate]);
    const long = "x".repeat(500);
    await send(tOwner, room, long);

    const dto = await roomFromList(tOwner, room);
    const excerpt = (dto.lastMessage as { excerpt: string }).excerpt;
    const graphemes = [...new Intl.Segmenter("vi").segment(excerpt)].length;
    expect(graphemes).toBe(120);
    // Cắt ở CLIENT là không cắt gì cả — payload vẫn mang trọn 500 ký tự qua dây.
    expect(excerpt.length).toBeLessThan(long.length);
  });

  // ── peer: chỉ `direct` (CHAT-DEC-023) ───────────────────────────────────────────────────────────

  it("ca 7 — `peer` CÓ ở phòng `direct`, NULL ở `group` VÀ ở `department`", async () => {
    const dm = await roomFromList(tOwner, dmMate);
    expect(dm.peer).toMatchObject({ userId: uMate, isActive: true });

    expect((await roomFromList(tOwner, groupRoom)).peer).toBeNull();
    // Loại thứ ba, KHÔNG phải `group`: nhánh mapper là `roomType !== 'direct'`, và một ca chỉ phủ
    // `group` sẽ xanh y hệt nếu ai đó viết `roomType === 'group' ? null : …`.
    expect((await roomFromList(tOwner, derivedRoom)).peer).toBeNull();
  });

  it("ca 8 — `peer` KHÔNG BAO GIỜ là chính actor, và KHÔNG rò `directKey`", async () => {
    const dm = await roomFromList(tOwner, dmMate);
    expect((dm.peer as { userId: string }).userId).not.toBe(uOwner);
    // `direct_key` ghép từ 2 userId ⇒ bản thân nó LÀ quan hệ ai-nhắn-với-ai; không cột nào của nó
    // được rời server (docblock `ChatRoomRow`).
    expect(Object.keys(dm)).not.toContain("directKey");
  });

  it("ca 9 — `isActive:false` khi TÀI KHOẢN bị khoá (users.status)", async () => {
    await direct.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [uLocked]);
    const dm = await roomFromList(tOwner, dmLocked);
    expect((dm.peer as { isActive: boolean }).isActive).toBe(false);
    // Đối chứng DƯƠNG trong CÙNG lần đọc: một DM khác vẫn `true` ⇒ ca trên không xanh vì "mọi thứ đều
    // false" (memory `deny-cases-vacuous-without-allow-case`).
    expect(((await roomFromList(tOwner, dmMate)).peer as { isActive: boolean }).isActive).toBe(
      true,
    );
  });

  it("ca 10 — `isActive:false` khi NHÂN SỰ đã nghỉ, dù tài khoản còn `active`", async () => {
    // Vế này KHÔNG suy ra được từ vế trên: đăng nhập chỉ gate `users.status`, `deleteEmployee`/
    // `unlinkUser` không chạm `users`, và `lockUser` là TUỲ CHỌN — người đã nghỉ vẫn `active`.
    await direct.query(
      `INSERT INTO employee_profiles (id, company_id, user_id, employee_code, status)
       VALUES ($1,$2,$3,$4,'inactive')`,
      [randomUUID(), A.companyId, uResigned, `EMP-${uResigned.slice(0, 8)}`],
    );
    const before = await direct.query(`SELECT status FROM users WHERE id = $1`, [uResigned]);
    expect(before.rows[0].status).toBe("active");

    const dm = await roomFromList(tOwner, dmResigned);
    expect((dm.peer as { isActive: boolean }).isActive).toBe(false);
  });

  it("ca 11 — avatar peer ký ĐÚNG MỘT LÔ cho cả trang, không phải một lần mỗi DM", async () => {
    const presign = app.get(AvatarPresignService, { strict: false });
    const spy = vi.spyOn(presign, "resolveEmployeeAvatars");
    try {
      const res = await authGet(tOwner, "/chat/rooms");
      expect(res.status).toBe(200);
      const dms = (res.body.data as { roomType: string }[]).filter((r) => r.roomType === "direct");
      // Ca chỉ có nghĩa khi trang thật sự có NHIỀU DM: 1 DM thì "1 lô" và "1 lần mỗi DM" bằng nhau.
      expect(dms.length).toBeGreaterThanOrEqual(3);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  // ── createdByName (CHAT-DEC-025) ────────────────────────────────────────────────────────────────

  it("ca 12 — `getRoom` trả `createdByName`; phòng do HỆ THỐNG dựng không đổi hành vi", async () => {
    const res = await authGet(tOwner, `/chat/rooms/${groupRoom}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const owner = await direct.query(`SELECT full_name FROM users WHERE id = $1`, [uOwner]);
    expect(res.body.data.createdByName).toBe(owner.rows[0].full_name);

    // Khoá `createdByName` CHỈ ở đường chi tiết — thêm nó vào danh sách là một LEFT JOIN nữa cho MỌI
    // phòng ở đường nóng nhất module, phục vụ một dòng chữ danh sách không hiện.
    expect(await roomFromList(tOwner, groupRoom)).not.toHaveProperty("createdByName");
  });

  // ── deny-path + cross-tenant ────────────────────────────────────────────────────────────────────

  it("ca 13 — không-thành-viên gọi `getRoom` ⇒ 404 mang mã CHAT-ERR-001, giống hệt phòng LẠ", async () => {
    const notMine = await authGet(tOutsider, `/chat/rooms/${groupRoom}`);
    const unknown = await authGet(tOutsider, `/chat/rooms/${UNKNOWN_ROOM}`);

    expect(notMine.status).toBe(404);
    // 403 sẽ xác nhận phòng CÓ TỒN TẠI ⇒ oracle dò. Mã lỗi trong thân phân biệt "route chưa viết" với
    // "phòng không thuộc về bạn" — thiếu assert này thì ca XANH cả khi route chưa tồn tại.
    expect(JSON.stringify(notMine.body)).toContain("CHAT-ERR-001");
    expect(unknown.status).toBe(notMine.status);

    // ALLOW đối chứng — MÃ CHÍNH XÁC, không `.not.toBe(403)`.
    const allowed = await authGet(tOwner, `/chat/rooms/${groupRoom}`);
    expect(allowed.status).toBe(200);
  });

  it("ca 14 — cross-tenant: actor công ty B KHÔNG thấy phòng nào của A", async () => {
    const res = await authGet(tB, "/chat/rooms");
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((r) => r.id);
    for (const roomId of [groupRoom, dmMate, derivedRoom]) {
      expect(ids).not.toContain(roomId);
    }
    // `peer` của A không rò sang B qua bất kỳ hàng nào.
    expect(JSON.stringify(res.body)).not.toContain(uMate);
  });

  // ── CHAT-API-017 ?kind (SPEC-15 §15b) ───────────────────────────────────────────────────────────

  describe("CHAT-API-017 `?kind=image|file` — lọc Ở SQL", () => {
    let filesRoom = "";

    beforeAll(async () => {
      filesRoom = await createGroup(tOwner, "Kho tệp", [uMate]);
      const png = await insertFile(A.companyId, uOwner, "image/png", "anh.png");
      // MIME viết HOA: `mime_type` do client khai lúc upload và KHÔNG được chuẩn hoá ở DB. Đây là ca mà
      // `mime_type LIKE 'image/%'` TRẦN sẽ trượt — DTO nói `isImage:true` mà `kind=image` lọc mất.
      const upper = await insertFile(A.companyId, uOwner, "IMAGE/JPEG", "hoa.jpg");
      const pdf = await insertFile(A.companyId, uOwner, "application/pdf", "tai-lieu.pdf");
      await send(tOwner, filesRoom, "", [png]);
      await send(tOwner, filesRoom, "", [upper]);
      await send(tOwner, filesRoom, "", [pdf]);
    }, 120_000);

    it("ca 15 — `kind=image` trả ĐÚNG các tệp `isImage`, kể cả MIME viết HOA", async () => {
      const res = await authGet(tOwner, `/chat/rooms/${filesRoom}/files?kind=image`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data as { mimeType: string; isImage: boolean }[];
      expect(rows.length).toBe(2);
      // Bất biến "MỘT định nghĩa": mọi hàng lọt bộ lọc SQL đều mang `isImage: true` ở DTO.
      for (const r of rows) expect(r.isImage, `lệch ở MIME '${r.mimeType}'`).toBe(true);
      expect(rows.map((r) => r.mimeType).sort()).toEqual(["IMAGE/JPEG", "image/png"]);
    });

    it("ca 16 — `kind=file` là PHỦ ĐỊNH đúng của cùng vị từ", async () => {
      const res = await authGet(tOwner, `/chat/rooms/${filesRoom}/files?kind=file`);
      expect(res.status).toBe(200);
      const rows = res.body.data as { mimeType: string; isImage: boolean }[];
      expect(rows.map((r) => r.mimeType)).toEqual(["application/pdf"]);
      for (const r of rows) expect(r.isImage).toBe(false);
    });

    it("ca 17 — VẮNG `kind` ⇒ trả TOÀN BỘ (hành vi CHAT-API-017 cũ không đổi)", async () => {
      const res = await authGet(tOwner, `/chat/rooms/${filesRoom}/files`);
      expect(res.status).toBe(200);
      expect((res.body.data as unknown[]).length).toBe(3);
    });

    it("ca 18 — `kind` LẠ ⇒ 400 (validation), KHÔNG phải 422 và KHÔNG phải 200 im lặng", async () => {
      const res = await authGet(tOwner, `/chat/rooms/${filesRoom}/files?kind=video`);
      // 422 dành cho vi phạm rule NGHIỆP VỤ (API-01); sai tập giá trị là lỗi format. Và 200 sẽ nghĩa là
      // tham số bị NUỐT — lọc câm, đúng lớp `ui-promises-backend-never-reads`.
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    });

    it("ca 19 — deny-path: không-thành-viên gọi `?kind=image` ⇒ 404 (gate KHÔNG đổi)", async () => {
      const denied = await authGet(tOutsider, `/chat/rooms/${filesRoom}/files?kind=image`);
      expect(denied.status).toBe(404);
      expect(JSON.stringify(denied.body)).toContain("CHAT-ERR-001");
      // ALLOW đối chứng, MÃ CHÍNH XÁC.
      const allowed = await authGet(tOwner, `/chat/rooms/${filesRoom}/files?kind=image`);
      expect(allowed.status).toBe(200);
    });
  });

  // ── KHÔNG N+1 + kế hoạch truy vấn ───────────────────────────────────────────────────────────────

  describe("hiệu năng — LATERAL nằm TRONG câu list", () => {
    beforeAll(async () => {
      // Cắm thẳng DB (không qua API) — 200 lần POST /chat/rooms là ~200 transaction, quá chậm cho một
      // ca chỉ cần ĐỦ HÀNG. Mỗi phòng có 1 tin để LATERAL thật sự phải chạy.
      for (let i = 0; i < BULK_ROOMS; i += 1) {
        const rid = await insertRoomDirect(
          { roomType: "group", name: `Bulk ${i}`, code: `BULK-${randomUUID().slice(0, 12)}` },
          [uOwner],
        );
        await direct.query(
          `INSERT INTO chat_messages (id, company_id, room_id, sender_id, body, message_type, room_seq)
           VALUES ($1,$2,$3,$4,$5,'text',1)`,
          [randomUUID(), A.companyId, rid, uOwner, `tin của phòng ${i}`],
        );
        await direct.query(
          `UPDATE chat_rooms SET last_message_at = now(), last_message_seq = 1 WHERE id = $1`,
          [rid],
        );
      }
      // Planner cần thống kê để ca EXPLAIN dưới nói được điều gì đó về dữ liệu thật.
      await direct.query(`ANALYZE chat_messages, chat_rooms, chat_room_members`);
    }, 240_000);

    it("ca 20 — 200 phòng ⇒ ĐÚNG MỘT câu SQL chạm `chat_rooms`", async () => {
      const cap = captureQueries();
      let queries: CapturedQuery[];
      try {
        const res = await authGet(tOwner, "/chat/rooms");
        expect(res.status).toBe(200);
        expect((res.body.data as unknown[]).length).toBeGreaterThan(BULK_ROOMS);
        // Mỗi phòng bulk PHẢI có preview — nếu LATERAL không chạy thì ca đếm dưới vẫn xanh (0 câu thêm)
        // mà tính năng hỏng. Vế này khoá lại: 1 câu VÀ có dữ liệu.
        const withPreview = (res.body.data as { name: string; lastMessage: unknown }[]).filter(
          (r) => r.name?.startsWith("Bulk ") && r.lastMessage !== null,
        );
        expect(withPreview.length).toBe(BULK_ROOMS);
      } finally {
        queries = cap.stop();
      }

      const roomQueries = queriesFromTable(queries, "chat_rooms");
      expect(
        roomQueries.length,
        `N+1: ${roomQueries.length} câu chạm chat_rooms cho ${BULK_ROOMS} phòng`,
      ).toBe(1);
      // Và đúng câu đó mang CẢ HAI lateral — không phải "1 câu vì tính năng chưa nối dây".
      expect(roomQueries[0].text.toLowerCase()).toContain("left join lateral");
      expect(roomQueries[0].text).toContain("chat_messages");
    });

    it("ca 21 — vị từ tin cuối ĐI ĐƯỢC trên index `(company_id, room_id, room_seq)`", async () => {
      // ⚠️ Ca này chứng minh HÌNH DẠNG vị từ dùng được index (bật `enable_seqscan=off` để loại nhiễu
      // "bảng bé nên seq scan rẻ hơn"), KHÔNG hứa planner sẽ CHỌN nó ở PROD. Assert trên KẾ HOẠCH, và
      // TUYỆT ĐỐI không assert `pg_stat_user_indexes.idx_scan` — số đó cộng dồn toàn cụm và bằng 0
      // không có nghĩa là index vô dụng (memory `pg-planner-index-assert-trap`, `idx-scan-zero-is-not-unused`).
      //
      // ⚠️ **KHÔNG ghim TÊN index** (vá 11/09/2026). `chat_messages` có HAI index phủ ĐÚNG vị từ này:
      //     `idx_chat_messages_room_seq (company_id, room_id, room_seq DESC)`        — mig `0539:56`
      //     `uq_chat_messages_room_seq  (company_id, room_id, room_seq)`  UNIQUE     — mig `0539:55`
      // btree quét NGƯỢC không tốn thêm gì, nên với `ORDER BY room_seq DESC LIMIT 1` hai index có chi phí
      // BẰNG NHAU ⇒ cái nào thắng là xổ số theo thống kê. Bản cũ assert `toContain("idx_chat_messages_
      // room_seq")`: XANH trên lane DB sạch, ĐỎ trên CI (run `34597707204` — CI dồn mọi int-spec vào MỘT
      // DB nên thống kê khác, planner lật sang `uq_…`) ⇒ chặn PR #503 dù schema hoàn toàn đúng.
      // Thay bằng BA khẳng định TẤT ĐỊNH:
      //   (1) CATALOG — index thiết kế còn sống, đúng cột + đúng chiều (đọc `pg_indexes`, không qua planner);
      //   (2) KHÔNG `Seq Scan on chat_messages` khi đã tắt seqscan ⇒ CÓ index phục vụ được vị từ;
      //   (3) index planner THỰC SỰ dùng cho `chat_messages` phải có tiền tố `(company_id, room_id,
      //       room_seq` — tra `pg_indexes` theo tên ĐỌC TỪ PLAN. Đổi qua lại giữa hai index anh em KHÔNG
      //       đỏ; tụt xuống `chat_messages_room_seq_idx (room_id, seq)` (phải Sort mới ra tin cuối) thì ĐỎ.
      const cap = captureQueries();
      let queries: CapturedQuery[];
      try {
        await authGet(tOwner, "/chat/rooms");
      } finally {
        queries = cap.stop();
      }
      const target = queriesFromTable(queries, "chat_rooms")[0];
      expect(target, "không bắt được câu SQL của listRoomsForUser").toBeDefined();

      const client = await direct.connect();
      try {
        await client.query("BEGIN");
        // RLS + FORCE: EXPLAIN phải chạy trong đúng ngữ cảnh tenant, nếu không policy đổi cả kế hoạch
        // (memory `rls-force-hides-nonleakproof-expr-from-index-cond`).
        await client.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);

        const indexdefOf = async (name: string): Promise<string | undefined> => {
          const r = await client.query(
            `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
            [name],
          );
          return (r.rows as { indexdef: string }[])[0]?.indexdef;
        };

        // (1) CATALOG — index thiết kế của mig `0539` còn sống, đúng cột + đúng chiều DESC.
        const designed = await indexdefOf("idx_chat_messages_room_seq");
        expect(designed, "`idx_chat_messages_room_seq` (mig 0539:56) đã biến mất").toBeDefined();
        expect(designed!).toContain("(company_id, room_id, room_seq DESC)");

        await client.query("SET LOCAL enable_seqscan = off");
        const plan = await client.query(
          `EXPLAIN (FORMAT TEXT) ${target!.text}`,
          target!.values as never[],
        );
        const text = (plan.rows as { "QUERY PLAN": string }[])
          .map((r) => r["QUERY PLAN"])
          .join("\n");

        // (2) `enable_seqscan=off` chỉ PHẠT seq scan chứ không CẤM — còn thấy nó nghĩa là KHÔNG index
        // nào phục vụ được vị từ.
        expect(text, `Seq Scan trên chat_messages dù đã tắt seqscan:\n${text}`).not.toMatch(
          /Seq Scan on chat_messages\b/,
        );

        // (3) Index planner thực sự dùng phải có tiền tố `(company_id, room_id, room_seq`.
        const used = /Index (?:Only )?Scan (?:Backward )?using (\w+) on chat_messages\b/.exec(text);
        expect(used, `không có Index Scan nào trên chat_messages:\n${text}`).not.toBeNull();
        const usedDef = await indexdefOf(used![1]!);
        expect(
          usedDef,
          `index '${used![1]}' planner chọn cho chat_messages KHÔNG có tiền tố (company_id, room_id, room_seq):\n${text}`,
        ).toMatch(/\(company_id, room_id, room_seq\b/);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    });
  });
});
