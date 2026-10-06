/**
 * S16-SOCIAL-FE-3B (L4) — hộp thoại tạo (049) / sửa (050) huy hiệu `BadgeFormDialog`: ca F1 (form) · F4 (icon)
 * · gắn đúng huy hiệu khi đích đổi · vòng đời `attemptId` (plan D20 · B22).
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY, truy vấn bằng role + tên trợ năng. Body kiểm bằng CHÍNH schema contracts.
 * Lỗi của lời gọi · bấm đúp · yêu cầu treo · focus: `BadgeFormDialog.errors.spec.tsx`.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKudosBadgeSchema, updateKudosBadgeSchema } from "@mediaos/contracts";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import { ADMIN_ERR, BADGE_ID, makeBadgeAdmin } from "../../admin/admin-test-doubles";
import { KUDOS_BADGE_ICON_NAMES } from "../../kudos/components/KudosBadgeIcon";
import { BadgeFormDialog } from "./BadgeFormDialog";

const createBadge = vi.fn();
const updateBadge = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialKudosApi: {
      ...actual.socialKudosApi,
      createBadge: (...a: unknown[]) => createBadge(...a),
      updateBadge: (...a: unknown[]) => updateBadge(...a),
    },
  };
});

const OTHER_ID = "99999999-9999-4999-8999-999999999999";
const TITLE = { create: "Thêm huy hiệu", edit: "Sửa huy hiệu" };
const CODE = "Mã huy hiệu";
const NAME = "Tên huy hiệu";
const DESCRIPTION = "Mô tả (không bắt buộc)";
const ICON = "Biểu tượng";
const EMOJI = "Emoji (không bắt buộc)";
const POSITION = "Thứ tự hiển thị";
const SAVE = "Lưu";
const CODE_INVALID =
  "Mã chưa hợp lệ: cần 2–32 ký tự, chỉ gồm chữ thường a–z, chữ số 0–9 và dấu gạch nối.";
const NAME_INVALID = "Hãy nhập tên huy hiệu (tối đa 255 ký tự).";
const POSITION_INVALID = "Thứ tự phải là số nguyên từ 0 đến 32767.";
/** Viết tay — KHÔNG suy từ `KUDOS_BADGE_ICON_NAMES`. */
const ICON_NAMES = [
  "award",
  "trophy",
  "medal",
  "star",
  "heart",
  "sparkles",
  "users-round",
  "lightbulb",
  "heart-handshake",
  "graduation-cap",
  "rocket",
];

function dialogNode(badge: KudosBadgeAdminDto | null, handlers: Handlers) {
  return <BadgeFormDialog badge={badge} {...handlers} />;
}
interface Handlers {
  onClose: () => void;
  onOutcome: (outcome: unknown) => void;
  onStale: () => void;
}
function renderDialog(badge: KudosBadgeAdminDto | null = null) {
  const handlers = { onClose: vi.fn(), onOutcome: vi.fn(), onStale: vi.fn() };
  const view = renderWithProviders(dialogNode(badge, handlers));
  return {
    ...view,
    ...handlers,
    show: (next: KudosBadgeAdminDto | null) => view.rerender(dialogNode(next, handlers)),
  };
}

const dialog = (mode: "create" | "edit"): HTMLElement =>
  screen.getByRole("dialog", { name: TITLE[mode] });
const box = (name: string): HTMLInputElement => screen.getByRole("textbox", { name });
const type = (name: string, value: string): void => {
  fireEvent.change(box(name), { target: { value } });
};
const iconSelect = (): HTMLSelectElement => screen.getByRole("combobox", { name: ICON });
const clickSave = (): void => {
  fireEvent.click(screen.getByRole("button", { name: SAVE }));
};
/** Phần tử mà `aria-describedby` của ô trỏ tới ĐẦU TIÊN — câu lỗi phải đứng trước gợi ý. */
const firstDescription = (el: HTMLElement): HTMLElement | null => {
  const firstId = (el.getAttribute("aria-describedby") ?? "").split(" ")[0] ?? "";
  return firstId === "" ? null : document.getElementById(firstId);
};
const sentCreate = (call = 0): unknown => createBadge.mock.calls[call]?.[0];
const sentAttemptId = (call = 0): unknown => createBadge.mock.calls[call]?.[1];

function fillValidCreate(): void {
  type(CODE, "sang-tao");
  type(NAME, "Sáng tạo");
}
async function saveAndWait(spy: typeof createBadge, calls = 1): Promise<void> {
  clickSave();
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(calls));
}

