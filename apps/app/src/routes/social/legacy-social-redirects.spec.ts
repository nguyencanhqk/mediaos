/**
 * S16-SOCIAL-FE-2B (owner ký O2) — ca N1: link NOTI `/social/*` chuyển sang portal `/feed/*`.
 *
 * ⚠️ Giới hạn đã biết: kho không có spec nào dựng cây route thật (0 hit `createMemoryHistory`), nên ca
 * này KHÔNG chứng minh hai route đã được trải vào `routeTree.addChildren` ở `router.tsx` — vế đó kiểm
 * bằng tay khi chạy app (ghi trong PR). Ca ở đây giữ: đích + tham số + `replace`, và phủ ĐÚNG các
 * template NOTI đang sinh link hỏng.
 */
import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { LEGACY_SOCIAL_REDIRECTS, legacyRedirectBeforeLoad } from "./legacy-social-redirects";

/** Template link của NOTI SOCIAL (migration 0581) có route FE đích trong lát này. */
const NOTI_TEMPLATES_COVERED = ["/social/groups/{group_id}", "/social/posts/{post_id}"];

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("beforeLoad KHÔNG ném redirect");
}

describe("N1 — chuyển hướng link NOTI cũ", () => {
  it("phủ ĐÚNG hai template NOTI (nhóm + bài), mỗi cái một mục", () => {
    expect(LEGACY_SOCIAL_REDIRECTS.map((r) => r.notiTemplate).sort()).toEqual(
      [...NOTI_TEMPLATES_COVERED].sort(),
    );
  });

  it.each(LEGACY_SOCIAL_REDIRECTS)("$path ⇒ $to, giữ tham số, replace", (entry) => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const err = thrownBy(() => legacyRedirectBeforeLoad(entry)({ params: { [entry.param]: id } }));
    expect(isRedirect(err)).toBe(true);
    const opts = (err as { options: Record<string, unknown> }).options;
    expect(opts.to).toBe(entry.to);
    expect(opts.params).toEqual({ [entry.param]: id });
    expect(opts.replace).toBe(true);
  });

  it("đường cũ dưới `/social/…`, đích dưới `/feed/…` (không đè route SSO `/social` khớp đúng)", () => {
    for (const r of LEGACY_SOCIAL_REDIRECTS) {
      expect(r.path.startsWith("/social/")).toBe(true);
      expect(r.to.startsWith("/feed/")).toBe(true);
    }
  });
});
