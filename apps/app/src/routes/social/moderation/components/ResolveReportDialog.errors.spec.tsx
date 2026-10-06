/**
 * S16-SOCIAL-FE-3 (L2) — hộp thoại kết thúc báo cáo `ResolveReportDialog` (SOCIAL-API-029), NHÓM CA LỖI +
 * KẾT CỤC: E1–E6 · E9–E11 của bảng lỗi plan §3 L2. Nhóm ca chữ/body/cổng/bấm đúp (B1 · B2 · G3 · DC1) ở
 * `ResolveReportDialog.spec.tsx` — tách hai file để mỗi file dưới ~500 dòng.
 *
 * Phân vai đo ở đây:
 *  · Lỗi «giữ hộp thoại» (E2 · E3 · E4 · E5 · E10 · E11): dải `role="alert"` nằm TRONG hộp thoại, nháp
 *    còn nguyên, `onOutcome` KHÔNG được gọi.
 *  · Kết cục «đóng» (thành công · E1 · E6 · E9): hộp thoại KHÔNG vẽ dải, KHÔNG invalidate — chỉ báo lên
 *    trang qua `onOutcome`. Việc trang làm với nó đo ở spec của trang.
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY; lỗi dựng bằng `ADMIN_ERR` (đúng hình dạng trên dây, `message` là chữ
 * của SERVER — ca E2 assert nó không lên màn).
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { ApiError } from "@mediaos/web-core";
import { FEED_NOTE_MAX, resolveFeedReportSchema, type FeedReportDto } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import { ADMIN_ERR, advanceFakeTimers, makeReport } from "../../admin/admin-test-doubles";
import { ResolveReportDialog } from "./ResolveReportDialog";

const resolveReport = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialModerationApi: {
      ...actual.socialModerationApi,
      resolveReport: (...a: unknown[]) => resolveReport(...a),
    },
  };
});

const FULL_MODERATOR = {
  "view:feed": true,
  "view:feed-report": true,
  "manage:feed-report": true,
  "manage:feed-post": true,
};

const TITLE = "Xử lý báo cáo";
const RESOLVED = "Giải quyết";
const DISMISSED = "Bỏ qua";
const NO_ACTION = "Không kèm hành động";
const NOTE = "Ghi chú xử lý (không bắt buộc)";
const SUBMIT = "Xác nhận";
const CANCEL = "Huỷ";
const RETRY = "Thử lại";
const UNAVAILABLE_HINT =
  "Nội dung bị báo cáo không còn thao tác được nên hành động kèm đã được đưa về «Không kèm hành động». Bấm «Xác nhận» để kết thúc báo cáo mà không kèm hành động.";
const TARGETS = {
  post: { confirmLabel: "Tôi hiểu bài sẽ bị xoá; hiện chưa có màn khôi phục" },
};

function renderDialog(report: FeedReportDto = makeReport()) {
  const onClose = vi.fn();
  const onOutcome = vi.fn();
  const onStale = vi.fn();
  renderWithProviders(
    <ResolveReportDialog
      report={report}
      onClose={onClose}
      onOutcome={onOutcome}
      onStale={onStale}
    />,
  );
  return { report, onClose, onOutcome, onStale };
}

const dialog = (): HTMLElement => screen.getByRole("dialog", { name: TITLE });
const radio = (name: string): HTMLInputElement => screen.getByRole("radio", { name });
const pick = (name: string): void => {
  fireEvent.click(radio(name));
};
const submitButton = (): HTMLElement => screen.getByRole("button", { name: SUBMIT });
const clickSubmit = (): void => {
  fireEvent.click(submitButton());
};
const noteBox = (): HTMLElement => screen.getByRole("textbox", { name: NOTE });
const alertReason = (): string | null =>
  within(dialog()).getByRole("alert").getAttribute("data-reason");
const sentBody = (call = 0): unknown => resolveReport.mock.calls[call]?.[1];

async function submitAndWait(calls = 1): Promise<void> {
  clickSubmit();
  await waitFor(() => expect(resolveReport).toHaveBeenCalledTimes(calls));
}

beforeEach(() => {
  setCaps(FULL_MODERATOR);
  resolveReport.mockReset();
  resolveReport.mockImplementation((_id: string) => Promise.resolve(makeReport()));
});
afterEach(() => {
  cleanup();
  resetCaps();
});

describe("Lỗi GIỮ hộp thoại — dải lỗi nằm trong hộp thoại, không báo kết cục", () => {
  it("E2 `REPORT-BUSY`: hộp thoại CÒN, bấm «Xác nhận» lại được; không lộ thông điệp server", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportBusy());
    const { onOutcome, onClose } = renderDialog();
    pick(DISMISSED);
    clickSubmit();

    await waitFor(() => expect(alertReason()).toBe("reportBusy"));
    expect(dialog()).not.toHaveTextContent("SOCIAL-ERR");
    expect(onOutcome).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(submitButton()).toBeEnabled();

    await submitAndWait(2);
    expect(sentBody(1)).toEqual({ status: "dismissed" });
    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
  });

  it("E3 `REPORT-ACTION-DENIED`: hành động về «không», không nút thử lại, không gợi ý của E5; gửi lại ⇒ không `action`", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportActionDenied());
    const { onOutcome } = renderDialog();
    pick(RESOLVED);
    pick("Ẩn bài");
    clickSubmit();

    await waitFor(() => expect(alertReason()).toBe("reportActionDenied"));
    expect(sentBody(0)).toEqual({ status: "resolved", action: "hide_post" });
    expect(radio(NO_ACTION)).toBeChecked();
    expect(radio("Ẩn bài")).not.toBeChecked();
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(screen.queryByText(UNAVAILABLE_HINT)).toBeNull();
    expect(onOutcome).not.toHaveBeenCalled();

    await submitAndWait(2);
    expect(sentBody(1)).toEqual({ status: "resolved" });
  });

  it("E4 `REPORT-ACTION-INVALID-FOR-TARGET`: giữ hộp thoại VÀ giữ lựa chọn để người dùng tự đổi", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportActionInvalid());
    const { onOutcome } = renderDialog();
    pick(RESOLVED);
    pick("Khoá bình luận của bài");
    clickSubmit();

    await waitFor(() => expect(alertReason()).toBe("reportActionInvalid"));
    expect(radio("Khoá bình luận của bài")).toBeChecked();
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("E5 `REPORT-ACTION-TARGET-UNAVAILABLE`: hành động về «không», ô tick mất, có gợi ý kết thúc không kèm hành động", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportTargetUnavailable());
    const { onOutcome } = renderDialog();
    pick(RESOLVED);
    expect(screen.queryByText(UNAVAILABLE_HINT)).toBeNull();
    pick("Xoá bài");
    fireEvent.click(screen.getByRole("checkbox", { name: TARGETS.post.confirmLabel }));
    clickSubmit();

    await waitFor(() => expect(alertReason()).toBe("reportTargetUnavailable"));
    expect(radio(NO_ACTION)).toBeChecked();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(UNAVAILABLE_HINT)).toBeInTheDocument();
    expect(onOutcome).not.toHaveBeenCalled();

    await submitAndWait(2);
    expect(sentBody(1)).toEqual({ status: "resolved" });
  });

  it("E5 — gợi ý chỉ đúng khi hành động CÒN ở «không»: chọn lại một hành động ⇒ gợi ý biến mất, hành động đi vào body", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportTargetUnavailable());
    renderDialog();
    pick(RESOLVED);
    pick("Khoá bình luận của bài");
    clickSubmit();

    await waitFor(() => expect(alertReason()).toBe("reportTargetUnavailable"));
    expect(screen.getByText(UNAVAILABLE_HINT)).toBeInTheDocument();

    pick("Ẩn bài");
    expect(radio("Ẩn bài")).toBeChecked();
    expect(screen.queryByText(UNAVAILABLE_HINT)).toBeNull();

    await submitAndWait(2);
    expect(sentBody(1)).toEqual({ status: "resolved", action: "hide_post" });
  });

  it("E10 — 400 của server: `invalidRequest`, giữ hộp thoại, không nút thử lại", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.badRequest());
    const { onOutcome } = renderDialog();
    pick(DISMISSED);
    clickSubmit();

    await waitFor(() => expect(alertReason()).toBe("invalidRequest"));
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("E10 — body không qua schema contracts (ghi chú quá trần) ⇒ KHÔNG gửi, báo `invalidRequest`; sửa lại ⇒ gửi được", async () => {
    const { onOutcome } = renderDialog();
    pick(DISMISSED);
    fireEvent.change(noteBox(), { target: { value: "a".repeat(FEED_NOTE_MAX + 1) } });
    clickSubmit();

    expect(alertReason()).toBe("invalidRequest");

    fireEvent.change(noteBox(), { target: { value: "a".repeat(FEED_NOTE_MAX) } });
    await submitAndWait();
    // «KHÔNG gửi» của cú bấm quá trần đo SAU khi lượt hợp lệ xong: `mutationFn` chạy sau vài nhịp
    // microtask nên đếm ngay sau cú bấm thì luôn bằng 0.
    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(sentBody(0)).toEqual({ status: "dismissed", resolutionNote: "a".repeat(FEED_NOTE_MAX) });
    expect(resolveFeedReportSchema.safeParse(sentBody(0)).success).toBe(true);
  });

  it("E11 — 500: `outcomeUnknown` (5xx không chứng minh «chưa ghi») + «Thử lại» gửi lại; ghi chú đã nhập còn nguyên", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.server());
    const { onOutcome } = renderDialog();
    pick(DISMISSED);
    fireEvent.change(noteBox(), { target: { value: "Đã trao đổi trực tiếp" } });
    clickSubmit();

    await waitFor(() => expect(alertReason()).toBe("outcomeUnknown"));
    expect(noteBox()).toHaveValue("Đã trao đổi trực tiếp");
    expect(onOutcome).not.toHaveBeenCalled();

    fireEvent.click(within(dialog()).getByRole("button", { name: RETRY }));
    await waitFor(() => expect(resolveReport).toHaveBeenCalledTimes(2));
    expect(sentBody(1)).toEqual({ status: "dismissed", resolutionNote: "Đã trao đổi trực tiếp" });
  });
});

/** Ba đường đóng của hộp thoại — cả ba đều đi qua `close()`. */
const CLOSERS = [
  { closer: "Esc", close: () => fireEvent.keyDown(document, { key: "Escape" }) },
  { closer: "bấm ra ngoài", close: () => fireEvent.click(dialog().parentElement as HTMLElement) },
  {
    closer: "nút «Huỷ»",
    close: () => fireEvent.click(screen.getByRole("button", { name: CANCEL })),
  },
];

