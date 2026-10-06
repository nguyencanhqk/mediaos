/**
 * S16-SOCIAL-FE-3B (L4) — màn Thiết lập huy hiệu `SOC-SCREEN-012`: NHÓM CA GHI của hai nút hàng — F2 («Ngừng
 * dùng» 051 có bước xác nhận · «Bật lại» 050 `{ isActive: true }` · invalidate) · DC3 (bấm đúp) · lỗi của lượt
 * tắt / bật. Kết cục của hộp thoại tạo / sửa nhìn từ trang ở `BadgeSettingsPage.form.spec.tsx`.
 *
 * Đo invalidate (plan B24): seed khoá CỤ THỂ KHÔNG có observer rồi đọc `isInvalidated` — query đang có observer
 * refetch xong là cờ về `false` (đua), còn `getQueryState(<tiền tố>)` luôn `undefined`. Mỗi ca có khoá ĐỐI
 * CHỨNG phải còn `false`.
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY, truy vấn bằng role + tên trợ năng.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { socialKeys } from "@mediaos/web-core";
import { updateKudosBadgeSchema } from "@mediaos/contracts";
import {
  makeTestQueryClient,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../feed/social-test-doubles";
import {
  ADMIN_ERR,
  advanceFakeTimers,
  BADGE_ID,
  makeBadgeAdmin,
  makeBadgeAdminPage,
  routeSearchDouble,
} from "../admin/admin-test-doubles";
import { BadgeSettingsPage } from "./BadgeSettingsPage";

const listBadgesAdmin = vi.fn();
const updateBadge = vi.fn();
const deactivateBadge = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialKudosApi: {
      ...actual.socialKudosApi,
      listBadgesAdmin: (...a: unknown[]) => listBadgesAdmin(...a),
      updateBadge: (...a: unknown[]) => updateBadge(...a),
      deactivateBadge: (...a: unknown[]) => deactivateBadge(...a),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const doubles = await import("../admin/admin-test-doubles");
  return {
    ...actual,
    useNavigate: () => (options: { search?: unknown }) => {
      doubles.routeSearchDouble.navigate(options);
    },
    useSearch: () => doubles.useRouteSearchDouble(),
  };
});

const OFF_ID = "99999999-9999-4999-8999-999999999999";

const TABLE = "Danh sách huy hiệu vinh danh";
const DEACTIVATE_ROW = "Ngừng dùng huy hiệu Đồng đội";
const REACTIVATE_ROW = "Bật lại huy hiệu Tiên phong";
const CONFIRM_TITLE = "Ngừng dùng huy hiệu «Đồng đội»?";
const CONFIRM_BODY =
  "Huy hiệu sẽ không còn trong ô chọn khi gửi vinh danh mới. Các lời vinh danh đã gửi vẫn giữ huy hiệu này, và bạn có thể bật lại bất cứ lúc nào.";
const CONFIRM = "Ngừng dùng";
const CANCEL = "Huỷ";
const WORKING = "Đang xử lý…";
const RETRY = "Thử lại";
const DISMISS = "Đóng thông báo";
const DONE_OFF = "Đã ngừng dùng huy hiệu «Đồng đội».";
const DONE_ON = "Đã bật lại huy hiệu «Tiên phong».";
const LOAD_FAILED_TEXT = "Không tải được danh sách do lỗi hệ thống hoặc kết nối. Vui lòng thử lại.";

const active = makeBadgeAdmin();
const inactive = makeBadgeAdmin({
  id: OFF_ID,
  code: "da-tat",
  name: "Tiên phong",
  isActive: false,
});

/** `badges` + `otherAdminPage` phải bị làm mới sau MỖI lượt ghi; hai khoá còn lại là ĐỐI CHỨNG. */
const KEY = {
  badges: socialKeys.kudos.badges(),
  otherAdminPage: socialKeys.kudos.badgesAdmin({ page: 9, limit: 50 }),
  kudosList: socialKeys.kudos.list({ month: "2026-10" }),
  birthdays: socialKeys.birthdays({ range: "week" }),
};
type SeededKey = keyof typeof KEY;

