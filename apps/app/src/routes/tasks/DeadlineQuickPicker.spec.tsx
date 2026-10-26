import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeadlineQuickPicker, type DeadlineQuickPickerProps } from "./DeadlineQuickPicker";
import { DEFAULT_DEADLINE_PRESETS, type DeadlinePresetDefinition } from "./deadline-presets";

/**
 * S20-TASK-QUICKEDIT-1 — popover mốc hạn dùng chung. Đồng hồ truyền qua `getNow` (không đọc giờ máy),
 * múi là giờ công ty ⇒ kết quả như nhau dưới mọi TZ máy.
 */
const VN = "Asia/Ho_Chi_Minh";
// Thứ Năm 22/10/2026 10:00 giờ VN.
const THURSDAY_MORNING = new Date("2026-10-22T03:00:00.000Z");
// Thứ Năm 22/10/2026 18:00 giờ VN.
const THURSDAY_EVENING = new Date("2026-10-22T11:00:00.000Z");

function renderPicker(props: Partial<DeadlineQuickPickerProps> = {}) {
  const onSelect = vi.fn();
  render(
    <DeadlineQuickPicker
      id="dq"
      ariaLabel="Chọn hạn"
      value={null}
      onSelect={onSelect}
      timeZone={VN}
      getNow={() => THURSDAY_MORNING}
      {...props}
    />,
  );
  return onSelect;
}

const open = () => fireEvent.click(screen.getByTestId("dq"));

describe("DeadlineQuickPicker — S20-TASK-QUICKEDIT-1", () => {
  it("chưa có hạn ⇒ nút hiện «Chưa có hạn»; mở ra đủ 4 mốc 17:00 theo giờ công ty, không «Xoá hạn»", () => {
    renderPicker();
    expect(screen.getByTestId("dq")).toHaveTextContent("Chưa có hạn");
    open();
    expect(screen.getByTestId("dq-preset-today")).toHaveTextContent("Hôm nay 17:00");
    expect(screen.getByTestId("dq-preset-tomorrow")).toHaveTextContent("Ngày mai 17:00");
    expect(screen.getByTestId("dq-preset-friday")).toHaveTextContent("Thứ Sáu này 17:00");
    expect(screen.getByTestId("dq-preset-nextMonday")).toHaveTextContent("Thứ Hai tuần sau 17:00");
    expect(screen.queryByTestId("dq-clear")).not.toBeInTheDocument();
  });

  it("bấm «Thứ Sáu này» (Thứ Năm 22/10) ⇒ onSelect 23/10 17:00 VN = 10:00 UTC, popover đóng", () => {
    const onSelect = renderPicker();
    open();
    fireEvent.click(screen.getByTestId("dq-preset-friday"));
    expect(onSelect).toHaveBeenCalledWith("2026-10-23T10:00:00.000Z");
    expect(screen.queryByTestId("dq-preset-friday")).not.toBeInTheDocument();
  });

  it("sau 17:00 ⇒ «Hôm nay 23:59», không tạo việc quá hạn ngay khi đặt", () => {
    const onSelect = renderPicker({ getNow: () => THURSDAY_EVENING });
    open();
    expect(screen.getByTestId("dq-preset-today")).toHaveTextContent("Hôm nay 23:59");
    fireEvent.click(screen.getByTestId("dq-preset-today"));
    expect(onSelect).toHaveBeenCalledWith("2026-10-22T16:59:00.000Z");
  });

  it("chọn lại đúng hạn đang có ⇒ không gọi onSelect", () => {
    const onSelect = renderPicker({ value: "2026-10-23T10:00:00.000Z" });
    open();
    fireEvent.click(screen.getByTestId("dq-preset-tomorrow"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("đang có hạn ⇒ «Xoá hạn» gửi null; allowClear=false thì không có", () => {
    const onSelect = renderPicker({ value: "2026-10-23T10:00:00.000Z" });
    open();
    fireEvent.click(screen.getByTestId("dq-clear"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("allowClear=false / allowCustom=false ⇒ ẩn «Xoá hạn» và «Tuỳ chỉnh»", () => {
    renderPicker({ value: "2026-10-23T10:00:00.000Z", allowClear: false, allowCustom: false });
    open();
    expect(screen.queryByTestId("dq-clear")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dq-custom")).not.toBeInTheDocument();
  });

  it("«Tuỳ chỉnh» đọc ô ngày giờ theo giờ công ty; ngày sai lịch ⇒ báo lỗi, không gửi", () => {
    const onSelect = renderPicker();
    open();
    fireEvent.click(screen.getByTestId("dq-custom"));
    const input = screen.getByTestId("dq-custom-input");
    fireEvent.change(input, { target: { value: "2026-10-30T09:15" } });
    fireEvent.click(screen.getByTestId("dq-custom-apply"));
    expect(onSelect).toHaveBeenCalledWith("2026-10-30T02:15:00.000Z");

    open();
    fireEvent.click(screen.getByTestId("dq-custom"));
    fireEvent.change(screen.getByTestId("dq-custom-input"), { target: { value: "" } });
    fireEvent.keyDown(screen.getByTestId("dq-custom-input"), { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("Ngày giờ không hợp lệ");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("Esc trong ô Tuỳ chỉnh không lọt lên đóng panel/drawer phía ngoài", () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <DeadlineQuickPicker
          id="dq"
          ariaLabel="Chọn hạn"
          value={null}
          onSelect={vi.fn()}
          timeZone={VN}
          getNow={() => THURSDAY_MORNING}
        />
      </div>,
    );
    open();
    fireEvent.click(screen.getByTestId("dq-custom"));
    fireEvent.keyDown(screen.getByTestId("dq-custom-input"), { key: "Escape" });
    expect(outer).not.toHaveBeenCalled();
  });

  it("mốc bổ sung được qua prop `presets` (tạo nhanh / Quá hạn dùng lại)", () => {
    const noon: DeadlinePresetDefinition = {
      id: "noon",
      resolve: (ctx) => ({ localDate: ctx.today, time: "12:00", labelKey: "custom" }),
    };
    const onSelect = renderPicker({ presets: [...DEFAULT_DEADLINE_PRESETS, noon] });
    open();
    expect(screen.getByTestId("dq-preset-noon")).toHaveTextContent("12:00");
    fireEvent.click(screen.getByTestId("dq-preset-noon"));
    expect(onSelect).toHaveBeenCalledWith("2026-10-22T05:00:00.000Z");
  });

  it("disabled ⇒ không mở được", () => {
    renderPicker({ disabled: true });
    open();
    expect(screen.queryByTestId("dq-preset-today")).not.toBeInTheDocument();
  });
});