beforeEach(() => {
  // Hộp thoại không có cổng riêng (route đã gác `manage:feed-kudos`); caps chỉ để khung giống spec khác.
  setCaps({ "view:feed": true, "manage:feed-kudos": true });
  createBadge.mockReset();
  updateBadge.mockReset();
  createBadge.mockImplementation(() =>
    Promise.resolve(makeBadgeAdmin({ id: OTHER_ID, code: "sang-tao", name: "Sáng tạo" })),
  );
  updateBadge.mockImplementation(() => Promise.resolve(makeBadgeAdmin({ name: "Tên mới" })));
});
afterEach(() => {
  cleanup();
  resetCaps();
});

describe("F1 — TẠO (049)", () => {
  it("(role) `dialog` «Thêm huy hiệu»: đủ sáu ô có nhãn, ô mã NHẬP được, thứ tự mặc định 0", () => {
    renderDialog();
    expect(dialog("create")).toBeInTheDocument();
    expect(box(CODE)).toHaveValue("");
    expect(box(CODE)).not.toHaveAttribute("readonly");
    expect(box(NAME)).toHaveValue("");
    expect(box(DESCRIPTION)).toHaveValue("");
    expect(iconSelect()).toHaveValue("");
    expect(box(EMOJI)).toHaveValue("");
    expect(box(POSITION)).toHaveValue("0");
  });

  it("gửi ⇒ `createBadge(body, attemptId)`: body ĐÚNG các trường đã nhập, qua `createKudosBadgeSchema`; `updateBadge` 0 lần", async () => {
    const { onOutcome, onClose } = renderDialog();
    type(CODE, "sang-tao");
    type(NAME, "  Sáng tạo ");
    type(DESCRIPTION, "Ý tưởng mới");
    fireEvent.change(iconSelect(), { target: { value: "lightbulb" } });
    type(POSITION, "4");
    await saveAndWait(createBadge);

    expect(sentCreate()).toEqual({
      code: "sang-tao",
      name: "Sáng tạo",
      description: "Ý tưởng mới",
      icon: "lightbulb",
      position: 4,
    });
    expect(createKudosBadgeSchema.safeParse(sentCreate()).success).toBe(true);
    expect(String(sentAttemptId()).trim().length).toBeGreaterThan(0);
    expect(updateBadge).not.toHaveBeenCalled();

    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(onOutcome).toHaveBeenCalledWith({
      kind: "done",
      mode: "create",
      badge: makeBadgeAdmin({ id: OTHER_ID, code: "sang-tao", name: "Sáng tạo" }),
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("mã `A b` ⇒ lỗi TẠI Ô: `aria-invalid` + `aria-describedby` trỏ câu lỗi, focus về ô mã, 0 lời gọi; ô khác không bị đánh dấu", async () => {
    const { onOutcome, onClose } = renderDialog();
    type(CODE, "A b");
    type(NAME, "Sáng tạo");
    clickSave();

    expect(box(CODE)).toHaveAttribute("aria-invalid", "true");
    expect(firstDescription(box(CODE))).toHaveTextContent(CODE_INVALID);
    expect(box(CODE)).toHaveFocus();
    expect(box(NAME)).not.toHaveAttribute("aria-invalid", "true");
    expect(box(POSITION)).not.toHaveAttribute("aria-invalid", "true");
    // Cho react-query một nhịp: lời gọi (nếu lưới thủng) chạy SAU cú bấm.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createBadge).not.toHaveBeenCalled();
    expect(onOutcome).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Gõ lại ô đó ⇒ dấu lỗi của CHÍNH ô đó được gỡ; sửa xong gửi được.
    type(CODE, "sang-tao");
    expect(box(CODE)).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(CODE_INVALID)).toBeNull();
    await saveAndWait(createBadge);
    expect(sentCreate()).toEqual({ code: "sang-tao", name: "Sáng tạo", position: 0 });
  });

  it("nhiều ô sai ⇒ MỖI ô một câu lỗi riêng, focus về ô sai ĐẦU TIÊN; 0 lời gọi", async () => {
    renderDialog();
    type(CODE, "ok-code");
    type(POSITION, "x");
    clickSave();

    expect(box(CODE)).not.toHaveAttribute("aria-invalid", "true");
    expect(box(NAME)).toHaveAttribute("aria-invalid", "true");
    expect(firstDescription(box(NAME))).toHaveTextContent(NAME_INVALID);
    expect(box(POSITION)).toHaveAttribute("aria-invalid", "true");
    expect(firstDescription(box(POSITION))).toHaveTextContent(POSITION_INVALID);
    expect(box(NAME)).toHaveFocus();
    // Cho react-query một nhịp: lời gọi (nếu lưới thủng) chạy SAU cú bấm.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createBadge).not.toHaveBeenCalled();
  });
});

describe("F1 — SỬA (050)", () => {
  it("(role) `dialog` «Sửa huy hiệu»: ô mã `readOnly` mang mã của huy hiệu, các ô khác điền sẵn", () => {
    renderDialog(makeBadgeAdmin({ position: 3 }));
    expect(dialog("edit")).toBeInTheDocument();
    expect(box(CODE)).toHaveValue("team-player");
    expect(box(CODE)).toHaveAttribute("readonly");
    expect(box(NAME)).toHaveValue("Đồng đội");
    expect(box(DESCRIPTION)).toHaveValue("Luôn hỗ trợ đồng nghiệp");
    expect(iconSelect()).toHaveValue("users-round");
    expect(box(POSITION)).toHaveValue("3");
  });

  it("đổi MỘT trường ⇒ `updateBadge(id, body)` với body `toEqual` CHỈ trường đó (không `code`, không cả form); qua schema", async () => {
    const { onOutcome } = renderDialog(makeBadgeAdmin({ position: 3 }));
    type(NAME, "Tên mới");
    await saveAndWait(updateBadge);

    expect(updateBadge.mock.calls[0]?.[0]).toBe(BADGE_ID);
    expect(updateBadge.mock.calls[0]?.[1]).toEqual({ name: "Tên mới" });
    expect(updateKudosBadgeSchema.safeParse(updateBadge.mock.calls[0]?.[1]).success).toBe(true);
    expect(createBadge).not.toHaveBeenCalled();

    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(onOutcome).toHaveBeenCalledWith({
      kind: "done",
      mode: "edit",
      badge: makeBadgeAdmin({ name: "Tên mới" }),
    });
  });

  it("đổi hai trường ⇒ body ĐÚNG hai khoá đó", async () => {
    renderDialog(makeBadgeAdmin({ position: 3 }));
    type(DESCRIPTION, "");
    type(POSITION, "8");
    await saveAndWait(updateBadge);
    expect(updateBadge.mock.calls[0]?.[1]).toEqual({ description: null, position: 8 });
  });

  it("KHÔNG đổi gì ⇒ «Lưu» đóng hộp thoại (`onClose` 1 lần), 0 lời gọi, không có kết cục", async () => {
    const { onClose, onOutcome } = renderDialog(makeBadgeAdmin());
    clickSave();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateBadge).not.toHaveBeenCalled();
    expect(createBadge).not.toHaveBeenCalled();
    expect(onOutcome).not.toHaveBeenCalled();
  });
});

describe("F4 — icon", () => {
  it("`KUDOS_BADGE_ICON_NAMES` = ĐÚNG 11 tên của danh mục (viết tay); option của `<select>` `toEqual` nó, sau lựa chọn «Mặc định»", () => {
    expect([...KUDOS_BADGE_ICON_NAMES]).toEqual(ICON_NAMES);
    renderDialog();
    const options = within(iconSelect()).getAllByRole<HTMLOptionElement>("option");
    expect(options[0]).toHaveValue("");
    expect(options[0]).toHaveTextContent("Mặc định");
    expect(options.slice(1).map((o) => o.value)).toEqual(KUDOS_BADGE_ICON_NAMES);
    // Nhãn là chữ tiếng Việt thật, không phải khoá i18n thô và không trùng nhau.
    const labels = options.map((o) => o.textContent ?? "");
    for (const label of labels) expect(label).not.toMatch(/admin\.|badges\./);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("emoji ở ô emoji ⇒ body mang emoji đó (thắng ô chọn) và ô xem trước vẽ CHỮ emoji", async () => {
    renderDialog();
    fillValidCreate();
    fireEvent.change(iconSelect(), { target: { value: "star" } });
    expect(within(dialog("create")).getByTestId("kudos-badge-icon")).toBeInTheDocument();

    type(EMOJI, "🎉");
    expect(within(dialog("create")).getByTestId("kudos-badge-emoji")).toHaveTextContent("🎉");
    await saveAndWait(createBadge);
    expect(sentCreate()).toEqual({ code: "sang-tao", name: "Sáng tạo", icon: "🎉", position: 0 });
  });

  it("SỬA huy hiệu đang mang emoji → CHỌN một biểu tượng trong danh mục ⇒ ô emoji được xoá, xem trước vẽ icon, «Lưu» gửi `{ icon }` (không đóng im lặng)", async () => {
    const { onClose } = renderDialog(makeBadgeAdmin({ icon: "🎉" }));
    expect(box(EMOJI)).toHaveValue("🎉");
    expect(iconSelect()).toHaveValue("");

    fireEvent.change(iconSelect(), { target: { value: "star" } });
    expect(box(EMOJI)).toHaveValue("");
    expect(within(dialog("edit")).getByTestId("kudos-badge-icon")).toBeInTheDocument();
    expect(within(dialog("edit")).queryByTestId("kudos-badge-emoji")).toBeNull();

    await saveAndWait(updateBadge);
    expect(updateBadge.mock.calls[0]?.[0]).toBe(BADGE_ID);
    expect(updateBadge.mock.calls[0]?.[1]).toEqual({ icon: "star" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("chọn lại «Mặc định» ở ô biểu tượng KHÔNG xoá ô emoji (chỉ lựa chọn có giá trị mới thay emoji)", () => {
    renderDialog(makeBadgeAdmin({ icon: "🎉" }));
    fireEvent.change(iconSelect(), { target: { value: "star" } });
    type(EMOJI, "🔥");
    fireEvent.change(iconSelect(), { target: { value: "" } });
    expect(box(EMOJI)).toHaveValue("🔥");
  });
});

describe("gắn ĐÚNG huy hiệu khi đích đổi (PR-A: nháp sống qua lần đổi đích từng ghi NHẦM đối tượng)", () => {
  it("đang sửa A (đã gõ dở) → nơi mount đổi sang B ⇒ nháp của A bị bỏ, form mang dữ liệu B, lưu gửi ĐÚNG id của B", async () => {
    const a = makeBadgeAdmin({ position: 3 });
    const b = makeBadgeAdmin({ id: OTHER_ID, code: "sang-tao", name: "Sáng tạo", position: 5 });
    const { show } = renderDialog(a);
    type(NAME, "Tên gõ dở cho A");

    show(b);
    expect(box(CODE)).toHaveValue("sang-tao");
    expect(box(NAME)).toHaveValue("Sáng tạo");
    expect(box(POSITION)).toHaveValue("5");

    type(POSITION, "6");
    await saveAndWait(updateBadge);
    expect(updateBadge.mock.calls[0]?.[0]).toBe(OTHER_ID);
    expect(updateBadge.mock.calls[0]?.[1]).toEqual({ position: 6 });
  });

  it("đang sửa → chuyển sang TẠO ⇒ form trống, ô mã nhập được; gửi đi là 049 chứ không phải 050", async () => {
    const { show } = renderDialog(makeBadgeAdmin());
    type(NAME, "Tên gõ dở");

    show(null);
    expect(dialog("create")).toBeInTheDocument();
    expect(box(CODE)).toHaveValue("");
    expect(box(CODE)).not.toHaveAttribute("readonly");
    expect(box(NAME)).toHaveValue("");

    fillValidCreate();
    await saveAndWait(createBadge);
    expect(updateBadge).not.toHaveBeenCalled();
  });
});

describe("`attemptId` của 049 — một lượt MỞ một giá trị (plan D20 · B22)", () => {
  const alertReason = (): string | null =>
    within(dialog("create")).getByRole("alert").getAttribute("data-reason");

  it("lỗi rồi gửi lại trong CÙNG lượt mở ⇒ cùng body, CÙNG `attemptId` (khác rỗng)", async () => {
    createBadge.mockRejectedValueOnce(ADMIN_ERR.idempotencyInProgress());
    renderDialog();
    fillValidCreate();
    clickSave();
    await waitFor(() => expect(alertReason()).toBe("busy"));

    await saveAndWait(createBadge, 2);
    expect(sentCreate(1)).toEqual(sentCreate(0));
    expect(typeof sentAttemptId(0)).toBe("string");
    expect(String(sentAttemptId(0)).trim().length).toBeGreaterThan(0);
    expect(sentAttemptId(1)).toBe(sentAttemptId(0));
  });

  it("đổi nội dung giữa hai lần gửi trong cùng lượt mở ⇒ `attemptId` KHÔNG đổi theo nội dung", async () => {
    createBadge.mockRejectedValueOnce(ADMIN_ERR.idempotencyInProgress());
    renderDialog();
    fillValidCreate();
    clickSave();
    await waitFor(() => expect(alertReason()).toBe("busy"));

    type(NAME, "Sáng tạo hơn");
    await saveAndWait(createBadge, 2);
    expect(sentCreate(1)).toMatchObject({ name: "Sáng tạo hơn" });
    expect(sentAttemptId(1)).toBe(sentAttemptId(0));
  });

  it("unmount → mount lại hộp thoại, gửi CÙNG body ⇒ `attemptId` KHÁC lượt trước và khác rỗng", async () => {
    const first = renderDialog();
    fillValidCreate();
    await saveAndWait(createBadge, 1);
    first.unmount();

    renderDialog();
    fillValidCreate();
    await saveAndWait(createBadge, 2);

    expect(sentCreate(1)).toEqual(sentCreate(0));
    const [a, b] = [sentAttemptId(0), sentAttemptId(1)];
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(String(a).trim().length).toBeGreaterThan(0);
    expect(String(b).trim().length).toBeGreaterThan(0);
    expect(b).not.toBe(a);
  });
});
