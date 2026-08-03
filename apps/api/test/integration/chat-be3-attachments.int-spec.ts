/**
 * S7-CHAT-BE-3 — đính kèm tệp/ảnh (SPEC-15 §13.5 · §13.6 · DB-12 §6.5 · API-13 §6 nguyên tắc 3·10).
 *
 * ⚠️ CHỦ THỂ KHÔNG PHẢI SUPER ADMIN — SA giữ `*:*` nên mọi ca deny sẽ xanh-giả (lý do đầy đủ ở đầu
 * `chat-be1-access.int-spec.ts`). GATE CỨNG `hasDb && LANE_DB`.
 *
 * ⚠️ HAI ĐƯỜNG TẢI, HAI HÌNH DẠNG TỪ CHỐI — cả hai đều fail-closed:
 *   • FOUNDATION `GET /foundation/files/:id/download` — cần cặp `download:foundation-file` (DB thật chỉ
 *     SA + company-admin giữ). Từ chối = **403**.
 *   • CHAT (DTO tin + tab Tệp) — không cần cặp foundation nào; đây là đường của người dùng thường.
 *     Từ chối = **`url: null`** (fail-soft có log: một tệp hỏng không được làm trắng cả trang tin).
 * Cả hai đều đi qua CÙNG `FilePolicyService.decideForLinkedFile` ⇒ gỡ resolver là cả hai cùng câm.
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
import { ChatMessageFileResolver } from "../../src/chat/chat-message-file.resolver";
import {
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  CHAT_MESSAGE_ENTITY_TYPE,
} from "../../src/chat/chat-file.constants";
import { directPool, hasDb } from "../helpers/integration-db";
import { FALLBACK_S3_SECRET } from "../helpers/fixture-secrets";
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
const LOGIN_PW = "Passw0rd!chatbe3";

// Presign S3 là HMAC OFFLINE — không gọi mạng, không cần MinIO chạy. Đặt trước khi dựng app.
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY ??= "mediaos";
process.env.S3_SECRET_KEY ??= FALLBACK_S3_SECRET;
process.env.S3_BUCKET ??= "mediaos-assets";
process.env.S3_FORCE_PATH_STYLE ??= "true";
process.env.S3_REGION ??= "us-east-1";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/**
 * 8 cặp CHAT thường + 3 cặp FOUNDATION file.
 *
 * `download`/`link`/`unlink` × `foundation-file` được cấp CÓ CHỦ ĐÍCH cho CẢ người ngoài phòng: nếu
 * không, mọi ca deny sẽ 403 ngay ở `PermissionGuard` của route FOUNDATION và **không chứng minh được gì
 * về resolver** — đúng lớp "test đóng đinh lỗ hổng". Có cặp rồi mà vẫn 403 thì lý do chỉ có thể là
 * `ChatMessageFileResolver`.
 */
const CHAT_FULL: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
  ["recall", "chat-message", "Company"],
  ["pin", "chat-message", "Company"],
  ["download", "foundation-file", "Company"],
  ["link", "foundation-file", "Company"],
  ["unlink", "foundation-file", "Company"],
];

interface Ctx {
  app: INestApplication;
  direct: Pool;
}

