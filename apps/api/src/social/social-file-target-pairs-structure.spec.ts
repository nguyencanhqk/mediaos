import fs from "node:fs";
import path from "node:path";
import { feedTargetTypeSchema } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import {
  SOCIAL_FILE_TARGET_PAIRS,
  SOCIAL_POST_TYPE_PAIRS,
  SOCIAL_ROUTE_PAIRS,
} from "./social-route-pairs.const";
import { SOCIAL_FILE_TARGET_DENIED } from "./social.errors";

/**
 * S16-SOCIAL-BE-1C · **C-8** — CẤU TRÚC bảng cặp-theo-`target` của cửa đăng ký tệp (plan §1 D1).
 * Khuôn nguyên văn **C-6** (`social-post-type-pairs-structure.spec.ts`).
 *
 * ┌─ VÌ SAO CẦN SPEC NÀY KHI ĐÃ CÓ `satisfies Record<FeedTargetTypeDto, …>` ───────────────────────┐
 * │ `satisfies` bắt được chiều "enum mở mà bảng thiếu khoá". KHÔNG bắt được ba chiều dưới, và ở      │
 * │ cửa NÀY cả ba đều dẫn tới cùng một hậu quả — cổng tầng-2 biến mất mà tầng-1 vẫn xanh:            │
 * │                                                                                                 │
 * │  (a) **bảng có khoá LẠ** mà enum không có ⇒ khoá đó không route nào đọc tới, nằm im;            │
 * │  (b) **cặp rỗng** `{action:"",resourceType:""}` thoả kiểu hoàn hảo; `resolveManyOrNull` trả      │
 * │      `null` cho nó ⇒ `assertFileTarget` 403 với MỌI người, kể cả `company-admin`;                │
 * │  (c) **hai `target` trỏ CÙNG một cặp** ⇒ đúng thứ D1 sinh ra để tránh: vai chỉ có                │
 * │      `create:feed-comment` lại bị hỏi `create:feed-post` (hoặc ngược lại) ⇒ 403 chặn NHẦM ở      │
 * │      cửa, trong khi người đó vẫn viết được nội dung loại kia bằng chữ. `satisfies` mù hẳn với    │
 * │      chuyện này vì cả hai đều là `string`.                                                       │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 🔴 CA (d) — CẶP CỦA CỬA PHẢI TRÙNG CẶP MÀ `canLinkFile` HỎI ─────────────────────────────────┐
 * │ Bất biến THẬT của WO này không nằm trong bảng, mà nằm GIỮA bảng này và                          │
 * │ `SocialFileResolver.canLinkFile` (vế 6a): cửa upload và cổng link phải hỏi CÙNG cặp, nếu không   │
 * │ sinh ra vai «tải lên được mà gắn không được» (jsdoc `ChatFilesController`). Ca cuối dưới đây ghim │
 * │ bảng vào ĐÚNG hai literal mà resolver dùng, nên một lượt "đổi cho gọn" ở một phía là ĐỎ.        │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * PHÉP ĐO CỔNG (chạy 24/09/2026, khôi phục sau): đổi `comment` thành `{action:"create",
 * resourceType:"feed-post"}` ⇒ ca (c) và ca (d) ĐỎ, TS thì KHÔNG. Xoá khoá `comment` ⇒ TS đỏ **và**
 * ca "TẬP khoá" đỏ.
 */

type PairShape = { action: string; resourceType: string; isSensitive: boolean };

/** Số `target` hợp lệ, gõ TAY. Neo dương: bảng rỗng thì mọi so-TẬP dưới đây thành vacuous. */
const EXPECTED_TARGETS = 2;

