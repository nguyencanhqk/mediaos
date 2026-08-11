import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkEditRequest } from "./bulk-edit";

/**
 * Sua hang loat, chay tren mot CSDL THAT (SQLite trong thu muc tam).
 *
 * Nhung dieu duoc gac o day la nhung dieu ma mot loi nho se lam hong ca kho noi dung:
 *
 * 1. XEM TRUOC KHONG DUOC GHI GI. Neu buoc xem truoc lo ghi xuong thi nguoi dung mat quyen tu
 *    choi — bam "xem truoc" da la da roi.
 * 2. CHI DUNG VAO NHUNG NOI DUNG DA CHON. Thay nham sang noi dung khong chon la kieu hong khong
 *    ai kiem lai kip khi thu vien co hang tram bai.
 * 3. KHONG SUA BAI DA RA KHOI TAM TAY. Bai da nam tren Facebook ma van doi trong CSDL thi giao
 *    dien noi mot dang, Facebook dang mot neo.
 *
 * `SOCIAL_DATA_DIR` phai dat TRUOC khi nap module vi `paths.ts` doc no o cap module — nen moi ca
 * test deu `resetModules()` roi `await import(...)`, giong db.spec.ts.
 */

let dataDir: string;

beforeEach(() => {
  dataDir = join(mkdtempSync(join(tmpdir(), "fbpost-bulk-")), "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "kek.bin"), randomBytes(32));
  process.env.SOCIAL_DATA_DIR = dataDir;
  process.env.SOCIAL_KEK_PATH = join(dataDir, "kek.bin");
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  vi.resetModules();
});

async function load() {
  const contentRepo = await import("./repo/content-repo");
  const postRepo = await import("./repo/post-repo");
  const service = await import("./bulk-edit-service");
  return { ...contentRepo, ...postRepo, ...service };
}

/** Yeu cau toi thieu: thay mot cap trong o noi dung cua cac id da cho. */
function request(contentIds: number[], overrides: Partial<BulkEditRequest> = {}): BulkEditRequest {
  return {
    contentIds,
    rules: [{ find: "0909", replace: "0388" }],
    fields: ["message"],
    caseSensitive: false,
    includePendingPosts: false,
    ...overrides,
  };
}

describe("sua hang loat trong thu vien noi dung", () => {
  it("xem truoc dem dung so lan thay ma KHONG ghi gi xuong CSDL", async () => {
    const lib = await load();
    const a = lib.createContent({ type: "text", message: "Hotline 0909 · zalo 0909" });
    const b = lib.createContent({ type: "text", message: "Gọi 0909 nhé" });

    const preview = lib.previewBulkEdit(request([a.id, b.id]));

    expect(preview.applied).toBe(false);
    expect(preview.totalHits).toBe(3);
    expect(preview.changedContents).toHaveLength(2);
    expect(preview.changedContents[0].changes[0].after).toBe("Hotline 0388 · zalo 0388");

    // CSDL phai con nguyen ven.
    expect(lib.getContent(a.id)?.message).toBe("Hotline 0909 · zalo 0909");
    expect(lib.getContent(b.id)?.message).toBe("Gọi 0909 nhé");
  });

  it("ap dung ghi xuong dung nhung noi dung DA CHON", async () => {
    const lib = await load();
    const chon1 = lib.createContent({ type: "text", message: "Hotline 0909" });
    const chon2 = lib.createContent({ type: "text", message: "Đặt hàng 0909" });
    const khongChon = lib.createContent({ type: "text", message: "Vẫn là 0909" });

    const result = lib.applyBulkEdit(request([chon1.id, chon2.id]));

    expect(result.applied).toBe(true);
    expect(result.changedContents).toHaveLength(2);
    expect(lib.getContent(chon1.id)?.message).toBe("Hotline 0388");
    expect(lib.getContent(chon2.id)?.message).toBe("Đặt hàng 0388");
    expect(lib.getContent(khongChon.id)?.message).toBe("Vẫn là 0909");
  });

  it("noi dung khong khop khong bi dong toi va khong hien trong ket qua", async () => {
    const lib = await load();
    const khop = lib.createContent({ type: "text", message: "Hotline 0909" });
    const khongKhop = lib.createContent({ type: "text", message: "Không có số nào" });
    const truocKhi = lib.getContent(khongKhop.id)?.updatedAt;

    const result = lib.applyBulkEdit(request([khop.id, khongKhop.id]));

    expect(result.scannedContents).toBe(2);
    expect(result.changedContents.map((c) => c.contentId)).toEqual([khop.id]);
    expect(lib.getContent(khongKhop.id)?.updatedAt).toBe(truocKhi);
  });

  it("chi sua dung nhung o duoc chon", async () => {
    const lib = await load();
    const content = lib.createContent({
      type: "video",
      message: "Xem ngay 0909",
      title: "Video 0909",
      label: "Nhãn 0909",
      mediaIds: [1],
    });

    lib.applyBulkEdit(request([content.id], { fields: ["title"] }));

    const after = lib.getContent(content.id);
    expect(after?.title).toBe("Video 0388");
    expect(after?.message).toBe("Xem ngay 0909");
    expect(after?.label).toBe("Nhãn 0909");
  });

  it("bo qua link neu thay xong khong con la link hop le, va noi ro ly do", async () => {
    const lib = await load();
    const content = lib.createContent({
      type: "text",
      message: "Xem tại https://cu.example.com",
      link: "https://cu.example.com/uu-dai",
    });

    const result = lib.applyBulkEdit(
      request([content.id], {
        rules: [{ find: "https://cu.example.com", replace: "trang chủ" }],
        fields: ["message", "link"],
      }),
    );

    expect(lib.getContent(content.id)?.link).toBe("https://cu.example.com/uu-dai");
    expect(lib.getContent(content.id)?.message).toBe("Xem tại trang chủ");
    expect(result.warnings.some((w) => w.includes("không còn là link hợp lệ"))).toBe(true);
  });

  it("doi link sang dia chi moi khi ket qua van hop le", async () => {
    const lib = await load();
    const content = lib.createContent({
      type: "text",
      message: "Xem tại https://cu.example.com/uu-dai",
      link: "https://cu.example.com/uu-dai",
    });

    lib.applyBulkEdit(
      request([content.id], {
        rules: [{ find: "cu.example.com", replace: "moi.example.com" }],
        fields: ["message", "link"],
      }),
    );

    expect(lib.getContent(content.id)?.link).toBe("https://moi.example.com/uu-dai");
  });

  it("khong nhan cap rong: khong co gi de thay thi khong doi gi", async () => {
    const lib = await load();
    const content = lib.createContent({ type: "text", message: "Hotline 0909" });

    const result = lib.applyBulkEdit(
      request([content.id], { rules: [{ find: "", replace: "X" }] }),
    );

    expect(result.changedContents).toHaveLength(0);
    expect(lib.getContent(content.id)?.message).toBe("Hotline 0909");
  });

  it("bao lai khi co noi dung da chon nhung khong con trong thu vien", async () => {
    const lib = await load();
    const content = lib.createContent({ type: "text", message: "Hotline 0909" });

    const result = lib.previewBulkEdit(request([content.id, 9999]));

    expect(result.scannedContents).toBe(1);
    expect(result.warnings.some((w) => w.includes("không còn trong thư viện"))).toBe(true);
  });
});

describe("sua hang loat cham den cac bai da xep lich", () => {
  /** Mot noi dung kem nam luot dang o nam trang thai khac nhau. */
  async function seedPosts() {
    const lib = await load();
    const content = lib.createContent({ type: "text", message: "Hotline 0909" });

    const make = (status: "draft" | "queued" | "failed" | "scheduled" | "published") =>
      lib.createPost(
        {
          pageRef: 1,
          pageName: "Page test",
          contentId: content.id,
          type: "text",
          message: "Hotline 0909",
          scheduleMode: "facebook",
        },
        status,
      );

    return {
      lib,
      content,
      draft: make("draft"),
      queued: make("queued"),
      failed: make("failed"),
      scheduled: make("scheduled"),
      published: make("published"),
    };
  }

  it("bat cong tac thi sua ca bai chua gui, KHONG dong vao bai da ra khoi tam tay", async () => {
    const { lib, content, draft, queued, failed, scheduled, published } = await seedPosts();

    const result = lib.applyBulkEdit(request([content.id], { includePendingPosts: true }));

    expect(result.changedPosts).toBe(3);
    expect(lib.getPost(draft.id)?.message).toBe("Hotline 0388");
    expect(lib.getPost(queued.id)?.message).toBe("Hotline 0388");
    // Bai loi chua bao gio len Facebook — sua roi bam "Thử lại" la dung viec nguoi dung muon lam.
    expect(lib.getPost(failed.id)?.message).toBe("Hotline 0388");
    expect(lib.getPost(scheduled.id)?.message).toBe("Hotline 0909");
    expect(lib.getPost(published.id)?.message).toBe("Hotline 0909");
    expect(result.warnings.some((w) => w.includes("đã được Facebook nhận"))).toBe(true);
  });

  it("bai bao LOI nhung Facebook DA tao bai thi khong duoc sua", async () => {
    const { lib, content, failed } = await seedPosts();

    // Ca hiem that: `sendToFacebook` thanh cong roi buoc sau nem loi ⇒ status `failed` nhung bai
    // da nam tren Page. Chi con `fbPostId` noi len su that do.
    lib.updatePost(failed.id, { fbPostId: "123_456" });

    const result = lib.applyBulkEdit(request([content.id], { includePendingPosts: true }));

    expect(lib.getPost(failed.id)?.message).toBe("Hotline 0909");
    expect(result.changedPosts).toBe(2);
  });

  it("tat cong tac thi khong bai nao bi sua, nhung phai NHAC rang co bai con doan do", async () => {
    const { lib, content, draft } = await seedPosts();

    const result = lib.applyBulkEdit(request([content.id], { includePendingPosts: false }));

    expect(result.changedPosts).toBe(0);
    expect(lib.getPost(draft.id)?.message).toBe("Hotline 0909");
    expect(lib.getContent(content.id)?.message).toBe("Hotline 0388");
    expect(result.warnings.some((w) => w.includes("chưa gửi đi cũng chứa đoạn cần thay"))).toBe(
      true,
    );
  });

  it("xem truoc dem so bai se doi nhung khong sua bai nao", async () => {
    const { lib, content, draft } = await seedPosts();

    const preview = lib.previewBulkEdit(request([content.id], { includePendingPosts: true }));

    expect(preview.changedPosts).toBe(3);
    expect(preview.changedContents[0].pendingPosts).toBe(3);
    expect(lib.getPost(draft.id)?.message).toBe("Hotline 0909");
  });

  it("bai dang duoc gui di thi khong bi cham toi", async () => {
    const { lib, content, draft, queued } = await seedPosts();

    lib.updatePost(queued.id, { status: "publishing" });

    const result = lib.applyBulkEdit(request([content.id], { includePendingPosts: true }));

    expect(lib.getPost(draft.id)?.message).toBe("Hotline 0388");
    expect(lib.getPost(queued.id)?.message).toBe("Hotline 0909");
    expect(result.changedPosts).toBe(2);
  });

  /**
   * Chot chan THAT nam trong cau UPDATE, khong nam o vong lap cua service: neu worker gianh lay
   * bai dung giua luc dung ke hoach va luc ghi thi chi dieu kien trong SQL con giu duoc. Kiem
   * thang o day vi qua service khong tai hien duoc canh do bang mot luong dong bo.
   */
  it("updatePendingPostText tu choi bai da roi khoi tam tay", async () => {
    const lib = await load();
    const make = (status: "queued" | "publishing" | "scheduled" | "published" | "cancelled") =>
      lib.createPost(
        {
          pageRef: 1,
          pageName: "Page test",
          type: "text",
          message: "cũ",
          scheduleMode: "facebook",
        },
        status,
      );

    expect(lib.updatePendingPostText(make("queued").id, { message: "mới" })).toBe(true);
    expect(lib.updatePendingPostText(make("cancelled").id, { message: "mới" })).toBe(true);
    expect(lib.updatePendingPostText(make("publishing").id, { message: "mới" })).toBe(false);
    expect(lib.updatePendingPostText(make("scheduled").id, { message: "mới" })).toBe(false);
    expect(lib.updatePendingPostText(make("published").id, { message: "mới" })).toBe(false);

    // Trang thai con "sua duoc" nhung Facebook DA nhan bai ⇒ van phai tu choi.
    const daLenFacebook = make("queued");
    lib.updatePost(daLenFacebook.id, { fbPostId: "123_456" });
    expect(lib.updatePendingPostText(daLenFacebook.id, { message: "mới" })).toBe(false);
    expect(lib.getPost(daLenFacebook.id)?.message).toBe("cũ");
  });

  it("bai co van ban rieng khac noi dung goc van duoc thay theo van ban cua chinh no", async () => {
    const lib = await load();
    const content = lib.createContent({ type: "text", message: "Hotline 0909" });
    const post = lib.createPost(
      {
        pageRef: 1,
        pageName: "Page test",
        contentId: content.id,
        type: "text",
        message: "Bản riêng: 0909 · 0909",
        scheduleMode: "local",
      },
      "queued",
    );

    lib.applyBulkEdit(request([content.id], { includePendingPosts: true }));

    expect(lib.getPost(post.id)?.message).toBe("Bản riêng: 0388 · 0388");
  });
});