async function insertFile(
  direct: Pool,
  companyId: string,
  ownerId: string,
  opts: { mime?: string; uploadStatus?: string; scanStatus?: string; name?: string } = {},
): Promise<string> {
  const fileId = randomUUID();
  const name = opts.name ?? "anh.png";
  await direct.query(
    `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
       storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,1024,'MinIO',$6,'Private',$7,$8,$9,$9)`,
    [
      fileId,
      companyId,
      name,
      `${fileId}-${name}`,
      opts.mime ?? "image/png",
      `${companyId}/files/${fileId}`,
      opts.uploadStatus ?? "Uploaded",
      opts.scanStatus ?? "Clean",
      ownerId,
    ],
  );
  return fileId;
}

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-3 — đính kèm (DB cô lập, đường thật)", () => {
  const ctx = {} as Ctx;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let uAdmin = "";
  let uMember = "";
  let uOutsider = "";
  let uB = "";
  let tAdmin = "";
  let tMember = "";
  let tOutsider = "";
  let tB = "";
  let room = "";

  async function grantPairs(companyId: string, userId: string, label: string): Promise<void> {
    const roleId = await seedRole(direct(), companyId, `chatf-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of CHAT_FULL) {
      const permId = await seedPermissionCatalog(direct(), action, resource, false);
      await seedRolePermission(direct(), roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct(), userId, roleId, companyId);
  }

  const direct = (): Pool => ctx.direct;
  const authGet = (t: string, u: string) =>
    request(ctx.app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) =>
    request(ctx.app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(ctx.app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Gửi tin qua API THẬT — giữ nguyên đường đi production (không gieo `file_links` bằng tay). */
  async function send(token: string, roomId: string, body: string, fileIds?: string[]) {
    return authPost(token, `/chat/rooms/${roomId}/messages`).send({
      body,
      clientMessageId: randomUUID(),
      ...(fileIds ? { fileIds } : {}),
    });
  }

  /** Phòng nhóm mới qua API thật — dùng cho các ca cần một phòng riêng (lưu trữ, trần tệp…). */
  async function createRoom(name: string): Promise<string> {
    const res = await authPost(tAdmin, "/chat/rooms").send({ name, memberUserIds: [uMember] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function countLinks(messageId: string): Promise<number> {
    const r = await direct().query(
      `SELECT count(*)::int AS n FROM file_links
        WHERE module_code = 'CHAT' AND entity_type = $1 AND entity_id = $2 AND deleted_at IS NULL`,
      [CHAT_MESSAGE_ENTITY_TYPE, messageId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    ctx.app = moduleRef.createNestApplication();
    ctx.app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    ctx.app.useGlobalFilters(new AllExceptionsFilter());
    await ctx.app.init();

    ctx.direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(ctx.direct, "chatbe3a");
    B = await seedCompany(ctx.direct, "chatbe3b");
    companyIds.push(A.companyId, B.companyId);

    const mk = (n: string) => seedUser(ctx.direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uAdmin = await mk("owner");
    uMember = await mk("mate");
    uOutsider = await mk("outsider");
    uB = await seedUser(ctx.direct, B.companyId, `bob@${B.slug}.test`, hash);
    for (const [u, l] of [
      [uAdmin, "owner"],
      [uMember, "mate"],
      [uOutsider, "outsider"],
    ] as const) {
      await grantPairs(A.companyId, u, l);
    }
    await grantPairs(B.companyId, uB, "b");

    tAdmin = await login(A.slug, `owner@${A.slug}.test`);
    tMember = await login(A.slug, `mate@${A.slug}.test`);
    tOutsider = await login(A.slug, `outsider@${A.slug}.test`);
    tB = await login(B.slug, `bob@${B.slug}.test`);

    const res = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng có tệp",
      memberUserIds: [uMember],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    room = res.body.data.id as string;
  }, 180_000);

  afterAll(async () => {
    await cleanupTenants(ctx.direct, companyIds);
    await ctx.direct.end();
    await ctx.app.close();
  });

  // ── Gắn tệp: bốn vế của CHAT-ERR-015 ────────────────────────────────────────

  it("ca 1: gửi 2 tệp → attachmentCount=2, messageType='file', 2 hàng file_links CÙNG tin", async () => {
    const f1 = await insertFile(direct(), A.companyId, uAdmin, { name: "a.png" });
    const f2 = await insertFile(direct(), A.companyId, uAdmin, {
      name: "b.pdf",
      mime: "application/pdf",
    });
    const res = await send(tAdmin, room, "hai tệp", [f1, f2]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // `attachment_count` đặt NGAY TRONG CÂU INSERT — cột không có GRANT UPDATE (0538:350). Nếu ai đó
    // chuyển sang `UPDATE … SET attachment_count` thì ca này 500, không phải sai số.
    expect(res.body.data.attachmentCount).toBe(2);
    expect(res.body.data.messageType).toBe("file");
    expect(res.body.data.attachments).toHaveLength(2);
    expect(await countLinks(res.body.data.id as string)).toBe(2);

    const byName = Object.fromEntries(
      (res.body.data.attachments as Array<Record<string, unknown>>).map((a) => [a.name, a]),
    );
    expect(byName["a.png"].isImage).toBe(true);
    expect(typeof byName["a.png"].url).toBe("string");
    expect(byName["a.png"].thumbnailUrl).toBe(byName["a.png"].url);
    // Tệp KHÔNG phải ảnh: `thumbnailUrl` null ⇒ FE hiện tên + kích thước (SPEC-15 §13.5 câu cuối).
    expect(byName["b.pdf"].isImage).toBe(false);
    expect(byName["b.pdf"].thumbnailUrl).toBeNull();
    expect(typeof byName["b.pdf"].url).toBe("string");
  });

  it("ca 2: gắn tệp NGƯỜI KHÁC tải lên → 403 CHAT-ERR-015 (chốt tại nguồn)", async () => {
    const foreign = await insertFile(direct(), A.companyId, uMember, { name: "cccd.png" });
    const res = await send(tAdmin, room, "mượn tệp", [foreign]);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-015");
  });

  it("ca 3: tệp Infected / chưa Uploaded → 403 CHAT-ERR-015", async () => {
    const infected = await insertFile(direct(), A.companyId, uAdmin, { scanStatus: "Infected" });
    const pending = await insertFile(direct(), A.companyId, uAdmin, { uploadStatus: "Pending" });
    expect((await send(tAdmin, room, "nhiễm", [infected])).status).toBe(403);
    expect((await send(tAdmin, room, "chưa xong", [pending])).status).toBe(403);
  });

  it("ca 4: cross-tenant — tệp của tenant B gắn vào tin tenant A → 403", async () => {
    const foreign = await insertFile(direct(), B.companyId, uB, { name: "b.png" });
    const res = await send(tAdmin, room, "chéo tenant", [foreign]);
    expect(res.status).toBe(403);
  });

  it("ca 5: fileId trùng lặp [f, f] → 1 link, attachmentCount=1 (không 23505)", async () => {
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "trung.png" });
    const res = await send(tAdmin, room, "trùng", [f, f]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.attachmentCount).toBe(1);
    expect(await countLinks(res.body.data.id as string)).toBe(1);
  });

  it("ca 6: gửi LẠI cùng clientMessageId + cùng fileIds → idempotent, vẫn 1 link (không nhân đôi)", async () => {
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "idem.png" });
    const clientMessageId = randomUUID();
    const payload = { body: "gửi lại", clientMessageId, fileIds: [f] };

    const first = await authPost(tAdmin, `/chat/rooms/${room}/messages`).send(payload);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await authPost(tAdmin, `/chat/rooms/${room}/messages`).send(payload);
    expect(second.status, JSON.stringify(second.body)).toBe(200);

    expect(second.body.data.id).toBe(first.body.data.id);
    // Nhánh idempotent PHẢI return sớm trước khi gắn link: gắn lại là 23505 của
    // `uq_file_links_entity_file_active` ⇒ một lần bấm-lại vô hại biến thành 500.
    expect(await countLinks(first.body.data.id as string)).toBe(1);
  });

  it("ca 7: quá trần 10 tệp → 400; body rỗng + 0 tệp → 400 (CHAT-ERR-004); body rỗng + 1 tệp → 200", async () => {
    // 400 chứ không 422: đây là lỗi SCHEMA (`ZodValidationPipe` ở biên), khác lỗi LUẬT ở service
    // (vd `CURSOR_EXCLUSIVE` → 422). API-13 §8 cho phép cả hai cho nhóm validate đầu vào; ca này đóng
    // đinh mã THẬT để không ai "sửa cho khớp tài liệu" bằng cách đổi tầng ném lỗi.
    const many = Array.from({ length: 11 }, () => randomUUID());
    expect((await send(tAdmin, room, "quá tay", many)).status).toBe(400);

    const empty = await authPost(tAdmin, `/chat/rooms/${room}/messages`).send({
      body: "",
      clientMessageId: randomUUID(),
    });
    // Nới `body` sang `.default("")` KHÔNG được làm lọt tin rỗng-không-tệp — `superRefine` giữ lại vế đó.
    expect(empty.status, JSON.stringify(empty.body)).toBe(400);
    expect(JSON.stringify(empty.body)).toContain("CHAT-ERR-004");

    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "chi-anh.png" });
    const onlyFile = await authPost(tAdmin, `/chat/rooms/${room}/messages`).send({
      body: "",
      clientMessageId: randomUUID(),
      fileIds: [f],
    });
    expect(onlyFile.status, JSON.stringify(onlyFile.body)).toBe(200);
    expect(onlyFile.body.data.attachmentCount).toBe(1);
  });

  // ── Đường đọc: cặp gate của tệp TRÙNG cặp đường đọc tin ─────────────────────

  it("ca 8: thành viên tải được qua FOUNDATION; NGƯỜI NGOÀI PHÒNG (có download:foundation-file) → 403", async () => {
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "chung.png" });
    const sent = await send(tAdmin, room, "cho cả phòng", [f]);
    expect(sent.status).toBe(200);

    // Thành viên khác trong phòng: 302 (redirect tới URL ký).
    const ok = await authGet(tMember, `/foundation/files/${f}/download`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(302);

    // `uOutsider` giữ ĐỦ `download:foundation-file` @Company — chỉ thiếu MEMBERSHIP. 403 ở đây chứng
    // minh chính `ChatMessageFileResolver` là thứ chặn, không phải guard của route.
    expect((await authGet(tOutsider, `/foundation/files/${f}/download`)).status).toBe(403);
    expect((await authGet(tB, `/foundation/files/${f}/download`)).status).toBe(404);
  });

  it("ca 9: gắn tệp của mình vào tin NGƯỜI KHÁC qua route FOUNDATION → 403", async () => {
    const victim = await send(tAdmin, room, "tin của owner");
    expect(victim.status).toBe(200);
    const mine = await insertFile(direct(), A.companyId, uMember, { name: "chen.png" });

    const res = await authPost(tMember, `/foundation/files/${mine}/links`).send({
      fileId: mine,
      moduleCode: "CHAT",
      entityType: CHAT_MESSAGE_ENTITY_TYPE,
      entityId: victim.body.data.id,
      linkType: "Attachment",
    });
    // Không có vế "người gửi tin đích", `attachment_count` của tin nạn nhân (0, không sửa được) sẽ lệch
    // VĨNH VIỄN với tab Tệp — không có đường sửa qua API.
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await countLinks(victim.body.data.id as string)).toBe(0);
  });

  // ── CHAT-API-017 — tab Tệp ──────────────────────────────────────────────────

  it("ca 10: GET /rooms/:id/files — thành viên thấy tệp kèm URL; người ngoài → 404 (không 403)", async () => {
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "tab-tep.png" });
    const sent = await send(tAdmin, room, "vào tab tệp", [f]);
    expect(sent.status).toBe(200);

    const list = await authGet(tMember, `/chat/rooms/${room}/files`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const rows = list.body.data as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.fileId === f);
    expect(row, "tệp vừa gửi phải có trong tab Tệp").toBeDefined();
    expect(typeof row!.url).toBe("string");
    expect(row!.messageId).toBe(sent.body.data.id);
    expect(row!.senderId).toBe(uAdmin);

    // 404 chứ KHÔNG 403: hằng `ROOM_NOT_FOUND` — 403 xác nhận phòng có thật (CHAT-ERR-001).
    expect((await authGet(tOutsider, `/chat/rooms/${room}/files`)).status).toBe(404);
    expect((await authGet(tB, `/chat/rooms/${room}/files`)).status).toBe(404);
  });

  it("ca 11: mỗi tệp ĐÃ KÝ ở tab Tệp để lại 1 dòng file_access_logs 'GenerateSignedUrl'", async () => {
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "dau-vet.png" });
    expect((await send(tAdmin, room, "để lại dấu", [f])).status).toBe(200);

    // ⚠️ `before` và `after` phải dùng CÙNG bộ lọc (kể cả `actor_user_id`). Bản đầu đếm `before` không
    // lọc actor — hôm nay vẫn đúng vì `before = 0`, nhưng lệch chiều ngay khi có đường khác ghi
    // `GenerateSignedUrl` cho tệp này: so hai phép đếm khác điều kiện là so hai đại lượng khác nhau.
    const countSigned = async (): Promise<number> => {
      const r = await direct().query(
        `SELECT count(*)::int AS n FROM file_access_logs
          WHERE file_id = $1 AND action = 'GenerateSignedUrl' AND actor_user_id = $2`,
        [f, uMember],
      );
      return r.rows[0].n as number;
    };
    const before = await countSigned();
    expect((await authGet(tMember, `/chat/rooms/${room}/files`)).status).toBe(200);
    // Kéo cả kho tệp của một phòng mà KHÔNG để lại dấu vết nào là điều duy nhất không chấp nhận được ở
    // đường này (từng lượt tải qua FOUNDATION thì đã có dấu).
    expect(await countSigned()).toBeGreaterThan(before);
  });

  it("ca 11b: phân trang tab Tệp KHÔNG chẻ đôi một tin — limit=1 trên tin 3 tệp vẫn trả đủ 3", async () => {
    // Con trỏ trang kế là `beforeSeq = room_seq nhỏ nhất của trang này`, vị từ LOẠI TRỪ ⇒ cắt giữa một
    // tin là mất phần đuôi VĨNH VIỄN (không lỗi, không log). Ca này khoá lại hành vi đó.
    const paged = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng phân trang",
      memberUserIds: [],
    });
    expect(paged.status).toBe(201);
    const pagedRoom = paged.body.data.id as string;

    const trio = await Promise.all([
      insertFile(direct(), A.companyId, uAdmin, { name: "p1.png" }),
      insertFile(direct(), A.companyId, uAdmin, { name: "p2.png" }),
      insertFile(direct(), A.companyId, uAdmin, { name: "p3.png" }),
    ]);
    const solo = await insertFile(direct(), A.companyId, uAdmin, { name: "p0.png" });
    expect((await send(tAdmin, pagedRoom, "tin cũ", [solo])).status).toBe(200);
    const big = await send(tAdmin, pagedRoom, "tin 3 tệp", trio);
    expect(big.status, JSON.stringify(big.body)).toBe(200);

    const first = await authGet(tAdmin, `/chat/rooms/${pagedRoom}/files?limit=1`);
    expect(first.status).toBe(200);
    const page1 = first.body.data as Array<Record<string, unknown>>;
    expect(page1).toHaveLength(3);
    expect(new Set(page1.map((r) => r.fileId))).toEqual(new Set(trio));

    const cursor = Math.min(...page1.map((r) => r.roomSeq as number));
    const second = await authGet(
      tAdmin,
      `/chat/rooms/${pagedRoom}/files?limit=1&beforeSeq=${cursor}`,
    );
    const page2 = second.body.data as Array<Record<string, unknown>>;
    expect(page2).toHaveLength(1);
    expect(page2[0].fileId).toBe(solo);
  });

  // ── Thu hồi: tệp biến mất khỏi MỌI đường ────────────────────────────────────

  it("ca 12: thu hồi tin có tệp → attachments rỗng · rời tab Tệp · FOUNDATION download 403", async () => {
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "thu-hoi.png" });
    const sent = await send(tAdmin, room, "sẽ thu hồi", [f]);
    expect(sent.status).toBe(200);
    const messageId = sent.body.data.id as string;

    // Trước thu hồi: tải được.
    expect((await authGet(tMember, `/foundation/files/${f}/download`)).status).toBe(302);

    const recalled = await authPost(tAdmin, `/chat/messages/${messageId}/recall`);
    expect(recalled.status, JSON.stringify(recalled.body)).toBe(200);
    expect(recalled.body.data.attachments).toEqual([]);
    expect(recalled.body.data.body).toBeNull();
    // `attachmentCount` CỐ Ý giữ số cũ — cột không có GRANT UPDATE; nó là số liệu lịch sử.
    expect(recalled.body.data.attachmentCount).toBe(1);

    // ⚠️ Link được GIỮ SỐNG có chủ đích (FULL gate HIGH-1). Bản đầu soft-delete nó, và đo được rằng
    // thao tác đó MỞ RỘNG phạm vi tải: 0 link ⇒ `decideForLinkedFile` tụt xuống fallback
    // `FOUNDATION.FILE.DOWNLOAD` ⇒ người ngoài phòng giữ cặp đó chuyển từ 403 sang 302 SAU thu hồi.
    // Giữ link ⇒ tệp vẫn module-owned ⇒ resolver vẫn quyết định, và nó chặn vì `recalled_at`.
    expect(await countLinks(messageId), "link giữ SỐNG để tệp vẫn module-owned").toBe(1);

    // ĐÂY là tính chất mà tên ca test hứa — assert thật, không phải comment.
    expect(
      (await authGet(tMember, `/foundation/files/${f}/download`)).status,
      "thu hồi phải CHẶN đường tải FOUNDATION, không được mở rộng nó",
    ).toBe(403);
    expect((await authGet(tOutsider, `/foundation/files/${f}/download`)).status).toBe(403);

    const list = await authGet(tMember, `/chat/rooms/${room}/files`);
    expect((list.body.data as Array<Record<string, unknown>>).some((r) => r.fileId === f)).toBe(
      false,
    );

    const messages = await authGet(tMember, `/chat/rooms/${room}/messages?limit=100`);
    const recalledDto = (messages.body.data as Array<Record<string, unknown>>).find(
      (m) => m.id === messageId,
    );
    expect(recalledDto?.attachments).toEqual([]);

    // Gắn LẠI tệp vào tin đã thu hồi phải bị từ chối — nếu không, link sống lại và mở lại đường tải
    // cho mọi thành viên phòng trong khi mọi đường đọc CHAT vẫn giấu tin đó.
    const relink = await authPost(tAdmin, `/foundation/files/${f}/links`).send({
      moduleCode: "CHAT",
      entityType: CHAT_MESSAGE_ENTITY_TYPE,
      entityId: messageId,
      linkType: "Attachment",
    });
    expect(relink.status, JSON.stringify(relink.body)).toBe(403);
  });

  // ── Đường ghi THỨ HAI: POST /foundation/files/:id/links ─────────────────────

  it("ca 12b: khoá điều phối lệch chính tả → 400 (không tạo được link 'ma')", async () => {
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "ma.png" });
    const sent = await send(tAdmin, room, "tin nền", []);
    const messageId = sent.body.data.id as string;

    // Registry của FilePolicyService tra resolver bằng khoá ĐÃ lowercase ⇒ cặp lệch chính tả VẪN khớp
    // resolver (tức VẪN cấp quyền tải), nhưng CHAT truy vấn exact-match nên không thấy để hiển thị/gỡ.
    // Biên ghi phải từ chối, nếu không đây là grant vô hình và vĩnh viễn.
    for (const variant of [
      { moduleCode: "chat", entityType: CHAT_MESSAGE_ENTITY_TYPE },
      { moduleCode: "CHAT", entityType: "Chat_Message" },
      { moduleCode: " CHAT ", entityType: CHAT_MESSAGE_ENTITY_TYPE },
    ]) {
      const res = await authPost(tAdmin, `/foundation/files/${f}/links`).send({
        ...variant,
        entityId: messageId,
        linkType: "Attachment",
      });
      expect(res.status, `variant ${JSON.stringify(variant)}: ${JSON.stringify(res.body)}`).toBe(
        400,
      );
    }

    // Dạng chính tắc vẫn đi qua được (đối chứng dương — nếu không có ca này thì "400 hết" cũng xanh).
    const ok = await authPost(tAdmin, `/foundation/files/${f}/links`).send({
      moduleCode: "CHAT",
      entityType: CHAT_MESSAGE_ENTITY_TYPE,
      entityId: messageId,
      linkType: "Attachment",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it("ca 12c: tệp gắn qua đường FOUNDATION vẫn LÊN /messages (không vô hình vì attachmentCount cũ)", async () => {
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "gan-sau.png" });
    const sent = await send(tAdmin, room, "tin không tệp", []);
    const messageId = sent.body.data.id as string;
    expect(sent.body.data.attachmentCount).toBe(0);

    const linked = await authPost(tAdmin, `/foundation/files/${f}/links`).send({
      moduleCode: "CHAT",
      entityType: CHAT_MESSAGE_ENTITY_TYPE,
      entityId: messageId,
      linkType: "Attachment",
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);

    // `attachment_count` KHÔNG tăng được (cột không có GRANT UPDATE) — đó là lệch ĐÃ CHẤP NHẬN.
    // Nhưng tệp PHẢI hiện trên đường đọc chính, nếu không hai đường đọc nói hai chuyện khác nhau và
    // không có đường sửa qua API.
    const messages = await authGet(tMember, `/chat/rooms/${room}/messages?limit=100`);
    const dto = (messages.body.data as Array<Record<string, unknown>>).find(
      (m) => m.id === messageId,
    );
    const atts = dto?.attachments as Array<Record<string, unknown>>;
    expect(atts, "tệp gắn sau phải hiện trên /messages").toHaveLength(1);
    expect(atts[0].fileId).toBe(f);
  });

  it("ca 12d: gắn tệp vào phòng ĐÃ LƯU TRỮ → 403 (CHAT-ERR-005 không bị vòng qua)", async () => {
    const arch = await createRoom("phong-luu-tru");
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "archived.png" });
    const sent = await send(tAdmin, arch, "trước khi lưu trữ", []);
    const messageId = sent.body.data.id as string;

    await direct().query(`UPDATE chat_rooms SET is_archived = true WHERE id = $1`, [arch]);

    // Đường gửi tin đã chặn từ BE-1; đường FOUNDATION phải chặn CÙNG luật, nếu không vẫn ghi được nội
    // dung mới vào phòng chỉ-đọc.
    expect((await send(tAdmin, arch, "sau khi lưu trữ", [])).status).toBe(409);
    const res = await authPost(tAdmin, `/foundation/files/${f}/links`).send({
      moduleCode: "CHAT",
      entityType: CHAT_MESSAGE_ENTITY_TYPE,
      entityId: messageId,
      linkType: "Attachment",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("ca 12e: chạm trần tệp/tin qua đường FOUNDATION → 403 (điều kiện tiên quyết của trimToMessageBoundary)", async () => {
    const fileIds: string[] = [];
    for (let i = 0; i < CHAT_MAX_ATTACHMENTS_PER_MESSAGE; i += 1) {
      fileIds.push(await insertFile(direct(), A.companyId, uAdmin, { name: `tran-${i}.png` }));
    }
    const sent = await send(tAdmin, room, "đầy trần", fileIds);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const messageId = sent.body.data.id as string;
    expect(await countLinks(messageId)).toBe(CHAT_MAX_ATTACHMENTS_PER_MESSAGE);

    const extra = await insertFile(direct(), A.companyId, uAdmin, { name: "vuot-tran.png" });
    const res = await authPost(tAdmin, `/foundation/files/${extra}/links`).send({
      moduleCode: "CHAT",
      entityType: CHAT_MESSAGE_ENTITY_TYPE,
      entityId: messageId,
      linkType: "Attachment",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await countLinks(messageId)).toBe(CHAT_MAX_ATTACHMENTS_PER_MESSAGE);
  });

  // ── Đường đọc mang tệp ───────────────────────────────────────────────────────

  it("ca 13: /messages và /pinned đều trả attachments đã ký", async () => {
    const f = await insertFile(direct(), A.companyId, uAdmin, { name: "ghim.png" });
    const sent = await send(tAdmin, room, "sẽ ghim", [f]);
    expect(sent.status).toBe(200);
    const messageId = sent.body.data.id as string;

    const list = await authGet(tMember, `/chat/rooms/${room}/messages?limit=100`);
    const dto = (list.body.data as Array<Record<string, unknown>>).find((m) => m.id === messageId);
    expect((dto?.attachments as unknown[]).length).toBe(1);

    expect((await authPost(tAdmin, `/chat/messages/${messageId}/pin`)).status).toBe(200);
    const pinned = await authGet(tMember, `/chat/rooms/${room}/pinned`);
    const pinnedDto = (pinned.body.data as Array<Record<string, unknown>>).find(
      (m) => m.id === messageId,
    );
    expect((pinnedDto?.attachments as Array<Record<string, unknown>>)[0].fileId).toBe(f);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Ca cốt lõi của WO: GỠ ĐĂNG KÝ RESOLVER ⇒ MỌI đường tải câm.
// ═══════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-3 — fail-closed khi THIẾU resolver (ca cốt lõi)", () => {
  let app: INestApplication;
  let direct: Pool;
  let tenant: SeededTenant;
  const companyIds: string[] = [];
  let token = "";
  let userId = "";
  let room = "";

  beforeAll(async () => {
    /**
     * Thay `ChatMessageFileResolver` bằng một stub khai `moduleCode` KHÁC ⇒ `ChatModule.onModuleInit`
     * đăng ký stub dưới một key khác, cặp `(CHAT, chat_message)` **không ai nhận** ⇒
     * `decideForLinkedFile` trả `deny-no-resolver`.
     *
     * Stub trả `true` cho MỌI method — cố ý. Nếu ca vẫn từ chối thì lý do CHỈ có thể là điều phối
     * registry, không phải verdict của stub. Đây là điểm khác biệt giữa "chứng minh fail-closed" và
     * "giả định fail-closed".
     */
    const stub = {
      moduleCode: "CHAT-RESOLVER-GO-MAT",
      entityTypes: [CHAT_MESSAGE_ENTITY_TYPE],
      canViewFile: () => Promise.resolve(true),
      canDownloadFile: () => Promise.resolve(true),
      canLinkFile: () => Promise.resolve(true),
      canUnlinkFile: () => Promise.resolve(true),
      canDeleteFile: () => Promise.resolve(true),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ChatMessageFileResolver)
      .useValue(stub)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    tenant = await seedCompany(direct, "chatbe3x");
    companyIds.push(tenant.companyId);
    userId = await seedUser(direct, tenant.companyId, `solo@${tenant.slug}.test`, hash);

    const roleId = await seedRole(direct, tenant.companyId, "chatf-solo");
    for (const [action, resource, scope] of CHAT_FULL) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, tenant.companyId);

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email: `solo@${tenant.slug}.test`, password: LOGIN_PW });
    expect(loginRes.status, JSON.stringify(loginRes.body)).toBe(200);
    token = loginRes.body.data.accessToken as string;

    const roomRes = await request(app.getHttpServer())
      .post("/chat/rooms")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Phòng không resolver", memberUserIds: [] });
    expect(roomRes.status, JSON.stringify(roomRes.body)).toBe(201);
    room = roomRes.body.data.id as string;
  }, 180_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  it("gỡ đăng ký resolver → FOUNDATION download 403, DTO tin `url: null`, tab Tệp `url: null`", async () => {
    const fileId = await insertFile(direct, tenant.companyId, userId, { name: "cam.png" });
    const sent = await request(app.getHttpServer())
      .post(`/chat/rooms/${room}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "gửi được", clientMessageId: randomUUID(), fileIds: [fileId] });

    // Gửi VẪN thành công — đó chính là hình dạng của "tính năng chết trong im lặng": tệp lên tới nơi,
    // link tạo xong, và không ai tải được. Ca này khoá đúng khoảnh khắc đó lại.
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.data.attachmentCount).toBe(1);
    expect(sent.body.data.attachments[0].url, "KHÔNG được ký khi thiếu resolver").toBeNull();
    expect(sent.body.data.attachments[0].thumbnailUrl).toBeNull();
    // Metadata VẪN trả để FE hiện "tệp không tải được" thay vì một ô trống không giải thích.
    expect(sent.body.data.attachments[0].name).toBe("cam.png");

    const dl = await request(app.getHttpServer())
      .get(`/foundation/files/${fileId}/download`)
      .set("Authorization", `Bearer ${token}`);
    expect(dl.status, JSON.stringify(dl.body)).toBe(403);

    const files = await request(app.getHttpServer())
      .get(`/chat/rooms/${room}/files`)
      .set("Authorization", `Bearer ${token}`);
    expect(files.status).toBe(200);
    const row = (files.body.data as Array<Record<string, unknown>>).find(
      (r) => r.fileId === fileId,
    );
    expect(row?.url, "tab Tệp cũng không được ký").toBeNull();
  });
});