/** Mỗi lỗi «giữ hộp thoại» của bảng lỗi plan §3 L2: cách dựng nháp để lượt gửi đầu nhận đúng lỗi đó. */
const KEPT_ERRORS = [
  { name: "E2", err: ADMIN_ERR.reportBusy, reason: "reportBusy", picks: [DISMISSED] },
  {
    name: "E3",
    err: ADMIN_ERR.reportActionDenied,
    reason: "reportActionDenied",
    picks: [RESOLVED, "Ẩn bài"],
  },
  {
    name: "E4",
    err: ADMIN_ERR.reportActionInvalid,
    reason: "reportActionInvalid",
    picks: [RESOLVED, "Khoá bình luận của bài"],
  },
  {
    name: "E5",
    err: ADMIN_ERR.reportTargetUnavailable,
    reason: "reportTargetUnavailable",
    picks: [RESOLVED, "Ẩn bài"],
  },
  { name: "E10 (400)", err: ADMIN_ERR.badRequest, reason: "invalidRequest", picks: [DISMISSED] },
  { name: "E11 (500)", err: ADMIN_ERR.server, reason: "outcomeUnknown", picks: [DISMISSED] },
  {
    name: "4xx mã lạ",
    err: () => new ApiError(409, "SOME-UNKNOWN-CONFLICT", "x"),
    reason: "generic",
    picks: [DISMISSED],
  },
];

