/**
 * S16-SOCIAL-FE-3 (L2, ca B1 — vế hàm) — ma trận hành động kèm của `029` theo loại đích, body gửi đi, và
 * bảng `loại đích × hành động → khoá i18n`.
 *
 * Body kiểm bằng CHÍNH `resolveFeedReportSchema` của contracts (`.strict()` + refine «dismissed ⇒ none»).
 * Chữ đọc qua i18n THẬT (`@/i18n`); i18next trả lại chính khoá khi thiếu bản dịch ⇒ mọi ca so chữ với
 * câu VIẾT TAY, không chỉ «có chữ» (plan B18).
 */
import { describe, expect, it } from "vitest";
import {
  feedReportActionSchema,
  feedTargetTypeSchema,
  resolveFeedReportSchema,
  type FeedReportActionDto,
  type FeedTargetTypeDto,
} from "@mediaos/contracts";
import i18n from "@/i18n";
import {
  REPORT_ACTION_LABEL_KEYS,
  REPORT_ACTION_MATRIX,
  REPORT_DELETE_CONFIRM_KEYS,
  buildResolveBody,
  reportActionNeedsConfirm,
  reportActionOptions,
  type ResolveDraft,
} from "./report-actions";

const text = (key: string): string => i18n.t(key, { ns: "social" });

const draft = (over: Partial<ResolveDraft> = {}): ResolveDraft => ({
  decision: "resolved",
  action: "none",
  note: "",
  canManagePosts: true,
  ...over,
});

describe("REPORT_ACTION_MATRIX — chép ma trận của server (plan M3 · D7)", () => {
  it("đúng từng hàng, đúng thứ tự (viết tay theo `social-report-actions.ts`)", () => {
    expect(REPORT_ACTION_MATRIX).toEqual({
      post: ["none", "hide_post", "lock_comments", "delete_target"],
      comment: ["none", "lock_comments", "delete_target"],
    });
  });

  it("đích `comment` KHÔNG có `hide_post`; đích `post` CÓ", () => {
    expect(REPORT_ACTION_MATRIX.post).toContain("hide_post");
    expect(REPORT_ACTION_MATRIX.comment).not.toContain("hide_post");
  });

  it("phủ đủ mọi loại đích của hợp đồng; mọi hành động thuộc enum hợp đồng", () => {
    expect(Object.keys(REPORT_ACTION_MATRIX).sort()).toEqual(
      [...feedTargetTypeSchema.options].sort(),
    );
    const known: readonly string[] = feedReportActionSchema.options;
    const all = Object.values(REPORT_ACTION_MATRIX).flat();
    expect(all).toHaveLength(7);
    for (const action of all) expect(known).toContain(action);
  });
});

