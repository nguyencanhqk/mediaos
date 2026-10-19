/**
 * S16-SOCIAL-ATTMETAMASK-1 — metadata đính kèm (`fileName`/`sizeBytes`) trên các đường đọc SOCIAL đi
 * theo CÙNG quyết định ký URL cho người xem (plan `docs/plans/S16-SOCIAL-ATTMETAMASK-1.md` §3, §6).
 *
 * Bất biến đo ở đây (REST — mọi đường đọc dựng đính kèm qua `decorateMany`):
 *   `fileName`/`sizeBytes` khác `null` ⇔ `url` của CHÍNH phần tử đó khác `null` (D-1, một vị từ);
 *   phần tử bị che vẫn CÒN trong mảng với `fileId`/`kind` đúng (D-2 — giữ phần tử).
 *
 * Ba nguồn «không ký được» (fixture gieo bằng pool `direct`):
 *   F_hid   — tệp có thêm một link sống tới bài ẨN của tác giả ⇒ luật AND từ chối người xem thường,
 *             tác giả vẫn ký được ⇒ TỪ CHỐI đứng cạnh CHO PHÉP trên CÙNG phần tử;
 *   F_gone  — link sống phụ tới một bài không tồn tại ⇒ từ chối mọi người, kể cả kiểm duyệt;
 *   F_store — khoá lưu trữ ngoài tiền tố tenant ⇒ policy cho qua, ký ném ⇒ `url` null (D-1).
 *
 * Mọi ca TỪ CHỐI có neo dương trên CHÍNH phản hồi (phần tử tồn tại, `fileId` đúng, tệp cạnh đó đủ
 * trường) — tránh «rỗng xanh». Ca WS của cùng luật nằm ở `s16-social-qa1-ws.int-spec.ts` (W-1/W-2).
 */
import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasDb } from "../helpers/integration-db";
import {
  FEED_PAIRS,
  bootQa1World,
  createPost,
  sharePost,
  type Json,
  type Qa1Actor,
  type Qa1World,
} from "../helpers/social-qa1-kit";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 90_000;
const FILE_SIZE = 2048;

const dataOf = (body: unknown): Json => ((body as { data?: unknown }).data ?? {}) as Json;
/** Phần tử của một trang danh sách — chịu cả `{data:[…]}` lẫn `{data:{data:[…]}}`. */
const rowsOf = (body: unknown): Json[] => {
  const d = (body as { data?: unknown }).data;
  if (Array.isArray(d)) return d as Json[];
  return (((d ?? {}) as { data?: unknown }).data ?? []) as Json[];
};
const attOf = (item: Json, fileId: string): Json | undefined =>
  ((item.attachments ?? []) as Json[]).find((a) => a.fileId === fileId);

