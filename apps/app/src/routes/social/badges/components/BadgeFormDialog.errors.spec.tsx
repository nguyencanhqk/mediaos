/**
 * S16-SOCIAL-FE-3B (L4) — `BadgeFormDialog`, đường LỖI của lượt ghi: ca F3 (mã lỗi 049 / 050 lên màn) · DC3
 * (vế hộp thoại: bấm đúp «Lưu») · mất mạng · yêu cầu TREO. Focus khi đóng: `BadgeFormDialog.focus.spec.tsx`.
 *
 * Bài học gate PR-A áp cho lượt GHI: tách «server ĐÃ từ chối» (4xx — chưa ghi) khỏi «chưa xác nhận được kết
 * quả» (5xx · hết hạn · mất phản hồi · 2xx sai schema — có thể ĐÃ ghi ⇒ báo trang đọc lại danh sách), và
 * không lượt gửi nào được khoá hộp thoại không lối ra.
 *
 * i18n THẬT; lỗi dựng bằng `ADMIN_ERR` (`message` là chữ của SERVER — không được lên màn).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { ZodError } from "zod";
import type { KudosBadgeAdminDto } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import {
  ADMIN_ERR,
  advanceFakeTimers,
  BADGE_ID,
  makeBadgeAdmin,
} from "../../admin/admin-test-doubles";
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

const CODE = "Mã huy hiệu";
const NAME = "Tên huy hiệu";
const SAVE = "Lưu";
const CANCEL = "Huỷ";
const RETRY = "Thử lại";
const CODE_TAKEN_TEXT =
  "Mã huy hiệu này đã được dùng. Hãy nhập mã khác; nếu huy hiệu cũ đang ngừng dùng, bạn có thể bật lại nó trong danh sách.";
const OUTCOME_UNKNOWN_TEXT =
  "Chưa xác nhận được kết quả: máy chủ không phản hồi hoặc báo lỗi hệ thống, nhưng thao tác có thể đã được ghi. Hãy kiểm tra lại danh sách trước khi thực hiện lần nữa.";

function renderDialog(badge: KudosBadgeAdminDto | null = null) {
  const handlers = { onClose: vi.fn(), onOutcome: vi.fn(), onStale: vi.fn() };
  const view = renderWithProviders(<BadgeFormDialog badge={badge} {...handlers} />);
  return { ...view, ...handlers };
}

const dialog = (): HTMLElement => screen.getByRole("dialog");
const box = (name: string): HTMLInputElement => screen.getByRole("textbox", { name });
const type = (name: string, value: string): void => {
  fireEvent.change(box(name), { target: { value } });
};
const saveButton = (): HTMLElement => screen.getByRole("button", { name: SAVE });
const clickSave = (): void => {
  fireEvent.click(saveButton());
};
const cancelButton = (): HTMLElement => screen.getByRole("button", { name: CANCEL });
const alertReason = (): string | null =>
  within(dialog()).getByRole("alert").getAttribute("data-reason");
const sentAttemptId = (call = 0): unknown => createBadge.mock.calls[call]?.[1];
const hang = (): Promise<never> => new Promise<never>(() => undefined);

function fillValidCreate(): void {
  type(CODE, "sang-tao");
  type(NAME, "Sáng tạo");
}
/** Mở ở chế độ SỬA và đổi tên — một nháp gửi được. */
function renderEditWithChange() {
  const view = renderDialog(makeBadgeAdmin());
  type(NAME, "Tên mới");
  return view;
}

beforeEach(() => {
  setCaps({ "view:feed": true, "manage:feed-kudos": true });
  createBadge.mockReset();
  updateBadge.mockReset();
  createBadge.mockImplementation(() => Promise.resolve(makeBadgeAdmin({ code: "sang-tao" })));
  updateBadge.mockImplementation(() => Promise.resolve(makeBadgeAdmin({ name: "Tên mới" })));
});
afterEach(() => {
  cleanup();
  resetCaps();
  vi.useRealTimers();
  onlineManager.setOnline(true);
});

