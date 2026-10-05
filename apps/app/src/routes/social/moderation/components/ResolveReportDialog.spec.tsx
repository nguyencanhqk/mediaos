/**
 * S16-SOCIAL-FE-3 (L2) — hộp thoại kết thúc báo cáo `ResolveReportDialog` (SOCIAL-API-029): ca B1 · B2 ·
 * G3 · DC1 (vế 029) · E1–E6 · E9–E11 của plan §4 + kết cục báo lên TRANG.
 *
 * - Quyền đặt trên store THẬT (`setCaps`) TRƯỚC render — đo luật `useCan` thật, không đo mock.
 * - i18n THẬT; vế kỳ vọng là chữ tiếng Việt VIẾT TAY ⇒ thiếu khoá (i18next trả khoá thô) là đỏ (plan B18).
 * - Body gửi đi so `toEqual` với literal VIẾT TAY rồi qua CHÍNH `resolveFeedReportSchema` của contracts.
 * - «0 lời gọi» luôn đứng TRƯỚC một vế ALLOW cùng ca (bấm tiếp ⇒ có lời gọi) — vế vắng mặt có đối chứng.
 * - Hộp thoại KHÔNG invalidate và KHÔNG vẽ dải «kết cục»: ca kết cục chỉ đo thứ nó báo qua `onOutcome`.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEED_NOTE_MAX,
  resolveFeedReportSchema,
  type FeedReportActionDto,
  type FeedReportDto,
} from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import { ADMIN_ERR, makeReport, REPORT_ID } from "../../admin/admin-test-doubles";
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

const COMMENT_ID = "99999999-9999-4999-8999-999999999999";

/** Người xử lý báo cáo KHÔNG có quyền kiểm duyệt bài — được kết thúc báo cáo, không được kèm hành động. */
const REPORT_MANAGER = { "view:feed": true, "view:feed-report": true, "manage:feed-report": true };
const FULL_MODERATOR = { ...REPORT_MANAGER, "manage:feed-post": true };

const TITLE = "Xử lý báo cáo";
const DECISION_GROUP = "Quyết định";
const RESOLVED = "Giải quyết";
const DISMISSED = "Bỏ qua";
const ACTION_GROUP = "Hành động kèm";
const NO_ACTION = "Không kèm hành động";
const NOTE = "Ghi chú xử lý (không bắt buộc)";
const SUBMIT = "Xác nhận";
const CANCEL = "Huỷ";
const RETRY = "Thử lại";
const UNAVAILABLE_HINT =
  "Nội dung bị báo cáo không còn thao tác được nên hành động kèm đã được đưa về «Không kèm hành động». Bấm «Xác nhận» để kết thúc báo cáo mà không kèm hành động.";

type TargetType = FeedReportDto["targetType"];

/** Bảng «Theo `targetType`» của plan §3 L2 — VIẾT TAY, theo đúng thứ tự hiển thị. */
const TARGETS: Record<
  TargetType,
  {
    report: () => FeedReportDto;
    options: { action: FeedReportActionDto; label: string }[];
    deleteLabel: string;
    confirmLabel: string;
  }
> = {
  post: {
    report: () => makeReport(),
    options: [
      { action: "none", label: NO_ACTION },
      { action: "hide_post", label: "Ẩn bài" },
      { action: "lock_comments", label: "Khoá bình luận của bài" },
      { action: "delete_target", label: "Xoá bài" },
    ],
    deleteLabel: "Xoá bài",
    confirmLabel: "Tôi hiểu bài sẽ bị xoá; hiện chưa có màn khôi phục",
  },
  comment: {
    report: () => makeReport({ targetType: "comment", targetId: COMMENT_ID }),
    options: [
      { action: "none", label: NO_ACTION },
      { action: "lock_comments", label: "Khoá bình luận của bài chứa bình luận này" },
      { action: "delete_target", label: "Xoá bình luận này" },
    ],
    deleteLabel: "Xoá bình luận này",
    confirmLabel: "Tôi hiểu bình luận sẽ bị xoá; hiện chưa có màn khôi phục",
  },
};
const TARGET_TYPES: TargetType[] = ["post", "comment"];

