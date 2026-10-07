/**
 * S16-SOCIAL-FE-3C (L6 · finding CRC-02 của gate code-review) — dải VẼ theo cổng của registry ĐANG NẠP, không theo
 * một cổng viết tay ở tầng component (`done_when`: «lấy từ `APP_REGISTRY` theo quyền, không hard-code»).
 *
 * `QuickLinkStrip.spec.tsx` đo bằng `APP_REGISTRY` thật, nên một cổng viết tay TRÙNG giá trị registry hôm nay (vd
 * đọc `view:social-post` từ store quanh ô «Đăng bài Facebook») qua được mọi ca ở đó. File này thay `APP_REGISTRY`
 * mà component import bằng BẢN SAO: cả bảy app của dải đổi cổng sang một cặp KHÔNG có ở registry thật
 * (`zz:quick-link-<appKey>`). Mọi thứ khác của web-core giữ nguyên — store, checker khớp đúng-bằng, `getVisibleApps`.
 *  · DENY: đủ MỌI cặp registry thật đòi + cặp mới của sáu ô kia ⇒ thiếu đúng ô đang đo (dải vẫn sống với sáu ô);
 *  · ALLOW: CHỈ cặp mới của ô đó, không cặp cũ nào ⇒ đúng một ô. Cổng viết tay đứng THÊM vào cổng registry đỏ ở đây.
 * Vế thuần (bộ chọn đọc cổng từ registry được truyền vào, cả cổng một-cặp lẫn đủ-cả-hai) ở `lib/quick-links.spec.ts`.
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY. Quyền là chuỗi cặp viết tay — fixture, không phải mã sản phẩm.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { resetCaps, setCaps } from "../social-test-doubles";
import { QuickLinkStrip } from "./QuickLinkStrip";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  const stripKeys = ["tasks", "leave", "attendance", "rooms", "goals", "lms", "fbpost"];
  return {
    ...actual,
    APP_REGISTRY: actual.APP_REGISTRY.map((app) => {
      if (!stripKeys.includes(app.appKey)) return app;
      // Gỡ CẢ HAI trường cổng cũ rồi mới đặt cổng mới (`rooms` vốn khai `requiredPermissions`).
      const { requiredPermissions: _all, requiredAnyPermissions: _any, ...ungated } = app;
      return { ...ungated, requiredAnyPermissions: [`zz:quick-link-${app.appKey}`] };
    }),
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
  };
});

const STRIP = "Liên kết nhanh";

/** Bảy ô theo thứ tự SC-14: `appKey` (để dựng cặp mới) + tên NHÌN THẤY viết tay. */
const TILES: ReadonlyArray<[appKey: string, name: string]> = [
  ["tasks", "Công việc"],
  ["leave", "Nghỉ phép"],
  ["attendance", "Chấm công"],
  ["rooms", "Phòng họp"],
  ["goals", "Mục tiêu"],
  ["lms", "Đào tạo"],
  ["fbpost", "Đăng bài Facebook"],
];

const newPair = (appKey: string): string => `zz:quick-link-${appKey}`;
const capsOf = (pairs: readonly string[]): Record<string, boolean> =>
  Object.fromEntries(pairs.map((pair) => [pair, true]));

/** MỌI cặp registry THẬT đòi cho bảy app (+ `view:feed`) — với bản sao ở file này chúng không mở ô nào. */
const OLD_CAPS = capsOf([
  "view:feed",
  "read:task",
  "view-own:leave",
  "view-own:attendance",
  "access:room",
  "view:room",
  "access:goal",
  "access:lms",
  "view:social-post",
]);

const renderStrip = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <QuickLinkStrip />
    </I18nextProvider>,
  );

/** Chữ NHÌN THẤY của từng ô, theo thứ tự vẽ. Ném nếu dải không có mặt. */
const visibleNames = (): string[] =>
  within(screen.getByRole("navigation", { name: STRIP }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");

afterEach(() => {
  cleanup();
  resetCaps();
});

describe("tiền đề — registry mà dải đang nạp đã đổi cổng của cả bảy app", () => {
  it("DENY: đủ MỌI cặp registry thật đòi, không cặp mới nào ⇒ 0 ô, dải không render", () => {
    setCaps(OLD_CAPS);
    const { container } = renderStrip();
    expect(container).toBeEmptyDOMElement();
  });

  it("ALLOW: đủ bảy cặp mới, KHÔNG cặp cũ nào ⇒ đủ 7 ô theo thứ tự SC-14", () => {
    setCaps(capsOf(TILES.map(([appKey]) => newPair(appKey))));
    renderStrip();
    expect(visibleNames()).toEqual(TILES.map(([, name]) => name));
  });
});

describe.each(TILES)("ô `%s` («%s») vẽ theo cổng của registry đang nạp", (appKey, name) => {
  const otherTiles = TILES.filter(([key]) => key !== appKey);

  it("DENY: mọi cặp cũ + cặp mới của sáu ô kia ⇒ KHÔNG có ô này (sáu ô kia vẫn có)", () => {
    setCaps({ ...OLD_CAPS, ...capsOf(otherTiles.map(([key]) => newPair(key))) });
    renderStrip();
    expect(visibleNames()).toEqual(otherTiles.map(([, otherName]) => otherName));
  });

  it("ALLOW: CHỈ cặp mới của ô này, không cặp cũ nào ⇒ đúng một ô", () => {
    setCaps(capsOf([newPair(appKey)]));
    renderStrip();
    expect(visibleNames()).toEqual([name]);
  });
});
