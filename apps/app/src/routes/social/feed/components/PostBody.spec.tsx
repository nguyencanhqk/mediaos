/**
 * S16-SOCIAL-FE-1 — `PostBody`: vế RENDER của ca **C14** (vế tokenize ở `parse-feed-body.spec.ts`).
 *
 * Hai ca đo hai thứ khác nhau và cần cả hai: hàm thuần chứng minh chuỗi được CẮT đúng; file này
 * chứng minh token được DỰNG thành node React đúng loại — `#thẻ` và URL thành link THẬT, `@mention`
 * thành span (không phải link), và nội dung người dùng không bao giờ trở thành markup.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { PostBody } from "./PostBody";

/**
 * Mock `Link` NỘI SUY `params` (khuôn `KudosBlock.spec` — bài học H2 FE-2C): mock trần `href={to}` in
 * khuôn `/feed/profiles/$employeeId` cho MỌI id ⇒ link mention trỏ nhầm người vẫn xanh.
 */
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      search,
      params,
    }: {
      children: React.ReactNode;
      to: string;
      search?: Record<string, unknown>;
      params?: Record<string, string>;
    }) => (
      <a
        href={
          search?.tag
            ? `${to}?tag=${String(search.tag)}`
            : Object.entries(params ?? {}).reduce((h, [k, v]) => h.replace(`$${k}`, v), to)
        }
        data-router-link="1"
      >
        {children}
      </a>
    ),
  };
});

const wrap = (node: React.ReactNode) =>
  render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("C14 (render) — không có đường nào biến nội dung thành markup", () => {
  it("chuỗi trông như thẻ HTML hiện thành TEXT, và KHÔNG có element `img` nào", () => {
    const { container } = wrap(<PostBody body="<img src=x onerror=alert(1)>" />);
    expect(screen.getByTestId("post-body")).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });

  it("URL ⇒ `<a>` mở tab mới có `noopener noreferrer`", () => {
    // Link tới nội dung do NGƯỜI DÙNG dán — không tin được; thiếu `noopener` là tab mới đọc được
    // `window.opener` của mình.
    const { container } = wrap(<PostBody body="xem https://intranet.acme.vn/a" />);
    const a = container.querySelector('a[href^="https://"]') as HTMLAnchorElement;
    expect(a).not.toBeNull();
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("`#thẻ` ⇒ link lọc theo thẻ ĐÃ CHUẨN HOÁ chữ thường", () => {
    const { container } = wrap(<PostBody body="#TuyểnDụng đợt 3" />);
    const a = container.querySelector("a[data-router-link]") as HTMLAnchorElement;
    expect(a).not.toBeNull();
    // Hiển thị giữ nguyên văn, khoá lọc thì chữ thường — hai vai trò khác nhau của cùng một thẻ.
    expect(a.textContent).toBe("#TuyểnDụng");
    expect(a.getAttribute("href")).toContain("tag=tuyểndụng");
  });

  it("🔴 `@mention` KHÔNG có `mentions` của server ⇒ SPAN, KHÔNG phải link", () => {
    const { container } = wrap(<PostBody body="chào @an.nguyen" />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(0);
    expect(screen.getByTestId("post-body")).toHaveTextContent("@an.nguyen");
  });
});

describe("S16-SOCIAL-MENTIONLINK-1 — B1: mention thành link hồ sơ CHỈ khi server nói `withheld:false`", () => {
  const E1 = "33333333-3333-4333-8333-333333333333";

  it("ALLOW: phần tử `withheld:false` ⇒ link tới hồ sơ ĐÚNG `employeeId`, chữ = nguyên văn trong bài", () => {
    wrap(
      <PostBody
        body="Chào @Nguyễn Văn An!"
        mentions={[{ withheld: false, employeeId: E1, label: "Nguyễn Văn An" }]}
      />,
    );
    const link = screen.getByRole("link", { name: "@Nguyễn Văn An" });
    expect(link.getAttribute("href")).toBe(`/feed/profiles/${E1}`);
  });

  it("DENY: chỉ phần tử `withheld:true` ⇒ span, 0 thẻ `a`", () => {
    const { container } = wrap(
      <PostBody body="Chào @Nguyễn Văn An!" mentions={[{ withheld: true }]} />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(screen.getByTestId("post-body")).toHaveTextContent("Chào @Nguyễn Văn An!");
  });
});

describe("`body` rỗng / null", () => {
  it("`null` ⇒ KHÔNG render gì (không khung trống, không chữ «null»)", () => {
    // `body` được phép NULL với bài poll/kudos (`chk_feed_posts_body_required`) — xem R16/C27.
    const { container } = wrap(<PostBody body={null} />);
    expect(screen.queryByTestId("post-body")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("chuỗi rỗng ⇒ cũng không render", () => {
    expect(wrap(<PostBody body="" />).container.textContent).toBe("");
  });
});

describe("«Xem thêm» khi nội dung dài", () => {
  const LONG = Array.from({ length: 10 }, (_, i) => `dòng ${i + 1}`).join("\n");

  it("`collapsible=false` ⇒ KHÔNG có nút gập (bình luận vốn ngắn)", () => {
    wrap(<PostBody body={LONG} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("`collapsible` + quá 6 dòng ⇒ có nút, bấm đổi nhãn và bỏ gập", () => {
    const t = i18n.getFixedT("vi", "social");
    wrap(<PostBody body={LONG} collapsible />);

    const btn = screen.getByRole("button", { name: t("post.showMore") });
    // Gập bằng CSS (`line-clamp`) chứ KHÔNG cắt chuỗi: cắt chuỗi sẽ cắt giữa một `#thẻ`/URL và làm
    // hỏng token, rồi «Thu gọn» lại phải parse lại từ đầu.
    expect(screen.getByTestId("post-body").className).toContain("line-clamp-6");

    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: t("post.showLess") })).toBeInTheDocument();
    expect(screen.getByTestId("post-body").className).not.toContain("line-clamp-6");
  });

  it("`collapsible` nhưng nội dung NGẮN ⇒ không có nút (không mời bấm vào việc vô nghĩa)", () => {
    wrap(<PostBody body={"một\nhai"} collapsible />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
