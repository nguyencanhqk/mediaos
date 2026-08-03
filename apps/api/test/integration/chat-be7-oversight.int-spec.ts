/**
 * S7-CHAT-BE-7 🔒 — ĐỌC-VƯỢT MEMBERSHIP trên DB thật, đường thật (CHAT-DEC-004).
 * SPEC-15 §3.3 · §12 CHAT-ERR-019/020 · §20 ca 10/11 · §21 nhóm "Đọc-vượt membership" · API-13 §5.3.
 *
 * ┌─ CHỦ THỂ **KHÔNG PHẢI** SUPER ADMIN — ĐỌC TRƯỚC KHI "ĐƠN GIẢN HOÁ" FIXTURE ──────────────────────┐
 * │ SA có `*:*` **và** được grant toàn bộ catalog ⇒ ca positive vẫn XANH kể cả khi guard khai sai      │
 * │ resource (`chat-oversite`), sai action, hoặc **quên guard hoàn toàn**. Thêm nữa, lane DB không set │
 * │ `PLATFORM_SUPERADMIN_EMAIL` thì role SA có thể **không tồn tại** và ca không chạy được             │
 * │ (memory `superadmin-not-a-canonical-role`). Cả vế allow LẪN vế deny dùng role dựng trong test.     │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ HAI CHỦ THỂ, KHÁC NHAU ĐÚNG MỘT CẶP ────────────────────────────────────────────────────────────┐
 * │ `uOvs`   — 9 cặp CHAT thường + `download:foundation-file` + **`('view','chat-oversight')`**        │
 * │ `uPlain` — 9 cặp CHAT thường + `download:foundation-file`, **KHÔNG** có cặp đọc-vượt              │
 * │ Khác biệt duy nhất là cặp đó ⇒ mọi chênh lệch hành vi quan sát được QUY VỀ nó, không quy về "một   │
 * │ người có quyền hơn". `download:foundation-file` cấp cho CẢ HAI có chủ đích: thiếu nó thì ca "tải   │
 * │ tệp trong phòng không thuộc → 403" sẽ 403 ngay ở `PermissionGuard` của route FOUNDATION và         │
 * │ **không chứng minh được gì về resolver** (lớp `tests-can-pin-a-hole-open`).                        │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mọi ca đếm `audit_logs` TRƯỚC/SAU: thành công +1 `Success` · từ chối +1 `Denied` (VẪN +1 SAU KHI
 * request trả 403) · ép ghi audit lỗi → +0 VÀ 0 dữ liệu.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { AuditService } from "../../src/events/audit.service";
import { CHAT_AUDIT, CHAT_MODULE_CODE } from "../../src/chat/chat.errors";
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
const LOGIN_PW = "Passw0rd!chatbe7";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/** 9 cặp CHAT thường + đường tải tệp FOUNDATION. TẤT CẢ `is_sensitive = false` (seed 0538:406-415). */
const CHAT_BASE: PairGrant[] = [
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
];

/**
 * Cặp ĐỌC-VƯỢT. `is_sensitive` PHẢI là `true` — khớp seed THẬT `0538:419`.
 *
 * ⚠️ `seedPermissionCatalog` ghi `ON CONFLICT DO UPDATE SET is_sensitive = EXCLUDED.is_sensitive` lên
 * catalog **TOÀN CỤC**, còn `cleanupTenants` chỉ dọn tenant ⇒ truyền `false` ở đây là **lật cờ vĩnh viễn
 * trên lane DB**, và cờ đó lái `getCapabilities()` ⇒ int-spec khác phụ thuộc THỨ TỰ CHẠY
 * (lớp `canonical-seed-pin-regression`).
 */
const OVERSIGHT_PAIR: PairGrant = ["view", "chat-oversight", "Company"];

interface Ctx {
  app: INestApplication;
  direct: Pool;
}

