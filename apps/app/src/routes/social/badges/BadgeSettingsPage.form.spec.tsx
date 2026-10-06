/**
 * S16-SOCIAL-FE-3B (L4) — màn Thiết lập huy hiệu `SOC-SCREEN-012`: việc TRANG làm với hộp thoại tạo (049) / sửa
 * (050) — hộp thoại THẬT, chỉ mock lời gọi. Trang phải: mở đúng chế độ + đúng huy hiệu · sau kết cục gỡ hộp
 * thoại, làm mới `kudos.badges()` (ô chọn của composer) VÀ nhánh quản trị, vẽ dải ở TRANG · lỗi «giữ hộp thoại»
 * báo dữ liệu cũ (`onStale`) cũng làm mới ngay · người dùng tự đóng thì không chạm gì.
 *
 * Form, body, `attemptId`, lỗi gắn ô: đo ở spec của `BadgeFormDialog`. Đo invalidate theo plan B24 (khoá ĐÃ
 * SEED không observer + khoá đối chứng). i18n THẬT, chữ kỳ vọng VIẾT TAY.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { socialKeys } from "@mediaos/web-core";
import {
  makeTestQueryClient,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../feed/social-test-doubles";
import {
  ADMIN_ERR,
  BADGE_ID,
  makeBadgeAdmin,
  makeBadgeAdminPage,
  routeSearchDouble,
} from "../admin/admin-test-doubles";
import { BadgeSettingsPage } from "./BadgeSettingsPage";

const listBadgesAdmin = vi.fn();
const createBadge = vi.fn();
const updateBadge = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialKudosApi: {
      ...actual.socialKudosApi,
      listBadgesAdmin: (...a: unknown[]) => listBadgesAdmin(...a),
      createBadge: (...a: unknown[]) => createBadge(...a),
      updateBadge: (...a: unknown[]) => updateBadge(...a),
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

const NEW_ID = "99999999-9999-4999-8999-999999999999";

const TABLE = "Danh sách huy hiệu vinh danh";
const ADD = "Thêm huy hiệu";
const EDIT_ROW = "Sửa huy hiệu Đồng đội";
const DIALOG = { create: "Thêm huy hiệu", edit: "Sửa huy hiệu" };
const CODE = "Mã huy hiệu";
const NAME = "Tên huy hiệu";
const SAVE = "Lưu";
const CANCEL = "Huỷ";
const DONE_CREATED = "Đã thêm huy hiệu «Sáng tạo».";
const DONE_UPDATED = "Đã lưu huy hiệu «Đồng đội mới».";

const existing = makeBadgeAdmin();

const KEY = {
  badges: socialKeys.kudos.badges(),
  otherAdminPage: socialKeys.kudos.badgesAdmin({ page: 9, limit: 50 }),
  kudosList: socialKeys.kudos.list({ month: "2026-10" }),
};
type SeededKey = keyof typeof KEY;
const REFRESHED = { badges: true, otherAdminPage: true, kudosList: false };
const UNTOUCHED = { badges: false, otherAdminPage: false, kudosList: false };

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
  });
  return { snapshot };
}

const type = (name: string, value: string): void => {
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
};
const clickSave = (): void => {
  fireEvent.click(screen.getByRole("button", { name: SAVE }));
};
const dialogGone = (): Promise<void> =>
  waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

function openCreateAndFill(): void {
  fireEvent.click(screen.getByRole("button", { name: ADD }));
  type(CODE, "sang-tao");
  type(NAME, "Sáng tạo");
}
function openEditAndRename(): void {
  fireEvent.click(screen.getByRole("button", { name: EDIT_ROW }));
  type(NAME, "Đồng đội mới");
}

beforeEach(() => {
  setCaps({ "view:feed": true, "manage:feed-kudos": true });
  listBadgesAdmin.mockReset();
  createBadge.mockReset();
  updateBadge.mockReset();
  listBadgesAdmin.mockImplementation(() => Promise.resolve(makeBadgeAdminPage([existing])));
  createBadge.mockImplementation(() =>
    Promise.resolve(makeBadgeAdmin({ id: NEW_ID, code: "sang-tao", name: "Sáng tạo" })),
  );
  updateBadge.mockImplementation(() => Promise.resolve(makeBadgeAdmin({ name: "Đồng đội mới" })));
});
afterEach(() => {
  cleanup();
  resetCaps();
  routeSearchDouble.reset();
});

describe("Mở hộp thoại đúng chế độ, đúng huy hiệu", () => {
  it("«Thêm huy hiệu» ⇒ hộp thoại TẠO, ô mã trống và nhập được", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: ADD }));

    const dialog = screen.getByRole("dialog", { name: DIALOG.create });
    expect(within(dialog).getByRole("textbox", { name: CODE })).toHaveValue("");
    expect(within(dialog).getByRole("textbox", { name: CODE })).not.toHaveAttribute("readonly");
  });

  it("«Sửa» ở hàng ⇒ hộp thoại SỬA mang dữ liệu của CHÍNH hàng đó, ô mã chỉ đọc", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: EDIT_ROW }));

    const dialog = screen.getByRole("dialog", { name: DIALOG.edit });
    expect(within(dialog).getByRole("textbox", { name: CODE })).toHaveValue("team-player");
    expect(within(dialog).getByRole("textbox", { name: CODE })).toHaveAttribute("readonly");
    expect(within(dialog).getByRole("textbox", { name: NAME })).toHaveValue("Đồng đội");
  });

  it("«Huỷ» ⇒ hộp thoại đóng; không lời ghi, không khoá nào bị làm mới, không dải nào", async () => {
    const { snapshot } = await renderPage();
    openCreateAndFill();

    fireEvent.click(screen.getByRole("button", { name: CANCEL }));

    await dialogGone();
    expect(createBadge).toHaveBeenCalledTimes(0);
    expect(snapshot()).toEqual(UNTOUCHED);
    expect(listBadgesAdmin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Kết cục THÀNH CÔNG — trang gỡ hộp thoại, làm mới hai khoá, vẽ dải xác nhận", () => {
  it("tạo (049) ⇒ hộp đóng; `kudos.badges()` VÀ trang quản trị khác `isInvalidated`; bảng được đọc lại; dải «Đã thêm…»", async () => {
    const { snapshot } = await renderPage();
    openCreateAndFill();

    clickSave();

    await dialogGone();
    expect(createBadge).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual(REFRESHED);
    await waitFor(() => expect(listBadgesAdmin).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent(DONE_CREATED);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sửa (050) ⇒ 050 nhận ĐÚNG id của hàng + chỉ trường đã đổi; hai khoá `isInvalidated`; dải «Đã lưu…» mang tên server trả", async () => {
    const { snapshot } = await renderPage();
    openEditAndRename();

    clickSave();

    await dialogGone();
    expect(updateBadge.mock.calls).toEqual([[BADGE_ID, { name: "Đồng đội mới" }]]);
    expect(snapshot()).toEqual(REFRESHED);
    await waitFor(() => expect(listBadgesAdmin).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent(DONE_UPDATED);
  });

  it("sau kết cục, focus nằm ở dải thông báo, không rơi về `body`", async () => {
    await renderPage();
    openCreateAndFill();

    clickSave();

    const status = await screen.findByRole("status");
    await waitFor(() => expect(document.activeElement).toContainElement(status));
  });
});

describe("Kết cục LỖI đóng hộp thoại — dải ở TRANG", () => {
  it("sửa gặp 404 ⇒ hộp đóng, dải `badgeGone` ở trang (không «Thử lại»), hai khoá `isInvalidated`", async () => {
    updateBadge.mockImplementation(() => Promise.reject(ADMIN_ERR.badgeGone()));
    const { snapshot } = await renderPage();
    openEditAndRename();

    clickSave();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "badgeGone");
    expect(within(alert).queryByRole("button", { name: "Thử lại" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(snapshot()).toEqual(REFRESHED);
  });

  it("sửa gặp 403 ⇒ hộp đóng, dải `forbidden` ở trang; KHÔNG khoá nào bị làm mới (đối chứng của ca 404)", async () => {
    updateBadge.mockImplementation(() => Promise.reject(ADMIN_ERR.forbidden()));
    const { snapshot } = await renderPage();
    openEditAndRename();

    clickSave();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "forbidden");
    expect(alert).not.toHaveTextContent("Forbidden resource");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(snapshot()).toEqual(UNTOUCHED);
    expect(listBadgesAdmin).toHaveBeenCalledTimes(1);
  });
});

describe("Lỗi GIỮ hộp thoại báo dữ liệu cũ (`onStale`) — trang làm mới NGAY, hộp thoại còn nguyên", () => {
  it("tạo gặp 409 «mã đã dùng» ⇒ hộp thoại + nháp còn; hai khoá `isInvalidated`; bảng được đọc lại; trang KHÔNG vẽ dải riêng", async () => {
    createBadge.mockImplementation(() => Promise.reject(ADMIN_ERR.badgeCodeTaken()));
    const { snapshot } = await renderPage();
    openCreateAndFill();

    clickSave();

    const dialog = screen.getByRole("dialog", { name: DIALOG.create });
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "badgeCodeTaken");
    expect(within(dialog).getByRole("textbox", { name: CODE })).toHaveValue("sang-tao");
    expect(snapshot()).toEqual(REFRESHED);
    await waitFor(() => expect(listBadgesAdmin).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("tạo gặp 400 ⇒ hộp thoại còn, KHÔNG khoá nào bị làm mới (đối chứng: lỗi giữ hộp thoại không tự kéo theo làm mới)", async () => {
    createBadge.mockImplementation(() => Promise.reject(ADMIN_ERR.badRequest()));
    const { snapshot } = await renderPage();
    openCreateAndFill();

    clickSave();

    const dialog = screen.getByRole("dialog", { name: DIALOG.create });
    expect(await within(dialog).findByRole("alert")).toHaveAttribute(
      "data-reason",
      "invalidRequest",
    );
    expect(snapshot()).toEqual(UNTOUCHED);
    expect(listBadgesAdmin).toHaveBeenCalledTimes(1);
  });
});

describe("Kết cục của nút hàng về khi hộp thoại tạo / sửa ĐANG MỞ", () => {
  const OFF_ID = "88888888-8888-4888-8888-888888888888";
  const REACTIVATE_ROW = "Bật lại huy hiệu Tiên phong";
  const DONE_ON = "Đã bật lại huy hiệu «Tiên phong».";
  const inactive = makeBadgeAdmin({
    id: OFF_ID,
    code: "da-tat",
    name: "Tiên phong",
    isActive: false,
  });

  it("«Bật lại» còn treo → mở «Sửa» hàng khác → phản hồi về ⇒ dải vẫn vẽ nhưng focus KHÔNG bị kéo ra khỏi hộp thoại đang nhập", async () => {
    listBadgesAdmin.mockImplementation(() =>
      Promise.resolve(makeBadgeAdminPage([existing, inactive])),
    );
    let release: (badge: unknown) => void = () => undefined;
    updateBadge.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: REACTIVATE_ROW }));
    await waitFor(() => expect(updateBadge).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: EDIT_ROW }));
    const dialog = screen.getByRole("dialog", { name: DIALOG.edit });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    release({ ...inactive, isActive: true });

    expect(await screen.findByText(DONE_ON)).toBeInTheDocument();
    await waitFor(() => expect(listBadgesAdmin).toHaveBeenCalledTimes(2));
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("dialog", { name: DIALOG.edit })).toBe(dialog);
  });
});

describe("Dải của trang không sống qua lượt mở hộp thoại kế tiếp", () => {
  it("có dải «Đã thêm…» rồi mở hộp thoại sửa ⇒ dải được gỡ", async () => {
    await renderPage();
    openCreateAndFill();
    clickSave();
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: EDIT_ROW }));

    expect(screen.getByRole("dialog", { name: DIALOG.edit })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