async function renderPage() {
  const client = makeTestQueryClient();
  Object.values(KEY).forEach((key) => client.setQueryData(key, { seeded: true }));
  routeSearchDouble.set({});
  renderWithProviders(<BadgeSettingsPage />, client);
  await screen.findByRole("table", { name: TABLE });
  const invalidated = (key: SeededKey): boolean | undefined =>
    client.getQueryState(KEY[key])?.isInvalidated;
  const snapshot = (): Record<SeededKey, boolean | undefined> => ({
    badges: invalidated("badges"),
    otherAdminPage: invalidated("otherAdminPage"),
    kudosList: invalidated("kudosList"),
    birthdays: invalidated("birthdays"),
  });
  return { client, snapshot };
}

const REFRESHED = { badges: true, otherAdminPage: true, kudosList: false, birthdays: false };
const UNTOUCHED = { badges: false, otherAdminPage: false, kudosList: false, birthdays: false };

const rowButton = (name: string): HTMLElement => screen.getByRole("button", { name });
const confirmDialog = (): HTMLElement => screen.getByRole("dialog", { name: CONFIRM_TITLE });
const openConfirm = (): void => {
  fireEvent.click(rowButton(DEACTIVATE_ROW));
};
const clickConfirm = (): void => {
  fireEvent.click(within(confirmDialog()).getByRole("button", { name: CONFIRM }));
};
const dialogGone = (): Promise<void> =>
  waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined);

beforeEach(() => {
  setCaps({ "view:feed": true, "manage:feed-kudos": true });
  listBadgesAdmin.mockReset();
  updateBadge.mockReset();
  deactivateBadge.mockReset();
  listBadgesAdmin.mockImplementation(() => Promise.resolve(makeBadgeAdminPage([active, inactive])));
  deactivateBadge.mockImplementation(() => Promise.resolve({ ...active, isActive: false }));
  updateBadge.mockImplementation(() => Promise.resolve({ ...inactive, isActive: true }));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  resetCaps();
  routeSearchDouble.reset();
});

