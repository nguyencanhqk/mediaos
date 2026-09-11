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

/**
 * S17-CHAT-UX2-FE-5 — ba bổ sung cho drawer chat (DEC-026), viết ở đây vì cả ba là hợp đồng của
 * primitive dùng chung, không phải của riêng CHAT.
 *
 * Hai ca Esc dưới đây là ca HỒI QUY cho MỌI consumer của `Sheet` (TaskDetailDrawer, đặt phòng…): trước
 * FE-5, `Sheet` đóng ngay cả khi con đã xử lý xong phím đó.
 */
describe("Sheet — nhường Esc cho VIỆC ĐANG DỞ bên trong", () => {
  it("dấu nằm NGOÀI mọi lớp modal (thuộc trang nền) → Esc KHÔNG đóng sheet", () => {
    const onClose = vi.fn();
    render(
      <>
        {/* NGOÀI panel — cố ý: ở `/chat` mốc 2 cột, dải "đang trả lời" nằm ở cột hội thoại, còn Sheet
            là bảng thông tin phòng. Sheet vẫn phải nhường. */}
        <div data-escape-claim="open" />
        <Sheet open onClose={onClose} title="T">
          <p>Nội dung</p>
        </Sheet>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dấu nằm trong một Sheet KHÁC → Esc VẪN đóng sheet này (không nuốt xuyên tính năng)", () => {
    /*
     * `Sheet` là primitive dùng chung (chi tiết công việc · đặt phòng · drawer chat…). Nếu vế nhường
     * Esc quét toàn tài liệu không điều kiện thì một trạng thái đang-dở của tính năng A (ví dụ đang
     * soạn câu trả lời trong drawer chat) sẽ nuốt phím Esc của panel thuộc tính năng B — người dùng
     * bấm Esc và KHÔNG có gì xảy ra, không dấu vết nào để lần.
     */
    const onClose = vi.fn();
    render(
      <>
        {/* Lớp modal KHÁC, mang dấu bên trong nó. */}
        <div role="dialog" aria-modal="true">
          <span data-escape-claim="open" />
        </div>
        <Sheet open onClose={onClose} title="Panel của tính năng khác">
          <p>Nội dung</p>
        </Sheet>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dấu nằm TRONG panel của chính mình → Esc KHÔNG đóng", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="T">
        <span data-escape-claim="open" />
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG: dấu đã gỡ (data-escape-claim khác 'open') → Esc đóng lại bình thường", () => {
    const onClose = vi.fn();
    render(
      <>
        <div data-escape-claim="closed" />
        <Sheet open onClose={onClose} title="T">
          <p>Nội dung</p>
        </Sheet>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("con đã preventDefault() phím Esc → Esc KHÔNG đóng sheet", () => {
    const onClose = vi.fn();
    // Đăng ký TRƯỚC khi render ⇒ listener này chạy trước listener của Sheet, đúng như một component con
    // mount trước. (`defaultPrevented` là dây an toàn thứ HAI — nó bắt được con xử Esc mà không để lại
    // dấu DOM nào; vế không-phụ-thuộc-thứ-tự là `data-escape-claim` ở hai ca trên.)
    const claimEscape = (e: KeyboardEvent): void => {
      if (e.key === "Escape") e.preventDefault();
    };
    document.addEventListener("keydown", claimEscape);
    try {
      render(
        <Sheet open onClose={onClose} title="T">
          <p>Nội dung</p>
        </Sheet>,
      );
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", claimEscape);
    }
  });
});

describe("Sheet — leading · bodyClassName · closeOnBackdrop", () => {
  it("leading render TRƯỚC khối tiêu đề (nút ‹ không được nằm cạnh nút đóng)", () => {
    render(
      <Sheet
        open
        onClose={vi.fn()}
        title="Nhóm Kế toán"
        leading={<button data-testid="back">‹</button>}
      >
        <p>Nội dung</p>
      </Sheet>,
    );

    const back = screen.getByTestId("back");
    const heading = screen.getByRole("heading", { name: "Nhóm Kế toán" });
    // `DOCUMENT_POSITION_FOLLOWING` = `heading` đứng SAU `back` trong thứ tự tài liệu.
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Và nó KHÔNG nằm trong cụm nút phải (nơi có ✕).
    expect(screen.getByTestId("sheet-close").parentElement).not.toContainElement(back);
  });

  it("bodyClassName đè được padding mặc định của thân", () => {
    render(
      <Sheet open onClose={vi.fn()} title="T" bodyClassName="p-0">
        <p data-testid="body-child">Nội dung</p>
      </Sheet>,
    );
    const body = screen.getByTestId("body-child").parentElement!;
    expect(body.className).toContain("p-0");
    expect(body.className).not.toContain("px-5");
    expect(body.className).not.toContain("py-4");
  });

  it("bodyClassName đè được OVERFLOW mặc định (nhóm xung đột của tailwind-merge)", () => {
    // Ca RIÊNG cho overflow: `p-0` đè padding là nhóm dễ, còn `overflow-hidden` đè `overflow-y-auto`
    // dựa vào `conflictingClassGroups.overflow` của tailwind-merge. Một lần nâng version đổi bảng đó
    // là drawer chat có hai thanh cuộn lồng nhau — hỏng im lặng, không có gì đỏ.
    render(
      <Sheet open onClose={vi.fn()} title="T" bodyClassName="overflow-hidden">
        <p data-testid="body-child">Nội dung</p>
      </Sheet>,
    );
    const body = screen.getByTestId("body-child").parentElement!;
    expect(body.className).toContain("overflow-hidden");
    expect(body.className).not.toContain("overflow-y-auto");
  });

  it("closeOnBackdrop=false ⇒ bấm nền KHÔNG đóng, nhưng ✕ vẫn đóng", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet open onClose={onClose} title="T" closeOnBackdrop={false}>
        <p>Nội dung</p>
      </Sheet>,
    );

    fireEvent.click(container.querySelector('[role="presentation"]')!);
    expect(onClose).not.toHaveBeenCalled();

    // ĐỐI CHỨNG trong CÙNG một ca: nếu `false` khoá luôn cả nút đóng thì panel thành cái bẫy.
    fireEvent.click(screen.getByTestId("sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ĐỐI CHỨNG: mặc định (không truyền) ⇒ bấm nền VẪN đóng", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet open onClose={onClose} title="T">
        <p>Nội dung</p>
      </Sheet>,
    );
    fireEvent.click(container.querySelector('[role="presentation"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