function renderDialog(report: FeedReportDto = makeReport()) {
  const onClose = vi.fn();
  const onOutcome = vi.fn();
  renderWithProviders(
    <ResolveReportDialog report={report} onClose={onClose} onOutcome={onOutcome} />,
  );
  return { report, onClose, onOutcome };
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

/** Nhãn hiển thị của các radio trong một nhóm, theo thứ tự DOM. */
const radioLabels = (group: HTMLElement): (string | null | undefined)[] =>
  within(group)
    .getAllByRole("radio")
    .map((el) => el.closest("label")?.textContent);

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

describe("Khung + trợ năng", () => {
  it("`role=dialog` có tên; nhóm quyết định có nhãn nhóm và đúng hai lựa chọn; ghi chú có nhãn + trần ký tự", () => {
    renderDialog();
    expect(dialog()).toBeInTheDocument();
    expect(radioLabels(screen.getByRole("group", { name: DECISION_GROUP }))).toEqual([
      RESOLVED,
      DISMISSED,
    ]);
    expect(noteBox()).toHaveAttribute("maxlength", String(FEED_NOTE_MAX));
  });

  it("chưa chọn quyết định ⇒ «Xác nhận» khoá, bấm không gửi; chọn rồi ⇒ gửi được", async () => {
    renderDialog();
    expect(submitButton()).toBeDisabled();
    clickSubmit();
    expect(resolveReport).not.toHaveBeenCalled();

    pick(DISMISSED);
    await submitAndWait();
  });

  it("«Huỷ» gọi `onClose`, không gửi gì, không báo kết cục", () => {
    const { onClose, onOutcome } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: CANCEL }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(resolveReport).not.toHaveBeenCalled();
    expect(onOutcome).not.toHaveBeenCalled();
  });
});

describe.each(TARGET_TYPES)("B1 — chữ + body 029 cho đích `%s`", (targetType) => {
  const target = TARGETS[targetType];

  it("ô «Hành động kèm» liệt kê ĐÚNG các lựa chọn của loại đích, đúng chữ, đúng thứ tự", () => {
    renderDialog(target.report());
    pick(RESOLVED);
    expect(radioLabels(screen.getByRole("group", { name: ACTION_GROUP }))).toEqual(
      target.options.map((o) => o.label),
    );
    expect(radio(NO_ACTION)).toBeChecked();
  });

  it.each(target.options)(
    "«Giải quyết» + «$label» ⇒ body đúng hình dạng và qua schema contracts",
    async ({ action, label }) => {
      const { report } = renderDialog(target.report());
      pick(RESOLVED);
      pick(label);
      if (action === "delete_target") {
        fireEvent.click(screen.getByRole("checkbox", { name: target.confirmLabel }));
      }
      await submitAndWait();

      expect(resolveReport.mock.calls[0]?.[0]).toBe(report.id);
      expect(report.id).toBe(REPORT_ID);
      const expected = action === "none" ? { status: "resolved" } : { status: "resolved", action };
      expect(sentBody()).toEqual(expected);
      expect(resolveFeedReportSchema.safeParse(sentBody()).success).toBe(true);
    },
  );

  it("«Bỏ qua» ⇒ không có ô hành động; body chỉ có `status`", async () => {
    renderDialog(target.report());
    pick(RESOLVED);
    expect(screen.getByRole("group", { name: ACTION_GROUP })).toBeInTheDocument();
    pick(DISMISSED);
    expect(screen.queryByRole("group", { name: ACTION_GROUP })).toBeNull();
    await submitAndWait();

    expect(sentBody()).toEqual({ status: "dismissed" });
    expect(resolveFeedReportSchema.safeParse(sentBody()).success).toBe(true);
  });

  it("«Bỏ qua» SAU KHI đã chọn một hành động ⇒ body KHÔNG có khoá `action`", async () => {
    renderDialog(target.report());
    pick(RESOLVED);
    const chosen = target.options[1]?.label ?? "";
    pick(chosen);
    expect(radio(chosen)).toBeChecked();
    pick(DISMISSED);
    await submitAndWait();

    expect(sentBody()).toEqual({ status: "dismissed" });
    expect(Object.keys(sentBody() as object)).not.toContain("action");
  });

  it("ô tick xác nhận xoá nói rõ xoá CÁI GÌ + «hiện chưa có màn khôi phục»", () => {
    renderDialog(target.report());
    pick(RESOLVED);
    expect(screen.queryByRole("checkbox")).toBeNull();
    pick(target.deleteLabel);
    expect(screen.getByRole("checkbox", { name: target.confirmLabel })).not.toBeChecked();
  });
});

