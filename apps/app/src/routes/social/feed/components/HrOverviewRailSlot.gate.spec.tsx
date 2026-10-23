/**
 * S16-SOCIAL-FE-3C (L7) · S4-DASH-HROVERVIEW-FE-1 — phép AND bốn vế của `HrOverviewRailSlot` (ba cặp đúng-bằng +
 * phạm vi `read:employee` ≥ sàn của widget), đo với widget GIẢ.
 *
 * `HrOverviewRailSlot.spec.tsx` chạy `HrOverviewWidget` THẬT, mà widget thật có cổng riêng bên trong
 * (`PermissionGate(read:employee)`, nhận wildcard). Ở ca «thiếu `read:employee`» của file đó, bỏ vế `read:employee`
 * khỏi slot thì cổng trong vẫn chặn ⇒ ca vẫn xanh; vế ấy ở đó chỉ treo trên MỘT hàng wildcard («DENY-W»).
 *
 * File này thay widget bằng một khối đánh dấu KHÔNG có cổng nào: thứ duy nhất quyết định «mount hay không» là phép
 * AND của slot ⇒ mỗi vế được ghim bằng ca DENY TRẦN của chính nó (đủ các vế còn lại, thiếu đúng vế đang đo) — không
 * nhờ cổng trong của widget, không nhờ luật wildcard.
 *
 * Chỉ đo QUYẾT ĐỊNH mount và thứ slot truyền xuống widget. Hành vi của ô thật (số lời gọi, wildcard từng cặp, trạng
 * thái tải / lỗi / rỗng) ở `HrOverviewRailSlot.spec.tsx`; đường nối vỏ ↔ slot ở `../SocialPortalShell.hr-widget.spec.tsx`.
 * Quyền là chuỗi cặp engine viết tay — fixture, không phải mã sản phẩm.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataScope } from "@mediaos/web-core";
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

/**
 * ĐỦ ba cặp của cổng. Cặp đọc hồ sơ thì MỌI vai chuẩn đều giữ — vế phân biệt là PHẠM VI của nó (vế thứ tư).
 * Quyền / phạm vi là chuỗi viết tay — fixture, không phải mã sản phẩm.
 */
const THREE_PAIRS: Record<string, boolean> = {
  "view:feed": true,
  "read:dashboard": true,
  "read:employee": true,
};
/** Người giữ `read:employee` @Department — mức THẤP NHẤT còn được thấy ô (SPEC-07 §14.8). */
const AT_FLOOR = { "read:employee": ["Department"] } as const;
/** Quản lý: `read:employee` @Team — dưới sàn. */
const BELOW_FLOOR = { "read:employee": ["Team"] } as const;

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
  it("ALLOW: đủ ba cặp + `read:employee` ở đúng sàn ⇒ slot mount đúng widget, không truyền prop nào (không `dashboardType` — plan D16)", () => {
    setCaps(THREE_PAIRS, AT_FLOOR);
    const { container } = render(<HrOverviewRailSlot />);
    expect(observe(container)).toEqual(MOUNTED);
    // Props RỖNG: slot không suy vai người xem thành loại dashboard.
    expect(widgetRender).toHaveBeenLastCalledWith({});
  });

  it.each<[string, Record<string, boolean>, Record<string, readonly DataScope[]>]>([
    ["thiếu `view:feed`", { "read:dashboard": true, "read:employee": true }, AT_FLOOR],
    ["thiếu `read:dashboard`", { "view:feed": true, "read:employee": true }, AT_FLOOR],
    [
      "thiếu cặp `read:employee` (phạm vi vẫn ở sàn)",
      { "view:feed": true, "read:dashboard": true },
      AT_FLOOR,
    ],
    ["phạm vi `read:employee` dưới sàn (@Team)", THREE_PAIRS, BELOW_FLOOR],
    [
      "phạm vi `read:employee` dưới sàn (@Team) dù CÓ `update:employee` — vế cũ không còn mở cổng",
      { ...THREE_PAIRS, "update:employee": true },
      BELOW_FLOOR,
    ],
    ["không có phạm vi nào cho `read:employee`", THREE_PAIRS, {}],
  ])("DENY · %s ⇒ slot không mount widget, không vẽ gì", (_label, caps, scopes) => {
    setCaps(caps, scopes);
    const { container } = render(<HrOverviewRailSlot />);
    expect(observe(container)).toEqual(NOTHING);
  });
});
