// @vitest-environment jsdom
/**
 * ForbiddenPage — a11y smoke (S5-QA-REG-1 §15.4: Screen reader / heading structure).
 *
 * Phủ: có đúng MỘT <h1> heading · message đổi đúng theo `reason` enum (route guard truyền vào,
 * xem beforeLoad ở router.tsx) · reason lạ/thiếu → rơi về mô tả mặc định (KHÔNG throw/crash) ·
 * action "Về trang chủ" có accessible name (link, không phải icon trần).
 *
 * `Link` (tanstack/react-router) cần Router context thật để render — mock thành <a> đơn giản,
 * cùng kỹ thuật đã dùng ở test/layout.spec.tsx (không mount RouterProvider chỉ để test 1 component).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenPage } from "./forbidden";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

describe("ForbiddenPage — heading structure", () => {
  it("renders exactly one <h1> with the forbidden title", () => {
    render(<ForbiddenPage reason="NO_PERMISSION" />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Bạn không có quyền truy cập trang này.");
  });
});

describe("ForbiddenPage — message theo reason enum", () => {
  it.each([
    ["NO_PERMISSION", "Tài khoản của bạn không có quyền xem nội dung này."],
    ["NO_SCOPE", "Nội dung này nằm ngoài phạm vi dữ liệu của bạn."],
    ["USER_INACTIVE", "Tài khoản của bạn đang bị vô hiệu hóa."],
    ["COMPANY_INACTIVE", "Công ty của bạn đang bị đình chỉ hoặc vô hiệu hóa."],
    ["MODULE_DISABLED", "Module này chưa được kích hoạt."],
    ["FEATURE_DISABLED", "Tính năng này đang bị tắt."],
  ])("reason=%s → hiện đúng message tương ứng", (reason, expectedMessage) => {
    render(<ForbiddenPage reason={reason} />);
    expect(screen.getByText(expectedMessage)).toBeInTheDocument();
  });

  it("reason không xác định (route guard gửi giá trị lạ) → rơi về mô tả mặc định, KHÔNG throw", () => {
    render(<ForbiddenPage reason="SOME_FUTURE_REASON_NOT_IN_ENUM" />);
    expect(
      screen.getByText("Vui lòng liên hệ quản trị viên nếu bạn cho rằng đây là nhầm lẫn."),
    ).toBeInTheDocument();
  });

  it("thiếu reason (undefined) → mô tả mặc định", () => {
    render(<ForbiddenPage />);
    expect(
      screen.getByText("Vui lòng liên hệ quản trị viên nếu bạn cho rằng đây là nhầm lẫn."),
    ).toBeInTheDocument();
  });
});

describe("ForbiddenPage — action link accessible name", () => {
  it("'Về trang chủ' có accessible name qua role=link và trỏ về '/'", () => {
    render(<ForbiddenPage reason="NO_PERMISSION" />);
    const link = screen.getByRole("link", { name: "Về trang chủ" });
    expect(link).toHaveAttribute("href", "/");
  });
});