describe("B1 — riêng từng loại đích", () => {
  it("báo cáo BÌNH LUẬN không có «Ẩn bài» (đối chứng: báo cáo BÀI có)", () => {
    renderDialog(TARGETS.comment.report());
    pick(RESOLVED);
    expect(screen.getByRole("radio", { name: "Xoá bình luận này" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Ẩn bài" })).toBeNull();
    cleanup();

    renderDialog(TARGETS.post.report());
    pick(RESOLVED);
    expect(screen.getByRole("radio", { name: "Ẩn bài" })).toBeInTheDocument();
  });

  it("ghi chú có chữ ⇒ gửi bản đã trim; toàn khoảng trắng ⇒ bỏ khoá `resolutionNote`", async () => {
    renderDialog();
    pick(DISMISSED);
    fireEvent.change(noteBox(), { target: { value: "  Không vi phạm nội quy  " } });
    await submitAndWait();
    expect(sentBody()).toEqual({ status: "dismissed", resolutionNote: "Không vi phạm nội quy" });
    cleanup();

    resolveReport.mockClear();
    renderDialog();
    pick(DISMISSED);
    fireEvent.change(noteBox(), { target: { value: "   " } });
    await submitAndWait();
    expect(sentBody()).toEqual({ status: "dismissed" });
  });
});

describe("B2 — `delete_target` buộc tick xác nhận", () => {
  it.each(TARGET_TYPES)(
    "đích `%s`: chưa tick ⇒ nút khoá + 0 lời gọi; tick ⇒ gửi `delete_target`",
    async (targetType) => {
      const target = TARGETS[targetType];
      renderDialog(target.report());
      pick(RESOLVED);
      pick(target.deleteLabel);

      expect(submitButton()).toBeDisabled();
      clickSubmit();
      expect(resolveReport).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("checkbox", { name: target.confirmLabel }));
      expect(submitButton()).toBeEnabled();
      await submitAndWait();
      expect(sentBody()).toEqual({ status: "resolved", action: "delete_target" });
    },
  );

  it("bỏ chọn `delete_target` ⇒ ô tick biến mất; chọn lại ⇒ ô tick TRỐNG và nút lại khoá", () => {
    const target = TARGETS.post;
    renderDialog(target.report());
    pick(RESOLVED);
    pick(target.deleteLabel);
    fireEvent.click(screen.getByRole("checkbox", { name: target.confirmLabel }));
    expect(submitButton()).toBeEnabled();

    pick("Ẩn bài");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(submitButton()).toBeEnabled();

    pick(target.deleteLabel);
    expect(screen.getByRole("checkbox", { name: target.confirmLabel })).not.toBeChecked();
    expect(submitButton()).toBeDisabled();
  });

  it("đổi sang «Bỏ qua» rồi quay lại «Giải quyết» ⇒ tick KHÔNG sống sót", () => {
    const target = TARGETS.comment;
    renderDialog(target.report());
    pick(RESOLVED);
    pick(target.deleteLabel);
    fireEvent.click(screen.getByRole("checkbox", { name: target.confirmLabel }));
    pick(DISMISSED);
    expect(submitButton()).toBeEnabled();

    pick(RESOLVED);
    expect(radio(target.deleteLabel)).toBeChecked();
    expect(screen.getByRole("checkbox", { name: target.confirmLabel })).not.toBeChecked();
    expect(submitButton()).toBeDisabled();
  });
});

describe("G3 — hành động kèm gác `manage:feed-post`", () => {
  it("DENY: có `manage:feed-report`, thiếu `manage:feed-post` ⇒ không ô hành động; body KHÔNG có `action`", async () => {
    setCaps(REPORT_MANAGER);
    renderDialog();
    pick(RESOLVED);
    expect(radio(RESOLVED)).toBeChecked();
    expect(screen.queryByRole("group", { name: ACTION_GROUP })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Ẩn bài" })).toBeNull();
    await submitAndWait();

    expect(sentBody()).toEqual({ status: "resolved" });
    expect(resolveFeedReportSchema.safeParse(sentBody()).success).toBe(true);
  });

  it("ALLOW: thêm `manage:feed-post` ⇒ ô hành động hiện và hành động đi vào body", async () => {
    setCaps(FULL_MODERATOR);
    renderDialog();
    pick(RESOLVED);
    expect(screen.getByRole("group", { name: ACTION_GROUP })).toBeInTheDocument();
    pick("Ẩn bài");
    await submitAndWait();
    expect(sentBody()).toEqual({ status: "resolved", action: "hide_post" });
  });
});

describe("DC1 — 029 không idempotent: bấm đúp chỉ gửi MỘT lần", () => {
  it("promise treo: bấm «Xác nhận» 2 lần ⇒ `resolveReport` 1 lần, nút `disabled`; không đóng được giữa chừng", async () => {
    resolveReport.mockImplementation(() => new Promise<never>(() => undefined));
    const { onClose } = renderDialog();
    pick(DISMISSED);
    clickSubmit();
    await waitFor(() => expect(submitButton()).toBeDisabled());
    clickSubmit();
    fireEvent.click(screen.getByRole("button", { name: CANCEL }));

    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(submitButton()).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });
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
    renderDialog();
    pick(DISMISSED);
    fireEvent.change(noteBox(), { target: { value: "a".repeat(FEED_NOTE_MAX + 1) } });
    clickSubmit();

    expect(alertReason()).toBe("invalidRequest");
    expect(resolveReport).not.toHaveBeenCalled();

    fireEvent.change(noteBox(), { target: { value: "a".repeat(FEED_NOTE_MAX) } });
    await submitAndWait();
    expect(resolveFeedReportSchema.safeParse(sentBody()).success).toBe(true);
  });

  it("E11 — 500: `generic` + «Thử lại» gửi lại; ghi chú đã nhập còn nguyên", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.server());
    const { onOutcome } = renderDialog();
    pick(DISMISSED);
    fireEvent.change(noteBox(), { target: { value: "Đã trao đổi trực tiếp" } });
    clickSubmit();

    await waitFor(() => expect(alertReason()).toBe("generic"));
    expect(noteBox()).toHaveValue("Đã trao đổi trực tiếp");
    expect(onOutcome).not.toHaveBeenCalled();

    fireEvent.click(within(dialog()).getByRole("button", { name: RETRY }));
    await waitFor(() => expect(resolveReport).toHaveBeenCalledTimes(2));
    expect(sentBody(1)).toEqual({ status: "dismissed", resolutionNote: "Đã trao đổi trực tiếp" });
  });
});

describe("Kết cục ĐÓNG hộp thoại — báo lên trang qua `onOutcome`, hộp thoại không tự vẽ dải", () => {
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
    },
    {
      name: "E6 404 `SOCIAL-ERR-001`",
      err: ADMIN_ERR.reportGone,
      reason: "reportGone",
      invalidate: true,
    },
    {
      name: "E9 403 `AUTH-ERR-FORBIDDEN`",
      err: ADMIN_ERR.forbidden,
      reason: "forbidden",
      invalidate: false,
    },
  ])(
    "$name ⇒ `failed` với reason + cờ invalidate; không có dải lỗi trong hộp thoại",
    async ({ err, reason, invalidate }) => {
      resolveReport.mockRejectedValueOnce(err());
      const { report, onOutcome, onClose } = renderDialog();
      pick(DISMISSED);
      clickSubmit();

      await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
      expect(onOutcome).toHaveBeenCalledWith({ kind: "failed", report, reason, invalidate });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(submitButton()).toBeDisabled();
    },
  );
});
