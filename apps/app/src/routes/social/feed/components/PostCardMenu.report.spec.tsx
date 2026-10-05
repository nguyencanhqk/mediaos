/**
 * S16-SOCIAL-FE-3 (L3, ca P1) — mục «Báo cáo» trong menu ⋯ của thẻ BÀI (`PostCardMenu`) và đường nối tới
 * hộp thoại soạn báo cáo (`SOCIAL-API-027`).
 *
 * File spec RIÊNG: `PostCard.spec.tsx` thuộc nhánh FE-2D đang mở — không sửa nó.
 *
 * Ghim:
 *  · bài của người khác ⇒ có mục (role `menuitem`); bài của chính mình ⇒ KHÔNG, và menu vẫn không rỗng
 *    («Sao chép liên kết» làm đối chứng — bẫy «nút ⋯ vắng ≠ mục vắng»).
 *  · hộp thoại mount LƯỜI: menu vẽ được khi KHÔNG có `QueryClientProvider` (plan B14 — 3 spec của FE-2D
 *    render thẻ bài không có provider cho hook mới).
 *  · bấm mục ⇒ hộp thoại mở với đích là CHÍNH bài đó; đóng rồi mở lại ⇒ `attemptId` mới (plan B22).
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedReportSchema } from "@mediaos/contracts";
import i18n from "@/i18n";
import { makePost, renderWithProviders, resetCaps, setCaps } from "../social-test-doubles";
import { PostCardMenu, type PostCardMenuActions } from "./PostCardMenu";

const createReport = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialModerationApi: {
      ...actual.socialModerationApi,
      createReport: (...a: unknown[]) => createReport(...a),
    },
  };
});

const POST_ID = "55555555-5555-4555-8555-555555555555";
const TRIGGER = "Tuỳ chọn bài viết";
const REPORT = "Báo cáo";
const COPY_LINK = "Sao chép liên kết";
const DIALOG_TITLE = "Báo cáo bài viết";
const SUBMIT = "Gửi báo cáo";
const CANCEL = "Huỷ";
const CLOSE = "Đóng";

function makeActions(): PostCardMenuActions {
  return {
    onCopyLink: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onToggleHidden: vi.fn(),
    onToggleComments: vi.fn(),
    onTogglePinned: vi.fn(),
  };
}

const openMenu = (): HTMLElement => {
  fireEvent.click(screen.getByRole("button", { name: TRIGGER }));
  return screen.getByRole("menu");
};
const reportItem = (menu: HTMLElement): HTMLElement | null =>
  within(menu).queryByRole("menuitem", { name: REPORT });

beforeEach(() => {
  setCaps({ "view:feed": true });
  createReport.mockReset();
  createReport.mockImplementation(() =>
    Promise.resolve({ id: "66666666-6666-4666-8666-666666666666" }),
  );
});
afterEach(() => {
  cleanup();
  resetCaps();
});

describe("P1 — mục «Báo cáo» trên thẻ bài", () => {
  it("ALLOW: bài của NGƯỜI KHÁC ⇒ có mục «Báo cáo» (role `menuitem`)", () => {
    renderWithProviders(
      <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />,
    );
    const menu = openMenu();
    expect(within(menu).getByRole("menuitem", { name: REPORT })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: COPY_LINK })).toBeInTheDocument();
  });

  it("DENY: bài của CHÍNH MÌNH ⇒ KHÔNG có mục «Báo cáo»; «Sao chép liên kết» vẫn có", () => {
    renderWithProviders(
      <PostCardMenu post={makePost({ id: POST_ID, isMine: true })} actions={makeActions()} />,
    );
    const menu = openMenu();
    expect(within(menu).getByRole("menuitem", { name: COPY_LINK })).toBeInTheDocument();
    expect(reportItem(menu)).toBeNull();
  });

  it("người kiểm duyệt vẫn báo cáo được bài người khác — mục không phụ thuộc cặp `manage:*`", () => {
    setCaps({ "view:feed": true, "manage:feed-post": true, "manage:feed-news": true });
    renderWithProviders(
      <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />,
    );
    expect(reportItem(openMenu())).not.toBeNull();
  });

  it("mount LƯỜI: KHÔNG có `QueryClientProvider` ⇒ menu vẫn vẽ, có mục «Báo cáo», chưa có hộp thoại", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />
      </I18nextProvider>,
    );
    expect(reportItem(openMenu())).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("P1 — bấm «Báo cáo» mở hộp thoại cho ĐÚNG bài đó", () => {
  it("bấm ⇒ menu đóng, hộp thoại «Báo cáo bài viết» mở; gửi ⇒ đích là `post` + id của bài; không callback nào của thẻ bị gọi", async () => {
    const actions = makeActions();
    renderWithProviders(
      <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={actions} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: REPORT }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: DIALOG_TITLE })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Spam hoặc quảng cáo" }));
    fireEvent.click(screen.getByRole("button", { name: SUBMIT }));
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(1));

    const body: unknown = createReport.mock.calls[0]?.[0];
    expect(body).toEqual({ targetType: "post", targetId: POST_ID, reason: "spam" });
    expect(createFeedReportSchema.safeParse(body).success).toBe(true);
    for (const spy of Object.values(actions)) expect(spy).not.toHaveBeenCalled();
  });

  it("«Huỷ» ⇒ hộp thoại biến mất, 0 lời gọi; mở lại ⇒ nháp TRẮNG (lượt mount mới)", () => {
    renderWithProviders(
      <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />,
    );
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: REPORT }));
    fireEvent.click(screen.getByRole("radio", { name: "Lý do khác" }));
    fireEvent.click(screen.getByRole("button", { name: CANCEL }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createReport).not.toHaveBeenCalled();

    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: REPORT }));
    expect(screen.getByRole("radio", { name: "Lý do khác" })).not.toBeChecked();
  });

  it("gửi xong, đóng, mở lại và gửi CÙNG nội dung ⇒ `attemptId` MỚI (không phát lại phản hồi cũ)", async () => {
    renderWithProviders(
      <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />,
    );

    for (const round of [1, 2]) {
      fireEvent.click(within(openMenu()).getByRole("menuitem", { name: REPORT }));
      fireEvent.click(screen.getByRole("radio", { name: "Spam hoặc quảng cáo" }));
      fireEvent.click(screen.getByRole("button", { name: SUBMIT }));
      await waitFor(() => expect(createReport).toHaveBeenCalledTimes(round));
      fireEvent.click(await screen.findByRole("button", { name: CLOSE }));
      expect(screen.queryByRole("dialog")).toBeNull();
    }

    const [first, second] = createReport.mock.calls;
    expect(second?.[0]).toEqual(first?.[0]);
    expect(typeof first?.[1]).toBe("string");
    expect(String(first?.[1]).length).toBeGreaterThan(0);
    expect(String(second?.[1]).length).toBeGreaterThan(0);
    expect(second?.[1]).not.toBe(first?.[1]);
  });
});
