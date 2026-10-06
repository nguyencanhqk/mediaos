/**
 * S16-SOCIAL-FE-3B (L4) — `BadgeFormDialog`: đóng hộp thoại (mọi đường) trả focus về nút đã mở nó.
 *
 * Bài học PR-A: phần tử kích hoạt bị gỡ khỏi DOM cùng nhịp hộp thoại mount thì `Dialog` không còn gì để trả
 * focus. Ở đây nút mở (nút của hàng / nút «Thêm huy hiệu» của trang) còn nguyên trong DOM ⇒ `Dialog` tự trả.
 * Mới đo trên jsdom — chưa ai nhìn trên trình duyệt thật.
 */
import * as React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import { makeBadgeAdmin } from "../../admin/admin-test-doubles";
import { BadgeFormDialog } from "./BadgeFormDialog";

const updateBadge = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialKudosApi: {
      ...actual.socialKudosApi,
      updateBadge: (...a: unknown[]) => updateBadge(...a),
    },
  };
});

const NAME = "Tên huy hiệu";
const dialog = (): HTMLElement => screen.getByRole("dialog");
const cancelButton = (): HTMLElement => screen.getByRole("button", { name: "Huỷ" });
const clickSave = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
};
const type = (name: string, value: string): void => {
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
};

beforeEach(() => {
  setCaps({ "view:feed": true, "manage:feed-kudos": true });
  updateBadge.mockReset();
  updateBadge.mockImplementation(() => Promise.resolve(makeBadgeAdmin({ name: "Tên mới" })));
});
afterEach(() => {
  cleanup();
  resetCaps();
});

describe("Focus — đóng hộp thoại trả focus về nút đã mở", () => {
  function Host(): React.ReactElement {
    const [target, setTarget] = React.useState<KudosBadgeAdminDto | null | undefined>(undefined);
    return (
      <>
        <button type="button" onClick={() => setTarget(makeBadgeAdmin())}>
          mở sửa
        </button>
        {target !== undefined && (
          <BadgeFormDialog
            badge={target}
            onClose={() => setTarget(undefined)}
            onOutcome={() => setTarget(undefined)}
            onStale={() => undefined}
          />
        )}
      </>
    );
  }
  const trigger = (): HTMLElement => screen.getByRole("button", { name: "mở sửa" });
  const open = (): void => {
    trigger().focus();
    fireEvent.click(trigger());
  };

  it("mở ⇒ focus vào TRONG hộp thoại; «Huỷ» ⇒ hộp thoại gỡ, focus về nút đã mở", () => {
    renderWithProviders(<Host />);
    open();
    expect(dialog()).toContainElement(document.activeElement as HTMLElement);

    fireEvent.click(cancelButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("Esc · lưu thành công ⇒ cũng trả focus về nút đã mở", async () => {
    renderWithProviders(<Host />);
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();

    open();
    type(NAME, "Tên mới");
    clickSave();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger()).toHaveFocus();
    expect(updateBadge).toHaveBeenCalledTimes(1);
  });
});
