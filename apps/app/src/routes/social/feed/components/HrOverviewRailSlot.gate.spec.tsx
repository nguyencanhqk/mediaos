/**
 * S16-SOCIAL-FE-3C (L7) — phép AND bốn vế của `HrOverviewRailSlot`, đo với widget GIẢ.
 *
 * `HrOverviewRailSlot.spec.tsx` chạy `HrOverviewWidget` THẬT, mà widget thật có cổng riêng bên trong
 * (`PermissionGate(read:employee)`, nhận wildcard). Ở ca «thiếu `read:employee`» của file đó, bỏ vế `read:employee`
 * khỏi slot thì cổng trong vẫn chặn ⇒ ca vẫn xanh; vế ấy ở đó chỉ treo trên MỘT hàng wildcard («DENY-W»).
 *
 * File này thay widget bằng một khối đánh dấu KHÔNG có cổng nào: thứ duy nhất quyết định «mount hay không» là phép
 * AND của slot ⇒ mỗi vế được ghim bằng ca DENY TRẦN của chính nó (đủ ba cặp còn lại, thiếu đúng cặp đang đo) — không
 * nhờ cổng trong của widget, không nhờ luật wildcard.
 *
 * Chỉ đo QUYẾT ĐỊNH mount và thứ slot truyền xuống widget. Hành vi của ô thật (số lời gọi, wildcard từng cặp, trạng
 * thái tải / lỗi / rỗng) ở `HrOverviewRailSlot.spec.tsx`; đường nối vỏ ↔ slot ở `../SocialPortalShell.hr-widget.spec.tsx`.
 * Quyền là chuỗi cặp engine viết tay — fixture, không phải mã sản phẩm.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCaps, setCaps } from "../social-test-doubles";
import { HrOverviewRailSlot } from "./HrOverviewRailSlot";

const { widgetRender, WIDGET_STUB_TEXT } = vi.hoisted(() => ({
  widgetRender: vi.fn(),
  WIDGET_STUB_TEXT: "widget giả — không có cổng nào",
}));

vi.mock("@/components/dashboard/HrOverviewWidget", () => ({
  HrOverviewWidget: (props: Record<string, unknown>) => {
    widgetRender(props);
    return <p>{WIDGET_STUB_TEXT}</p>;
  },
}));

/** ĐỦ bốn cặp của cổng — trong bốn vai chuẩn chỉ HR và company-admin giữ cả bốn. */
const FOUR_PAIRS: Record<string, boolean> = {
  "view:feed": true,
  "read:dashboard": true,
  "read:employee": true,
  "update:employee": true,
};

/** Thứ một lượt đo nhìn vào, gom thành MỘT object ⇒ ca đỏ in mọi cạnh cạnh nhau. */
const observe = (container: HTMLElement) => ({
  renderedNodes: container.childElementCount,
  widgetOnScreen: screen.queryByText(WIDGET_STUB_TEXT) !== null,
  widgetRenders: widgetRender.mock.calls.length > 0,
});

const NOTHING = { renderedNodes: 0, widgetOnScreen: false, widgetRenders: false };
const MOUNTED = { renderedNodes: 1, widgetOnScreen: true, widgetRenders: true };

beforeEach(() => {
  widgetRender.mockReset();
});

afterEach(() => {
  cleanup();
  resetCaps();
});

describe("phép AND của slot — mỗi vế một ca DENY trần, widget giả không có cổng trong", () => {
  it("ALLOW: đủ bốn cặp ⇒ slot mount đúng widget, không truyền prop nào (không `dashboardType` — plan D16)", () => {
    setCaps(FOUR_PAIRS);
    const { container } = render(<HrOverviewRailSlot />);
    expect(observe(container)).toEqual(MOUNTED);
    // Props RỖNG: slot không suy vai người xem thành loại dashboard.
    expect(widgetRender).toHaveBeenLastCalledWith({});
  });

  it.each<[string, Record<string, boolean>]>([
    [
      "thiếu `view:feed`",
      { "read:dashboard": true, "read:employee": true, "update:employee": true },
    ],
    [
      "thiếu `read:dashboard`",
      { "view:feed": true, "read:employee": true, "update:employee": true },
    ],
    [
      "thiếu `read:employee`",
      { "view:feed": true, "read:dashboard": true, "update:employee": true },
    ],
    [
      "thiếu `update:employee`",
      { "view:feed": true, "read:dashboard": true, "read:employee": true },
    ],
  ])("DENY · đủ ba cặp còn lại, %s ⇒ slot không mount widget, không vẽ gì", (_label, caps) => {
    setCaps(caps);
    const { container } = render(<HrOverviewRailSlot />);
    expect(observe(container)).toEqual(NOTHING);
  });
});
