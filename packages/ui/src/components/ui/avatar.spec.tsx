import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, initialsFrom } from "./avatar";

/**
 * Render-smoke (QA-02 matrix) — Avatar: mount không throw + initials logic + img fallback.
 */
describe("initialsFrom", () => {
  it("tên rỗng/null → '?'", () => {
    expect(initialsFrom(null)).toBe("?");
    expect(initialsFrom("")).toBe("?");
  });

  it("tên đơn → 2 ký tự đầu viết hoa", () => {
    expect(initialsFrom("Bình")).toBe("BÌ");
  });

  it("họ tên đầy đủ → ký tự đầu-cuối viết hoa", () => {
    expect(initialsFrom("Nguyễn Văn Cảnh")).toBe("NC");
  });
});

describe("Avatar", () => {
  it("render initials khi không có src (mount không throw)", () => {
    render(<Avatar name="An Bình" />);
    // Initials "AB"
    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("render img khi có src", () => {
    render(<Avatar name="An" src="https://example.com/avatar.png" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/avatar.png");
  });

  it("name=undefined → '?' hiển thị", () => {
    render(<Avatar />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});

/**
 * S19-UI-AVATARFALLBACK-1 — URL ký TTL ngắn (300 s) + `loading="lazy"`: ngồi quá hạn rồi cuộn tới ảnh là
 * storage từ chối. Ảnh lỗi phải rơi về chữ cái đầu, và URL ký MỚI (sau refetch) phải được thử lại.
 */
describe("Avatar — ảnh tải lỗi", () => {
  const DEAD = "https://storage.local/dead.png?X-Amz-Expires=300";
  const FRESH = "https://storage.local/fresh.png?X-Amz-Expires=300";

  it("ảnh lỗi (URL ký hết hạn / 404) → chữ cái đầu của `name`, KHÔNG để icon ảnh vỡ", () => {
    render(<Avatar name="An Bình" src={DEAD} />);

    fireEvent.error(screen.getByRole("img"));

    expect(screen.getByText("AB")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("render lại với CÙNG `src` đã hỏng → vẫn chữ cái đầu (không vòng lặp tải lại)", () => {
    const { rerender } = render(<Avatar name="An Bình" src={DEAD} />);
    fireEvent.error(screen.getByRole("img"));

    rerender(<Avatar name="An Bình" src={DEAD} />);
    rerender(<Avatar name="An Bình" src={DEAD} size="lg" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("đổi `src` (URL ký mới sau refetch) → thử lại ảnh; URL mới cũng hỏng → lại chữ cái đầu", () => {
    // GIỮ NGUYÊN instance (rerender, không mount lại): mount lại thì state nào cũng sạch ⇒ test chỉ
    // chứng minh "mount lại thì hết lỗi", KHÔNG chứng minh state lỗi thoát kẹt.
    const { rerender } = render(<Avatar name="An Bình" src={DEAD} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    rerender(<Avatar name="An Bình" src={FRESH} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", FRESH);
    expect(screen.getByRole("img")).toHaveAttribute("loading", "lazy");
    expect(screen.queryByText("AB")).not.toBeInTheDocument();

    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("AB")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("lỗi của MỘT avatar không kéo avatar khác về chữ cái đầu", () => {
    render(
      <>
        <Avatar name="An Bình" src={DEAD} />
        <Avatar name="Cao Dũng" src={FRESH} />
      </>,
    );

    fireEvent.error(screen.getByAltText("An Bình"));

    expect(screen.getByText("AB")).toBeInTheDocument();
    expect(screen.getByAltText("Cao Dũng")).toHaveAttribute("src", FRESH);
    expect(screen.queryByText("CD")).not.toBeInTheDocument();
  });

  it("rơi về chữ cái đầu vẫn giữ `className` + thuộc tính truyền vào trên khung (API không đổi)", () => {
    render(<Avatar name="An Bình" src={DEAD} className="ring-2" data-testid="avatar" />);

    fireEvent.error(screen.getByRole("img"));

    const frame = screen.getByTestId("avatar");
    expect(frame).toHaveClass("ring-2");
    expect(frame).toHaveTextContent("AB");
  });
});