// Cờ chặn gửi-đúp phải nhả sau MỌI lỗi giữ hộp thoại. Kẹt ⇒ «Xác nhận» trông bấm được mà không gửi gì,
// và `close()` (cũng hỏi cờ đó) không đóng nữa: hộp thoại modal không lối ra.
describe("Sau lỗi GIỮ hộp thoại — cờ chặn gửi-đúp đã nhả: gửi lại được, đóng được", () => {
  it("E4: đổi sang hành động khác rồi «Xác nhận» ⇒ lượt HAI lên dây với hành động mới", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportActionInvalid());
    const { onOutcome } = renderDialog();
    pick(RESOLVED);
    pick("Khoá bình luận của bài");
    clickSubmit();
    await waitFor(() => expect(alertReason()).toBe("reportActionInvalid"));

    pick("Ẩn bài");
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await submitAndWait(2);

    expect(sentBody(0)).toEqual({ status: "resolved", action: "lock_comments" });
    expect(sentBody(1)).toEqual({ status: "resolved", action: "hide_post" });
    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
  });

  it("E10 (400 của server): sửa ghi chú rồi «Xác nhận» ⇒ lượt HAI lên dây với ghi chú mới", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.badRequest());
    const { onOutcome } = renderDialog();
    pick(DISMISSED);
    fireEvent.change(noteBox(), { target: { value: "bản đầu" } });
    clickSubmit();
    await waitFor(() => expect(alertReason()).toBe("invalidRequest"));

    fireEvent.change(noteBox(), { target: { value: "bản đã sửa" } });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await submitAndWait(2);

    expect(sentBody(0)).toEqual({ status: "dismissed", resolutionNote: "bản đầu" });
    expect(sentBody(1)).toEqual({ status: "dismissed", resolutionNote: "bản đã sửa" });
    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
  });

  describe.each(KEPT_ERRORS)("$name `$reason`", ({ err, reason, picks }) => {
    it.each(CLOSERS)("$closer ⇒ đóng được: `onClose` 1 lần, không kết cục", async ({ close }) => {
      resolveReport.mockRejectedValueOnce(err());
      const { onClose, onOutcome } = renderDialog();
      picks.forEach(pick);
      clickSubmit();
      await waitFor(() => expect(alertReason()).toBe(reason));
      // Dải lỗi lên màn TRƯỚC khi `isPending` về `false` — đóng ngay lúc đó là đo nhầm lưới «đang gửi».
      await waitFor(() => expect(screen.getByRole("button", { name: CANCEL })).toBeEnabled());

      close();

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onOutcome).not.toHaveBeenCalled();
      expect(resolveReport).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Kết cục ĐÓNG hộp thoại — báo lên trang qua `onOutcome`, hộp thoại không tự vẽ dải", () => {
  // Hợp đồng «mỗi lượt mở kết thúc bằng ĐÚNG MỘT trong hai»: trang chậm unmount sau `onOutcome` thì ba
  // đường đóng cũng không được báo thêm `onClose`.
  it.each([
    { name: "thành công", arrange: () => resolveReport.mockResolvedValueOnce(makeReport()) },
    {
      name: "E1 409 (kết cục lỗi)",
      arrange: () => resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportAlreadyDecided()),
    },
  ])(
    "sau kết cục ($name), hộp thoại CHƯA bị unmount ⇒ Esc · bấm ra ngoài · «Huỷ» KHÔNG gọi `onClose`",
    async ({ arrange }) => {
      arrange();
      const { onClose, onOutcome } = renderDialog();
      pick(DISMISSED);
      clickSubmit();
      await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByRole("button", { name: CANCEL })).toBeEnabled());

      CLOSERS.forEach(({ close }) => close());

      expect(onClose).not.toHaveBeenCalled();
      expect(onOutcome).toHaveBeenCalledTimes(1);
      expect(resolveReport).toHaveBeenCalledTimes(1);
    },
  );

  it("thành công kèm hành động ⇒ `done` mang báo cáo gốc, bản server trả và hành động ĐÃ gửi", async () => {
    const updated = makeReport({ status: "resolved", resolutionNote: "ok" });
    resolveReport.mockResolvedValueOnce(updated);
    const { report, onOutcome, onClose } = renderDialog();
    pick(RESOLVED);
    pick("Ẩn bài");
    clickSubmit();

    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(onOutcome).toHaveBeenCalledWith({ kind: "done", report, updated, action: "hide_post" });
    expect(onClose).not.toHaveBeenCalled();
    expect(submitButton()).toBeDisabled();
  });

  it("thành công không kèm hành động ⇒ `action: none`", async () => {
    const updated = makeReport({ status: "dismissed" });
    resolveReport.mockResolvedValueOnce(updated);
    const { report, onOutcome } = renderDialog();
    pick(DISMISSED);
    clickSubmit();

    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(onOutcome).toHaveBeenCalledWith({ kind: "done", report, updated, action: "none" });
  });

  it.each([
    {
      name: "E1 409 `SOCIAL-ERR-021`",
      err: ADMIN_ERR.reportAlreadyDecided,
      reason: "reportAlreadyDecided",
      invalidate: true,
      invalidatePosts: true,
    },
    {
      name: "E6 404 `SOCIAL-ERR-001`",
      err: ADMIN_ERR.reportGone,
      reason: "reportGone",
      invalidate: true,
      invalidatePosts: false,
    },
    {
      name: "E9 403 `AUTH-ERR-FORBIDDEN`",
      err: ADMIN_ERR.forbidden,
      reason: "forbidden",
      invalidate: false,
      invalidatePosts: false,
    },
  ])(
    "$name ⇒ `failed` với reason + HAI cờ invalidate; không có dải lỗi trong hộp thoại",
    async ({ err, reason, invalidate, invalidatePosts }) => {
      resolveReport.mockRejectedValueOnce(err());
      const { report, onOutcome, onClose } = renderDialog();
      pick(DISMISSED);
      clickSubmit();

      await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
      expect(onOutcome).toHaveBeenCalledWith({
        kind: "failed",
        report,
        reason,
        invalidate,
        invalidatePosts,
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(submitButton()).toBeDisabled();
    },
  );
});

