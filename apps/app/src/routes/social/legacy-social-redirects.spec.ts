/**
 * S16-SOCIAL-FE-2B (owner ký O2) · S16-SOCIAL-FE-3 — ca N1: link NOTI `/social/*` chuyển sang portal
 * `/feed/*`.
 *
 * File này đo DỮ LIỆU + hàm `beforeLoad`: đích, tham số, `replace`, và phủ ĐÚNG các template NOTI đang
 * sinh link. Vế «route đã được dựng từ đúng hằng và đã lắp vào `rootRoute.addChildren`» đo ở
 * `social-wiring.spec.ts` (ca W3, đọc nguồn `router.tsx`) — kho không có spec nào dựng cây route thật.
 */
import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import {
  LEGACY_SOCIAL_GROUP_REDIRECT,
  LEGACY_SOCIAL_POST_REDIRECT,
  LEGACY_SOCIAL_REDIRECTS,
  LEGACY_SOCIAL_REPORTS_REDIRECT,
  legacyRedirectBeforeLoad,
  type LegacySocialRedirect,
} from "./legacy-social-redirects";

/** Template link của NOTI SOCIAL (migration 0581) đã có route FE đích. Viết tay. */
const NOTI_TEMPLATES_COVERED = [
  "/social/groups/{group_id}",
  "/social/posts/{post_id}",
  "/social/reports",
];

/** Hai mục MANG tham số — viết tay, không lọc từ mảng sản phẩm (mảng thiếu mục thì ca vẫn chạy đủ). */
const WITH_PARAM = [LEGACY_SOCIAL_GROUP_REDIRECT, LEGACY_SOCIAL_POST_REDIRECT] as const;

interface RedirectOptions {
  to?: unknown;
  params?: unknown;
  replace?: unknown;
}

function redirectThrownBy(entry: LegacySocialRedirect, params: Record<string, string>) {
  let thrown: unknown;
  try {
    legacyRedirectBeforeLoad(entry)({ params });
  } catch (e) {
    thrown = e;
  }
  expect(isRedirect(thrown), "beforeLoad KHÔNG ném redirect").toBe(true);
  return (thrown as { options: RedirectOptions }).options;
}

describe("N1 — chuyển hướng link NOTI cũ", () => {
  it("phủ ĐÚNG ba template NOTI (nhóm + bài + báo cáo vi phạm), mỗi cái một mục", () => {
    expect(LEGACY_SOCIAL_REDIRECTS.map((r) => r.notiTemplate).sort()).toEqual(
      [...NOTI_TEMPLATES_COVERED].sort(),
    );
    expect(LEGACY_SOCIAL_REDIRECTS).toHaveLength(3);
  });

  it.each(WITH_PARAM)("CÓ tham số — $path ⇒ $to, giữ tham số, replace", (entry) => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const opts = redirectThrownBy(entry, { [entry.param]: id });
    expect(opts.to).toBe(entry.to);
    expect(opts.params).toEqual({ [entry.param]: id });
    expect(opts.replace).toBe(true);
  });

  it.each(WITH_PARAM)(
    "CÓ tham số — $path mà router không trao tham số ⇒ vẫn chuyển hướng, tham số là chuỗi rỗng (không `undefined`)",
    (entry) => {
      const opts = redirectThrownBy(entry, {});
      expect(opts.to).toBe(entry.to);
      expect(opts.params).toEqual({ [entry.param]: "" });
      expect(opts.replace).toBe(true);
    },
  );

  it("`kind` lạ lọt qua kiểu (dữ liệu ép kiểu) ⇒ NÉM lỗi có tên file, không lặng lẽ chuyển hướng bừa", () => {
    const alien = {
      kind: "comment",
      path: "/social/x",
      to: "/feed",
    } as unknown as LegacySocialRedirect;
    let thrown: unknown;
    try {
      legacyRedirectBeforeLoad(alien)({ params: {} });
    } catch (e) {
      thrown = e;
    }
    expect(isRedirect(thrown)).toBe(false);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("[legacy-social-redirects] kind chưa xử lý");
  });

  it("KHÔNG tham số — `/social/reports` ⇒ `/feed/moderation`, replace, không mang `params`", () => {
    const opts = redirectThrownBy(LEGACY_SOCIAL_REPORTS_REDIRECT, {});
    expect(opts.to).toBe("/feed/moderation");
    expect(opts.replace).toBe(true);
    expect(opts).not.toHaveProperty("params");
  });

  it("KHÔNG tham số — tham số lạ trên đường cũ không được chép sang đích", () => {
    const opts = redirectThrownBy(LEGACY_SOCIAL_REPORTS_REDIRECT, { postId: "x", groupId: "y" });
    expect(opts.to).toBe("/feed/moderation");
    expect(opts).not.toHaveProperty("params");
  });

  it("hằng có tên KHÔNG ghép chéo: nhóm → nhóm, bài → bài, báo cáo → kiểm duyệt (router đọc `path` từ chính hằng)", () => {
    expect(LEGACY_SOCIAL_GROUP_REDIRECT).toMatchObject({
      kind: "group",
      path: "/social/groups/$groupId",
      to: "/feed/groups/$groupId",
      param: "groupId",
    });
    expect(LEGACY_SOCIAL_POST_REDIRECT).toMatchObject({
      kind: "post",
      path: "/social/posts/$postId",
      to: "/feed/posts/$postId",
      param: "postId",
    });
    expect(LEGACY_SOCIAL_REPORTS_REDIRECT).toMatchObject({
      kind: "reports",
      path: "/social/reports",
      to: "/feed/moderation",
      notiTemplate: "/social/reports",
    });
    expect(LEGACY_SOCIAL_REPORTS_REDIRECT).not.toHaveProperty("param");
  });

  it("đường cũ dưới `/social/…`, đích dưới `/feed/…` (không đè route SSO `/social` khớp đúng)", () => {
    for (const r of LEGACY_SOCIAL_REDIRECTS) {
      expect(r.path.startsWith("/social/")).toBe(true);
      expect(r.to.startsWith("/feed/")).toBe(true);
    }
  });
});
