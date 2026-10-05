/**
 * S16-SOCIAL-FE-3 (L3) — hộp thoại soạn báo cáo `ReportDialog` (SOCIAL-API-027): ca P2 (gửi) · P3 (lỗi) ·
 * DC2 (bấm đúp) · vòng đời `attemptId` (plan D20 · B22).
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY. Body kiểm bằng CHÍNH `createFeedReportSchema`. Lỗi dựng bằng
 * `ADMIN_ERR` (đúng hình dạng trên dây; `message` là chữ của SERVER — không được lên màn).
 *
 * P2 chạy với CẢ hai loại đích: PR-C dùng lại hộp thoại này cho bình luận, hard-code `"post"` ở đây là
 * báo cáo bình luận gửi nhầm đích mà không ca nào của PR-A thấy.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedReportSchema, FEED_NOTE_MAX } from "@mediaos/contracts";
import { socialKeys } from "@mediaos/web-core";
import {
  makeTestQueryClient,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../../feed/social-test-doubles";
import { ADMIN_ERR } from "../../admin/admin-test-doubles";
import { ReportDialog } from "./ReportDialog";

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

type TargetType = "post" | "comment";

const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const CREATED = { id: "44444444-4444-4444-8444-444444444444" };

const TITLES: Record<TargetType, string> = {
  post: "Báo cáo bài viết",
  comment: "Báo cáo bình luận",
};
const REASON_GROUP = "Lý do báo cáo";
const REASON_LABELS = [
  "Spam hoặc quảng cáo",
  "Quấy rối hoặc xúc phạm",
  "Nội dung không phù hợp",
  "Thông tin sai lệch",
  "Lý do khác",
];
const NOTE = "Ghi chú thêm (không bắt buộc)";
const WARNING =
  "Người kiểm duyệt cấp công ty thấy tên người báo cáo; quản lý đơn vị thì không. Ghi chú của bạn được hiển thị nguyên văn cho mọi người kiểm duyệt, kể cả quản lý đơn vị — đừng viết điều có thể tự làm lộ danh tính của bạn.";
const SUBMIT = "Gửi báo cáo";
const CANCEL = "Huỷ";
const CLOSE = "Đóng";
const RETRY = "Thử lại";
const SENT = "Đã gửi báo cáo. Người kiểm duyệt sẽ xem xét nội dung này.";

function renderDialog(targetType: TargetType = "post", client = makeTestQueryClient()) {
  const onClose = vi.fn();
  const view = renderWithProviders(
    <ReportDialog targetType={targetType} targetId={TARGET_ID} onClose={onClose} />,
    client,
  );
  return { ...view, onClose };
}

const dialog = (targetType: TargetType = "post"): HTMLElement =>
  screen.getByRole("dialog", { name: TITLES[targetType] });
const radio = (name: string): HTMLInputElement => screen.getByRole("radio", { name });
const pick = (name: string): void => {
  fireEvent.click(radio(name));
};
const noteBox = (): HTMLTextAreaElement => screen.getByRole("textbox", { name: NOTE });
const typeNote = (value: string): void => {
  fireEvent.change(noteBox(), { target: { value } });
};
const submitButton = (): HTMLElement => screen.getByRole("button", { name: SUBMIT });
const clickSubmit = (): void => {
  fireEvent.click(submitButton());
};
const alertReason = (): string | null =>
  within(dialog()).getByRole("alert").getAttribute("data-reason");
const sentBody = (call = 0): unknown => createReport.mock.calls[call]?.[0];
const sentAttemptId = (call = 0): unknown => createReport.mock.calls[call]?.[1];

/**
 * Chờ câu xác nhận TRƯỚC rồi mới tìm hộp thoại: sang trạng thái «đã gửi» hộp thoại được mount lại (phần tử
 * DOM mới), nên `within(<hộp thoại lấy từ trước>)` sẽ tìm trong một nút đã rời khỏi cây.
 */
async function findSentStatus(): Promise<HTMLElement> {
  const status = await screen.findByRole("status");
  expect(dialog()).toContainElement(status);
  return status;
}