describe("F2 — «Ngừng dùng» (051) đi qua bước xác nhận", () => {
  it("bấm nút hàng ⇒ hộp xác nhận có tên + câu giải thích; CHƯA gọi 051", async () => {
    await renderPage();

    openConfirm();

    expect(confirmDialog()).toHaveTextContent(CONFIRM_BODY);
    expect(deactivateBadge).toHaveBeenCalledTimes(0);
  });

  it("ALLOW — xác nhận ⇒ 051 nhận ĐÚNG id; hộp đóng; `kudos.badges()` VÀ trang quản trị khác đều `isInvalidated`; bảng được đọc lại; có dải «Đã ngừng dùng…»", async () => {
    const { snapshot } = await renderPage();

    openConfirm();
    clickConfirm();

    await dialogGone();
    expect(deactivateBadge.mock.calls).toEqual([[BADGE_ID]]);
    expect(updateBadge).toHaveBeenCalledTimes(0);
    expect(snapshot()).toEqual(REFRESHED);
    await waitFor(() => expect(listBadgesAdmin).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent(DONE_OFF);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("DENY — «Huỷ» ở hộp xác nhận ⇒ hộp đóng, 051 gọi 0 lần, không khoá nào bị làm mới, không dải nào", async () => {
    const { snapshot } = await renderPage();

    openConfirm();
    fireEvent.click(within(confirmDialog()).getByRole("button", { name: CANCEL }));

    await dialogGone();
    expect(deactivateBadge).toHaveBeenCalledTimes(0);
    expect(snapshot()).toEqual(UNTOUCHED);
    expect(listBadgesAdmin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("2xx mà huy hiệu trả về VẪN đang bật ⇒ dải `outcomeUnknown`, KHÔNG có câu «Đã ngừng dùng…»; danh sách vẫn được đọc lại", async () => {
    deactivateBadge.mockImplementation(() => Promise.resolve(active));
    const { snapshot } = await renderPage();

    openConfirm();
    clickConfirm();

    expect(await screen.findByRole("alert")).toHaveAttribute("data-reason", "outcomeUnknown");
    expect(screen.queryByRole("status")).toBeNull();
    expect(snapshot()).toEqual(REFRESHED);
  });
});

describe("F2 — «Bật lại» (050)", () => {
  it("bấm ⇒ 050 nhận `(id, { isActive: true })` — ĐÚNG một khoá, qua schema; không hộp xác nhận; hai khoá `isInvalidated`; có dải «Đã bật lại…»", async () => {
    const { snapshot } = await renderPage();

    fireEvent.click(rowButton(REACTIVATE_ROW));

    expect(await screen.findByRole("status")).toHaveTextContent(DONE_ON);
    expect(updateBadge.mock.calls).toEqual([[OFF_ID, { isActive: true }]]);
    expect(updateKudosBadgeSchema.safeParse(updateBadge.mock.calls[0]?.[1]).success).toBe(true);
    expect(deactivateBadge).toHaveBeenCalledTimes(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(snapshot()).toEqual(REFRESHED);
    await waitFor(() => expect(listBadgesAdmin).toHaveBeenCalledTimes(2));
  });

  it("sau kết cục, focus nằm ở dải thông báo (nút vừa bấm sắp bị thay bằng nút khác); «Đóng thông báo» gỡ dải", async () => {
    await renderPage();

    fireEvent.click(rowButton(REACTIVATE_ROW));

    const status = await screen.findByRole("status");
    await waitFor(() => expect(document.activeElement).toContainElement(status));
    expect(document.activeElement).not.toBe(document.body);

    fireEvent.click(within(status).getByRole("button", { name: DISMISS }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("DC3 — bấm đúp khi yêu cầu còn treo", () => {
  it("«Bật lại» 2 lần ⇒ 050 gọi 1 lần; hai nút tắt / bật của MỌI hàng đều khoá", async () => {
    updateBadge.mockImplementation(() => pending());
    await renderPage();

    fireEvent.click(rowButton(REACTIVATE_ROW));
    fireEvent.click(rowButton(REACTIVATE_ROW));

    await waitFor(() => expect(rowButton(REACTIVATE_ROW)).toBeDisabled());
    expect(rowButton(DEACTIVATE_ROW)).toBeDisabled();
    expect(updateBadge).toHaveBeenCalledTimes(1);
  });

  it("«Ngừng dùng» ở hộp xác nhận 2 lần ⇒ 051 gọi 1 lần; hộp còn mở, cả hai nút của hộp đều khoá", async () => {
    deactivateBadge.mockImplementation(() => pending());
    await renderPage();

    openConfirm();
    // Giữ CHÍNH phần tử nút: nhãn của nó đổi sang «Đang xử lý…» khi yêu cầu bay.
    const confirmButton = within(confirmDialog()).getByRole("button", { name: CONFIRM });
    const cancelButton = within(confirmDialog()).getByRole("button", { name: CANCEL });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    // «Huỷ» / Esc cùng nhịp với «Ngừng dùng» không được đóng hộp khi yêu cầu đã lên dây.
    fireEvent.click(cancelButton);
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(confirmButton).toHaveTextContent(WORKING);
    expect(cancelButton).toBeDisabled();
    expect(confirmDialog()).toBeInTheDocument();
    expect(deactivateBadge).toHaveBeenCalledTimes(1);
  });
});

describe("Lỗi của lượt tắt / bật — dải ở TRANG, chữ của FE", () => {
  it("404 `KUDOS-BADGE-NOT-FOUND` ⇒ `badgeGone`, hộp đóng, hai khoá `isInvalidated`, KHÔNG «Thử lại», không lộ thông điệp server", async () => {
    deactivateBadge.mockImplementation(() => Promise.reject(ADMIN_ERR.badgeGone()));
    const { snapshot } = await renderPage();

    openConfirm();
    clickConfirm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "badgeGone");
    expect(within(alert).queryByRole("button", { name: RETRY })).toBeNull();
    expect(alert).not.toHaveTextContent("SOCIAL-ERR");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(snapshot()).toEqual(REFRESHED);
  });

  it("403 ⇒ `forbidden`, KHÔNG «Thử lại», KHÔNG khoá nào bị làm mới (server đã từ chối: chưa ghi)", async () => {
    updateBadge.mockImplementation(() => Promise.reject(ADMIN_ERR.forbidden()));
    const { snapshot } = await renderPage();

    fireEvent.click(rowButton(REACTIVATE_ROW));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "forbidden");
    expect(within(alert).queryByRole("button", { name: RETRY })).toBeNull();
    expect(snapshot()).toEqual(UNTOUCHED);
    expect(listBadgesAdmin).toHaveBeenCalledTimes(1);
  });

  it("400 ⇒ `invalidRequest`, KHÔNG «Thử lại»", async () => {
    updateBadge.mockImplementation(() => Promise.reject(ADMIN_ERR.badRequest()));
    await renderPage();

    fireEvent.click(rowButton(REACTIVATE_ROW));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "invalidRequest");
    expect(within(alert).queryByRole("button", { name: RETRY })).toBeNull();
  });

  it("500 ở «Ngừng dùng» ⇒ `outcomeUnknown` (server có thể ĐÃ ghi): hai khoá `isInvalidated`; «Thử lại» gửi lại 051 KHÔNG hỏi xác nhận lần nữa", async () => {
    deactivateBadge.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    const { snapshot } = await renderPage();

    openConfirm();
    clickConfirm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "outcomeUnknown");
    expect(alert).not.toHaveTextContent("boom");
    expect(snapshot()).toEqual(REFRESHED);

    fireEvent.click(within(alert).getByRole("button", { name: RETRY }));

    expect(await screen.findByRole("status")).toHaveTextContent(DONE_OFF);
    expect(deactivateBadge.mock.calls).toEqual([[BADGE_ID], [BADGE_ID]]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("051 treo quá 30 giây ⇒ hộp xác nhận đóng, dải `outcomeUnknown` + «Thử lại»; nút hàng mở lại", async () => {
    deactivateBadge.mockImplementation(() => pending());
    await renderPage();
    vi.useFakeTimers();

    openConfirm();
    clickConfirm();
    await advanceFakeTimers(29_999);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("dialog", { name: CONFIRM_TITLE })).toBeInTheDocument();

    await advanceFakeTimers(1);
    await advanceFakeTimers(0);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "outcomeUnknown");
    expect(within(alert).getByRole("button", { name: RETRY })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rowButton(DEACTIVATE_ROW)).toBeEnabled();
  });
});

describe("Dải kết cục và lượt đọc lại", () => {
  it("lượt ghi XONG mà lượt đọc lại hỏng ⇒ dải «Đã bật lại…» VẪN còn, đứng cạnh dải `loadFailed` của bảng", async () => {
    listBadgesAdmin.mockImplementationOnce(() =>
      Promise.resolve(makeBadgeAdminPage([active, inactive])),
    );
    listBadgesAdmin.mockImplementation(() => Promise.reject(ADMIN_ERR.server()));
    await renderPage();

    fireEvent.click(rowButton(REACTIVATE_ROW));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "loadFailed");
    expect(alert).toHaveTextContent(LOAD_FAILED_TEXT);
    expect(screen.getByRole("status")).toHaveTextContent(DONE_ON);
    // Bảng cũ không được trông như mới.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("`badgeGone` («…danh sách đã được làm mới») + lượt đọc lại hỏng ⇒ CHỈ còn dải `loadFailed` — không nói hai điều trái nhau", async () => {
    listBadgesAdmin.mockImplementationOnce(() =>
      Promise.resolve(makeBadgeAdminPage([active, inactive])),
    );
    listBadgesAdmin.mockImplementation(() => Promise.reject(ADMIN_ERR.server()));
    updateBadge.mockImplementation(() => Promise.reject(ADMIN_ERR.badgeGone()));
    await renderPage();

    fireEvent.click(rowButton(REACTIVATE_ROW));

    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((el) => el.getAttribute("data-reason"))).toEqual([
        "loadFailed",
      ]),
    );
    expect(updateBadge).toHaveBeenCalledTimes(1);
  });

  it("bắt đầu một lượt ghi mới ⇒ dải của lượt trước được gỡ", async () => {
    updateBadge.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.forbidden()));
    await renderPage();
    fireEvent.click(rowButton(REACTIVATE_ROW));
    await screen.findByRole("alert");

    updateBadge.mockImplementation(() => pending());
    fireEvent.click(rowButton(REACTIVATE_ROW));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(updateBadge).toHaveBeenCalledTimes(2);
  });
});