describe.skipIf(!hasLaneDb)(
  "S16-SOCIAL-ATTMETAMASK-1 · metadata đính kèm theo quyết định ký",
  () => {
    let w: Qa1World;
    /** `FEED_PAIRS` — đăng mọi loại, kiểm duyệt, thấy bài ẩn của chính mình. */
    let author: Qa1Actor;
    /** `view:feed` + `create:feed-comment` — KHÔNG cặp tệp FOUNDATION nào. */
    let peer: Qa1Actor;
    /** Chỉ cho R-8: `view:feed` + `view:foundation-file`. */
    let fileViewer: Qa1Actor;

    const names = new Map<string, string>();
    let hiddenPostId = "";
    /** Bài P: [F_hid, F_ok]. */
    let postP = "";
    let fHid = "";
    let fOk = "";
    /** Bình luận trên P mang F_hid′. */
    let commentId = "";
    let fHidC = "";
    /** Tin N: [F_hid″, F_okN]. */
    let newsId = "";
    let fHidN = "";
    let fOkN = "";
    /** Bài Q: [F_gone, F_okQ]. */
    let postQ = "";
    let fGone = "";
    let fOkQ = "";
    /** Bài S: [F_store, F_okS]. */
    let postS = "";
    let fStore = "";
    let fOkS = "";

    /** Hàng tệp đã tải xong + sạch của `owner`. `tenantKey=false` ⇒ khoá ngoài tiền tố tenant (F_store). */
    async function seedFile(owner: Qa1Actor, tenantKey = true): Promise<string> {
      const id = randomUUID();
      const name = `attmeta-${id.slice(0, 8)}.png`;
      names.set(id, name);
      await w.direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
                          storage_provider, storage_path, upload_status, scan_status,
                          owner_user_id, uploaded_by)
       VALUES ($1,$2,$3,$4,'image/png',$5,'MinIO',$6,'Uploaded','Clean',$7,$7)`,
        [
          id,
          owner.tenant.companyId,
          name,
          `stored-${id}`,
          FILE_SIZE,
          tenantKey ? `${owner.tenant.companyId}/social/${id}` : `social/${id}`,
          owner.userId,
        ],
      );
      return id;
    }

    /** Link SOCIAL sống PHỤ của `fileId` tới một bài (`postId` có thể không tồn tại). */
    async function extraPostLink(fileId: string, postId: string): Promise<void> {
      await w.direct.query(
        `INSERT INTO file_links (company_id, file_id, module_code, entity_type, entity_id, link_type,
                               sort_order, created_by)
       VALUES ($1,$2,'SOCIAL','feed_post',$3,'Attachment',0,$4)`,
        [author.tenant.companyId, fileId, postId, author.userId],
      );
    }

    /** Che đúng: phần tử CÒN, `fileId`/`kind` đúng, ba trường còn lại `null`. */
    function expectMasked(att: Json | undefined, fileId: string, what: string): void {
      expect(att, `${what}: phần tử bị từ chối VẪN trong mảng (D-2)`).toBeDefined();
      expect(att!.fileId).toBe(fileId);
      expect(att!.kind).toBe("image");
      expect(att!.url, `${what}: url`).toBeNull();
      expect(att!.fileName, `${what}: fileName`).toBeNull();
      expect(att!.sizeBytes, `${what}: sizeBytes`).toBeNull();
    }

    /** Đủ trường: tên/cỡ nguyên văn, `url` chuỗi. */
    function expectFull(att: Json | undefined, fileId: string, what: string): void {
      expect(att, `${what}: phần tử có mặt`).toBeDefined();
      expect(att!.fileId).toBe(fileId);
      expect(att!.kind).toBe("image");
      expect(typeof att!.url, `${what}: url`).toBe("string");
      expect(att!.fileName, `${what}: fileName`).toBe(names.get(fileId));
      expect(att!.sizeBytes, `${what}: sizeBytes`).toBe(FILE_SIZE);
    }

    beforeAll(async () => {
      w = await bootQa1World("attmeta");
      author = await w.actor(w.A, "author", { pairs: [...FEED_PAIRS] });
      peer = await w.actor(w.A, "peer", { pairs: ["view:feed", "create:feed-comment"] });
      fileViewer = await w.actor(w.A, "fileviewer", {
        pairs: ["view:feed", "view:foundation-file"],
      });

      // Bài ẩn H của tác giả — đích của các link phụ «F_hid».
      hiddenPostId = (await sharePost(w, author, `Bài ẩn ${randomUUID().slice(0, 8)}`)).id;
      const hide = await w
        .patch(author.token, `/social/posts/${hiddenPostId}/moderation`)
        .send({ hidden: true });
      expect(hide.status, JSON.stringify(hide.body)).toBe(200);

      // P = [F_hid, F_ok]; F_hid thêm link sống tới H.
      fHid = await seedFile(author);
      fOk = await seedFile(author);
      postP = (
        await createPost(w, author, {
          type: "share",
          audience: "company",
          body: `Bài P ${randomUUID().slice(0, 8)}`,
          attachmentIds: [fHid, fOk],
        })
      ).id;
      await extraPostLink(fHid, hiddenPostId);

      // Bình luận trên P mang F_hid′ (+ link tới H).
      fHidC = await seedFile(author);
      const c = await w
        .post(author.token, `/social/posts/${postP}/comments`)
        .send({ body: `Bình luận ${randomUUID().slice(0, 8)}`, attachmentIds: [fHidC] });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      commentId = dataOf(c.body).id as string;
      await extraPostLink(fHidC, hiddenPostId);

      // Tin N = [F_hid″, F_okN] (002 nhận đính kèm cho `news`).
      fHidN = await seedFile(author);
      fOkN = await seedFile(author);
      newsId = (
        await createPost(w, author, {
          type: "news",
          audience: "company",
          body: `Tin ${randomUUID().slice(0, 8)}`,
          requiresAck: false,
          attachmentIds: [fHidN, fOkN],
        })
      ).id;
      await extraPostLink(fHidN, hiddenPostId);

      // Q = [F_gone, F_okQ]; F_gone thêm link sống tới một bài không tồn tại.
      fGone = await seedFile(author);
      fOkQ = await seedFile(author);
      postQ = (
        await createPost(w, author, {
          type: "share",
          audience: "company",
          body: `Bài Q ${randomUUID().slice(0, 8)}`,
          attachmentIds: [fGone, fOkQ],
        })
      ).id;
      await extraPostLink(fGone, randomUUID());

      // S = [F_store, F_okS] — F_store có khoá ngoài tiền tố tenant.
      fStore = await seedFile(author, false);
      fOkS = await seedFile(author);
      postS = (
        await createPost(w, author, {
          type: "share",
          audience: "company",
          body: `Bài S ${randomUUID().slice(0, 8)}`,
          attachmentIds: [fStore, fOkS],
        })
      ).id;
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await w?.close();
    });

    it("R-1 003 · người xem bị từ chối: F_hid che tên/cỡ, phần tử còn; F_ok đủ trường", async () => {
      const res = await w.get(peer.token, `/social/posts/${postP}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const atts = dataOf(res.body).attachments as Json[];
      expect(atts, "neo D-2: cả hai phần tử còn").toHaveLength(2);
      expectMasked(attOf(dataOf(res.body), fHid), fHid, "peer · F_hid");
      expectFull(attOf(dataOf(res.body), fOk), fOk, "peer · F_ok");
    });

    it("R-1a 003 · tác giả (ký được F_hid): cả hai đủ trường — CHO PHÉP đứng cạnh", async () => {
      const res = await w.get(author.token, `/social/posts/${postP}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(dataOf(res.body).attachments as Json[]).toHaveLength(2);
      expectFull(attOf(dataOf(res.body), fHid), fHid, "author · F_hid");
      expectFull(attOf(dataOf(res.body), fOk), fOk, "author · F_ok");
    });

    it("R-2 001 feed · peer che F_hid / author đủ, trên phần tử của P", async () => {
      const asPeer = await w.get(peer.token, `/social/feed`);
      expect(asPeer.status, JSON.stringify(asPeer.body)).toBe(200);
      const p = rowsOf(asPeer.body).find((r) => r.id === postP);
      expect(p, "feed của peer có P").toBeDefined();
      expectMasked(attOf(p!, fHid), fHid, "feed peer · F_hid");
      expectFull(attOf(p!, fOk), fOk, "feed peer · F_ok");

      const asAuthor = await w.get(author.token, `/social/feed`);
      expect(asAuthor.status, JSON.stringify(asAuthor.body)).toBe(200);
      const pa = rowsOf(asAuthor.body).find((r) => r.id === postP);
      expect(pa, "feed của author có P").toBeDefined();
      expectFull(attOf(pa!, fHid), fHid, "feed author · F_hid");
    });

    it("R-3 014 bình luận · peer che F_hid′ / author đủ", async () => {
      const asPeer = await w.get(peer.token, `/social/posts/${postP}/comments`);
      expect(asPeer.status, JSON.stringify(asPeer.body)).toBe(200);
      const cp = rowsOf(asPeer.body).find((r) => r.id === commentId);
      expect(cp, "014 của peer có bình luận").toBeDefined();
      expect(cp!.attachments as Json[]).toHaveLength(1);
      expectMasked(attOf(cp!, fHidC), fHidC, "014 peer · F_hid′");

      const asAuthor = await w.get(author.token, `/social/posts/${postP}/comments`);
      expect(asAuthor.status, JSON.stringify(asAuthor.body)).toBe(200);
      const ca = rowsOf(asAuthor.body).find((r) => r.id === commentId);
      expect(ca, "014 của author có bình luận").toBeDefined();
      expectFull(attOf(ca!, fHidC), fHidC, "014 author · F_hid′");
    });

    it("R-4 020 tin · peer che F_hid″ / author đủ", async () => {
      const asPeer = await w.get(peer.token, `/social/news`);
      expect(asPeer.status, JSON.stringify(asPeer.body)).toBe(200);
      const np = rowsOf(asPeer.body).find((r) => r.id === newsId);
      expect(np, "020 của peer có tin").toBeDefined();
      expect(np!.attachments as Json[]).toHaveLength(2);
      expectMasked(attOf(np!, fHidN), fHidN, "020 peer · F_hid″");
      expectFull(attOf(np!, fOkN), fOkN, "020 peer · F_okN");

      const asAuthor = await w.get(author.token, `/social/news`);
      expect(asAuthor.status, JSON.stringify(asAuthor.body)).toBe(200);
      const na = rowsOf(asAuthor.body).find((r) => r.id === newsId);
      expect(na, "020 của author có tin").toBeDefined();
      expectFull(attOf(na!, fHidN), fHidN, "020 author · F_hid″");
    });

    it("R-5 006 phản hồi kiểm duyệt · F_gone che kể cả với kiểm duyệt, F_okQ đủ; từ chối thường KHÔNG log error", async () => {
      const errorSpy = vi.spyOn(Logger.prototype, "error");
      try {
        const res = await w
          .patch(author.token, `/social/posts/${postQ}/moderation`)
          .send({ commentsLocked: true });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(dataOf(res.body).commentsLocked, "neo: lượt kiểm duyệt đã áp").toBe(true);
        // Đo fixture TRƯỚC luật che (chạy được cả trên mã cũ): F_gone là từ chối THƯỜNG (`deny-resolver`).
        const lines = errorSpy.mock.calls.map((args) => args.map(String).join(" "));
        expect(
          lines.filter((l) => l.includes(fGone)),
          "F_gone: deny-resolver im lặng",
        ).toEqual([]);
        expect(dataOf(res.body).attachments as Json[]).toHaveLength(2);
        expectMasked(attOf(dataOf(res.body), fGone), fGone, "006 · F_gone");
        expectFull(attOf(dataOf(res.body), fOkQ), fOkQ, "006 · F_okQ");
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("R-6 003 · lỗi ký (storage) ⇒ url null ⇒ tên/cỡ null (D-1); dòng warn không mang tên tệp", async () => {
      const warnSpy = vi.spyOn(Logger.prototype, "warn");
      try {
        const res = await w.get(author.token, `/social/posts/${postS}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        // Đo fixture TRƯỚC luật che (chạy được cả trên mã cũ): ký F_store ném TRONG signOne ⇒ warn.
        const lines = warnSpy.mock.calls.map((args) => args.map(String).join(" "));
        const presign = lines.filter((l) => l.includes(`file=${fStore}`));
        expect(presign.length, "neo: ký F_store thật sự ném và có log warn").toBeGreaterThan(0);
        for (const l of presign) expect(l).not.toContain(names.get(fStore)!);
        expect(dataOf(res.body).attachments as Json[]).toHaveLength(2);
        expectMasked(attOf(dataOf(res.body), fStore), fStore, "author · F_store");
        expectFull(attOf(dataOf(res.body), fOkS), fOkS, "author · F_okS");
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("R-7 004 rồi 003 · gửi lại `attachmentIds` = các fileId đang thấy ⇒ link F_gone CÒN sống (D-2)", async () => {
      const before = await w.get(author.token, `/social/posts/${postQ}`);
      expect(before.status, JSON.stringify(before.body)).toBe(200);
      const ids = (dataOf(before.body).attachments as Json[]).map((a) => a.fileId as string);
      expect(ids.sort()).toEqual([fGone, fOkQ].sort());

      const edit = await w
        .patch(author.token, `/social/posts/${postQ}`)
        .send({ body: `Bài Q sửa ${randomUUID().slice(0, 8)}`, attachmentIds: ids });
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);

      const live = await w.direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM file_links
        WHERE company_id = $1 AND file_id = $2 AND entity_type = 'feed_post' AND entity_id = $3
          AND deleted_at IS NULL`,
        [author.tenant.companyId, fGone, postQ],
      );
      expect(live.rows[0]!.n, "link (Q, F_gone) còn sống").toBe("1");

      const after = await w.get(author.token, `/social/posts/${postQ}`);
      expect(after.status, JSON.stringify(after.body)).toBe(200);
      expect(dataOf(after.body).attachments as Json[]).toHaveLength(2);
    });

    it("R-8 FOUNDATION `GET /foundation/files/:id` · F_hid với người xem bị từ chối ⇒ không 200, thân lỗi không mang tên tệp", async () => {
      const res = await w.get(fileViewer.token, `/foundation/files/${fHid}`);
      expect(res.status, JSON.stringify(res.body)).not.toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(names.get(fHid)!);

      // Neo CHO PHÉP: cùng người xem, tệp chỉ gắn bài thấy được ⇒ 200 mang tên.
      const ok = await w.get(fileViewer.token, `/foundation/files/${fOk}`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(JSON.stringify(ok.body)).toContain(names.get(fOk)!);
    });
  },
);