async function submitAndWait(calls = 1): Promise<void> {
  clickSubmit();
  await waitFor(() => expect(createReport).toHaveBeenCalledTimes(calls));
}

beforeEach(() => {
  // 027 gác bằng `view:feed` — hộp thoại không có cổng riêng; caps chỉ để khung giống các spec khác.
  setCaps({ "view:feed": true });
  createReport.mockReset();
  createReport.mockImplementation(() => Promise.resolve(CREATED));
});
afterEach(() => {
  cleanup();
  resetCaps();
});

describe.each<TargetType>(["post", "comment"])("P2 — gửi báo cáo, đích `%s`", (targetType) => {
  it("(role) `dialog` có tên theo loại đích; nhóm lý do có nhãn nhóm và ĐÚNG 5 lựa chọn, chưa chọn sẵn", () => {
    renderDialog(targetType);
    const group = within(dialog(targetType)).getByRole("group", { name: REASON_GROUP });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual(REASON_LABELS);
    for (const r of radios) expect(r).not.toBeChecked();
  });

  it("dòng cảnh báo SOC-DEC-011 hiện TRƯỚC khi gõ và là mô tả trợ năng của ô ghi chú", () => {
    renderDialog(targetType);
    expect(within(dialog(targetType)).getByText(WARNING)).toBeInTheDocument();
    expect(noteBox()).toHaveValue("");
    expect(noteBox()).toHaveAccessibleDescription(/tự làm lộ danh tính/);
    expect(noteBox()).toHaveAttribute("maxlength", String(FEED_NOTE_MAX));
  });

  it("gửi kèm ghi chú ⇒ body đúng `targetType`/`targetId` của prop, ghi chú đã cắt khoảng trắng, qua schema", async () => {
    renderDialog(targetType);
    pick("Quấy rối hoặc xúc phạm");
    typeNote("  lời lẽ xúc phạm đồng nghiệp  ");
    await submitAndWait();

    expect(sentBody()).toEqual({
      targetType,
      targetId: TARGET_ID,
      reason: "harassment",
      note: "lời lẽ xúc phạm đồng nghiệp",
    });
    expect(createFeedReportSchema.safeParse(sentBody()).success).toBe(true);
  });

  it.each(["", "   \n "])("ghi chú rỗng (%j) ⇒ body KHÔNG có khoá `note`", async (note) => {
    renderDialog(targetType);
    pick("Lý do khác");
    typeNote(note);
    await submitAndWait();

    expect(sentBody()).toEqual({ targetType, targetId: TARGET_ID, reason: "other" });
    expect(sentBody()).not.toHaveProperty("note");
    expect(createFeedReportSchema.safeParse(sentBody()).success).toBe(true);
  });
});

describe("P2 — luật gửi + kết cục thành công", () => {
  it("chưa chọn lý do ⇒ nút «Gửi báo cáo» khoá, 0 lời gọi; chọn rồi ⇒ gửi được", async () => {
    renderDialog();
    typeNote("chỉ có ghi chú");
    expect(submitButton()).toBeDisabled();
    clickSubmit();

    pick("Spam hoặc quảng cáo");
    expect(submitButton()).toBeEnabled();
    await submitAndWait();
    expect(sentBody()).toEqual({
      targetType: "post",
      targetId: TARGET_ID,
      reason: "spam",
      note: "chỉ có ghi chú",
    });
  });

  it("mỗi lý do gửi ĐÚNG giá trị enum của nó", async () => {
    const expected = ["spam", "harassment", "inappropriate", "misinformation", "other"];
    for (const [index, label] of REASON_LABELS.entries()) {
      const { unmount } = renderDialog();
      pick(label);
      await submitAndWait(index + 1);
      expect(sentBody(index)).toEqual({
        targetType: "post",
        targetId: TARGET_ID,
        reason: expected[index],
      });
      unmount();
    }
  });

  it("thành công ⇒ câu xác nhận TRONG hộp thoại, form biến mất; «Đóng» ⇒ `onClose` 1 lần", async () => {
    const { onClose } = renderDialog();
    pick("Thông tin sai lệch");
    clickSubmit();

    const status = await findSentStatus();
    expect(status).toHaveTextContent(SENT);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: SUBMIT })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Nút đang giữ focus vừa biến mất — focus phải ở lại TRONG hộp thoại, không rơi ra `body`.
    expect(screen.getByRole("button", { name: CLOSE })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: CLOSE }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createReport).toHaveBeenCalledTimes(1);
  });

  it("thành công KHÔNG invalidate gì của bảng tin (báo cáo không đổi bài)", async () => {
    const client = makeTestQueryClient();
    const feedKey = socialKeys.feed.list({ sort: "latest" });
    const detailKey = socialKeys.posts.detail(TARGET_ID);
    client.setQueryData(feedKey, { pages: [], pageParams: [] });
    client.setQueryData(detailKey, { id: TARGET_ID });
    renderDialog("post", client);
    pick("Spam hoặc quảng cáo");
    clickSubmit();

    await findSentStatus();
    expect(client.getQueryState(feedKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(false);
  });

  it("«Huỷ» · Esc khi chưa gửi ⇒ `onClose`, 0 lời gọi", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: CANCEL }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(createReport).not.toHaveBeenCalled();
  });
});

