/**
 * S16-SOCIAL-FE-3 (L2) — hộp thoại kết thúc báo cáo `ResolveReportDialog` (SOCIAL-API-029): ca B1 · B2 ·
 * G3 · DC1 (vế 029) của plan §4. Nhóm ca LỖI + KẾT CỤC (E1–E6 · E9–E11) ở
 * `ResolveReportDialog.errors.spec.tsx`.
 *
 * - Quyền đặt trên store THẬT (`setCaps`) TRƯỚC render — đo luật `useCan` thật, không đo mock.
 * - i18n THẬT; vế kỳ vọng là chữ tiếng Việt VIẾT TAY ⇒ thiếu khoá (i18next trả khoá thô) là đỏ (plan B18).
 * - Body gửi đi so `toEqual` với literal VIẾT TAY rồi qua CHÍNH `resolveFeedReportSchema` của contracts.
 * - «0 lời gọi» của một cú bấm bị chặn đo bằng TỔNG lời gọi sau khi vế ALLOW cùng ca đã xong (đúng 1, đúng
 *   body của vế ALLOW) — `mutationFn` chạy trễ vài nhịp microtask nên đếm ngay sau cú bấm thì luôn bằng 0.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEED_NOTE_MAX,
  resolveFeedReportSchema,
  type FeedReportActionDto,
  type FeedReportDto,
} from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import { makeReport, REPORT_ID } from "../../admin/admin-test-doubles";
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
    const { onOutcome } = renderDialog();
    expect(submitButton()).toBeDisabled();
    clickSubmit();

    pick(DISMISSED);
    await submitAndWait();
    // «0 lời gọi» của cú bấm khi nút còn khoá đo ở ĐÂY, sau khi lượt hợp lệ đã xong: `mutationFn` chạy
    // sau vài nhịp microtask nên đếm ngay sau cú bấm thì luôn bằng 0, kể cả khi lượt gửi đã khởi động.
    await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(sentBody(0)).toEqual({ status: "dismissed" });
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
      const { onOutcome } = renderDialog(target.report());
      pick(RESOLVED);
      pick(target.deleteLabel);

      expect(submitButton()).toBeDisabled();
      clickSubmit();

      fireEvent.click(screen.getByRole("checkbox", { name: target.confirmLabel }));
      expect(submitButton()).toBeEnabled();
      await submitAndWait();
      // Cú bấm lúc CHƯA tick không được sinh lời gọi nào: đếm sau khi lượt đã tick xong (xem ca «chưa
      // chọn quyết định» về lý do không đếm ngay sau cú bấm).
      await waitFor(() => expect(onOutcome).toHaveBeenCalledTimes(1));
      expect(resolveReport).toHaveBeenCalledTimes(1);
      expect(sentBody(0)).toEqual({ status: "resolved", action: "delete_target" });
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

  // `isPending` tới màn sau một nhịp của react-query ⇒ giữa hai kích hoạt sát nhau nút CHƯA `disabled`.
  it("hai kích hoạt LIỀN NHAU trước khi màn kịp vẽ lại ⇒ vẫn chỉ MỘT lời gọi", async () => {
    resolveReport.mockImplementation(() => new Promise<never>(() => undefined));
    renderDialog();
    pick(DISMISSED);

    clickSubmit();
    clickSubmit();

    await waitFor(() => expect(submitButton()).toBeDisabled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ status: "dismissed" });
  });

  // Nút «Huỷ» tự khoá khi đang gửi nên không tới được lưới trong `close()`; Esc và bấm ra ngoài thì tới.
  // Lọt lưới ⇒ trang nhận CẢ `onClose` lẫn `onOutcome` cho cùng một lượt mở.
  it.each([
    { name: "Esc", act: () => fireEvent.keyDown(document, { key: "Escape" }) },
    {
      name: "bấm ra ngoài",
      act: () => fireEvent.click(dialog().parentElement as HTMLElement),
    },
  ])(
    "$name: trước khi gửi ⇒ `onClose` 1 lần (đối chứng); đang gửi ⇒ KHÔNG đóng được",
    async ({ act }) => {
      resolveReport.mockImplementation(() => new Promise<never>(() => undefined));
      const { onClose, onOutcome } = renderDialog();
      act();
      expect(onClose).toHaveBeenCalledTimes(1);

      pick(DISMISSED);
      clickSubmit();
      await waitFor(() => expect(submitButton()).toBeDisabled());
      act();

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(resolveReport).toHaveBeenCalledTimes(1);
      expect(onOutcome).not.toHaveBeenCalled();
    },
  );
});
