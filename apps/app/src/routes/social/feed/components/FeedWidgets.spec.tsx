/**
 * S16-SOCIAL-FE-1 — ca **C21 · C23 · C24** + badge «N bài mới» (D7).
 *
 * Bốn component nhỏ của rail phải / topbar gom vào một file vì chúng dùng CHUNG một bộ dựng khung
 * (`PortalWidgetBlock`) và kiểm cùng một luật: rỗng thì nói câu RIÊNG, lỗi thì không làm trắng rail.
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { FeedBirthdayDto, FeedNewsItemDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { BirthdayWidget } from "./BirthdayWidget";
import { HighlightNewsWidget } from "./HighlightNewsWidget";
import { FeedSearchBox } from "./FeedSearchBox";
import { NewFeedPostsBadge } from "./NewFeedPostsBadge";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const wrap = (node: React.ReactNode) =>
  render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

beforeEach(() => setCaps({ "view:feed": true }));
afterEach(() => {
  cleanup();
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("C21 — BirthdayWidget: hai bẫy của DTO sinh nhật", () => {
  /** ĐÚNG 5 khoá theo SPEC-16 §3.5 — KHÔNG năm sinh, KHÔNG tuổi, KHÔNG userId. */
  const PERSON: FeedBirthdayDto = {
    employeeId: "22222222-2222-4222-8222-222222222222",
    fullName: "An Nguyễn",
    avatar: null,
    day: 14,
    month: 3,
  };

  it("ALLOW: `{fullName:null, avatar:null}` render fallback, KHÔNG ném", () => {
    // Cả hai khoá đều nullable trong contracts. Một schema phái sinh khai chúng bắt buộc sẽ ném
    // ZodError dù HTTP 200 ⇒ trắng cả rail phải cho người có đồng nghiệp chưa cập nhật hồ sơ.
    expect(() =>
      wrap(
        <BirthdayWidget
          range="today"
          onRangeChange={vi.fn()}
          items={[{ ...PERSON, fullName: null, avatar: null }]}
          isLoading={false}
          isError={false}
          onWish={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByTestId("birthday-list")).toBeInTheDocument();
  });

  it("🔴 ghim tên khoá là `avatar`, KHÔNG phải `avatarUrl`", () => {
    /**
     * Phần còn lại của module dùng `avatarUrl`; riêng DTO này dùng `avatar`. Ca này ghim bằng chính
     * TẬP KHOÁ của đối tượng — gõ nhầm ở component sẽ đọc `undefined` im lặng, không đỏ ở đâu cả.
     */
    expect(Object.keys(PERSON).sort()).toEqual([
      "avatar",
      "day",
      "employeeId",
      "fullName",
      "month",
    ]);
    expect(PERSON).not.toHaveProperty("avatarUrl");
  });

  it("KHÔNG hiện năm sinh/tuổi — chỉ ngày/tháng (SOC-DEC-007)", () => {
    wrap(
      <BirthdayWidget
        range="today"
        onRangeChange={vi.fn()}
        items={[PERSON]}
        isLoading={false}
        isError={false}
        onWish={vi.fn()}
      />,
    );
    const list = screen.getByTestId("birthday-list");
    expect(list).toHaveTextContent("14/3");
    // Widget này gate chỉ bằng `view:feed`, không cặp HR nào ⇒ nó là cửa sau tiềm năng vào PII.
    expect(list.textContent).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(list.textContent).not.toMatch(/tuổi/i);
  });

  it("«Gửi lời chúc» chỉ GỌI CALLBACK — không có đường tự đăng bài (SOC-DEC-003)", () => {
    const onWish = vi.fn();
    wrap(
      <BirthdayWidget
        range="today"
        onRangeChange={vi.fn()}
        items={[PERSON]}
        isLoading={false}
        isError={false}
        onWish={onWish}
      />,
    );
    fireEvent.click(screen.getByTestId("birthday-wish"));
    expect(onWish).toHaveBeenCalledWith(PERSON);
  });

  it("DENY: rỗng ⇒ câu rỗng RIÊNG, không vỡ rail", () => {
    wrap(
      <BirthdayWidget
        range="week"
        onRangeChange={vi.fn()}
        items={[]}
        isLoading={false}
        isError={false}
        onWish={vi.fn()}
      />,
    );
    expect(screen.getByTestId("birthday-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("birthday-list")).toBeNull();
  });

  it("đổi khoảng thời gian gọi `onRangeChange` đúng giá trị", () => {
    const onRangeChange = vi.fn();
    wrap(
      <BirthdayWidget
        range="today"
        onRangeChange={onRangeChange}
        items={[]}
        isLoading={false}
        isError={false}
        onWish={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("birthday-range-month"));
    expect(onRangeChange).toHaveBeenCalledWith("month");
  });
});

describe("C23 — HighlightNewsWidget", () => {
  const NEWS = {
    id: "33333333-3333-4333-8333-333333333333",
    type: "news",
    audience: "company",
    orgUnitId: null,
    groupId: null,
    author: { employeeId: null, fullName: "HR", avatarUrl: null },
    body: "Thông báo nghỉ lễ",
    tags: [],
    attachments: [],
    pinned: true,
    commentsLocked: false,
    requiresAck: false,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    myReaction: null,
    savedByMe: false,
    isMine: false,
    editedAt: null,
    publishedAt: "2026-09-23T03:00:00.000Z",
    lastActivityAt: "2026-09-23T03:00:00.000Z",
    createdAt: "2026-09-23T03:00:00.000Z",
    ackedByMe: false,
  } as FeedNewsItemDto;

  it("ALLOW: có tin ⇒ render danh sách", () => {
    wrap(<HighlightNewsWidget items={[NEWS]} isLoading={false} isError={false} />);
    expect(screen.getByTestId("highlight-list")).toHaveTextContent("Thông báo nghỉ lễ");
  });

  it("DENY: rỗng ⇒ câu rỗng RIÊNG, KHÁC câu của bảng tin", () => {
    wrap(<HighlightNewsWidget items={[]} isLoading={false} isError={false} />);
    const t = i18n.getFixedT("vi", "social");
    expect(screen.getByTestId("highlight-empty")).toHaveTextContent(t("highlight.empty"));
    expect(t("highlight.empty")).not.toBe(t("empty.feed"));
  });

  it("`body: null` (bài poll/kudos lọt vào) ⇒ KHÔNG ném, không in chữ «null»", () => {
    wrap(
      <HighlightNewsWidget items={[{ ...NEWS, body: null }]} isLoading={false} isError={false} />,
    );
    expect(screen.getByTestId("highlight-list").textContent).not.toMatch(/null|undefined/);
  });

  it("lỗi ⇒ hiện thông báo, KHÔNG ném lên rail", () => {
    wrap(<HighlightNewsWidget items={[]} isLoading={false} isError />);
    expect(screen.queryByTestId("highlight-empty")).toBeNull();
    expect(screen.getByTestId("portal-widget-block")).toBeInTheDocument();
  });
});

describe("C24 — FeedSearchBox", () => {
  it("ALLOW: gõ + Enter ⇒ gọi `onSubmit` với từ khoá đã trim", () => {
    const onSubmit = vi.fn();
    wrap(<FeedSearchBox value="" onSubmit={onSubmit} onClear={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  nghỉ lễ  " } });
    fireEvent.submit(screen.getByTestId("feed-search-box"));
    expect(onSubmit).toHaveBeenCalledWith("nghỉ lễ");
  });

  it("từ khoá RỖNG ⇒ gọi `onClear`, KHÔNG gọi `onSubmit`", () => {
    /**
     * `searchFeedQuerySchema.q` đòi `min(1)` ⇒ gửi `q=""` là **400 vô danh**. Ô rỗng nghĩa là "bỏ
     * lọc", không phải "tìm chuỗi rỗng".
     */
    const onSubmit = vi.fn();
    const onClear = vi.fn();
    wrap(<FeedSearchBox value="" onSubmit={onSubmit} onClear={onClear} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "   " } });
    fireEvent.submit(screen.getByTestId("feed-search-box"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("DENY: KHÔNG có `view:feed` ⇒ ô KHÔNG render (không phải disabled)", () => {
    setCaps({});
    wrap(<FeedSearchBox value="" onSubmit={vi.fn()} onClear={vi.fn()} />);
    expect(screen.queryByTestId("feed-search-box")).toBeNull();
  });

  it("URL đổi từ ngoài ⇒ ô theo (nguồn sự thật là URL, không phải state nội bộ)", () => {
    const { rerender } = wrap(<FeedSearchBox value="cũ" onSubmit={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole("searchbox")).toHaveValue("cũ");
    rerender(
      <I18nextProvider i18n={i18n}>
        <FeedSearchBox value="mới" onSubmit={vi.fn()} onClear={vi.fn()} />
      </I18nextProvider>,
    );
    expect(screen.getByRole("searchbox")).toHaveValue("mới");
  });
});

describe("D7 — NewFeedPostsBadge", () => {
  it("`count = 0` ⇒ KHÔNG render gì (không dải trong suốt ăn vùng bấm)", () => {
    wrap(<NewFeedPostsBadge count={0} onClick={vi.fn()} />);
    expect(screen.queryByTestId("new-posts-badge")).toBeNull();
  });

  it("`count > 0` ⇒ hiện số và bấm gọi callback", () => {
    const onClick = vi.fn();
    wrap(<NewFeedPostsBadge count={3} onClick={onClick} />);
    const badge = screen.getByTestId("new-posts-badge");
    expect(badge).toHaveTextContent("3");
    fireEvent.click(badge);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