describe("P3 — lỗi 027: hộp thoại CÒN, nội dung còn", () => {
  it.each([
    {
      name: "409 trùng báo cáo đang mở",
      err: ADMIN_ERR.reportDuplicate,
      reason: "reportDuplicate",
    },
    { name: "409 idempotency đang chạy", err: ADMIN_ERR.idempotencyInProgress, reason: "busy" },
    { name: "404 đích không còn", err: ADMIN_ERR.postGone, reason: "reportTargetGone" },
    { name: "403", err: ADMIN_ERR.forbidden, reason: "forbidden" },
    { name: "500", err: ADMIN_ERR.server, reason: "generic" },
  ])(
    "$name ⇒ `$reason`; không báo «đã gửi», không đóng, nháp còn nguyên",
    async ({ err, reason }) => {
      createReport.mockRejectedValueOnce(err());
      const { onClose } = renderDialog();
      pick("Nội dung không phù hợp");
      typeNote("ghi chú của tôi");
      clickSubmit();

      await waitFor(() => expect(alertReason()).toBe(reason));
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByText(SENT)).toBeNull();
      expect(dialog()).not.toHaveTextContent("SOCIAL-ERR");
      expect(dialog()).not.toHaveTextContent("idempotency");
      expect(dialog()).not.toHaveTextContent("boom");
      expect(onClose).not.toHaveBeenCalled();
      expect(radio("Nội dung không phù hợp")).toBeChecked();
      expect(noteBox()).toHaveValue("ghi chú của tôi");
      expect(submitButton()).toBeEnabled();
    },
  );

  it("lỗi rồi gửi lại trong CÙNG lượt mở ⇒ cùng body, CÙNG `attemptId` (khác rỗng); lượt hai thành công", async () => {
    createReport.mockRejectedValueOnce(ADMIN_ERR.server());
    renderDialog();
    pick("Spam hoặc quảng cáo");
    clickSubmit();
    await waitFor(() => expect(alertReason()).toBe("generic"));

    await submitAndWait(2);
    expect(sentBody(1)).toEqual(sentBody(0));
    expect(typeof sentAttemptId(0)).toBe("string");
    expect(String(sentAttemptId(0)).length).toBeGreaterThan(0);
    expect(sentAttemptId(1)).toBe(sentAttemptId(0));

    await findSentStatus();
    expect(within(dialog()).queryByRole("alert")).toBeNull();
  });

  it("`busy` / `generic` có «Thử lại» và nó gửi lại với CÙNG `attemptId`", async () => {
    createReport.mockRejectedValueOnce(ADMIN_ERR.idempotencyInProgress());
    renderDialog();
    pick("Lý do khác");
    clickSubmit();
    await waitFor(() => expect(alertReason()).toBe("busy"));

    fireEvent.click(within(dialog()).getByRole("button", { name: RETRY }));
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(2));
    expect(sentAttemptId(1)).toBe(sentAttemptId(0));
    expect(sentBody(1)).toEqual({ targetType: "post", targetId: TARGET_ID, reason: "other" });
  });

  it.each([
    { name: "trùng báo cáo", err: ADMIN_ERR.reportDuplicate, reason: "reportDuplicate" },
    { name: "đích không còn", err: ADMIN_ERR.postGone, reason: "reportTargetGone" },
    { name: "403", err: ADMIN_ERR.forbidden, reason: "forbidden" },
  ])("lỗi kết cục ($name) KHÔNG mời «Thử lại»", async ({ err, reason }) => {
    createReport.mockRejectedValueOnce(err());
    renderDialog();
    pick("Lý do khác");
    clickSubmit();
    await waitFor(() => expect(alertReason()).toBe(reason));
    expect(within(dialog()).queryByRole("button", { name: RETRY })).toBeNull();
  });
});