describe("F3 — lỗi 049 (tạo)", () => {
  it("409 `CODE-TAKEN` ⇒ dải `badgeCodeTaken` GẮN Ô MÃ (`aria-invalid` + `aria-describedby`), giữ hộp thoại + nháp, báo trang đọc lại, KHÔNG «Thử lại», không lộ chữ server", async () => {
    createBadge.mockRejectedValueOnce(ADMIN_ERR.badgeCodeTaken());
    const { onClose, onOutcome, onStale } = renderDialog();
    fillValidCreate();
    clickSave();

    await waitFor(() => expect(alertReason()).toBe("badgeCodeTaken"));
    const alert = within(dialog()).getByRole("alert");
    expect(alert).toHaveTextContent(CODE_TAKEN_TEXT);
    expect(box(CODE)).toHaveAttribute("aria-invalid", "true");
    const describedBy = (box(CODE).getAttribute("aria-describedby") ?? "").split(" ");
    expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toContain(
      CODE_TAKEN_TEXT,
    );
    expect(box(NAME)).not.toHaveAttribute("aria-invalid", "true");
    expect(within(dialog()).queryByRole("button", { name: RETRY })).toBeNull();
    expect(dialog()).not.toHaveTextContent("SOCIAL-ERR");
    expect(dialog()).not.toHaveTextContent("mã huy hiệu đã tồn tại");
    expect(box(CODE)).toHaveValue("sang-tao");
    expect(box(NAME)).toHaveValue("Sáng tạo");
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onOutcome).not.toHaveBeenCalled();

    // Sửa mã ⇒ dải + dấu lỗi của ô mã được gỡ; gửi lại được.
    type(CODE, "sang-tao-2");
    expect(within(dialog()).queryByRole("alert")).toBeNull();
    expect(box(CODE)).not.toHaveAttribute("aria-invalid", "true");
    clickSave();
    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(createBadge).toHaveBeenCalledTimes(2);
  });

  it("409 idempotency đang chạy ⇒ `busy` (KHÔNG phải `badgeCodeTaken`): ô mã không bị đánh dấu, có «Thử lại» gửi CÙNG `attemptId`", async () => {
    createBadge.mockRejectedValueOnce(ADMIN_ERR.idempotencyInProgress());
    const { onStale } = renderDialog();
    fillValidCreate();
    clickSave();

    await waitFor(() => expect(alertReason()).toBe("busy"));
    expect(box(CODE)).not.toHaveAttribute("aria-invalid", "true");
    expect(onStale).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole("button", { name: RETRY }));
    await waitFor(() => expect(createBadge).toHaveBeenCalledTimes(2));
    expect(sentAttemptId(1)).toBe(sentAttemptId(0));
  });

  it("400 ⇒ `invalidRequest`: giữ hộp thoại + nháp, không «Thử lại», không báo trang", async () => {
    createBadge.mockRejectedValueOnce(ADMIN_ERR.badRequest());
    const { onClose, onOutcome, onStale } = renderDialog();
    fillValidCreate();
    clickSave();

    await waitFor(() => expect(alertReason()).toBe("invalidRequest"));
    expect(within(dialog()).queryByRole("button", { name: RETRY })).toBeNull();
    expect(dialog()).not.toHaveTextContent("Validation failed");
    expect(box(NAME)).toHaveValue("Sáng tạo");
    expect(saveButton()).toBeEnabled();
    expect(onStale).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("403 ⇒ kết cục `forbidden` giao cho TRANG (`onOutcome` 1 lần, không invalidate), không `onClose`; sau đó «Lưu» khoá", async () => {
    createBadge.mockRejectedValueOnce(ADMIN_ERR.forbidden());
    const { onClose, onOutcome } = renderDialog();
    fillValidCreate();
    clickSave();

    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(onOutcome).toHaveBeenCalledWith({
      kind: "failed",
      mode: "create",
      reason: "forbidden",
      invalidate: false,
    });
    expect(onClose).not.toHaveBeenCalled();
    // Trang chậm unmount cũng không gửi được lượt hai và không nhận thêm `onClose`.
    await waitFor(() => expect(saveButton()).toBeDisabled());
    clickSave();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(createBadge).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("F3 — lỗi 050 (sửa)", () => {
  it("404 `NOT-FOUND` ⇒ kết cục `badgeGone` + `invalidate: true` giao cho trang; không `onClose`", async () => {
    updateBadge.mockRejectedValueOnce(ADMIN_ERR.badgeGone());
    const { onClose, onOutcome } = renderEditWithChange();
    clickSave();

    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(onOutcome).toHaveBeenCalledWith({
      kind: "failed",
      mode: "edit",
      reason: "badgeGone",
      invalidate: true,
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(updateBadge.mock.calls[0]?.[0]).toBe(BADGE_ID);
  });

  it("500 ⇒ `outcomeUnknown` (KHÔNG «không thực hiện được»): giữ hộp thoại + nháp, báo trang đọc lại NGAY, có «Thử lại», «Huỷ» đóng được", async () => {
    updateBadge.mockRejectedValueOnce(ADMIN_ERR.server());
    const { onClose, onOutcome, onStale } = renderEditWithChange();
    clickSave();

    await waitFor(() => expect(alertReason()).toBe("outcomeUnknown"));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(OUTCOME_UNKNOWN_TEXT);
    expect(dialog()).not.toHaveTextContent("boom");
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onOutcome).not.toHaveBeenCalled();
    expect(box(NAME)).toHaveValue("Tên mới");
    expect(within(dialog()).getByRole("button", { name: RETRY })).toBeInTheDocument();

    await waitFor(() => expect(cancelButton()).toBeEnabled());
    fireEvent.click(cancelButton());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("2xx mà thân hỏng schema (`ZodError`) ⇒ `outcomeUnknown` + báo trang đọc lại — server CHẮC CHẮN đã ghi", async () => {
    updateBadge.mockRejectedValueOnce(new ZodError([]));
    const { onOutcome, onStale } = renderEditWithChange();
    clickSave();

    await waitFor(() => expect(alertReason()).toBe("outcomeUnknown"));
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("đóng dải lỗi ⇒ dải biến mất; hộp thoại còn, nháp còn nguyên", async () => {
    updateBadge.mockRejectedValueOnce(ADMIN_ERR.badRequest());
    const { onClose } = renderEditWithChange();
    clickSave();
    await waitFor(() => expect(alertReason()).toBe("invalidRequest"));

    fireEvent.click(within(dialog()).getByRole("button", { name: "Đóng thông báo" }));
    expect(within(dialog()).queryByRole("alert")).toBeNull();
    expect(box(NAME)).toHaveValue("Tên mới");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("DC3 — bấm đúp «Lưu» chỉ gửi MỘT lần", () => {
  it("promise treo: bấm «Lưu» 2 lần ⇒ 1 lời gọi, nút `disabled` + `aria-busy`; «Huỷ» · Esc không đóng giữa chừng", async () => {
    updateBadge.mockImplementation(hang);
    const { onClose } = renderEditWithChange();
    clickSave();
    await waitFor(() => expect(saveButton()).toBeDisabled());
    clickSave();
    fireEvent.click(cancelButton());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(updateBadge).toHaveBeenCalledTimes(1);
    expect(saveButton()).toHaveAttribute("aria-busy", "true");
    expect(onClose).not.toHaveBeenCalled();
  });

  // `isPending` tới màn sau một nhịp của react-query ⇒ giữa hai kích hoạt sát nhau nút CHƯA `disabled`.
  // Hai cú bấm nằm trong CÙNG một `act`: `fireEvent` bọc `act` riêng cho từng cú, kịp vẽ lại nút đã khoá
  // giữa hai cú — khi đó ca xanh nhờ `disabled` chứ không nhờ khoá đồng bộ, và mutant «bỏ khoá» sống sót.
  it("hai kích hoạt TRONG CÙNG MỘT NHỊP (màn chưa kịp vẽ lại) ⇒ vẫn chỉ MỘT lời gọi (049)", async () => {
    createBadge.mockImplementation(hang);
    renderDialog();
    fillValidCreate();
    const button = saveButton();

    act(() => {
      button.click();
      button.click();
    });

    await waitFor(() => expect(saveButton()).toBeDisabled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createBadge).toHaveBeenCalledTimes(1);
  });

  it("Esc CÙNG NHỊP với «Lưu» (nút chưa kịp khoá) ⇒ KHÔNG đóng; trang nhận ĐÚNG một kết cục", async () => {
    const { onClose, onOutcome } = renderEditWithChange();
    const button = saveButton();

    // Cùng MỘT `act` — lý do như ca «hai kích hoạt trong cùng một nhịp» ở trên.
    act(() => {
      button.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(updateBadge).toHaveBeenCalledTimes(1);
  });
});

describe("Mất mạng (trình duyệt báo offline)", () => {
  it("lượt ghi VẪN lên dây và hỏng ngay ⇒ dải `outcomeUnknown` + «Thử lại»; «Huỷ» đóng được", async () => {
    createBadge.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    const { onClose } = renderDialog();
    fillValidCreate();
    onlineManager.setOnline(false);

    clickSave();

    await waitFor(() => expect(createBadge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alertReason()).toBe("outcomeUnknown"));
    expect(within(dialog()).getByRole("button", { name: RETRY })).toBeInTheDocument();
    await waitFor(() => expect(cancelButton()).toBeEnabled());
    fireEvent.click(cancelButton());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// `apiFetch` không có timeout: yêu cầu treo giữ `isPending` tới khi TCP cắt, mà hộp thoại chặn mọi đường
// đóng lúc đang gửi ⇒ lớp phủ không lối ra. Hạn chờ 30 giây viết TAY (không đọc hằng của mã nguồn).
describe("Yêu cầu TREO — trình duyệt vẫn báo online, server không trả lời", () => {
  it("049 treo: trước 30 giây còn khoá; quá hạn ⇒ `outcomeUnknown`, trang được báo đọc lại, «Huỷ» mở; «Thử lại» gửi CÙNG `attemptId`", async () => {
    createBadge.mockImplementationOnce(hang);
    const { onClose, onOutcome, onStale } = renderDialog();
    fillValidCreate();
    vi.useFakeTimers();

    clickSave();
    await advanceFakeTimers(29_999);

    expect(createBadge).toHaveBeenCalledTimes(1);
    expect(within(dialog()).queryByRole("alert")).toBeNull();
    expect(cancelButton()).toBeDisabled();
    expect(onStale).not.toHaveBeenCalled();

    await advanceFakeTimers(1);
    await advanceFakeTimers(0);

    expect(alertReason()).toBe("outcomeUnknown");
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(cancelButton()).toBeEnabled();
    expect(box(NAME)).toHaveValue("Sáng tạo");
    expect(onClose).not.toHaveBeenCalled();

    // Server có thể ĐÃ ghi lượt treo ⇒ lượt lặp phải mang cùng khoá idempotency (cùng `attemptId`).
    fireEvent.click(within(dialog()).getByRole("button", { name: RETRY }));
    await advanceFakeTimers(0);

    expect(createBadge).toHaveBeenCalledTimes(2);
    expect(sentAttemptId(1)).toBe(sentAttemptId(0));
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ kind: "done" }));
  });

  it("050 treo quá hạn rồi bấm «Huỷ» ⇒ đóng được (`onClose` 1 lần) — trang ĐÃ được báo đọc lại trước đó", async () => {
    updateBadge.mockImplementation(hang);
    const { onClose, onStale } = renderEditWithChange();
    vi.useFakeTimers();

    clickSave();
    await advanceFakeTimers(30_000);
    await advanceFakeTimers(0);

    expect(alertReason()).toBe("outcomeUnknown");
    expect(onStale).toHaveBeenCalledTimes(1);
    fireEvent.click(cancelButton());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