describe("buildResolveBody — body của 029 qua CHÍNH schema hợp đồng", () => {
  it.each([
    ["post", "none", { status: "resolved" }],
    ["post", "hide_post", { status: "resolved", action: "hide_post" }],
    ["post", "lock_comments", { status: "resolved", action: "lock_comments" }],
    ["post", "delete_target", { status: "resolved", action: "delete_target" }],
    ["comment", "none", { status: "resolved" }],
    ["comment", "lock_comments", { status: "resolved", action: "lock_comments" }],
    ["comment", "delete_target", { status: "resolved", action: "delete_target" }],
  ] as const)("«Giải quyết» · đích %s · hành động %s", (targetType, action, expected) => {
    // Tổ hợp phải nằm trong ma trận — ca không xanh trên một tổ hợp server sẽ trả 422.
    expect(REPORT_ACTION_MATRIX[targetType]).toContain(action);
    const body = buildResolveBody(draft({ action }));
    expect(body).toStrictEqual(expected);
    const parsed = resolveFeedReportSchema.safeParse(body);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.data?.action).toBe(action);
  });

  it("`action` = «không» ⇒ BỎ khoá `action` (không gửi `action: none`)", () => {
    const body = buildResolveBody(draft({ action: "none" }));
    expect(body).toStrictEqual({ status: "resolved" });
    expect(Object.hasOwn(body, "action")).toBe(false);
  });

  it("«Bỏ qua» ⇒ đúng `{ status: dismissed }` và qua schema", () => {
    const body = buildResolveBody(draft({ decision: "dismissed" }));
    expect(body).toStrictEqual({ status: "dismissed" });
    expect(resolveFeedReportSchema.safeParse(body).success).toBe(true);
  });

  it.each(["hide_post", "lock_comments", "delete_target"] as const)(
    "«Bỏ qua» SAU KHI đã chọn `%s` ⇒ body KHÔNG có `action` (refine của hợp đồng sẽ 400)",
    (action) => {
      // Đối chứng cùng khung: cùng nháp nhưng «Giải quyết» ⇒ CÓ `action`.
      expect(buildResolveBody(draft({ decision: "resolved", action }))).toStrictEqual({
        status: "resolved",
        action,
      });
      const body = buildResolveBody(draft({ decision: "dismissed", action }));
      expect(body).toStrictEqual({ status: "dismissed" });
      expect(Object.hasOwn(body, "action")).toBe(false);
      expect(resolveFeedReportSchema.safeParse(body).success).toBe(true);
      // Vì sao phải bỏ: gửi kèm là hợp đồng từ chối.
      expect(resolveFeedReportSchema.safeParse({ status: "dismissed", action }).success).toBe(
        false,
      );
    },
  );

  it.each(["hide_post", "lock_comments", "delete_target"] as const)(
    "thiếu `manage:feed-post` ⇒ KHÔNG bao giờ có `action` dù nháp mang `%s`",
    (action) => {
      // ALLOW cùng khung.
      expect(buildResolveBody(draft({ action, canManagePosts: true }))).toStrictEqual({
        status: "resolved",
        action,
      });
      // DENY.
      const body = buildResolveBody(draft({ action, canManagePosts: false }));
      expect(body).toStrictEqual({ status: "resolved" });
      expect(Object.hasOwn(body, "action")).toBe(false);
    },
  );

  it.each([
    ["", "rỗng"],
    ["   ", "toàn khoảng trắng"],
    ["\n\t ", "xuống dòng + tab"],
  ])("ghi chú %j (%s) ⇒ BỎ khoá `resolutionNote`", (note) => {
    const body = buildResolveBody(draft({ note, action: "hide_post" }));
    expect(body).toStrictEqual({ status: "resolved", action: "hide_post" });
    expect(Object.hasOwn(body, "resolutionNote")).toBe(false);
  });

  it("ghi chú có chữ ⇒ gửi bản ĐÃ trim, cho cả hai quyết định", () => {
    expect(buildResolveBody(draft({ note: "  Đã nhắc nhở tác giả \n" }))).toStrictEqual({
      status: "resolved",
      resolutionNote: "Đã nhắc nhở tác giả",
    });
    const dismissed = buildResolveBody(
      draft({ decision: "dismissed", action: "delete_target", note: "Không vi phạm" }),
    );
    expect(dismissed).toStrictEqual({ status: "dismissed", resolutionNote: "Không vi phạm" });
    expect(resolveFeedReportSchema.safeParse(dismissed).success).toBe(true);
  });

  it("không sửa nháp đầu vào", () => {
    const input = draft({ decision: "dismissed", action: "hide_post", note: "  x " });
    const copy = { ...input };
    expect(buildResolveBody(input)).toStrictEqual({ status: "dismissed", resolutionNote: "x" });
    expect(input).toEqual(copy);
  });
});

describe("reportActionNeedsConfirm — chỉ hành động không hoàn tác được mới đòi tick", () => {
  it("`delete_target` ⇒ true; ba hành động còn lại ⇒ false", () => {
    expect(reportActionNeedsConfirm("delete_target")).toBe(true);
    expect(
      (["none", "hide_post", "lock_comments"] as const).map((a) => reportActionNeedsConfirm(a)),
    ).toEqual([false, false, false]);
  });
});

/** Chữ VIẾT TAY theo bảng «Theo targetType» của plan §3 L2. */
const EXPECTED_LABELS: Record<FeedTargetTypeDto, ReadonlyArray<[FeedReportActionDto, string]>> = {
  post: [
    ["none", "Không kèm hành động"],
    ["hide_post", "Ẩn bài"],
    ["lock_comments", "Khoá bình luận của bài"],
    ["delete_target", "Xoá bài"],
  ],
  comment: [
    ["none", "Không kèm hành động"],
    ["lock_comments", "Khoá bình luận của bài chứa bình luận này"],
    ["delete_target", "Xoá bình luận này"],
  ],
};