async function insertFile(
  direct: Pool,
  companyId: string,
  ownerId: string,
  name = "bao-cao.pdf",
): Promise<string> {
  const fileId = randomUUID();
  await direct.query(
    `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
       storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
     VALUES ($1,$2,$3,$4,'application/pdf',2048,'MinIO',$5,'Private','Uploaded','Clean',$6,$6)`,
    [fileId, companyId, name, `${fileId}-${name}`, `${companyId}/files/${fileId}`, ownerId],
  );
  return fileId;
}

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-7 — đọc-vượt membership (DB cô lập, đường thật)", () => {
  const ctx = {} as Ctx;
  const companyIds: string[] = [];

  let A: SeededTenant;
  let B: SeededTenant;
  let uOwner = "";
  let uPeer = "";
  let uOvs = "";
  let uPlain = "";
  let uB = "";
  let tOwner = "";
  let tPeer = "";
  let tOvs = "";
  let tPlain = "";
  let tB = "";

  /** Phòng nhóm mà `uOvs`/`uPlain` KHÔNG thuộc — sân khấu chính của WO. */
  let pGroup = "";
  /** DM giữa `uOwner` và `uPeer` — phần nhạy cảm nhất của CHAT-DEC-004. */
  let pDm = "";
  /** Phòng đã xoá mềm — đọc-vượt KHÔNG phải thùng rác. */
  let pDeleted = "";
  let roomB = "";
  let attachedFileId = "";
  let recalledMessageId = "";

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

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: PairGrant[],
  ): Promise<void> {
    const roleId = await seedRole(direct(), companyId, `chat7-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(
        direct(),
        action,
        resource,
        resource === "chat-oversight",
      );
      await seedRolePermission(direct(), roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct(), userId, roleId, companyId);
  }

  async function createRoom(token: string, name: string, members: string[]): Promise<string> {
    const res = await authPost(token, "/chat/rooms").send({ name, memberUserIds: members });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function send(
    token: string,
    roomId: string,
    body: string,
    fileIds?: string[],
  ): Promise<string> {
    const res = await authPost(token, `/chat/rooms/${roomId}/messages`).send({
      body,
      clientMessageId: randomUUID(),
      ...(fileIds ? { fileIds } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  /** Số dòng audit ĐỌC-VƯỢT của tenant A, lọc tuỳ chọn theo `result_status`. */
  async function auditCount(status?: "Success" | "Denied"): Promise<number> {
    const rows = await direct().query(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE company_id = $1 AND action = $2 AND module_code = $3
          AND ($4::text IS NULL OR result_status = $4)`,
      [A.companyId, CHAT_AUDIT.OVERSIGHT_READ, CHAT_MODULE_CODE, status ?? null],
    );
    return rows.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    ctx.app = moduleRef.createNestApplication();
    ctx.app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    ctx.app.useGlobalFilters(new AllExceptionsFilter());
    await ctx.app.init();

    ctx.direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);

    A = await seedCompany(ctx.direct, "chatbe7a");
    B = await seedCompany(ctx.direct, "chatbe7b");
    companyIds.push(A.companyId, B.companyId);

    uOwner = await seedUser(ctx.direct, A.companyId, `owner@${A.slug}.test`, hash);
    uPeer = await seedUser(ctx.direct, A.companyId, `peer@${A.slug}.test`, hash);
    uOvs = await seedUser(ctx.direct, A.companyId, `ovs@${A.slug}.test`, hash);
    uPlain = await seedUser(ctx.direct, A.companyId, `plain@${A.slug}.test`, hash);
    uB = await seedUser(ctx.direct, B.companyId, `bob@${B.slug}.test`, hash);

    await grantPairs(A.companyId, uOwner, "owner", CHAT_BASE);
    await grantPairs(A.companyId, uPeer, "peer", CHAT_BASE);
    await grantPairs(A.companyId, uOvs, "ovs", [...CHAT_BASE, OVERSIGHT_PAIR]);
    await grantPairs(A.companyId, uPlain, "plain", CHAT_BASE);
    await grantPairs(B.companyId, uB, "bob", [...CHAT_BASE, OVERSIGHT_PAIR]);

    tOwner = await login(A.slug, `owner@${A.slug}.test`);
    tPeer = await login(A.slug, `peer@${A.slug}.test`);
    tOvs = await login(A.slug, `ovs@${A.slug}.test`);
    tPlain = await login(A.slug, `plain@${A.slug}.test`);
    tB = await login(B.slug, `bob@${B.slug}.test`);

    // ── P_GROUP: 4 tin, tin #2 có tệp, tin #3 bị thu hồi. uOvs/uPlain KHÔNG thuộc phòng. ──
    pGroup = await createRoom(tOwner, "Ban giam doc noi bo", [uPeer]);
    await send(tOwner, pGroup, "So lieu quy 3 da chot");
    attachedFileId = await insertFile(ctx.direct, A.companyId, uOwner);
    await send(tOwner, pGroup, "Gui kem bao cao", [attachedFileId]);
    recalledMessageId = await send(tOwner, pGroup, "Tin nay se bi thu hoi");
    await authPost(tOwner, `/chat/messages/${recalledMessageId}/recall`).send({});
    await send(tPeer, pGroup, "Da nhan");

    // ── P_DM: tin nhắn RIÊNG giữa hai người khác. ──
    const dm = await authPost(tOwner, "/chat/rooms/direct").send({ peerUserId: uPeer });
    expect(dm.status, JSON.stringify(dm.body)).toBe(200);
    pDm = dm.body.data.id as string;
    await send(tOwner, pDm, "Chuyen rieng khong lien quan cong viec");
    await send(tPeer, pDm, "Da hieu");

    // ⚠️ `visible_from_seq` — v1 luôn NULL qua đường API (CHAT-DEC-008), nên phải gieo TAY để ca "018c
    // đọc toàn dải seq" có nghĩa. Không có mốc này thì truy vấn mượn vị từ §13.4 vẫn trả đủ tin cho một
    // THÀNH VIÊN, và ca test không phân biệt được hai hiện thực (ràng buộc 8 không được canh).
    await direct().query(
      `UPDATE chat_room_members SET visible_from_seq = 3 WHERE room_id = $1 AND user_id = $2`,
      [pGroup, uPeer],
    );

    // ── Ba phòng cùng tiền tố tên: fixture cho ca "vượt trần trang → cờ `truncated`". Không có chúng
    //    thì `truncated` chỉ được đo ở nhánh `false` và cờ có thể bị hard-code `false` mà test vẫn xanh.
    for (const suffix of ["Alpha", "Beta", "Gamma"]) {
      await createRoom(tOwner, `Du an ${suffix}`, [uPeer]);
    }

    // ── P_DELETED: phòng đã xoá mềm. ──
    pDeleted = await createRoom(tOwner, "Phong da xoa mem", [uPeer]);
    await send(tOwner, pDeleted, "Noi dung trong phong da xoa");
    await direct().query(`UPDATE chat_rooms SET deleted_at = now() WHERE id = $1`, [pDeleted]);

    // ── Tenant B ──
    roomB = await createRoom(tB, "Phong tenant B", []);
    await send(tB, roomB, "Noi dung cua tenant B");
  }, 240_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupTenants(ctx.direct, companyIds);
    await ctx.direct.end();
    await ctx.app.close();
  });

  // ═══════════ ĐƯỜNG TỪ CHỐI — CHAT-ERR-019 ═══════════

  it("ca 16: role thiếu cặp → 403 (KHÔNG 404) và VẪN +1 dòng audit `Denied` SAU KHI request trả về", async () => {
    const before = await auditCount("Denied");
    const res = await authGet(tPlain, `/chat/oversight/rooms/${pGroup}`);

    // 403 chứ không 404: người gọi BIẾT mình đang dùng chức năng quản trị, không có gì để dò (SPEC-15 §12).
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("Ban giam doc noi bo");

    // Dòng audit phải đã COMMIT trước khi 403 rời server. Ném 403 trong cùng tx sẽ rollback mất nó.
    expect(await auditCount("Denied")).toBe(before + 1);
  });

  it("ca 16b: dòng `Denied` mang đúng hình dạng (action · object · module · actor)", async () => {
    await authGet(tPlain, `/chat/oversight/rooms/${pGroup}`);
    const row = await direct().query(
      `SELECT actor_user_id, object_type, object_id, module_code, result_status, metadata
         FROM audit_logs
        WHERE company_id = $1 AND action = $2 AND result_status = 'Denied'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, CHAT_AUDIT.OVERSIGHT_READ],
    );
    expect(row.rows[0]).toMatchObject({
      actor_user_id: uPlain,
      object_type: "chat_room",
      object_id: pGroup,
      module_code: CHAT_MODULE_CODE,
      result_status: "Denied",
    });
    expect(row.rows[0].metadata.endpoint).toBe("018b");
  });

  it("ca 16c: từ chối trên CẢ BỐN route đều +1 dòng, mỗi dòng mang ĐÚNG nhãn endpoint", async () => {
    const before = await auditCount("Denied");
    await authGet(tPlain, "/chat/oversight/rooms?q=Ban");
    await authGet(tPlain, `/chat/oversight/rooms/${pGroup}`);
    await authGet(tPlain, `/chat/oversight/rooms/${pGroup}/messages`);
    await authGet(tPlain, "/chat/oversight/audit");
    expect(await auditCount("Denied")).toBe(before + 4);

    // ⚠️ Nhãn `metadata.endpoint` suy từ hình dạng đường dẫn THẬT của Express. Unit spec của guard truyền
    // `route.path` tự chế nên nó KHÔNG chứng minh được hình dạng runtime — ca này là chỗ duy nhất đo thật.
    // Sai nhãn không làm hỏng quyền, nhưng làm CHAT-SCREEN-008 phân loại sai "ai đã đọc phòng nào".
    const rows = await direct().query(
      `SELECT metadata->>'endpoint' AS endpoint FROM audit_logs
        WHERE company_id = $1 AND action = $2 AND result_status = 'Denied'
        ORDER BY created_at DESC LIMIT 4`,
      [A.companyId, CHAT_AUDIT.OVERSIGHT_READ],
    );
    expect(new Set(rows.rows.map((r: { endpoint: string }) => r.endpoint))).toEqual(
      new Set(["018a", "018b", "018c", "019"]),
    );
  });

  // ═══════════ ĐƯỜNG THÀNH CÔNG — audit CÙNG TX, TRƯỚC khi trả ═══════════

  it("ca 17: role CÓ cặp đọc được phòng mình không thuộc + ĐÚNG 1 dòng `Success`", async () => {
    const before = await auditCount("Success");
    const res = await authGet(tOvs, `/chat/oversight/rooms/${pGroup}`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.name).toBe("Ban giam doc noi bo");
    expect((res.body.data.members as unknown[]).length).toBe(2);
    // `myRole` KHÔNG được có mặt: người đọc-vượt không có hàng membership nào, mọi giá trị là bịa — và
    // FE đọc `myRole === 'admin'` sẽ bật nút quản trị trên phòng mà BE luôn 403.
    expect(res.body.data.myRole).toBeUndefined();

    expect(await auditCount("Success")).toBe(before + 1);
  });

  it("ca 18: 018c đọc TIN NHẮN RIÊNG của hai người khác (phần nhạy cảm nhất của DEC-004)", async () => {
    const res = await authGet(tOvs, `/chat/oversight/rooms/${pDm}/messages`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const bodies = (res.body.data as Array<{ body: string | null }>).map((m) => m.body);
    expect(bodies).toContain("Chuyen rieng khong lien quan cong viec");
    expect(bodies).toContain("Da hieu");
  });

  it("ca 18b: 018c đọc TOÀN DẢI seq — KHÔNG bị kẹp bởi `visible_from_seq` (ràng buộc 8)", async () => {
    // `uPeer` có `visible_from_seq = 3` trên P_GROUP ⇒ đường đọc THƯỜNG của chính uPeer bị cắt.
    // Đường oversight thì không. Nếu 018c tái dùng truy vấn có JOIN `chat_room_members`, người đọc-vượt
    // KHÔNG có hàng membership ⇒ kết quả RỖNG — ca này là thứ phân biệt hai hiện thực.
    const asMember = await authGet(tPeer, `/chat/rooms/${pGroup}/messages`);
    expect(asMember.status).toBe(200);
    const memberSeqs = (asMember.body.data as Array<{ roomSeq: number }>).map((m) => m.roomSeq);
    expect(
      Math.min(...memberSeqs),
      "đường thường PHẢI bị kẹp — nếu không, ca này không canh gì",
    ).toBe(3);

    const asOversight = await authGet(tOvs, `/chat/oversight/rooms/${pGroup}/messages`);
    expect(asOversight.status).toBe(200);
    const seqs = (asOversight.body.data as Array<{ roomSeq: number }>).map((m) => m.roomSeq);
    expect(seqs).toEqual([1, 2, 3, 4]);
  });

  it("ca 19: ép ghi audit LỖI → 500 (CHAT-ERR-020), 0 byte dữ liệu, audit +0", async () => {
    const auditSvc = ctx.app.get(AuditService, { strict: false });
    // Chỉ ném cho action đọc-vượt: chứng minh luôn rằng câu ĐỌC phía trên đã chạy xong (nếu nó hỏng thì
    // spy này không bao giờ được gọi) — tức 500 đến từ đúng bước ghi audit, không phải một lỗi khác.
    vi.spyOn(auditSvc, "record").mockImplementation(async (_tx, entry) => {
      if (entry.action === CHAT_AUDIT.OVERSIGHT_READ) throw new Error("audit_logs unavailable");
    });

    const before = await auditCount();
    const res = await authGet(tOvs, `/chat/oversight/rooms/${pGroup}`);

    // ⚠️ TUYỆT ĐỐI KHÔNG được là `200` với thân rỗng — đó là "đọc-vượt không dấu vết" ngụy trang thành
    // kết quả trống (API-13 §8).
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("Ban giam doc noi bo");
    expect(JSON.stringify(res.body)).not.toContain(pGroup);
    expect(await auditCount()).toBe(before);
  });

  it("ca 19b: sau khi bỏ ép lỗi, đường đọc trở lại bình thường (spy không rò sang ca khác)", async () => {
    const res = await authGet(tOvs, `/chat/oversight/rooms/${pGroup}`);
    expect(res.status).toBe(200);
  });

  // ═══════════ KHÔNG CẤP QUYỀN TẢI TỆP — ràng buộc 7 ═══════════

  it("ca 20: payload 018c mang metadata tệp và **0** URL ký", async () => {
    const res = await authGet(tOvs, `/chat/oversight/rooms/${pGroup}/messages`);
    expect(res.status).toBe(200);

    const withFile = (res.body.data as Array<Record<string, unknown>>).find(
      (m) => (m.attachmentCount as number) > 0,
    );
    expect(withFile, "fixture phải có ít nhất 1 tin kèm tệp").toBeDefined();
    const attachments = withFile?.attachments as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ fileId: attachedFileId, name: "bao-cao.pdf" });
    expect(attachments[0].url).toBeUndefined();
    expect(attachments[0].thumbnailUrl).toBeUndefined();

    // Quét TOÀN payload: một URL ký lọt qua bất kỳ trường nào cũng là ràng buộc 7 vỡ.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("X-Amz-Signature");
    expect(raw).not.toContain("http://");
    expect(raw).not.toContain("https://");
    // `storage_path` cũng không bao giờ rời server (CLAUDE.md §2.3).
    expect(raw).not.toContain(`${A.companyId}/files/`);
  });

  it("ca 21: người đọc-vượt tải tệp trong phòng mình không thuộc → 403 (resolver mù với cặp)", async () => {
    // `uOvs` CÓ `download:foundation-file` ⇒ 403 này chỉ có thể đến từ `ChatMessageFileResolver`.
    // Đối chứng dương ngay dưới: thành viên thật tải được (302) — nên 403 không phải vì tệp hỏng.
    expect((await authGet(tOvs, `/foundation/files/${attachedFileId}/download`)).status).toBe(403);
    expect((await authGet(tOwner, `/foundation/files/${attachedFileId}/download`)).status).toBe(
      302,
    );
  });

  // ═══════════ KHÔNG MỞ TÌM KIẾM — ràng buộc 5 ═══════════

  it("ca 22: người có cặp đọc-vượt gọi `/chat/search` → KHÔNG thấy phòng ngoài membership (§20 ca 11)", async () => {
    const res = await authGet(tOvs, "/chat/search?q=" + encodeURIComponent("So lieu"));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const roomIds = (res.body.data.data as Array<{ roomId: string }>).map((r) => r.roomId);
    expect(roomIds).not.toContain(pGroup);

    // Đối chứng dương: từ khoá ĐÓ có thật trong P_GROUP và thành viên thật tìm ra được — nên "0 kết quả"
    // ở trên là do vị từ membership, không phải do fixture không khớp.
    const asMember = await authGet(tOwner, "/chat/search?q=" + encodeURIComponent("So lieu"));
    expect((asMember.body.data.data as Array<{ roomId: string }>).map((r) => r.roomId)).toContain(
      pGroup,
    );
  });

  it("ca 22b: KHÔNG có route `/chat/oversight/search`", async () => {
    expect((await authGet(tOvs, "/chat/oversight/search?q=So")).status).toBe(404);
  });

  // ═══════════ CROSS-TENANT + phòng không đọc được ═══════════

  it("ca 23: đọc-vượt KHÔNG vượt qua ranh giới tenant → 404", async () => {
    const res = await authGet(tOvs, `/chat/oversight/rooms/${roomB}`);
    expect(res.status).toBe(404);
    expect((await authGet(tOvs, `/chat/oversight/rooms/${roomB}/messages`)).status).toBe(404);
  });

  it("ca 23b: phòng đã xoá mềm → 404 (đọc-vượt không phải thùng rác)", async () => {
    expect((await authGet(tOvs, `/chat/oversight/rooms/${pDeleted}`)).status).toBe(404);
  });

  it("ca 23c: phòng lạ và phòng-không-tồn-tại trả về BYTE GIỐNG HỆT NHAU (không oracle)", async () => {
    const ghost = await authGet(tOvs, `/chat/oversight/rooms/${randomUUID()}`);
    const deleted = await authGet(tOvs, `/chat/oversight/rooms/${pDeleted}`);
    const shape = (b: Record<string, unknown>): string => {
      const { meta: _meta, ...rest } = b as { meta?: unknown };
      return JSON.stringify(rest);
    };
    expect(shape(ghost.body)).toBe(shape(deleted.body));
    expect(shape(deleted.body)).not.toContain(pDeleted);
  });

  // ═══════════ 018a HẸP HƠN "LIỆT KÊ MỌI PHÒNG" ═══════════

  it("ca 24: `q` < 2 ký tự → 400/422; không có `q` → 400/422", async () => {
    expect([400, 422]).toContain((await authGet(tOvs, "/chat/oversight/rooms?q=B")).status);
    expect([400, 422]).toContain((await authGet(tOvs, "/chat/oversight/rooms")).status);
    expect([400, 422]).toContain(
      (await authGet(tOvs, "/chat/oversight/rooms?q=" + encodeURIComponent("  a  "))).status,
    );
  });

  it("ca 24b: 018a trả SIÊU DỮ LIỆU — không thành viên, không nội dung tin", async () => {
    const res = await authGet(tOvs, "/chat/oversight/rooms?q=Ban%20giam");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data.data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toContain(pGroup);
    const row = rows.find((r) => r.id === pGroup) as Record<string, unknown>;
    expect(row.memberCount).toBe(2);
    // Thiếu vế này thì MỘT lời gọi xuất được đồ thị "ai nhắn riêng với ai" của cả công ty.
    expect(row.members).toBeUndefined();
    expect(row.directKey).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("So lieu quy 3");
  });

  it("ca 24c: ký tự đại diện của LIKE bị vô hiệu hoá — `%` không khớp mọi phòng", async () => {
    // Không escape thì `q=%%` (dài đúng 2 ký tự, lọt `min(2)`) khớp MỌI phòng — chính là "liệt kê mọi
    // phòng" mà API-13 §5.3 cấm, đi vòng qua trần từ khoá.
    const res = await authGet(tOvs, "/chat/oversight/rooms?q=" + encodeURIComponent("%%"));
    expect(res.status).toBe(200);
    expect(res.body.data.data as unknown[]).toHaveLength(0);
  });

  it("ca 25: vượt trần trang → cờ `truncated` TƯỜNG MINH (không cắt im lặng)", async () => {
    // 3 phòng "Du an *" trong fixture ⇒ limit=1 chắc chắn cắt.
    const res = await authGet(tOvs, "/chat/oversight/rooms?q=Du%20an&limit=1");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data.data as unknown[]).length).toBe(1);
    expect(res.body.data.truncated).toBe(true);

    // Đối chứng dương: cùng từ khoá, trần rộng ⇒ trả đủ 3 và cờ `false`. Không có vế này thì một hiện
    // thực hard-code `truncated: true` vẫn xanh.
    const wide = await authGet(tOvs, "/chat/oversight/rooms?q=Du%20an&limit=50");
    expect((wide.body.data.data as unknown[]).length).toBe(3);
    expect(wide.body.data.truncated).toBe(false);
  });

  it("ca 25c: 018a KHÔNG có tham số phân trang — không lật trang được thì không enumerate được", async () => {
    // Ràng buộc thiết kế (API-13 §5.3): `cursor`/`offset`/`page` bị Zod `.strict()`-hoá bởi hợp đồng —
    // ở đây kiểm bằng hành vi: gửi lên cũng KHÔNG đổi tập kết quả.
    const plain = await authGet(tOvs, "/chat/oversight/rooms?q=Du%20an&limit=2");
    const withOffset = await authGet(tOvs, "/chat/oversight/rooms?q=Du%20an&limit=2&offset=2");
    expect(withOffset.status).toBe(200);
    expect((withOffset.body.data.data as Array<{ id: string }>).map((r) => r.id)).toEqual(
      (plain.body.data.data as Array<{ id: string }>).map((r) => r.id),
    );
  });

  it("ca 25b: 018a ghi TIÊU CHÍ TRA vào audit (bằng chứng 'đã tra cái gì')", async () => {
    await authGet(tOvs, "/chat/oversight/rooms?q=Ban%20giam");
    const row = await direct().query(
      `SELECT object_id, metadata FROM audit_logs
        WHERE company_id = $1 AND action = $2 AND result_status = 'Success'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, CHAT_AUDIT.OVERSIGHT_READ],
    );
    expect(row.rows[0].object_id, "018a không có phòng đích ⇒ object_id NULL").toBeNull();
    expect(row.rows[0].metadata.endpoint).toBe("018a");
    expect(row.rows[0].metadata.criteria.q).toBe("Ban giam");
  });

  // ═══════════ 019 — NHẬT KÝ ĐỌC-VƯỢT ═══════════

  it("ca 26: 019 CHỈ trả dòng `chat.oversight.read` của module CHAT — không phải cổng đọc audit toàn hệ thống", async () => {
    const foreignModule = randomUUID();
    const foreignAction = randomUUID();
    await direct().query(
      `INSERT INTO audit_logs (id, company_id, actor_user_id, action, object_type, object_id,
         module_code, result_status)
       VALUES ($1,$2,$3,$4,'chat_room',$5,'HR','Success'),
              ($6,$2,$3,$7,'chat_room',$5,'CHAT','Success')`,
      [
        foreignModule,
        A.companyId,
        uOwner,
        CHAT_AUDIT.OVERSIGHT_READ,
        pGroup,
        foreignAction,
        "hr.employee.viewed",
      ],
    );

    const res = await authGet(tOvs, "/chat/oversight/audit?limit=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.data.data as Array<{ id: string }>).map((r) => r.id);
    // Dòng 1: cùng `action`, module HR → phải bị loại bởi vế `module_code`.
    expect(ids).not.toContain(foreignModule);
    // Dòng 2: đúng module CHAT nhưng `action` khác → phải bị loại bởi vế `action`.
    expect(ids).not.toContain(foreignAction);
  });

  it("ca 26b: 019 CÓ trả dòng đọc-vượt thật (đối chứng dương — audit không xem được thì không phải kiểm soát)", async () => {
    await authGet(tOvs, `/chat/oversight/rooms/${pGroup}`);
    const res = await authGet(tOvs, "/chat/oversight/audit?limit=100");
    const rows = res.body.data.data as Array<Record<string, unknown>>;

    const success = rows.find((r) => r.resultStatus === "Success" && r.roomId === pGroup);
    expect(success, "phải thấy lần đọc-vượt vừa rồi").toBeDefined();
    expect(success?.roomCode).toBeTruthy();
    expect(success?.roomName).toBe("Ban giam doc noi bo");

    // SPEC-15 §18: "chuỗi thử-và-trượt là tín hiệu điều tra" ⇒ dòng từ chối phải xem được trên UI.
    expect(rows.some((r) => r.resultStatus === "Denied" && r.actorUserId === uPlain)).toBe(true);
  });

  it("ca 27: 019 KHÔNG rò dòng của tenant khác", async () => {
    await authGet(tB, `/chat/oversight/rooms/${roomB}`);
    const res = await authGet(tOvs, "/chat/oversight/audit?limit=100");
    const rows = res.body.data.data as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.roomId !== roomB)).toBe(true);

    const mine = await authGet(tB, "/chat/oversight/audit?limit=100");
    const mineRows = mine.body.data.data as Array<Record<string, unknown>>;
    expect(mineRows.some((r) => r.roomId === roomB)).toBe(true);
    expect(mineRows.every((r) => r.roomId !== pGroup)).toBe(true);
  });

  it("ca 27b: 019 phân trang bằng CON TRỎ, không sót/không lặp; con trỏ rác → 400", async () => {
    const first = await authGet(tOvs, "/chat/oversight/audit?limit=2");
    expect(first.status).toBe(200);
    const firstIds = (first.body.data.data as Array<{ id: string }>).map((r) => r.id);
    expect(firstIds).toHaveLength(2);
    expect(first.body.data.nextCursor).toBeTruthy();

    const second = await authGet(
      tOvs,
      `/chat/oversight/audit?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor as string)}`,
    );
    expect(second.status).toBe(200);
    const secondIds = (second.body.data.data as Array<{ id: string }>).map((r) => r.id);
    expect(
      secondIds.some((id) => firstIds.includes(id)),
      "trang 2 lặp dòng của trang 1",
    ).toBe(false);

    // Con trỏ hỏng phải 400, KHÔNG im lặng rơi về trang đầu (vòng lặp vô hạn ở FE).
    expect((await authGet(tOvs, "/chat/oversight/audit?cursor=rac-khong-hop-le")).status).toBe(400);
  });

  it("ca 27c: đọc 019 KHÔNG tự sinh dòng `Success` (bảng endpoint API-13 §5.3: cột Audit = —)", async () => {
    const before = await auditCount("Success");
    await authGet(tOvs, "/chat/oversight/audit?limit=10");
    expect(await auditCount("Success")).toBe(before);
  });

  // ═══════════ KHÔNG CÓ BIẾN THỂ GHI — ràng buộc 4 ═══════════

  it("ca 28: không POST/PATCH/DELETE nào tồn tại dưới `/chat/oversight/`", async () => {
    const bearer = `Bearer ${tOvs}`;
    // ⚠️ Dựng request NGAY TRƯỚC khi await, không gom sẵn vào mảng: supertest tự `listen()` một cổng
    // tạm cho mỗi request và ĐÓNG nó khi request xong ⇒ các request dựng trước sẽ ôm cổng đã chết và
    // ném `ECONNREFUSED` (đo thật ở lượt chạy đầu).
    const verbs = [
      ["post", `/chat/oversight/rooms/${pGroup}/messages`],
      ["post", `/chat/oversight/rooms/${pGroup}/archive`],
      ["patch", `/chat/oversight/rooms/${pGroup}`],
      ["delete", `/chat/oversight/rooms/${pGroup}`],
    ] as const;

    for (const [verb, url] of verbs) {
      // `agent[verb](url)` qua biến trung gian: viết thẳng `request(...)\n[verb](url)` là bẫy ASI
      // (`no-unexpected-multiline`) — prettier tự xuống dòng trước `[` và eslint chặn ở mức error.
      const agent = request(ctx.app.getHttpServer());
      const res = await agent[verb](url)
        .set("Authorization", bearer)
        .send({ body: "x", clientMessageId: randomUUID() });
      expect([404, 405], `${verb.toUpperCase()} ${url} → ${res.status}`).toContain(res.status);
    }
  });

  it("ca 28b: người đọc-vượt KHÔNG gửi/ghim/thu hồi được ở phòng mình không thuộc qua đường THƯỜNG", async () => {
    // Cặp đọc-vượt không mở một milimet nào ở đường ghi thường — nó vẫn bị `assertMember` chặn (404).
    const sent = await authPost(tOvs, `/chat/rooms/${pGroup}/messages`).send({
      body: "khong duoc phep",
      clientMessageId: randomUUID(),
    });
    expect(sent.status).toBe(404);
    expect((await authGet(tOvs, `/chat/rooms/${pGroup}`)).status).toBe(404);
    expect((await authGet(tOvs, `/chat/rooms/${pGroup}/messages`)).status).toBe(404);
  });

  // ═══════════ MASKING GIỮ NGUYÊN ═══════════

  it("ca 29: tin ĐÃ THU HỒI vẫn bị che ở đường đọc-vượt (DEC-004 mở membership, KHÔNG mở masking)", async () => {
    const res = await authGet(tOvs, `/chat/oversight/rooms/${pGroup}/messages`);
    const recalled = (res.body.data as Array<Record<string, unknown>>).find(
      (m) => m.id === recalledMessageId,
    );
    expect(recalled, "tin thu hồi PHẢI có mặt trong danh sách").toBeDefined();
    expect(recalled?.recalledAt).not.toBeNull();
    expect(recalled?.body).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("Tin nay se bi thu hoi");
  });

  it("ca 29b: `seq` cấp BẢNG không bao giờ rời server ở đường đọc-vượt (SPEC-15 §13.1)", async () => {
    const res = await authGet(tOvs, `/chat/oversight/rooms/${pGroup}/messages`);
    for (const m of res.body.data as Array<Record<string, unknown>>) {
      expect(m.seq).toBeUndefined();
      expect(m.clientMessageId).toBeUndefined();
    }
  });
});
