import {
  feedReportActionSchema,
  feedTargetTypeSchema,
  resolveFeedReportSchema,
  type FeedReportActionDto,
} from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import {
  REPORT_ACTION_MATRIX,
  canPerformReportAction,
  isReportActionValidForTarget,
} from "./social-report-actions";
import { SOCIAL_REPORT_ACTION_PAIRS } from "./social-route-pairs.const";
import type { SocialActor } from "./social.types";

/**
 * S16-SOCIAL-BE-3A — luật thuần của hành động kèm `029`: refine D1 · ma trận D2 · bảng cặp D4.
 * VÉT CẠN trên enum của contracts (không liệt kê tay) — thêm một giá trị enum mà quên dạy luật thì
 * ca «bảng phủ đủ enum» đỏ.
 */

const ACTIONS = feedReportActionSchema.options;
const TARGETS = feedTargetTypeSchema.options;

const actor = (canManagePosts: boolean): SocialActor =>
  ({ canManagePosts, canManageNews: false, canManageGroups: false }) as SocialActor;

describe("D1 — resolveFeedReportSchema", () => {
  it("vắng action ⇒ mặc định 'none' (client cũ không gãy)", () => {
    expect(resolveFeedReportSchema.parse({ status: "resolved" }).action).toBe("none");
    expect(resolveFeedReportSchema.parse({ status: "dismissed" }).action).toBe("none");
  });

  it.each(ACTIONS.filter((a) => a !== "none"))("dismissed + %s ⇒ từ chối", (action) => {
    expect(resolveFeedReportSchema.safeParse({ status: "dismissed", action }).success).toBe(false);
  });

  it.each(ACTIONS)("resolved + %s ⇒ nhận", (action) => {
    expect(resolveFeedReportSchema.safeParse({ status: "resolved", action }).success).toBe(true);
  });

  it("action lạ ⇒ từ chối; khoá lạ ⇒ từ chối (strict)", () => {
    expect(resolveFeedReportSchema.safeParse({ status: "resolved", action: "ban" }).success).toBe(
      false,
    );
    expect(resolveFeedReportSchema.safeParse({ status: "resolved", extra: 1 }).success).toBe(false);
  });
});

describe("D2 — ma trận hành động × loại đích", () => {
  it("phủ ĐÚNG mọi loại đích của enum contracts", () => {
    expect(Object.keys(REPORT_ACTION_MATRIX).sort()).toEqual([...TARGETS].sort());
  });

  const expected: Record<string, Record<FeedReportActionDto, boolean>> = {
    post: { none: true, hide_post: true, lock_comments: true, delete_target: true },
    comment: { none: true, hide_post: false, lock_comments: true, delete_target: true },
  };

  for (const t of TARGETS) {
    for (const a of ACTIONS) {
      it(`${t} × ${a} ⇒ ${expected[t][a]}`, () => {
        expect(isReportActionValidForTarget(t, a)).toBe(expected[t][a]);
      });
    }
  }
});

describe("D4 — SOCIAL_REPORT_ACTION_PAIRS + canPerformReportAction", () => {
  it("bảng phủ ĐÚNG mọi hành động của enum contracts", () => {
    expect(Object.keys(SOCIAL_REPORT_ACTION_PAIRS).sort()).toEqual([...ACTIONS].sort());
  });

  it("CHỈ `none` không đòi cặp thêm; ba hành động còn lại đòi manage:feed-post", () => {
    for (const a of ACTIONS) {
      const pair = SOCIAL_REPORT_ACTION_PAIRS[a];
      if (a === "none") expect(pair).toBeNull();
      else expect(pair).toEqual({ action: "manage", resourceType: "feed-post", isSensitive: false });
    }
  });

  it.each(ACTIONS)("%s: có manage:feed-post ⇒ được", (a) => {
    expect(canPerformReportAction(actor(true), a)).toBe(true);
  });

  it.each(ACTIONS)("%s: KHÔNG manage:feed-post ⇒ chỉ `none` được", (a) => {
    expect(canPerformReportAction(actor(false), a)).toBe(a === "none");
  });

  it("cờ phụ KHÁC (canManageNews/Groups) KHÔNG mở cửa hành động kiểm duyệt", () => {
    const other = {
      canManagePosts: false,
      canManageNews: true,
      canManageGroups: true,
    } as SocialActor;
    for (const a of ACTIONS.filter((x) => x !== "none")) {
      expect(canPerformReportAction(other, a)).toBe(false);
    }
  });
});