describe("`attemptId` — một lượt MOUNT một giá trị (plan D20 · B22)", () => {
  it("unmount rồi mount lại, gửi CÙNG body ⇒ `attemptId` KHÁC lượt trước và khác rỗng", async () => {
    const first = renderDialog();
    pick("Spam hoặc quảng cáo");
    await submitAndWait(1);
    first.unmount();

    renderDialog();
    pick("Spam hoặc quảng cáo");
    await submitAndWait(2);

    expect(sentBody(1)).toEqual(sentBody(0));
    const [a, b] = [sentAttemptId(0), sentAttemptId(1)];
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(String(a).trim().length).toBeGreaterThan(0);
    expect(String(b).trim().length).toBeGreaterThan(0);
    expect(b).not.toBe(a);
  });

  it("đổi nội dung giữa hai lần gửi trong cùng lượt mở ⇒ `attemptId` KHÔNG đổi theo nội dung", async () => {
    createReport.mockRejectedValueOnce(ADMIN_ERR.server());
    renderDialog();
    pick("Spam hoặc quảng cáo");
    clickSubmit();
    await waitFor(() => expect(alertReason()).toBe("generic"));

    pick("Lý do khác");
    typeNote("thêm ghi chú");
    await submitAndWait(2);
    expect(sentBody(1)).toEqual({
      targetType: "post",
      targetId: TARGET_ID,
      reason: "other",
      note: "thêm ghi chú",
    });
    expect(sentAttemptId(1)).toBe(sentAttemptId(0));
  });
});

describe("DC2 — bấm đúp 027 chỉ gửi MỘT lần", () => {
  it("promise treo: bấm «Gửi báo cáo» 2 lần ⇒ `createReport` 1 lần, nút `disabled`; không đóng được giữa chừng", async () => {
    createReport.mockImplementation(() => new Promise<never>(() => undefined));
    const { onClose } = renderDialog();
    pick("Spam hoặc quảng cáo");
    clickSubmit();
    await waitFor(() => expect(submitButton()).toBeDisabled());
    clickSubmit();
    fireEvent.click(screen.getByRole("button", { name: CANCEL }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(createReport).toHaveBeenCalledTimes(1);
    expect(submitButton()).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  // `isPending` tới màn sau một nhịp của react-query ⇒ giữa hai kích hoạt sát nhau nút CHƯA `disabled`.
  it("hai kích hoạt LIỀN NHAU trước khi màn kịp vẽ lại ⇒ vẫn chỉ MỘT lời gọi", async () => {
    createReport.mockImplementation(() => new Promise<never>(() => undefined));
    renderDialog();
    pick("Spam hoặc quảng cáo");

    clickSubmit();
    clickSubmit();

    await waitFor(() => expect(submitButton()).toBeDisabled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(createReport).toHaveBeenCalledTimes(1);
  });

  it("Esc CÙNG NHỊP với «Gửi báo cáo» (nút chưa kịp khoá) ⇒ KHÔNG đóng; người gửi vẫn thấy câu xác nhận", async () => {
    const { onClose } = renderDialog();
    pick("Spam hoặc quảng cáo");

    clickSubmit();
    fireEvent.keyDown(document, { key: "Escape" });

    await findSentStatus();
    expect(onClose).not.toHaveBeenCalled();
    expect(createReport).toHaveBeenCalledTimes(1);
  });
});
