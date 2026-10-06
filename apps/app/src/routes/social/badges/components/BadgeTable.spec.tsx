/**
 * S16-SOCIAL-FE-3B (L4) — bảng huy hiệu của màn `SOC-SCREEN-012`: ca F4 (vế hàng bảng vẽ icon) + hình dạng
 * hàng (đang dùng / ngừng dùng) + ba lối hành động của hàng.
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY; phần tử truy vấn bằng role + tên trợ năng. Bảng chỉ TRÌNH BÀY: lượt ghi
 * (051 / 050) và xác nhận «Ngừng dùng» là của trang — ở đây chỉ đo callback nhận ĐÚNG huy hiệu.
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";
import { renderWithProviders } from "../../feed/social-test-doubles";
import { makeBadgeAdmin } from "../../admin/admin-test-doubles";
import { BadgeTable } from "./BadgeTable";

const TABLE = "Danh sách huy hiệu vinh danh";
const COLUMNS = ["Huy hiệu", "Mã", "Mô tả", "Thứ tự", "Trạng thái", "Thao tác"];
const OTHER_ID = "99999999-9999-4999-8999-999999999999";

const active = (over: Partial<KudosBadgeAdminDto> = {}): KudosBadgeAdminDto =>
  makeBadgeAdmin({ position: 2, ...over });
const inactive = (over: Partial<KudosBadgeAdminDto> = {}): KudosBadgeAdminDto =>
  makeBadgeAdmin({
    id: OTHER_ID,
    code: "sang-tao",
    name: "Sáng tạo",
    description: null,
    icon: "lightbulb",
    position: 5,
    isActive: false,
    ...over,
  });

function renderTable(badges: KudosBadgeAdminDto[], isBusy = false) {
  const onEdit = vi.fn();
  const onDeactivate = vi.fn();
  const onReactivate = vi.fn();
  renderWithProviders(
    <BadgeTable
      badges={badges}
      isBusy={isBusy}
      onEdit={onEdit}
      onDeactivate={onDeactivate}
      onReactivate={onReactivate}
    />,
  );
  return { onEdit, onDeactivate, onReactivate };
}

const table = (): HTMLElement => screen.getByRole("table", { name: TABLE });
const rowOf = (name: string): HTMLElement => {
  const header = within(table()).getByRole("rowheader", { name });
  const row = header.closest("tr");
  if (row === null) throw new Error(`không tìm thấy hàng của «${name}»`);
  return row;
};

afterEach(() => {
  cleanup();
});

describe("hình dạng bảng", () => {
  it("(role) bảng có tên + ĐÚNG sáu `columnheader` theo thứ tự; mỗi huy hiệu một hàng có `rowheader` là tên", () => {
    renderTable([active(), inactive()]);
    expect(
      within(table())
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(COLUMNS);
    expect(
      within(table())
        .getAllByRole("rowheader")
        .map((th) => th.textContent),
    ).toEqual(["Đồng đội", "Sáng tạo"]);
  });

  it("hàng ĐANG DÙNG: mã · mô tả · thứ tự · «Đang dùng»; có «Sửa» + «Ngừng dùng», KHÔNG có «Bật lại»", () => {
    renderTable([active()]);
    const row = rowOf("Đồng đội");
    expect(
      within(row)
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(expect.arrayContaining(["team-player", "Luôn hỗ trợ đồng nghiệp", "2", "Đang dùng"]));
    expect(row).toHaveAttribute("data-active", "true");
    expect(within(row).getByRole("button", { name: "Sửa huy hiệu Đồng đội" })).toHaveTextContent(
      "Sửa",
    );
    expect(
      within(row).getByRole("button", { name: "Ngừng dùng huy hiệu Đồng đội" }),
    ).toHaveTextContent("Ngừng dùng");
    expect(within(row).queryByRole("button", { name: /Bật lại/ })).toBeNull();
  });

  it("hàng ĐÃ TẮT: pill «Ngừng dùng» ở cột trạng thái; có «Sửa» + «Bật lại», KHÔNG có nút «Ngừng dùng»", () => {
    renderTable([inactive()]);
    const row = rowOf("Sáng tạo");
    expect(row).toHaveAttribute("data-active", "false");
    expect(within(row).getByTestId("badge-status")).toHaveTextContent("Ngừng dùng");
    expect(within(row).queryByText("Đang dùng")).toBeNull();
    expect(within(row).getByRole("button", { name: "Sửa huy hiệu Sáng tạo" })).toBeEnabled();
    expect(within(row).getByRole("button", { name: "Bật lại huy hiệu Sáng tạo" })).toBeEnabled();
    expect(within(row).queryByRole("button", { name: /Ngừng dùng/ })).toBeNull();
  });

  it("`description: null` ⇒ «Chưa có mô tả» (không ô trống, không chữ `null`)", () => {
    renderTable([inactive()]);
    const row = rowOf("Sáng tạo");
    expect(within(row).getByText("Chưa có mô tả")).toBeInTheDocument();
    expect(row).not.toHaveTextContent("null");
  });
});

describe("F4 — icon của hàng", () => {
  it("tên icon trong danh mục ⇒ vẽ icon; EMOJI ⇒ vẽ CHỮ emoji đó; `null` ⇒ icon mặc định", () => {
    renderTable([
      active(),
      inactive({ icon: "🎉" }),
      makeBadgeAdmin({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Trống", icon: null }),
    ]);
    expect(within(rowOf("Đồng đội")).getByTestId("kudos-badge-icon")).toBeInTheDocument();
    const emoji = within(rowOf("Sáng tạo")).getByTestId("kudos-badge-emoji");
    expect(emoji).toHaveTextContent("🎉");
    expect(within(rowOf("Sáng tạo")).queryByTestId("kudos-badge-icon")).toBeNull();
    expect(within(rowOf("Trống")).getByTestId("kudos-badge-icon-default")).toBeInTheDocument();
  });

  it("(hồi quy) icon `constructor` / `__proto__` / `toString` KHÔNG ném — vẽ icon mặc định", () => {
    const names = ["constructor", "__proto__", "toString"];
    const badges = names.map((icon, index) =>
      makeBadgeAdmin({
        id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${index}`,
        name: `Huy hiệu ${index}`,
        icon,
      }),
    );
    expect(() => renderTable(badges)).not.toThrow();
    expect(within(table()).getAllByTestId("kudos-badge-icon-default")).toHaveLength(names.length);
  });

  it("bảng không vẽ `<img>` nào", () => {
    renderTable([active(), inactive({ icon: "🎉" })]);
    expect(table().querySelector("img")).toBeNull();
  });
});

describe("hành động của hàng", () => {
  it("«Sửa» · «Ngừng dùng» · «Bật lại» gọi callback ĐÚNG 1 lần với ĐÚNG huy hiệu của hàng", () => {
    const first = active();
    const second = inactive();
    const { onEdit, onDeactivate, onReactivate } = renderTable([first, second]);

    fireEvent.click(screen.getByRole("button", { name: "Sửa huy hiệu Sáng tạo" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(second);

    fireEvent.click(screen.getByRole("button", { name: "Ngừng dùng huy hiệu Đồng đội" }));
    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(onDeactivate).toHaveBeenCalledWith(first);

    fireEvent.click(screen.getByRole("button", { name: "Bật lại huy hiệu Sáng tạo" }));
    expect(onReactivate).toHaveBeenCalledTimes(1);
    expect(onReactivate).toHaveBeenCalledWith(second);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("`isBusy` (một lượt ghi đang bay) ⇒ «Ngừng dùng» / «Bật lại» của MỌI hàng khoá, bấm không gọi gì; «Sửa» vẫn mở", () => {
    const { onEdit, onDeactivate, onReactivate } = renderTable([active(), inactive()], true);
    const deactivate = screen.getByRole("button", { name: "Ngừng dùng huy hiệu Đồng đội" });
    const reactivate = screen.getByRole("button", { name: "Bật lại huy hiệu Sáng tạo" });
    expect(deactivate).toBeDisabled();
    expect(reactivate).toBeDisabled();
    fireEvent.click(deactivate);
    fireEvent.click(reactivate);
    expect(onDeactivate).not.toHaveBeenCalled();
    expect(onReactivate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sửa huy hiệu Đồng đội" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
