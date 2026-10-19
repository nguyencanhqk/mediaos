/**
 * S19-SEC-FILEMETAGATE-1 — tên/cỡ tệp chỉ đi theo quyết định xem từng tệp
 * (plan `docs/plans/S19-SEC-FILEMETAGATE-1.md` §2 · §5).
 *
 * Bất biến đo ở đây:
 *   (1) danh sách FOUNDATION: `originalName`/`fileExtension`/`sizeBytes`/`ownerUserId` của một hàng khác `null`
 *       ⇔ `GET /foundation/files/:id` của CÙNG người gọi = 200 (một vị từ, D-1);
 *   (2) hàng không bị bỏ — phân trang và `pagination.total` giữ nghĩa (D-1);
 *   (3) CHAT: metadata đính kèm = nội dung chủ tệp chia sẻ vào phòng; cả HAI đường gắn đòi chủ tệp (D-2);
 *   (4) giám sát CHAT: tên/cỡ cho người giữ cặp giám sát, KHÔNG khoá `url`; thiếu cặp ⇒ 403 (D-2b).
 *
 * Fixture gieo bằng pool `direct` (không PUT storage). Tệp tenant A:
 *   F_hid   — đính kèm một bài bị ẨN của tác giả ⇒ người xem thường bị từ chối, tác giả được (đường lùi §6);
 *   F_pub   — đính kèm bài audience company; F_free — chưa từng link;
 *   F_rev   — link duy nhất đã gỡ mềm; F_nores — link tới (module, entity) không có resolver đăng ký;
 *   F_c/F_c2 — đính kèm tin CHAT (F_c thêm một link sống tới bài không tồn tại ⇒ luật AND chặn ký).
 * Tenant B: F_B.
 *
 * Mọi ca TỪ CHỐI có ALLOW đứng cạnh trên cùng phản hồi hoặc cùng route.
 */
import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PasswordService } from "../../src/auth/password.service";
import { CHAT_MESSAGE_ENTITY_TYPE } from "../../src/chat/chat-file.constants";
import { hasDb } from "../helpers/integration-db";
import {
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";
import {
  FEED_PAIRS,
  bootQa1World,
  createPost,
  type Json,
  type Qa1Actor,
  type Qa1World,
} from "../helpers/social-qa1-kit";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;
const FILE_SIZE = 3072;
const PAGE_LIMIT_MAX = 100;
const LOGIN_PW = ["Passw0rd", "fmg19"].join("!");
const MASKED_KEYS = ["originalName", "fileExtension", "sizeBytes", "ownerUserId"] as const;

type PairGrant = readonly [string, string, string];
const CHAT_PAIRS: readonly PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
  ["download", "foundation-file", "Company"],
  ["link", "foundation-file", "Company"],
  ["unlink", "foundation-file", "Company"],
];
const OVERSIGHT_PAIR: PairGrant = ["view", "chat-oversight", "Company"];

const dataOf = (body: unknown): Json => ((body as { data?: unknown }).data ?? {}) as Json;
/** Phần tử của một trang — chịu cả `{data:[…]}` lẫn `{data:{data:[…]}}`. */
const rowsOf = (body: unknown): Json[] => {
  const d = (body as { data?: unknown }).data;
  if (Array.isArray(d)) return d as Json[];
  return (((d ?? {}) as { data?: unknown }).data ?? []) as Json[];
};
const totalOf = (body: unknown): number =>
  ((body as { pagination?: { total?: number } }).pagination?.total ?? -1) as number;

