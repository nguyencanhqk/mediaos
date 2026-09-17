// @vitest-environment jsdom
/**
 * S15-PAYROLL-DEBT-1 — khe `children` của `ConfirmDialog` (tuỳ chọn): có ⇒ thân hộp là children; vắng ⇒
 * thân giữ như cũ (tiêu đề sr-only). Nút xác nhận/huỷ + khoá khi `busy` không đổi.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

const base = {
  open: true,
  title: "Hoàn tất đợt?",
  confirmLabel: "Hoàn tất",
  cancelLabel: "Huỷ",
};

describe("ConfirmDialog", () => {
  it("có children ⇒ render children trong thân hộp; bấm xác nhận gọi onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog {...base} onConfirm={onConfirm} onCancel={vi.fn()}>
        <label>
          <input type="checkbox" /> Xác nhận đã chi tất cả
        </label>
      </ConfirmDialog>,
    );
    expect(screen.getByLabelText("Xác nhận đã chi tất cả")).toBeInTheDocument();
    expect(screen.queryByText(base.title, { selector: "span.sr-only" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tất" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("vắng children ⇒ thân giữ tiêu đề sr-only như cũ", () => {
    render(<ConfirmDialog {...base} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(base.title, { selector: "span.sr-only" })).toBeInTheDocument();
  });

  it("busy ⇒ khoá cả hai nút, hiện busyLabel", () => {
    render(
      <ConfirmDialog {...base} busy busyLabel="Đang xử lý…" onConfirm={vi.fn()} onCancel={vi.fn()}>
        <p>thân</p>
      </ConfirmDialog>,
    );
    expect(screen.getByRole("button", { name: "Đang xử lý…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Huỷ" })).toBeDisabled();
  });
});