// «Thử lại» trong dải lỗi gửi NHÁP ĐANG THẤY (cùng việc với «Xác nhận»). Nháp chưa gửi được (đổi sang
// «Xoá bài» nhưng chưa tick) mà nút vẫn đứng đó thì bấm vào KHÔNG có gì xảy ra (gate TS, TS-05).
describe("«Thử lại» chỉ có khi nháp đang thấy GỬI ĐƯỢC", () => {
  it("E2 rồi đổi sang «Xoá bài» (chưa tick) ⇒ KHÔNG còn nút «Thử lại», dải lỗi vẫn còn; tick ⇒ nút trở lại và gửi đúng nháp đang thấy", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportBusy());
    renderDialog();
    pick(RESOLVED);
    pick("Ẩn bài");
    clickSubmit();
    await waitFor(() => expect(alertReason()).toBe("reportBusy"));
    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(within(dialog()).getByRole("button", { name: RETRY })).toBeInTheDocument();

    pick("Xoá bài");

    expect(submitButton()).toBeDisabled();
    expect(alertReason()).toBe("reportBusy");
    expect(within(dialog()).queryByRole("button", { name: RETRY })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: TARGETS.post.confirmLabel }));
    fireEvent.click(within(dialog()).getByRole("button", { name: RETRY }));

    await waitFor(() => expect(resolveReport).toHaveBeenCalledTimes(2));
    expect(sentBody(0)).toEqual({ status: "resolved", action: "hide_post" });
    expect(sentBody(1)).toEqual({ status: "resolved", action: "delete_target" });
  });
});