describe.skipIf(!hasLaneDb)(
  "S19-SEC-FILEMETAGATE-1 · tên/cỡ tệp theo quyết định xem từng tệp",
  () => {
    let w: Qa1World;
    /** Tác giả bài (thấy bài ẩn của chính mình) + cặp xem tệp — vai «member» của plan. */
    let author: Qa1Actor;
    /** `view:feed` + `view:foundation-file` @Company — không thấy bài ẩn. */
    let fileViewer: Qa1Actor;
    let admin: Qa1Actor;
    let noFilePair: Qa1Actor;
    let viewerB: Qa1Actor;

    const names = new Map<string, string>();
    let seq = 0;
    let fHid = "";
    let fPub = "";
    let fFree = "";
    let fRev = "";
    let fNores = "";
    let fB = "";

    // CHAT (tenant A, dựng bằng helpers/seed — kit chỉ nhận cặp feed).
    let senderId = "";
    let mateId = "";
    let tSender = "";
    let tMate = "";
    let tOverseer = "";
    let room = "";
    let msgShared = "";
    let msgMate = "";
    let fC = "";
    let fC2 = "";
    let fX = "";
    let fM2 = "";

    /** Hàng tệp Uploaded + Clean. Mốc thời gian tách nhau ⇒ thứ tự phân trang xác định. */
    async function seedFile(
      tenant: SeededTenant,
      ownerId: string,
      prefix: "social" | "files",
    ): Promise<string> {
      const id = randomUUID();
      const name = `fmg-${id.slice(0, 8)}.png`;
      names.set(id, name);
      seq += 1;
      const at = new Date(Date.now() - seq * 1000).toISOString();
      await w.direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                          storage_provider, storage_path, upload_status, scan_status,
                          owner_user_id, uploaded_by, uploaded_at, created_at)
       VALUES ($1,$2,$3,$4,'image/png',$5,'MinIO',$6,'Uploaded','Clean',$7,$7,$8,$8)`,
        [
          id,
          tenant.companyId,
          name,
          `stored-${id}`,
          FILE_SIZE,
          `${tenant.companyId}/${prefix}/${id}`,
          ownerId,
          at,
        ],
      );
      return id;
    }

    async function insertLink(
      companyId: string,
      fileId: string,
      moduleCode: string,
      entityType: string,
      entityId: string,
      createdBy: string,
    ): Promise<string> {
      const r = await w.direct.query<{ id: string }>(
        `INSERT INTO file_links (company_id, file_id, module_code, entity_type, entity_id, link_type,
                               sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,'Attachment',0,$6) RETURNING id`,
        [companyId, fileId, moduleCode, entityType, entityId, createdBy],
      );
      return r.rows[0]!.id;
    }

    async function liveLinks(fileId: string): Promise<number> {
      const r = await w.direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM file_links WHERE file_id = $1 AND deleted_at IS NULL`,
        [fileId],
      );
      return r.rows[0]!.n;
    }

    async function chatUser(label: string, pairs: readonly PairGrant[]): Promise<string> {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const userId = await seedUser(w.direct, w.A.companyId, `${label}@${w.A.slug}.test`, hash);
      const roleId = await seedRole(w.direct, w.A.companyId, `fmg-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope] of pairs) {
        const permId = await seedPermissionCatalog(
          w.direct,
          action,
          resource,
          resource === "chat-oversight",
        );
        await seedRolePermission(w.direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(w.direct, userId, roleId, w.A.companyId);
      return userId;
    }

    async function login(label: string): Promise<string> {
      const res = await w
        .post(null, "/auth/login")
        .send({ companySlug: w.A.slug, email: `${label}@${w.A.slug}.test`, password: LOGIN_PW });
      expect(res.status, `login ${label}: ${JSON.stringify(res.body)}`).toBe(200);
      return dataOf(res.body).accessToken as string;
    }

    async function sendMessage(token: string, fileIds: string[]) {
      return w
        .post(token, `/chat/rooms/${room}/messages`)
        .send({ body: `tin ${randomUUID().slice(0, 8)}`, clientMessageId: randomUUID(), fileIds });
    }

    /** Toàn bộ danh sách của `actor` trong một trang (tenant tươi ⇒ tổng ≤ PAGE_LIMIT_MAX). */
    async function listAll(actor: Qa1Actor): Promise<{ rows: Json[]; total: number; raw: string }> {
      const res = await w.get(actor.token, `/foundation/files?page=1&limit=${PAGE_LIMIT_MAX}`);
      expect(res.status, `${actor.label} list: ${JSON.stringify(res.body)}`).toBe(200);
      const rows = rowsOf(res.body);
      const total = totalOf(res.body);
      expect(total, `${actor.label}: một trang phủ hết tenant`).toBeLessThanOrEqual(PAGE_LIMIT_MAX);
      expect(rows, `${actor.label}: trang chứa đủ ${total} hàng`).toHaveLength(total);
      return { rows, total, raw: JSON.stringify(res.body) };
    }

    const rowOf = (rows: Json[], id: string): Json | undefined => rows.find((r) => r.id === id);

    function expectMaskedRow(row: Json | undefined, id: string, what: string): void {
      expect(row, `${what}: hàng bị từ chối VẪN có trong danh sách`).toBeDefined();
      expect(row!.id).toBe(id);
      expect(row!.mimeType, `${what}: phần không nhạy cảm giữ nguyên`).toBe("image/png");
      for (const k of MASKED_KEYS) expect(row![k], `${what}: ${k} phải null`).toBeNull();
    }

    function expectFullRow(row: Json | undefined, id: string, ownerId: string, what: string): void {
      expect(row, `${what}: hàng có mặt`).toBeDefined();
      expect(row!.originalName, `${what}: originalName`).toBe(names.get(id));
      expect(row!.sizeBytes, `${what}: sizeBytes`).toBe(FILE_SIZE);
      expect(row!.ownerUserId, `${what}: ownerUserId`).toBe(ownerId);
    }

    async function detailStatus(actor: Qa1Actor | { token: string }, id: string): Promise<number> {
      return (await w.get(actor.token, `/foundation/files/${id}`)).status;
    }

    beforeAll(async () => {
      w = await bootQa1World("filemeta");
      author = await w.actor(w.A, "author", { pairs: [...FEED_PAIRS, "view:foundation-file"] });
      fileViewer = await w.actor(w.A, "fileviewer", {
        pairs: ["view:feed", "view:foundation-file"],
      });
      admin = await w.actor(w.A, "admin", { canonical: "company-admin" });
      noFilePair = await w.actor(w.A, "nofile", { pairs: ["view:feed"] });
      viewerB = await w.actor(w.B, "viewerb", { pairs: ["view:foundation-file"] });

      // F_hid — đính kèm một bài rồi ẨN bài đó.
      fHid = await seedFile(w.A, author.userId, "social");
      const hidden = await createPost(w, author, {
        type: "share",
        audience: "company",
        body: `Bài ẩn ${randomUUID().slice(0, 8)}`,
        attachmentIds: [fHid],
      });
      const hide = await w
        .patch(author.token, `/social/posts/${hidden.id}/moderation`)
        .send({ hidden: true });
      expect(hide.status, JSON.stringify(hide.body)).toBe(200);

      // F_pub — bài công khai.
      fPub = await seedFile(w.A, author.userId, "social");
      const pub = await createPost(w, author, {
        type: "share",
        audience: "company",
        body: `Bài công khai ${randomUUID().slice(0, 8)}`,
        attachmentIds: [fPub],
      });

      fFree = await seedFile(w.A, author.userId, "files");

      // F_rev — link duy nhất, gỡ mềm ⇒ 0 link sống, đã từng link.
      fRev = await seedFile(w.A, author.userId, "social");
      const revLink = await insertLink(
        w.A.companyId,
        fRev,
        "SOCIAL",
        "feed_post",
        pub.id,
        author.userId,
      );
      await w.direct.query(
        `UPDATE file_links SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        [revLink, author.userId],
      );

      // F_nores — `file_links.module_code` không có CHECK; (LEAVE, leave_request) không có resolver.
      fNores = await seedFile(w.A, author.userId, "files");
      await insertLink(
        w.A.companyId,
        fNores,
        "LEAVE",
        "leave_request",
        randomUUID(),
        author.userId,
      );

      fB = await seedFile(w.B, viewerB.userId, "files");

      // CHAT — phòng R (sender + mate); overseer ngoài phòng.
      senderId = await chatUser("sender", CHAT_PAIRS);
      mateId = await chatUser("mate", CHAT_PAIRS);
      await chatUser("overseer", [...CHAT_PAIRS, OVERSIGHT_PAIR]);
      tSender = await login("sender");
      tMate = await login("mate");
      tOverseer = await login("overseer");

      const roomRes = await w
        .post(tSender, "/chat/rooms")
        .send({ name: `Phòng ${randomUUID().slice(0, 8)}`, memberUserIds: [mateId] });
      expect(roomRes.status, JSON.stringify(roomRes.body)).toBe(201);
      room = dataOf(roomRes.body).id as string;

      fC = await seedFile(w.A, senderId, "files");
      fC2 = await seedFile(w.A, senderId, "files");
      const shared = await sendMessage(tSender, [fC, fC2]);
      expect(shared.status, JSON.stringify(shared.body)).toBe(200);
      msgShared = dataOf(shared.body).id as string;
      // Link sống phụ của F_c tới một bài không tồn tại ⇒ luật AND chặn ký URL.
      await insertLink(w.A.companyId, fC, "SOCIAL", "feed_post", randomUUID(), senderId);

      fX = await seedFile(w.A, senderId, "files");
      const fM = await seedFile(w.A, mateId, "files");
      fM2 = await seedFile(w.A, mateId, "files");
      const own = await sendMessage(tMate, [fM]);
      expect(
        own.status,
        `neo ALLOW: mate gửi tệp của chính mình — ${JSON.stringify(own.body)}`,
      ).toBe(200);
      msgMate = dataOf(own.body).id as string;
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await w?.close();
    });

    // ── Danh sách FOUNDATION ───────────────────────────────────────────────────

    it("R-1 người xem bị từ chối: hàng F_hid CÒN, bốn trường null, thân phản hồi không mang tên", async () => {
      expect(await detailStatus(fileViewer, fHid), "neo fixture: GET /:id F_hid bị từ chối").toBe(
        403,
      );
      const { rows, raw } = await listAll(fileViewer);
      expectMaskedRow(rowOf(rows, fHid), fHid, "fileViewer · F_hid");
      expect(raw, "tên F_hid không có ở bất kỳ đâu trong phản hồi").not.toContain(names.get(fHid)!);
    });

    it("R-1a cùng phản hồi: F_pub + F_free đủ trường — ALLOW đứng cạnh", async () => {
      expect(await detailStatus(fileViewer, fPub), "neo: GET /:id F_pub").toBe(200);
      expect(await detailStatus(fileViewer, fFree), "neo: GET /:id F_free").toBe(200);
      const { rows } = await listAll(fileViewer);
      expectFullRow(rowOf(rows, fPub), fPub, author.userId, "fileViewer · F_pub");
      expectFullRow(rowOf(rows, fFree), fFree, author.userId, "fileViewer · F_free");
    });

    it("R-2 tác giả (xem được F_hid): F_hid đủ trường", async () => {
      expect(await detailStatus(author, fHid), "neo: GET /:id F_hid của tác giả").toBe(200);
      const { rows } = await listAll(author);
      expectFullRow(rowOf(rows, fHid), fHid, author.userId, "author · F_hid");
    });

    it("R-3 một vị từ: với fileViewer · author · admin, MỌI hàng có tên ⇔ GET /:id cùng người = 200", async () => {
      for (const actor of [fileViewer, author, admin]) {
        const { rows } = await listAll(actor);
        expect(rows.length, `${actor.label}: tenant có tệp`).toBeGreaterThan(0);
        for (const row of rows) {
          const id = row.id as string;
          const detail = await w.get(actor.token, `/foundation/files/${id}`);
          expect([200, 403], `${actor.label} · GET /:id ${id}`).toContain(detail.status);
          if (detail.status === 200) {
            const d = dataOf(detail.body);
            for (const k of MASKED_KEYS) {
              expect(row[k], `${actor.label} · ${id}: ${k} khớp GET /:id`).toEqual(d[k] ?? null);
            }
          } else {
            for (const k of MASKED_KEYS) {
              expect(row[k], `${actor.label} · ${id}: GET /:id 403 ⇒ ${k} null`).toBeNull();
            }
          }
        }
      }
    });

    it("R-4 link đã gỡ hết (đã từng link) ⇒ che; F_pub cạnh đó đủ", async () => {
      expect(await detailStatus(fileViewer, fRev), "neo fixture: GET /:id F_rev").toBe(403);
      const { rows } = await listAll(fileViewer);
      expectMaskedRow(rowOf(rows, fRev), fRev, "fileViewer · F_rev");
      expectFullRow(rowOf(rows, fPub), fPub, author.userId, "fileViewer · F_pub");
    });

    it("R-5 link tới module chưa có resolver ⇒ che; không dòng log error nào mang tên tệp", async () => {
      expect(await detailStatus(fileViewer, fNores), "neo fixture: GET /:id F_nores").toBe(403);
      const errorSpy = vi.spyOn(Logger.prototype, "error");
      try {
        const { rows } = await listAll(fileViewer);
        expectMaskedRow(rowOf(rows, fNores), fNores, "fileViewer · F_nores");
        expectFullRow(rowOf(rows, fFree), fFree, author.userId, "fileViewer · F_free");
        const lines = errorSpy.mock.calls.map((args) => args.map(String).join(" "));
        for (const name of names.values()) {
          expect(
            lines.filter((l) => l.includes(name)),
            `log không mang tên ${name}`,
          ).toEqual([]);
        }
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("R-6 phân trang: trang đầy đủ `limit`, trang cuối đúng phần dư, total giữ — hàng che KHÔNG bị bỏ", async () => {
      const { total } = await listAll(fileViewer);
      expect(total, "fixture đủ để chia trang").toBeGreaterThanOrEqual(6);
      const limit = [4, 3, 5].find((n) => total % n !== 0) ?? 4;
      const pages = Math.ceil(total / limit);
      const seen: string[] = [];
      for (let page = 1; page <= pages; page += 1) {
        const res = await w.get(fileViewer.token, `/foundation/files?page=${page}&limit=${limit}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(totalOf(res.body), `trang ${page}: total`).toBe(total);
        const expected = page < pages ? limit : total - limit * (pages - 1);
        expect(rowsOf(res.body), `trang ${page}: số hàng`).toHaveLength(expected);
        seen.push(...rowsOf(res.body).map((r) => r.id as string));
      }
      expect(new Set(seen).size, "không trùng, không sót").toBe(total);
      for (const id of [fHid, fRev, fNores]) {
        expect(seen, `hàng che ${id} vẫn được phân trang`).toContain(id);
      }
    });

    it("R-7 cô lập tenant: A không thấy F_B, B không thấy tệp A; link chéo tenant không làm đổi hàng của A", async () => {
      let crossErr: { code?: string } | null = null;
      try {
        await insertLink(w.B.companyId, fFree, "SOCIAL", "feed_post", randomUUID(), viewerB.userId);
      } catch (err) {
        crossErr = err as { code?: string };
      }
      if (crossErr) {
        expect(crossErr.code, "DB từ chối link chéo tenant bằng FK tenant ghép").toBe("23503");
      }

      const a = await listAll(fileViewer);
      expect(rowOf(a.rows, fB), "A không thấy tệp của B").toBeUndefined();
      expectFullRow(
        rowOf(a.rows, fFree),
        fFree,
        author.userId,
        "fileViewer · F_free sau link chéo",
      );

      const b = await listAll(viewerB);
      expectFullRow(rowOf(b.rows, fB), fB, viewerB.userId, "viewerB · F_B (neo ALLOW)");
      for (const id of [fHid, fPub, fFree, fRev, fNores]) {
        expect(rowOf(b.rows, id), `B không thấy ${id}`).toBeUndefined();
      }
    });

    it("R-8 thiếu cặp xem tệp ⇒ 403 ở guard, thân lỗi không mang tên; người có cặp ⇒ 200", async () => {
      const res = await w.get(noFilePair.token, `/foundation/files?page=1&limit=${PAGE_LIMIT_MAX}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      for (const name of names.values()) expect(JSON.stringify(res.body)).not.toContain(name);
      const ok = await w.get(fileViewer.token, `/foundation/files?page=1&limit=${PAGE_LIMIT_MAX}`);
      expect(ok.status, "neo ALLOW").toBe(200);
    });

    // ── CHAT ───────────────────────────────────────────────────────────────────

    it("C-1 thành viên phòng: F_c không ký được (luật AND) ⇒ url null nhưng tên/cỡ còn; F_c2 ký được", async () => {
      const res = await w.get(tMate, `/chat/rooms/${room}/messages?limit=100`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const msg = rowsOf(res.body).find((m) => m.id === msgShared);
      expect(msg, "tin có tệp nằm trong trang").toBeDefined();
      const atts = (msg!.attachments ?? []) as Json[];
      const c = atts.find((a) => a.fileId === fC);
      const c2 = atts.find((a) => a.fileId === fC2);
      expect(c, "F_c có mặt").toBeDefined();
      expect(c!.url, "F_c: luật AND chặn ký").toBeNull();
      expect(c!.name, "F_c: tên do chủ tệp chia sẻ vẫn còn").toBe(names.get(fC));
      expect(c!.sizeBytes, "F_c: cỡ vẫn còn").toBe(FILE_SIZE);
      expect(c2, "F_c2 có mặt").toBeDefined();
      expect(typeof c2!.url, "neo ALLOW: F_c2 ký được").toBe("string");
      expect(c2!.name).toBe(names.get(fC2));
    });

    it("C-2 gửi tin kèm tệp KHÔNG phải của mình ⇒ 403, 0 link mới", async () => {
      const res = await sendMessage(tMate, [fX]);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-015");
      expect(await liveLinks(fX), "không link nào được tạo").toBe(0);
    });

    it("C-2b gắn qua route FOUNDATION vào tin CỦA MÌNH: tệp người khác ⇒ 403, 0 link; tệp của mình ⇒ được", async () => {
      const body = (fileId: string) => ({
        fileId,
        moduleCode: "CHAT",
        entityType: CHAT_MESSAGE_ENTITY_TYPE,
        entityId: msgMate,
        linkType: "Attachment",
      });
      const denied = await w.post(tMate, `/foundation/files/${fX}/links`).send(body(fX));
      expect(denied.status, JSON.stringify(denied.body)).toBe(403);
      expect(await liveLinks(fX), "không link nào được tạo").toBe(0);

      const ok = await w.post(tMate, `/foundation/files/${fM2}/links`).send(body(fM2));
      expect([200, 201], `neo ALLOW: ${JSON.stringify(ok.body)}`).toContain(ok.status);
      expect(await liveLinks(fM2)).toBe(1);
    });

    it("C-3 giám sát CHAT: người giữ cặp giám sát thấy tên + cỡ đính kèm, KHÔNG có khoá url", async () => {
      const res = await w.get(tOverseer, `/chat/oversight/rooms/${room}/messages`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const msg = rowsOf(res.body).find((m) => m.id === msgShared);
      expect(msg, "tin có tệp nằm trong trang giám sát").toBeDefined();
      const atts = (msg!.attachments ?? []) as Json[];
      expect(atts, "hai đính kèm").toHaveLength(2);
      for (const id of [fC, fC2]) {
        const a = atts.find((x) => x.fileId === id);
        expect(a, `${id} có mặt`).toBeDefined();
        expect(a!.name).toBe(names.get(id));
        expect(a!.sizeBytes).toBe(FILE_SIZE);
        expect(a, "không có khoá url").not.toHaveProperty("url");
      }
    });

    it("C-3d cùng route giám sát, thiếu cặp giám sát (dù là thành viên phòng) ⇒ 403, thân lỗi không mang tên", async () => {
      const res = await w.get(tMate, `/chat/oversight/rooms/${room}/messages`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(names.get(fC)!);
      expect(JSON.stringify(res.body)).not.toContain(names.get(fC2)!);
    });
  },
);