describe("reportActionOptions — lựa chọn + NHÃN theo loại đích (i18n thật)", () => {
  it.each(["post", "comment"] as const)(
    "đích %s: đúng tập lựa chọn, đúng thứ tự, đúng chữ",
    (targetType) => {
      const options = reportActionOptions(targetType);
      expect(options.map((o) => [o.action, text(o.labelKey)])).toEqual(EXPECTED_LABELS[targetType]);
      // Lựa chọn = đúng hàng ma trận (không nhiều hơn ⇒ 422, không ít hơn ⇒ thiếu chức năng).
      expect(options.map((o) => o.action)).toEqual([...REPORT_ACTION_MATRIX[targetType]]);
    },
  );

  it("đích `comment` KHÔNG có lựa chọn `hide_post`; đích `post` có", () => {
    expect(reportActionOptions("post").map((o) => o.action)).toContain("hide_post");
    expect(reportActionOptions("comment").map((o) => o.action)).not.toContain("hide_post");
    expect(Object.hasOwn(REPORT_ACTION_LABEL_KEYS.comment, "hide_post")).toBe(false);
  });

  it.each(["lock_comments", "delete_target"] as const)(
    "hai loại đích KHÔNG dùng chung nhãn `%s` (khoá khác VÀ chữ khác)",
    (action) => {
      const postKey = REPORT_ACTION_LABEL_KEYS.post[action];
      const commentKey = REPORT_ACTION_LABEL_KEYS.comment[action];
      expect(typeof postKey).toBe("string");
      expect(typeof commentKey).toBe("string");
      expect(postKey).not.toBe(commentKey);
      expect(text(postKey ?? "")).not.toBe(text(commentKey ?? ""));
    },
  );

  it("nhãn `lock_comments` của đích bình luận nói rõ là khoá bình luận của BÀI chứa nó", () => {
    const label = text(REPORT_ACTION_LABEL_KEYS.comment.lock_comments ?? "");
    expect(label).toMatch(/bài chứa bình luận này/i);
  });

  it("MỌI khoá trong bảng nhãn trỏ tới chữ THẬT (≠ khoá thô) và nằm dưới `admin.moderation.`", () => {
    const keys = [
      ...Object.values(REPORT_ACTION_LABEL_KEYS.post),
      ...Object.values(REPORT_ACTION_LABEL_KEYS.comment),
      ...Object.values(REPORT_DELETE_CONFIRM_KEYS),
    ];
    expect(keys).toHaveLength(9);
    for (const key of keys) {
      expect(key.startsWith("admin.moderation.")).toBe(true);
      expect(text(key)).not.toBe(key);
      expect(text(key)).not.toContain("admin.moderation");
      expect(text(key).trim().length).toBeGreaterThan(3);
    }
  });
});

describe("REPORT_DELETE_CONFIRM_KEYS — chữ ô tick xác nhận xoá theo loại đích", () => {
  it("đích `post`: nói BÀI sẽ bị xoá + chưa có màn khôi phục", () => {
    expect(text(REPORT_DELETE_CONFIRM_KEYS.post)).toBe(
      "Tôi hiểu bài sẽ bị xoá; hiện chưa có màn khôi phục",
    );
  });

  it("đích `comment`: nói BÌNH LUẬN sẽ bị xoá + chưa có màn khôi phục", () => {
    expect(text(REPORT_DELETE_CONFIRM_KEYS.comment)).toBe(
      "Tôi hiểu bình luận sẽ bị xoá; hiện chưa có màn khôi phục",
    );
  });

  it("hai loại đích KHÔNG dùng chung chữ tick", () => {
    expect(REPORT_DELETE_CONFIRM_KEYS.post).not.toBe(REPORT_DELETE_CONFIRM_KEYS.comment);
    expect(text(REPORT_DELETE_CONFIRM_KEYS.post)).not.toBe(
      text(REPORT_DELETE_CONFIRM_KEYS.comment),
    );
    expect(text(REPORT_DELETE_CONFIRM_KEYS.post)).toMatch(/bài sẽ bị xoá/);
  });
});