// `networkMode` mặc định của react-query là `online`: trình duyệt báo mất mạng thì `mutate()` bị TẠM DỪNG
// — `isPending` mà không `onError`. Hộp thoại chặn mọi đường đóng khi đang gửi ⇒ modal không lối ra, không
// một dòng báo lỗi, cho tới khi có mạng lại (gate TS, TS-03).
describe("Mất mạng (trình duyệt báo offline)", () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("029 VẪN lên dây và hỏng ngay ⇒ dải `outcomeUnknown` + «Thử lại», «Huỷ» đóng được", async () => {
    resolveReport.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    const { onClose, onOutcome } = renderDialog();
    pick(DISMISSED);
    onlineManager.setOnline(false);

    clickSubmit();

    await waitFor(() => expect(resolveReport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alertReason()).toBe("outcomeUnknown"));
    expect(within(dialog()).getByRole("button", { name: RETRY })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: CANCEL })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: CANCEL }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOutcome).not.toHaveBeenCalled();
  });
});

// `apiFetch` không có timeout: yêu cầu treo (rớt Wi-Fi / VPN khi trình duyệt vẫn báo online) giữ `isPending`
// tới khi TCP cắt, mà hộp thoại chặn mọi đường đóng lúc đang gửi ⇒ lớp phủ không lối ra (gate code, CODE-01).
describe("Yêu cầu TREO — trình duyệt vẫn báo online, server không trả lời", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = advanceFakeTimers;

  it("029 treo: trước 30 giây còn khoá; quá hạn ⇒ dải `outcomeUnknown` + «Thử lại», yêu cầu bị huỷ, trang được báo đọc lại, «Huỷ» đóng được", async () => {
    resolveReport.mockImplementation(() => new Promise<never>(() => undefined));
    const { onClose, onOutcome, onStale } = renderDialog();
    pick(DISMISSED);
    fireEvent.change(noteBox(), { target: { value: "ghi chú còn nguyên" } });
    vi.useFakeTimers();

    clickSubmit();
    await advance(29_999);

    expect(resolveReport).toHaveBeenCalledTimes(1);
    const signal: unknown = resolveReport.mock.calls[0]?.[2];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect((signal as AbortSignal).aborted).toBe(false);
    expect(within(dialog()).queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: CANCEL })).toBeDisabled();
    expect(onStale).not.toHaveBeenCalled();

    await advance(1);
    await advance(0);

    expect(alertReason()).toBe("outcomeUnknown");
    // Hết hạn KHÔNG có nghĩa server chưa ghi (có thể đã ẩn / xoá bài) ⇒ trang đọc lại hàng đợi + bề mặt bài
    // NGAY, không chờ người dùng bấm «Thử lại» — họ có thể bấm «Huỷ» (gate SF, SF-02).
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith({ invalidatePosts: true });
    expect((signal as AbortSignal).aborted).toBe(true);
    expect(within(dialog()).getByRole("button", { name: RETRY })).toBeInTheDocument();
    expect(noteBox()).toHaveValue("ghi chú còn nguyên");
    expect(screen.getByRole("button", { name: CANCEL })).toBeEnabled();
    expect(onOutcome).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: CANCEL }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// Lỗi GIỮ hộp thoại mà tự chứng minh thứ đang thấy đã cũ (E5: đích không còn thao tác được) ⇒ báo trang
