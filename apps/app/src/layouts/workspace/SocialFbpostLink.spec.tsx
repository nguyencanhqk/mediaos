import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateSpy }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, useCan: vi.fn(() => false) };
});

vi.mock("@/routes/social/open-social", () => ({ openSocial: vi.fn() }));

import { useCan } from "@mediaos/web-core";
import { openSocial } from "@/routes/social/open-social";
import { SocialFbpostLink } from "./SocialFbpostLink";

/** Trả `true` cho ĐÚNG những cặp được liệt kê, `false` cho mọi cặp khác (gate fail-closed thật). */
function grant(...pairs: string[]) {
  vi.mocked(useCan).mockImplementation(
    (action: string, resourceType: string) => pairs.includes(`${action}:${resourceType}`) as never,
  );
}

describe("S16-SOCIAL-FBPOST-1 — mục rail «Đăng bài Facebook»", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- C4 · cổng quyền: 2 ca ALLOW + 1 ca DENY (ca DENY một mình không đủ) --------------------
  it("C4-allow-1 · có `view:social-post` ⇒ THẤY mục", () => {
    grant("view:social-post");
    render(<SocialFbpostLink />);
    expect(screen.getByRole("button", { name: "app.fbpost" })).toBeInTheDocument();
  });

  it("C4-allow-2 · chỉ có `manage:social-account` (không có view:social-post) ⇒ VẪN thấy mục", () => {
    grant("manage:social-account");
    render(<SocialFbpostLink />);
    expect(screen.getByRole("button", { name: "app.fbpost" })).toBeInTheDocument();
  });

  it("C4-deny · không cặp `social-*` nào ⇒ KHÔNG render gì (kể cả khi có view:feed)", () => {
    grant("view:feed");
    const { container } = render(<SocialFbpostLink />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  // ---- C5 · hành vi bấm giữ Y HỆT ô Home cũ ---------------------------------------------------
  it("C5 · bấm ⇒ gọi openSocial (vào thẳng qua SSO), KHÔNG điều hướng nội bộ ngay", async () => {
    grant("view:social-post");
    render(<SocialFbpostLink />);
    fireEvent.click(screen.getByRole("button", { name: "app.fbpost" }));
    await waitFor(() => expect(openSocial).toHaveBeenCalledTimes(1));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("C5-fallback · openSocial gọi fallback (cầu SSO lỗi) ⇒ điều hướng `/social` để hiện lý do đọc được", async () => {
    grant("view:social-post");
    // Giả lập đúng hợp đồng của openSocial: lỗi ⇒ gọi onFallback, KHÔNG ném ra ngoài.
    vi.mocked(openSocial).mockImplementation(async (onFallback: () => void) => {
      onFallback();
    });
    render(<SocialFbpostLink />);
    fireEvent.click(screen.getByRole("button", { name: "app.fbpost" }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: "/social" }));
  });
});
