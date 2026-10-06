/**
 * S16-SOCIAL-FE-3B (L5a, ca X1) — nút «Xuất Excel» của màn Thống kê tương tác (`SOCIAL-API-053`).
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY, truy vấn bằng role + tên trợ năng. `triggerBlobDownload` được mock: mọi ca
 * lỗi đo «0 lần tải tệp» trên chính spy đó, cạnh một ca ALLOW dùng cùng khung.
 */
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedEngagementQuerySchema } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import { ADMIN_ERR, UNIT_ID, advanceFakeTimers } from "../../admin/admin-test-doubles";
import { ExportEngagementButton, type ExportEngagementButtonProps } from "./ExportEngagementButton";

const exportEngagement = vi.fn();
const triggerBlobDownload = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialStatsApi: {
      ...actual.socialStatsApi,
      exportEngagement: (...a: unknown[]) => exportEngagement(...a),
    },
  };
});
vi.mock("@/lib/download-blob", () => ({
  triggerBlobDownload: (...a: unknown[]) => triggerBlobDownload(...a),
}));

const EXPORT = "Xuất Excel";
const EXPORTING = "Đang xuất…";
const RETRY = "Thử lại";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TIMEOUT_MS = 30_000;

const PARAMS = { from: "2026-09-21", to: "2026-10-04", orgUnitId: UNIT_ID };
const RANGE = { from: "2026-09-21", to: "2026-10-04" };
const FALLBACK_NAME = "social-tuong-tac-2026-09-21_2026-10-04.xlsx";

const xlsxBlob = (): Blob => new Blob(["PK-xlsx-bytes"], { type: XLSX_MIME });
const fileResult = (filename: string | null = null, blob: Blob = xlsxBlob()) => ({
  blob,
  filename,
});

function buttonNode(over: Partial<ExportEngagementButtonProps> = {}) {
  return <ExportEngagementButton params={PARAMS} range={RANGE} {...over} />;
}
function renderButton(over: Partial<ExportEngagementButtonProps> = {}) {
  const view = renderWithProviders(buttonNode(over));
  return {
    ...view,
    show: (next: Partial<ExportEngagementButtonProps>) => view.rerender(buttonNode(next)),
  };
}

