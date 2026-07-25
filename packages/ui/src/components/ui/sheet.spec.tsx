import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./sheet";

/**
 * Sheet — a11y wiring (S5-QA-REG-1 §15.4: keyboard/ESC + role dùng chung cho mọi drawer P0
 * — TaskDetailDrawer/ProjectFormDrawer/TaskFormDrawer). `dialog.spec.tsx` đã phủ role/Esc/focus-trap
 * cho `Dialog`; `Sheet` là primitive RIÊNG (chưa có spec) và có một nhánh a11y KHÔNG có ở Dialog:
 * nhường Esc cho modal lồng bên trong (Dialog con hoặc Popover portal) — đây là trọng tâm bài test.
 */
describe("Sheet — role/aria wiring", () => {
  it("renders role=dialog + aria-modal + aria-labelledby/describedby trỏ đúng title/description", () => {
    render(
      <Sheet open onClose={vi.fn()} title="Chi tiết task" description="Dự án Alpha">
        <p>Nội dung</p>
      </Sheet>,
    );

    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("aria-modal", "true");

    const labelledby = sheet.getAttribute("aria-labelledby");
    const describedby = sheet.getAttribute("aria-describedby");
    expect(labelledby).toBeTruthy();
    expect(describedby).toBeTruthy();
    expect(document.getElementById(labelledby!)).toHaveTextContent("Chi tiết task");
    expect(document.getElementById(describedby!)).toHaveTextContent("Dự án Alpha");
  });

  it("nút đóng (icon-only, X) có accessible name", () => {
    render(
      <Sheet open onClose={vi.fn()} title="T">
        <p>Nội dung</p>
      </Sheet>,
    );
    expect(screen.getByTestId("sheet-close")).toHaveAccessibleName();
  });

  it("does not render anything when closed", () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Ẩn">
        <p>Nội dung</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Sheet — Escape đóng panel (không có modal lồng)", () => {
  it("Esc gọi onClose khi KHÔNG có dialog con / floating layer nào đang mở", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="T">
        <button>OK</button>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Sheet — nhường Esc cho modal lồng bên trong", () => {
  it("Dialog con (role=dialog aria-modal=true) đang mở TRONG panel → Esc KHÔNG đóng sheet ngoài", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="T">
        <div role="dialog" aria-modal="true">
          <p>Form sửa (dialog con)</p>
        </div>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("floating layer (Popover portal ra document.body) đang mở → Esc KHÔNG đóng sheet", () => {
    const onClose = vi.fn();
    render(
      <>
        <div data-floating-layer="open" />
        <Sheet open onClose={onClose} title="T">
          <p>Nội dung</p>
        </Sheet>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("floating layer đã đóng (data-floating-layer khác 'open') → Esc VẪN đóng sheet bình thường", () => {
    const onClose = vi.fn();
    render(
      <>
        <div data-floating-layer="closed" />
        <Sheet open onClose={onClose} title="T">
          <p>Nội dung</p>
        </Sheet>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
