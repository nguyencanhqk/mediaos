/**
 * S7-CHAT-FE-5 — `useConsoleNavItems`: lối vào đọc-vượt CHAT chỉ hiện với cặp khớp CHÍNH XÁC.
 *
 * Cả sidebar (`root-layout` → `AppShell`) lẫn launcher (`home`) đọc hook này, nên một ca ở đây khoá được
 * cả hai. Trước WO này `NAV_ITEMS` là hằng tĩnh và `NavItem.permission` không được ai đọc trên đường
 * render của console — tức khai `permission` rồi tin là đã gate sẽ cho ra một cổng không tồn tại.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@mediaos/web-core";
import { NAV_ITEMS, useConsoleNavItems } from "./nav";

const OVERSIGHT_IDS = ["chatOversight", "chatOversightAudit"];

function idsOf(items: readonly { id: string }[]) {
  return items.map((i) => i.id);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

beforeEach(() => setCaps({}));

describe("useConsoleNavItems — cổng cho mục nav nhạy cảm", () => {
  it("không có quyền → 2 mục đọc-vượt bị ẩn, mọi mục khác giữ nguyên", () => {
    const { result } = renderHook(() => useConsoleNavItems());
    const ids = idsOf(result.current);

    for (const id of OVERSIGHT_IDS) expect(ids).not.toContain(id);
    expect(result.current).toHaveLength(NAV_ITEMS.length - OVERSIGHT_IDS.length);
  });

  it("[crown-deny-path] caps `*:*` → VẪN ẩn (đây là chỗ `useCan` sẽ mở nhầm)", () => {
    setCaps({ "*:*": true });
    const ids = idsOf(renderHook(() => useConsoleNavItems()).result.current);
    for (const id of OVERSIGHT_IDS) expect(ids).not.toContain(id);
  });

  it.each([["view:*"], ["*:chat-oversight"]])("[crown-deny-path] caps `%s` → VẪN ẩn", (cap) => {
    setCaps({ [cap]: true });
    const ids = idsOf(renderHook(() => useConsoleNavItems()).result.current);
    for (const id of OVERSIGHT_IDS) expect(ids).not.toContain(id);
  });

  it("caps `view:chat-oversight` khớp chính xác → hiện đủ 2 mục", () => {
    setCaps({ "view:chat-oversight": true });
    const ids = idsOf(renderHook(() => useConsoleNavItems()).result.current);
    for (const id of OVERSIGHT_IDS) expect(ids).toContain(id);
    expect(ids).toHaveLength(NAV_ITEMS.length);
  });

  it("FAIL-CLOSED: mọi mục khai `permission` đều phải có vị từ trong hook (không có = bị ẩn)", () => {
    // Ca này bắt lỗi "thêm mục có quyền nhưng quên thêm dòng useCanExact": mục đó sẽ biến mất với MỌI
    // tài khoản. Ẩn nhầm nhìn thấy được ngay; hiện nhầm thì không.
    setCaps({ "view:chat-oversight": true });
    const ids = idsOf(renderHook(() => useConsoleNavItems()).result.current);
    const gated = NAV_ITEMS.filter((i) => i.permission !== undefined).map((i) => i.id);
    expect(gated.sort()).toEqual([...OVERSIGHT_IDS].sort());
    for (const id of gated) expect(ids).toContain(id);
  });
});