describe("S16-SOCIAL-BE-1C · C-8 · cấu trúc bảng cặp-theo-target", () => {
  it("neo dương: enum `target` có ĐÚNG 2 giá trị, cả hai bảng có ĐÚNG 2 khoá", () => {
    expect(feedTargetTypeSchema.options.length).toBe(EXPECTED_TARGETS);
    expect(Object.keys(SOCIAL_FILE_TARGET_PAIRS).length).toBe(EXPECTED_TARGETS);
    expect(Object.keys(SOCIAL_FILE_TARGET_DENIED).length).toBe(EXPECTED_TARGETS);
  });

  it("TẬP khoá: PAIRS = DENIED = feedTargetTypeSchema.options (cả hai chiều)", () => {
    const enumKeys = [...feedTargetTypeSchema.options].sort();
    expect(Object.keys(SOCIAL_FILE_TARGET_PAIRS).sort()).toEqual(enumKeys);
    expect(Object.keys(SOCIAL_FILE_TARGET_DENIED).sort()).toEqual(enumKeys);
  });

  it("(b) mọi cặp có `action`/`resourceType` KHÔNG rỗng (cặp rỗng ⇒ 403 cho mọi người)", () => {
    for (const [target, pair] of Object.entries(SOCIAL_FILE_TARGET_PAIRS) as Array<
      [string, PairShape]
    >) {
      expect(pair.action.trim().length, `${target}.action rỗng`).toBeGreaterThan(0);
      expect(pair.resourceType.trim().length, `${target}.resourceType rỗng`).toBeGreaterThan(0);
      // Mirror catalog `0578`: cả 14 cặp `feed-*` đều `is_sensitive = false`.
      expect(pair.isSensitive, `${target}.isSensitive phải mirror catalog 0578`).toBe(false);
    }
  });

  it("(c) hai `target` KHÔNG được trỏ cùng một cặp — đó là lý do D1 tồn tại", () => {
    const keys = Object.values(SOCIAL_FILE_TARGET_PAIRS).map(
      (p) => `${p.action}:${p.resourceType}`,
    );
    expect(new Set(keys).size, `hai target dùng chung cặp: ${keys.join(" · ")}`).toBe(keys.length);
  });

  it("mỗi `target` mang thông điệp 403 RIÊNG (hai đích dùng chung chuỗi ⇒ 403 nói sai lý do)", () => {
    const messages = Object.values(SOCIAL_FILE_TARGET_DENIED);
    expect(new Set(messages).size).toBe(messages.length);
    for (const [target, msg] of Object.entries(SOCIAL_FILE_TARGET_DENIED)) {
      expect(msg.trim().length, `${target} thông điệp rỗng`).toBeGreaterThan(0);
    }
  });

  it("(d) bảng ghim vào ĐÚNG hai cặp mà `SocialFileResolver.canLinkFile` hỏi (vế 6a)", () => {
    expect(SOCIAL_FILE_TARGET_PAIRS.post).toEqual({
      action: "create",
      resourceType: "feed-post",
      isSensitive: false,
    });
    expect(SOCIAL_FILE_TARGET_PAIRS.comment).toEqual({
      action: "create",
      resourceType: "feed-comment",
      isSensitive: false,
    });
  });

  it("SÀN của hai route cửa tệp là `view:feed`, và cặp tầng-2 KHÁC sàn (nếu không, cờ vô nghĩa)", () => {
    for (const key of ["fileUploadUrl", "fileConfirm"] as const) {
      const floor = SOCIAL_ROUTE_PAIRS[key];
      expect(`${floor.action}:${floor.resourceType}`).toBe("view:feed");
      // Cờ `tier1IsFloor` chỉ có nghĩa khi tầng 2 hỏi một cặp KHÁC sàn — bằng nhau thì decorator ĐÃ
      // là cặp thật và cờ đang nói dối (đẳng thức D17 của census đo tập, ca này đo TỪNG route).
      for (const pair of Object.values(SOCIAL_FILE_TARGET_PAIRS)) {
        expect(`${pair.action}:${pair.resourceType}`).not.toBe(
          `${floor.action}:${floor.resourceType}`,
        );
      }
      expect(floor.tier1IsFloor, `${key} phải khai tier1IsFloor`).toBe(true);
      expect(floor.companyFloor, `${key} giữ sàn scope Company`).toBe(true);
    }
  });

  /**
   * S16-SOCIAL-ATTGATE-1 — hằng `ATTACH_GATE_ENFORCED_BY_TIER1` khai rằng «cặp create đã bị tầng-1
   * ép». Câu đó CHỈ đúng ở `002`/`015`. Dán nó lên đường SỬA (`004`/`016`, tầng-1 = `view:feed`) là
   * vừa mở lại đúng lỗ WO này đóng, vừa ghim một lời khai SAI vào mã cho người đọc sau.
   *
   * ⚠️ **PHẢI `stripComments` trước khi đếm** (plan F-12): docblock của chính hằng đó nhắc tên nó
   * nhiều lần, quét thô sẽ đếm cả comment và ca này thành vô nghĩa. Ca tự-kiểm ngay dưới chứng minh
   * regex THẬT SỰ cắt — không có nó, một regex hỏng sẽ làm cả hai ca xanh-rỗng.
   */
  describe("(e) hằng cổng đường TẠO chỉ được dùng ở ĐÚNG 2 call-site TẠO", () => {
    const CONST_NAME = "ATTACH_GATE_ENFORCED_BY_TIER1";
    const stripComments = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    it("neo tự-kiểm: regex strip THẬT SỰ cắt comment (chống xanh-rỗng)", () => {
      expect(stripComments("/* x */ a // y\nb")).not.toContain("x");
      expect(stripComments("/* x */ a // y\nb")).not.toContain("y");
      expect(stripComments("/* x */ a // y\nb")).toContain("a");
    });

    it("đếm trên MÃ (đã bỏ comment): 1 khai báo + đúng 2 nơi TIÊU THỤ", () => {
      // `__dirname` (không `import.meta`): tsconfig của api là CommonJS — khuôn
      // `social-error-code-census.spec.ts:43`.
      const dir = __dirname;
      const consumers: Array<{ file: string; n: number }> = [];
      let scanned = 0;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".ts") || f.endsWith(".spec.ts")) continue;
        scanned += 1;
        const code = stripComments(fs.readFileSync(path.join(dir, f), "utf8"));
        const n = code.split(CONST_NAME).length - 1;
        if (n > 0) consumers.push({ file: f, n });
      }
      // Neo tự-kiểm: bộ quét này KHÔNG đệ quy. Nếu ai đó dời service vào thư mục con
      // (`src/social/posts/…`) thì `consumers` teo lại và ca sẽ đỏ theo hướng khó đọc — dòng này
      // nói thẳng nguyên nhân thay vì để người sau đi đoán.
      expect(scanned, "bộ quét KHÔNG đệ quy — có file .ts nào bị dời vào thư mục con?").toBeGreaterThan(40);

      const attachments = consumers.find((c) => c.file === "social-attachments.service.ts");
      expect(attachments, "hằng phải được KHAI ở chính service đính kèm").toBeTruthy();

      // Hai nơi tiêu thụ: `create()` của bài và của bình luận. Mỗi file: 1 import + 1 lời gọi = 2.
      const posts = consumers.find((c) => c.file === "social-posts.service.ts");
      const comments = consumers.find((c) => c.file === "social-comments.service.ts");
      expect(posts?.n, "social-posts.service.ts: import + 1 call-site TẠO").toBe(2);
      expect(comments?.n, "social-comments.service.ts: import + 1 call-site TẠO").toBe(2);

      // 🔴 VẾ CHẶN THẬT: không file nào KHÁC ba file trên được nhắc tới hằng này.
      expect(consumers.map((c) => c.file).sort()).toEqual([
        "social-attachments.service.ts",
        "social-comments.service.ts",
        "social-posts.service.ts",
      ]);
    });
  });

  it("neo hồi quy: bảng theo-LOẠI-BÀI của `002` không bị WO này chạm", () => {
    expect(Object.keys(SOCIAL_POST_TYPE_PAIRS).sort()).toEqual([
      "idea",
      "kudos",
      "news",
      "poll",
      "share",
    ]);
  });
});