// làm mới hàng đợi qua `onStale`; hộp thoại vẫn không tự invalidate (gate code, CODE-04).
describe("`onStale` — lỗi giữ hộp thoại báo trang rằng hàng đợi đã cũ", () => {
  it("E5 ⇒ `onStale` đúng 1 lần, không kết cục, không đóng", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportTargetUnavailable());
    const { onClose, onOutcome, onStale } = renderDialog();
    pick(RESOLVED);
    pick("Ẩn bài");
    clickSubmit();

    await waitFor(() => expect(alertReason()).toBe("reportTargetUnavailable"));
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith({ invalidatePosts: false });
    expect(onOutcome).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  // 5xx không chứng minh «chưa ghi»: 502/503/504 của reverse proxy (API restart / treo) hoặc 500 nổ sau
  // commit ⇒ upstream có thể ĐÃ kết thúc báo cáo kèm ẩn / xoá bài (gate SF vòng 2, SF-02R-GATEWAY-5XX).
  it.each([
    ["E11 (500 có envelope)", ADMIN_ERR.server],
    ["502 `HTTP_ERROR`", () => new ApiError(502, "HTTP_ERROR", "502 /social/reports/x: <html>")],
    ["504 `HTTP_ERROR`", () => new ApiError(504, "HTTP_ERROR", "504 /social/reports/x:")],
  ])(
    "%s ⇒ dải `outcomeUnknown`, `onStale` đúng 1 lần KÈM bề mặt bài; không kết cục, không đóng",
    async (_label, makeError) => {
      resolveReport.mockRejectedValueOnce(makeError());
      const { onClose, onOutcome, onStale } = renderDialog();
      pick(RESOLVED);
      pick("Ẩn bài");
      clickSubmit();

      await waitFor(() => expect(alertReason()).toBe("outcomeUnknown"));
      expect(onStale).toHaveBeenCalledTimes(1);
      expect(onStale).toHaveBeenCalledWith({ invalidatePosts: true });
      expect(onOutcome).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["E2", ADMIN_ERR.reportBusy],
    ["E3", ADMIN_ERR.reportActionDenied],
    ["E4", ADMIN_ERR.reportActionInvalid],
    ["E10", ADMIN_ERR.badRequest],
    ["4xx mã lạ", () => new ApiError(409, "SOME-UNKNOWN-CONFLICT", "x")],
  ])(
    "%s ⇒ KHÔNG gọi `onStale` (không có gì chứng minh hàng đợi đã cũ)",
    async (_label, makeError) => {
      resolveReport.mockRejectedValueOnce(makeError());
      const { onStale } = renderDialog();
      pick(RESOLVED);
      pick("Ẩn bài");
      clickSubmit();

      await waitFor(() => expect(within(dialog()).getByRole("alert")).toBeInTheDocument());
      expect(onStale).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["E1", ADMIN_ERR.reportAlreadyDecided],
    ["E6", ADMIN_ERR.reportGone],
  ])("%s (kết cục ĐÓNG) ⇒ đi qua `onOutcome`, KHÔNG qua `onStale`", async (_label, makeError) => {
    resolveReport.mockRejectedValueOnce(makeError());
    const { onOutcome, onStale } = renderDialog();
    pick(DISMISSED);
    clickSubmit();

    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(onStale).not.toHaveBeenCalled();
  });
});