const exportButton = (): HTMLButtonElement => screen.getByRole("button", { name: EXPORT });
const alertReason = (): string | null => screen.getByRole("alert").getAttribute("data-reason");
const clickExport = (): void => {
  fireEvent.click(exportButton());
};
/** Lời gọi treo: trả hàm nhả để ca tự quyết lúc nào phản hồi về. */
function hangExport(): { resolve: (value: unknown) => void; reject: (reason: unknown) => void } {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  exportEngagement.mockImplementationOnce(
    () =>
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return { resolve: (value) => resolve(value), reject: (reason) => reject(reason) };
}

beforeEach(() => {
  exportEngagement.mockReset();
  triggerBlobDownload.mockReset();
  setCaps({ "view:feed": true, "view:feed-report": true });
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.useRealTimers();
});

describe("ALLOW — xuất đúng thứ đang xem", () => {
  it("gọi `exportEngagement` MỘT lần với CÙNG tham số đang xem (qua schema contracts)", async () => {
    exportEngagement.mockResolvedValueOnce(fileResult());
    renderButton();
    clickExport();
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
    expect(exportEngagement).toHaveBeenCalledTimes(1);
    const sent: unknown = exportEngagement.mock.calls[0]?.[0];
    expect(sent).toStrictEqual(PARAMS);
    expect(feedEngagementQuerySchema.safeParse(sent).success).toBe(true);
  });

  it("đang xem mặc định (không tham số) ⇒ gọi với object KHÔNG khoá nào", async () => {
    exportEngagement.mockResolvedValueOnce(fileResult());
    renderButton({ params: {} });
    clickExport();
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
    expect(exportEngagement.mock.calls[0]?.[0]).toStrictEqual({});
  });

  it("`filename: null` (header bị trình duyệt giấu) ⇒ tên dự phòng `social-tuong-tac-<from>_<to>.xlsx` theo `range`", async () => {
    const result = fileResult(null);
    exportEngagement.mockResolvedValueOnce(result);
    renderButton({ params: {} });
    clickExport();
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
    expect(triggerBlobDownload).toHaveBeenCalledWith(result.blob, FALLBACK_NAME);
  });

  it("server gửi tên tệp ⇒ dùng tên của server", async () => {
    const result = fileResult("tuong-tac-2026-W39.xlsx");
    exportEngagement.mockResolvedValueOnce(result);
    renderButton();
    clickExport();
    await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
    expect(triggerBlobDownload).toHaveBeenCalledWith(result.blob, "tuong-tac-2026-W39.xlsx");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("nút KHÔNG có cổng quyền riêng: chỉ `view:feed` vẫn thấy nút (052 và 053 chung cặp — cổng là của route)", () => {
    setCaps({ "view:feed": true });
    renderButton();
    expect(exportButton()).toBeEnabled();
  });
});

describe("đang xuất · chưa có dữ liệu", () => {
  it("đang xuất ⇒ nút `disabled` + `aria-busy` + chữ «Đang xuất…»; xong thì mở lại", async () => {
    const pending = hangExport();
    renderButton();
    clickExport();
    const busy = await screen.findByRole("button", { name: EXPORTING });
    expect(busy).toBeDisabled();
    expect(busy.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      pending.resolve(fileResult());
      await Promise.resolve();
    });
    await waitFor(() => expect(exportButton()).toBeEnabled());
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
  });

  it("bấm 2 lần trong CÙNG một nhịp ⇒ đúng 1 lời gọi", async () => {
    hangExport();
    renderButton();
    const target = exportButton();
    act(() => {
      fireEvent.click(target);
      fireEvent.click(target);
    });
    await screen.findByRole("button", { name: EXPORTING });
    expect(exportEngagement).toHaveBeenCalledTimes(1);
  });

  it("chưa có dữ liệu (`range: null`) ⇒ nút khoá, bấm không gọi gì", () => {
    renderButton({ range: null });
    expect(exportButton()).toBeDisabled();
    clickExport();
    expect(exportEngagement).not.toHaveBeenCalled();
  });
});

describe("DENY / lỗi — có dải lỗi, KHÔNG tải tệp", () => {
  it("403 `STATS-UNIT-OUT-OF-SCOPE` ⇒ dải `statsUnitOutOfScope`, `triggerBlobDownload` 0 lần, không lộ chữ của server", async () => {
    const err = ADMIN_ERR.statsUnitOutOfScope();
    exportEngagement.mockRejectedValueOnce(err);
    renderButton();
    clickExport();
    await waitFor(() => expect(alertReason()).toBe("statsUnitOutOfScope"));
    expect(screen.getByRole("alert").textContent).toContain(
      "Bạn không có quyền xem thống kê của đơn vị này",
    );
    expect(document.body.textContent).not.toContain(err.message);
    expect(triggerBlobDownload).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(exportButton()).toBeEnabled();
  });

  it("403 tầng quyền ⇒ `forbidden`, không nút «Thử lại», 0 lần tải", async () => {
    exportEngagement.mockRejectedValueOnce(ADMIN_ERR.forbidden());
    renderButton();
    clickExport();
    await waitFor(() => expect(alertReason()).toBe("forbidden"));
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });

  it("400 khi đang gửi khoảng ⇒ `statsRangeInvalid`, 0 lần tải", async () => {
    exportEngagement.mockRejectedValueOnce(ADMIN_ERR.badRequest());
    renderButton();
    clickExport();
    await waitFor(() => expect(alertReason()).toBe("statsRangeInvalid"));
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });

  it.each([
    ["500", () => ADMIN_ERR.server()],
    ["lỗi mạng", () => new TypeError("Failed to fetch")],
  ])(
    "%s ⇒ `generic` + «Thử lại» gửi lại CÙNG tham số; lượt hai thành công thì dải biến mất",
    async (_n, make) => {
      exportEngagement.mockRejectedValueOnce(make());
      renderButton();
      clickExport();
      await waitFor(() => expect(alertReason()).toBe("generic"));
      expect(triggerBlobDownload).not.toHaveBeenCalled();

      exportEngagement.mockResolvedValueOnce(fileResult());
      fireEvent.click(screen.getByRole("button", { name: RETRY }));
      await waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledTimes(1));
      expect(exportEngagement).toHaveBeenCalledTimes(2);
      expect(exportEngagement.mock.calls[1]?.[0]).toStrictEqual(PARAMS);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it.each([
    ["tệp RỖNG", () => new Blob([], { type: XLSX_MIME })],
    [
      "trang HTML trả 200 (proxy / SPA fallback)",
      () => new Blob(["<html>"], { type: "text/html" }),
    ],
    ["JSON trả 200", () => new Blob(["{}"], { type: "application/json" })],
  ])("%s ⇒ dải `generic`, KHÔNG tải tệp hỏng", async (_n, makeBlob) => {
    exportEngagement.mockResolvedValueOnce(fileResult("x.xlsx", makeBlob()));
    renderButton();
    clickExport();
    await waitFor(() => expect(alertReason()).toBe("generic"));
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });

  it("dải lỗi đóng được; đổi tham số đang xem ⇒ dải của lượt xuất cũ tự biến mất", async () => {
    exportEngagement.mockRejectedValue(ADMIN_ERR.forbidden());
    const view = renderButton();
    clickExport();
    await waitFor(() => expect(alertReason()).toBe("forbidden"));
    fireEvent.click(screen.getByRole("button", { name: "Đóng thông báo" }));
    expect(screen.queryByRole("alert")).toBeNull();

    clickExport();
    await waitFor(() => expect(alertReason()).toBe("forbidden"));
    view.show({ params: {} });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("yêu cầu treo", () => {
  it("quá 30 giây ⇒ dải `generic` + nút mở lại; phản hồi về MUỘN bị bỏ qua (không tải tệp sau khi đã báo lỗi)", async () => {
    vi.useFakeTimers();
    const pending = hangExport();
    renderButton();
    clickExport();
    await advanceFakeTimers(TIMEOUT_MS - 1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: EXPORTING })).toBeDisabled();

    await advanceFakeTimers(1);
    await advanceFakeTimers(0);
    expect(alertReason()).toBe("generic");
    expect(exportButton()).toBeEnabled();

    pending.resolve(fileResult());
    await advanceFakeTimers(0);
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });
});
