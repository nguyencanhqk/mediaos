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

  // Mục menu vừa bấm bị gỡ cùng nhịp hộp thoại mở ⇒ `Dialog` không còn «phần tử kích hoạt» nào để trả
  // focus; không ai trả thì người dùng bàn phím rơi về đầu trang (kiểm toán nhóm C, AUD-C-05).
  it.each([
    { name: "«Huỷ»", close: () => fireEvent.click(screen.getByRole("button", { name: CANCEL })) },
    { name: "Esc", close: () => fireEvent.keyDown(document, { key: "Escape" }) },
  ])("đóng hộp thoại bằng $name ⇒ focus trở về nút ⋯ của ĐÚNG thẻ bài đó", ({ close }) => {
    renderWithProviders(
      <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />,
    );
    const trigger = screen.getByRole("button", { name: TRIGGER });
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: REPORT }));
    // Đang mở: focus nằm TRONG hộp thoại, không ở nút ⋯.
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);

    close();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  // Một thẻ thì «nút ⋯ của ĐÚNG thẻ đó» không phân biệt được với «nút ⋯ đầu tiên của trang».
  it("HAI thẻ bài, báo cáo từ thẻ THỨ HAI rồi «Huỷ» ⇒ focus về nút ⋯ của thẻ thứ hai, không phải thẻ đầu", () => {
    const OTHER_POST_ID = "77777777-7777-4777-8777-777777777777";
    renderWithProviders(
      <>
        <PostCardMenu
          post={makePost({ id: OTHER_POST_ID, isMine: false })}
          actions={makeActions()}
        />
        <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />
      </>,
    );
    const [firstTrigger, secondTrigger] = screen.getAllByRole("button", { name: TRIGGER });
    fireEvent.click(secondTrigger as HTMLElement);
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: REPORT }));
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: CANCEL }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(secondTrigger).toHaveFocus();
    expect(firstTrigger).not.toHaveFocus();
  });

  it("gửi xong rồi «Đóng» ⇒ focus trở về nút ⋯ (hộp thoại đã mount lại sang câu xác nhận)", async () => {
    renderWithProviders(
      <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />,
    );
    const trigger = screen.getByRole("button", { name: TRIGGER });
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: REPORT }));
    fireEvent.click(screen.getByRole("radio", { name: "Spam hoặc quảng cáo" }));
    fireEvent.click(screen.getByRole("button", { name: SUBMIT }));

    const closeButton = await screen.findByRole("button", { name: CLOSE });
    expect(closeButton).toHaveFocus();
    fireEvent.click(closeButton);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  // Trang chi tiết bài KHÔNG mount lại khi chỉ đổi `$postId` (router không khai `remountDeps`, thẻ bài
  // không có `key`): bấm Back của trình duyệt lúc hộp thoại đang mở là thẻ nhận bài KHÁC ngay dưới hộp
  // thoại. Nháp viết cho bài A mà gửi được cho bài B là một lượt GHI nhầm đích (gate TS, TS-01).
  describe("thẻ đổi sang BÀI KHÁC khi hộp thoại đang mở", () => {
    const OTHER_POST_ID = "77777777-7777-4777-8777-777777777777";
    const NOTE = "Ghi chú thêm (không bắt buộc)";

    function openWithDraft() {
      const view = renderWithProviders(
        <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />,
      );
      fireEvent.click(within(openMenu()).getByRole("menuitem", { name: REPORT }));
      fireEvent.click(screen.getByRole("radio", { name: "Quấy rối hoặc xúc phạm" }));
      fireEvent.change(screen.getByRole("textbox", { name: NOTE }), {
        target: { value: "viết cho bài A" },
      });
      return view;
    }

    it("hộp thoại ĐÓNG, 0 lời gọi 027; mở lại trên bài mới ⇒ nháp TRẮNG và đích là bài MỚI", async () => {
      const { rerender } = openWithDraft();

      rerender(
        <PostCardMenu
          post={makePost({ id: OTHER_POST_ID, isMine: false })}
          actions={makeActions()}
        />,
      );

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(createReport).not.toHaveBeenCalled();

      fireEvent.click(within(openMenu()).getByRole("menuitem", { name: REPORT }));
      expect(screen.getByRole("radio", { name: "Quấy rối hoặc xúc phạm" })).not.toBeChecked();
      expect(screen.getByRole("textbox", { name: NOTE })).toHaveValue("");
      fireEvent.click(screen.getByRole("radio", { name: "Spam hoặc quảng cáo" }));
      fireEvent.click(screen.getByRole("button", { name: SUBMIT }));
      await waitFor(() => expect(createReport).toHaveBeenCalledTimes(1));
      expect(createReport.mock.calls[0]?.[0]).toEqual({
        targetType: "post",
        targetId: OTHER_POST_ID,
        reason: "spam",
      });
    });

    it("đổi sang bài khác rồi QUAY LẠI bài cũ ⇒ hộp thoại vẫn đóng (không tự bật lại)", () => {
      const { rerender } = openWithDraft();
      const menuFor = (id: string) => (
        <PostCardMenu post={makePost({ id, isMine: false })} actions={makeActions()} />
      );

      rerender(menuFor(OTHER_POST_ID));
      rerender(menuFor(POST_ID));

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("CÙNG bài nhưng thẻ biết đó là bài của CHÍNH MÌNH ⇒ hộp thoại đóng (cổng `isMine` xét cả hộp thoại đã mở)", () => {
      const { rerender } = openWithDraft();

      rerender(
        <PostCardMenu post={makePost({ id: POST_ID, isMine: true })} actions={makeActions()} />,
      );

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(createReport).not.toHaveBeenCalled();
    });

    it("đối chứng: vẽ lại với CÙNG bài (object mới, cùng id) ⇒ hộp thoại và nháp còn nguyên", () => {
      const { rerender } = openWithDraft();

      rerender(
        <PostCardMenu post={makePost({ id: POST_ID, isMine: false })} actions={makeActions()} />,
      );

      expect(screen.getByRole("dialog", { name: DIALOG_TITLE })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Quấy rối hoặc xúc phạm" })).toBeChecked();
      expect(screen.getByRole("textbox", { name: NOTE })).toHaveValue("viết cho bài A");
    });
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
