// @vitest-environment jsdom
/**
 * S14-RECRUIT-FILEGRANT-1 — REC-SCREEN-003 tab CV: cổng hiển thị đúng CẶP, và đúng KIỂU hook.
 *
 * ┌─ CA TRỌNG TÂM: `*:*` KHÔNG mở được gì ────────────────────────────────────────────────────────┐
 * │ Hai cặp của tab này (`view:candidate` mig 0560 · `upload:candidate-file` mig 0569) đều         │
 * │ `is_sensitive=true`, nên `/auth/me` KHÔNG BAO GIỜ suy chúng ra từ wildcard. Dùng `useCan`      │
 * │ (có fallback `*:*`) sẽ hiện màn + nút cho người mà server chắc chắn 403 — đúng lớp lỗ mà       │
 * │ `S14-SEC-DASHGATE-WILDCARD-1` vừa vá ở tầng BE.                                                │
 * │                                                                                                │
 * │ Vì thế spec này **KHÔNG mock `useCanExact`**: nó gieo thẳng `capabilities` vào `useAuthStore`   │
 * │ và chạy hook THẬT. Mock hook sẽ làm ca `*:*` xanh-RỖNG (nó chỉ đo cái mock trả về, không đo    │
 * │ component đang gọi hook nào).                                                                   │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mỗi ca ẨN đi kèm ca HIỆN đối chứng cùng cấu hình (`deny-cases-vacuous-without-allow-case`).
 */
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";

const listCandidateFiles = vi.fn();
const getDownloadUrl = vi.fn();
const uploadCandidateFile = vi.fn();

vi.mock("../candidate-file-api", () => ({
  candidateFileApi: {
    listCandidateFiles: (...a: unknown[]) => listCandidateFiles(...a),
    getDownloadUrl: (...a: unknown[]) => getDownloadUrl(...a),
    uploadCandidateFile: (...a: unknown[]) => uploadCandidateFile(...a),
  },
}));

import { CandidateCvTab } from "./CandidateCvTab";

const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";

const VIEW_PAIR = "view:candidate";
const UPLOAD_PAIR = "upload:candidate-file";

function setCaps(caps: Record<string, boolean>): void {
  act(() => {
    useAuthStore.setState({ capabilities: caps });
  });
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <CandidateCvTab candidateId={CANDIDATE_ID} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("CandidateCvTab — cổng hiển thị theo cặp NHẠY CẢM (useCanExact, không wildcard)", () => {
  beforeEach(() => {
    listCandidateFiles.mockResolvedValue([]);
    setCaps({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Đường ĐỌC ────────────────────────────────────────────────────────────────

  it("[crown] chỉ có `*:*` ⇒ tab KHÔNG mở (EmptyState) và KHÔNG gọi API", async () => {
    setCaps({ "*:*": true });
    renderTab();
    expect(screen.getByText(i18n.t("recruit:cv.noPermission"))).toBeTruthy();
    // enabled:false ⇒ react-query không chạy queryFn. Nếu đây đỏ thì component đã dùng `useCan`.
    await waitFor(() => expect(listCandidateFiles).not.toHaveBeenCalled());
  });

  it("ALLOW đối chứng: có ĐÚNG cặp `view:candidate` ⇒ tab mở + gọi API list", async () => {
    setCaps({ [VIEW_PAIR]: true });
    renderTab();
    expect(screen.queryByText(i18n.t("recruit:cv.noPermission"))).toBeNull();
    await waitFor(() => expect(listCandidateFiles).toHaveBeenCalledWith(CANDIDATE_ID));
  });

  it("cặp `view:foundation-file` (cổng CŨ) KHÔNG còn mở tab — chứng minh đã đổi cặp", async () => {
    setCaps({ "view:foundation-file": true, "download:foundation-file": true });
    renderTab();
    expect(screen.getByText(i18n.t("recruit:cv.noPermission"))).toBeTruthy();
    await waitFor(() => expect(listCandidateFiles).not.toHaveBeenCalled());
  });

  // ── Đường GHI ────────────────────────────────────────────────────────────────

  it("[crown] có `view:candidate` + `*:*` nhưng KHÔNG có cặp ghi exact ⇒ nút Tải lên ẨN", async () => {
    setCaps({ [VIEW_PAIR]: true, "*:*": true });
    renderTab();
    await waitFor(() => expect(listCandidateFiles).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: i18n.t("recruit:cv.upload") })).toBeNull();
  });

  it("ALLOW đối chứng: thêm ĐÚNG cặp `upload:candidate-file` ⇒ nút Tải lên HIỆN", async () => {
    setCaps({ [VIEW_PAIR]: true, [UPLOAD_PAIR]: true });
    renderTab();
    await waitFor(() => expect(listCandidateFiles).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: i18n.t("recruit:cv.upload") })).toBeTruthy();
  });

  it("`upload:foundation-file` (cặp CŨ) KHÔNG mở nút Tải lên", async () => {
    setCaps({ [VIEW_PAIR]: true, "upload:foundation-file": true });
    renderTab();
    await waitFor(() => expect(listCandidateFiles).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: i18n.t("recruit:cv.upload") })).toBeNull();
  });

  // ── Lỗi tải lên PHẢI hiện ra ─────────────────────────────────────────────

  it("[crown] tải lên THẤT BẠI ⇒ hiện alert — không im lặng quay về trạng thái rảnh", async () => {
    // Chuỗi tải lên có 4 chặng và chặng cuối có nhánh TỪ CHỐI DỰ KIẾN: gắn lại tệp đã từng link trả
    // 403 (vế 5 của canLinkFile, chống bypass thu hồi). Thiếu `onError` thì nút chỉ hết "Đang tải
    // lên…" rồi thôi — người dùng tưởng CV đã đính. Không lỗi, không log, không dấu vết.
    setCaps({ [VIEW_PAIR]: true, [UPLOAD_PAIR]: true });
    uploadCandidateFile.mockRejectedValue(new Error("HTTP 403"));
    renderTab();
    await waitFor(() => expect(listCandidateFiles).toHaveBeenCalled());

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["cv"], "cv.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent, "alert phải mang thông điệp lỗi, không rỗng").toBeTruthy();
  });

  it("ALLOW đối chứng: tải lên THÀNH CÔNG ⇒ KHÔNG có alert nào (ca trên không xanh-rỗng)", async () => {
    setCaps({ [VIEW_PAIR]: true, [UPLOAD_PAIR]: true });
    uploadCandidateFile.mockResolvedValue({ fileId: "x" });
    renderTab();
    await waitFor(() => expect(listCandidateFiles).toHaveBeenCalled());

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["cv"], "cv.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(uploadCandidateFile).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // ── Nút Tải xuống dùng CÙNG cặp với danh sách ────────────────────────────────

  it("nút Tải xuống hiện với CHÍNH cặp mở danh sách (không có cờ thứ hai để lệch)", async () => {
    listCandidateFiles.mockResolvedValue([
      {
        linkId: "22222222-2222-4222-8222-222222222222",
        fileId: "33333333-3333-4333-8333-333333333333",
        originalName: "cv-nguyen-van-a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        scanStatus: "Clean",
        uploadStatus: "Uploaded",
        uploadedAt: "2026-09-04T00:00:00.000Z",
        purpose: "CV",
      },
    ]);
    setCaps({ [VIEW_PAIR]: true });
    renderTab();
    expect(await screen.findByText("cv-nguyen-van-a.pdf")).toBeTruthy();
    expect(screen.getByRole("button", { name: i18n.t("recruit:cv.download") })).toBeTruthy();
  });
});

/**
 * S19-FE-SIGNEDTAB-1 — nút Tải xuống mở URL ký ở tab mới (N2 của S19-OPS-TASKFILEURL-1).
 *
 * `window.open` giả lập ĐÚNG CHUẨN HTML: có cờ `noopener` trong `features` ⇒ trả `null` (tab trắng mở ra
 * nhưng phía gọi không cầm được nó để điều hướng). Spec TASK/payroll giả `open` trả tab VÔ ĐIỀU KIỆN nên
 * không thấy lỗi này — trình duyệt thật đo 14/10: nút CV hỏng ở mọi tốc độ, PDF lẫn PNG.
 */
describe("CandidateCvTab — nút Tải xuống mở URL ký ở tab mới (S19-FE-SIGNEDTAB-1)", () => {
  const FILE_ID = "33333333-3333-4333-8333-333333333333";
  const FILE = {
    linkId: "22222222-2222-4222-8222-222222222222",
    fileId: FILE_ID,
    originalName: "cv-nguyen-van-a.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    scanStatus: "Clean",
    uploadStatus: "Uploaded",
    uploadedAt: "2026-09-04T00:00:00.000Z",
    purpose: "CV",
  };
  const SIGNED = "https://storage.example.test/cv-nguyen-van-a.pdf?sig=t";
  const UNSAFE = "javascript:alert(1)";
  const EXPIRES_AT = "2026-10-16T12:00:00.000Z";

  let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };
  let open: MockInstance<typeof window.open>;

  beforeEach(() => {
    tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    open = vi
      .spyOn(window, "open")
      .mockImplementation((_u, _t, f) =>
        /noopener/i.test(String(f ?? "")) ? null : (tab as unknown as Window),
      );
    // Đặt lại mock cấp module MỖI ca: tuỳ phiên bản vitest, `restoreAllMocks` có thể xoá implementation.
    listCandidateFiles.mockReset();
    listCandidateFiles.mockResolvedValue([FILE]);
    getDownloadUrl.mockReset();
    setCaps({ [VIEW_PAIR]: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function findDownloadButton(): Promise<HTMLElement> {
    renderTab();
    return screen.findByRole("button", { name: i18n.t("recruit:cv.download") });
  }

  function mockAppLocationAssign(): ReturnType<typeof vi.fn> {
    const assign = vi.fn();
    // Giữ các trường đọc được của location THẬT, chỉ thay `assign`: mã nào đọc `pathname`/`href` trong lúc
    // spy còn bật sẽ không nhận `undefined` rồi đỏ khó hiểu (gate F4).
    const real = window.location;
    const fake = {
      href: real.href,
      origin: real.origin,
      protocol: real.protocol,
      host: real.host,
      pathname: real.pathname,
      search: real.search,
      hash: real.hash,
      assign,
    };
    vi.spyOn(window, "location", "get").mockReturnValue(fake as unknown as Location);
    return assign;
  }

  function uploadCv(): void {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["cv"], "cv.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
  }

  it("C-1 [allow] bấm Tải xuống ⇒ mở tab KHÔNG cờ noopener, cắt opener, điều hướng tới URL ký", async () => {
    getDownloadUrl.mockResolvedValue({ url: SIGNED, expiresAt: EXPIRES_AT });
    fireEvent.click(await findDownloadButton());

    await waitFor(() => expect(tab.location.href).toBe(SIGNED));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    expect(tab.close).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(getDownloadUrl).toHaveBeenCalledWith(CANDIDATE_ID, FILE_ID);
  });

  it("C-2 [nhịp click] `window.open` chạy ĐỒNG BỘ trong onClick, trước khi API trả URL", async () => {
    let resolveUrl!: (v: { url: string; expiresAt: string }) => void;
    getDownloadUrl.mockReturnValue(
      new Promise((r) => {
        resolveUrl = r;
      }),
    );
    const button = await findDownloadButton();

    // CẤM `await` giữa click và khẳng định: một `await` bất kỳ trước helper sẽ ra khỏi nhịp click
    // (trình duyệt thật chặn popup) — khẳng định ở dòng NGAY sau click mới bắt được điều đó.
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUrl({ url: SIGNED, expiresAt: EXPIRES_AT });
    });
    await waitFor(() => expect(tab.location.href).toBe(SIGNED));
  });

  it("C-3 [deny ⇄ C-1] API trả 404 ⇒ đóng tab trắng, không điều hướng, alert «không tìm thấy»", async () => {
    getDownloadUrl.mockRejectedValue(
      new ApiError({
        status: 404,
        code: "NOT_FOUND",
        message: "not found",
        details: [{ field: "kind", message: "not-found", rule: "recruit" }],
      }),
    );
    fireEvent.click(await findDownloadButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(i18n.t("recruit:errors.notFound"));
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });

  it("C-4 [popup bị chặn ⇄ C-1] `open` trả null ⇒ điều hướng chính tab app tới URL ký, không alert", async () => {
    open.mockReturnValue(null);
    getDownloadUrl.mockResolvedValue({ url: SIGNED, expiresAt: EXPIRES_AT });
    const button = await findDownloadButton();
    const assign = mockAppLocationAssign();

    fireEvent.click(button);

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith(SIGNED);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("C-5 [deny ⇄ C-1] URL không phải http(s) ⇒ đóng tab, không gán href, alert chung (không lộ chi tiết)", async () => {
    getDownloadUrl.mockResolvedValue({ url: UNSAFE, expiresAt: EXPIRES_AT });
    fireEvent.click(await findDownloadButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(i18n.t("recruit:errors.generic"));
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
  });

  it("C-5b [deny ⇄ C-4] popup bị chặn + URL không phải http(s) ⇒ KHÔNG điều hướng tab app, alert chung", async () => {
    open.mockReturnValue(null);
    getDownloadUrl.mockResolvedValue({ url: UNSAFE, expiresAt: EXPIRES_AT });
    const button = await findDownloadButton();
    const assign = mockAppLocationAssign();

    fireEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(i18n.t("recruit:errors.generic"));
    expect(assign).not.toHaveBeenCalled();
  });

  // Alert DÙNG CHUNG cho hai ngả (`downloadError ?? uploadError`) — gate SF-1: lỗi cũ của ngả này không được
  // che / treo đè lên kết quả mới của ngả kia.
  it("C-7 [alert chung] tải xuống lỗi RỒI tải lên lỗi ⇒ alert là lỗi TẢI LÊN, không phải lỗi tải cũ", async () => {
    setCaps({ [VIEW_PAIR]: true, [UPLOAD_PAIR]: true });
    getDownloadUrl.mockRejectedValue(
      new ApiError({
        status: 404,
        code: "NOT_FOUND",
        message: "not found",
        details: [{ field: "kind", message: "not-found", rule: "recruit" }],
      }),
    );
    uploadCandidateFile.mockReset();
    uploadCandidateFile.mockRejectedValue(new Error("HTTP 403"));
    fireEvent.click(await findDownloadButton());
    expect((await screen.findByRole("alert")).textContent).toBe(i18n.t("recruit:errors.notFound"));

    uploadCv();

    await waitFor(() => expect(uploadCandidateFile).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(i18n.t("recruit:errors.generic")),
    );
  });

  it("C-8 [alert chung ⇄ C-7] tải lên lỗi RỒI tải xuống thành công ⇒ không còn alert lỗi cũ", async () => {
    setCaps({ [VIEW_PAIR]: true, [UPLOAD_PAIR]: true });
    uploadCandidateFile.mockReset();
    uploadCandidateFile.mockRejectedValue(new Error("HTTP 403"));
    getDownloadUrl.mockResolvedValue({ url: SIGNED, expiresAt: EXPIRES_AT });
    const button = await findDownloadButton();
    uploadCv();
    expect((await screen.findByRole("alert")).textContent).toBe(i18n.t("recruit:errors.generic"));

    fireEvent.click(button);

    await waitFor(() => expect(tab.location.href).toBe(SIGNED));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["{}", {}],
    ["{ *:* }", { "*:*": true }],
  ])(
    "C-6 [mốc] caps %s ⇒ KHÔNG có nút Tải xuống (cổng `view:candidate` giữ nguyên)",
    async (_label, caps: Record<string, boolean>) => {
      setCaps(caps);
      renderTab();
      expect(await screen.findByText(i18n.t("recruit:cv.noPermission"))).toBeTruthy();
      expect(screen.queryByRole("button", { name: i18n.t("recruit:cv.download") })).toBeNull();
    },
  );
});

/**
 * S16-SOCIAL-FILEOPENUX-1 — nợ F1 + F2/SF-4 của S19-FE-SIGNEDTAB-1 trên nút Tải xuống CV, và lọc sớm ở form tải.
 *
 * C-9/C-10: lượt bấm TRÙNG cùng tệp khi lượt trước còn chờ ⇒ không mở tab, không gọi API, không xoá lỗi đang
 * hiện. C-12/C-13 là đối chứng: guard theo TỆP (không khoá cả bảng) và được giải phóng khi lượt kết thúc.
 * C-11: popup bị chặn + URL `inline` + rời màn khi API chậm ⇒ KHÔNG điều hướng tab app.
 */
describe("CandidateCvTab — bấm trùng · rời màn · lọc sớm (S16-SOCIAL-FILEOPENUX-1)", () => {
  const X = {
    linkId: "22222222-2222-4222-8222-222222222222",
    fileId: "33333333-3333-4333-8333-333333333333",
    originalName: "cv-x.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    scanStatus: "Clean",
    uploadStatus: "Uploaded",
    uploadedAt: "2026-09-04T00:00:00.000Z",
    purpose: "CV",
  };
  const Y = {
    ...X,
    linkId: "44444444-4444-4444-8444-444444444444",
    fileId: "55555555-5555-4555-8555-555555555555",
    originalName: "cv-y.pdf",
  };
  const SIGNED = "https://storage.example.test/cv-x.pdf?sig=t";
  const INLINE = `${SIGNED}&${new URLSearchParams({ "response-content-disposition": "inline" }).toString()}`;
  const EXPIRES_AT = "2026-10-23T12:00:00.000Z";
  const NOT_FOUND = () =>
    new ApiError({
      status: 404,
      code: "NOT_FOUND",
      message: "not found",
      details: [{ field: "kind", message: "not-found", rule: "recruit" }],
    });

  let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };
  let open: MockInstance<typeof window.open>;

  beforeEach(() => {
    tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    listCandidateFiles.mockReset();
    listCandidateFiles.mockResolvedValue([X, Y]);
    getDownloadUrl.mockReset();
    uploadCandidateFile.mockReset();
    setCaps({ [VIEW_PAIR]: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Nút tải của MỘT dòng — tìm theo tên tệp (nhãn nút đổi khi đang chờ). */
  function rowButton(name: string): HTMLButtonElement {
    const row = screen.getByText(name).closest("li");
    if (!row) throw new Error(`không thấy dòng ${name}`);
    return within(row).getByRole("button") as HTMLButtonElement;
  }

  async function renderRows(): Promise<ReturnType<typeof renderTab>> {
    const view = renderTab();
    await screen.findByText(X.originalName);
    return view;
  }

  it("C-9 [RED] bấm đúp cùng tệp khi API còn treo ⇒ 1 tab · 1 lượt API", async () => {
    getDownloadUrl.mockReturnValue(new Promise(() => {}));
    await renderRows();
    const button = rowButton(X.originalName);

    // Hai lượt bấm trong CÙNG một nhịp (chưa render lại) ⇒ đo guard đồng bộ, không nhờ `disabled`.
    act(() => {
      button.click();
      button.click();
    });

    expect(open).toHaveBeenCalledTimes(1);
    expect(getDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it("C-10 [RED] X treo → Y lỗi ⇒ lỗi Y hiện → bấm X lần 2 (trùng) ⇒ lỗi Y VẪN hiện · API X 1 · tab X 1", async () => {
    getDownloadUrl.mockImplementation((_candidate: string, fileId: string) =>
      fileId === X.fileId ? new Promise(() => {}) : Promise.reject(NOT_FOUND()),
    );
    await renderRows();

    fireEvent.click(rowButton(X.originalName));
    fireEvent.click(rowButton(Y.originalName));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(i18n.t("recruit:errors.notFound"));

    fireEvent.click(rowButton(X.originalName));

    expect(screen.getByRole("alert").textContent).toBe(i18n.t("recruit:errors.notFound"));
    expect(getDownloadUrl.mock.calls.filter(([, id]) => id === X.fileId)).toHaveLength(1);
    // Tab: 1 cho X + 1 cho Y — lượt trùng của X không mở thêm tab nào.
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("C-11 [RED] popup bị chặn + URL `inline` + rời màn khi API chậm ⇒ KHÔNG điều hướng tab app", async () => {
    open.mockReturnValue(null);
    let release!: (v: { url: string; expiresAt: string }) => void;
    getDownloadUrl.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    const view = await renderRows();
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ assign } as unknown as Location);

    fireEvent.click(rowButton(X.originalName));
    view.unmount();
    await act(async () => {
      release({ url: INLINE, expiresAt: EXPIRES_AT });
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(getDownloadUrl).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("C-12 [allow] hai tệp KHÁC nhau bấm liền ⇒ 2 tab · 2 lượt API (guard theo tệp, không khoá cả bảng)", async () => {
    getDownloadUrl.mockReturnValue(new Promise(() => {}));
    await renderRows();
    const bx = rowButton(X.originalName);
    const by = rowButton(Y.originalName);

    act(() => {
      bx.click();
      by.click();
    });

    expect(open).toHaveBeenCalledTimes(2);
    expect(getDownloadUrl).toHaveBeenCalledTimes(2);
  });

  it.each<[string, () => Promise<unknown>]>([
    ["resolver ném", () => Promise.reject(NOT_FOUND())],
    ["resolver null", () => Promise.resolve({ url: null, expiresAt: EXPIRES_AT })],
    ["thành công", () => Promise.resolve({ url: SIGNED, expiresAt: EXPIRES_AT })],
  ])(
    "C-13 [allow] lượt 1 kết thúc (%s) ⇒ nút bật lại, bấm lại cùng tệp ⇒ 2 tab · 2 lượt API",
    async (_label, first) => {
      getDownloadUrl
        .mockImplementationOnce(first)
        .mockImplementationOnce(() => Promise.resolve({ url: SIGNED, expiresAt: EXPIRES_AT }));
      await renderRows();

      fireEvent.click(rowButton(X.originalName));
      await waitFor(() => expect(rowButton(X.originalName)).not.toBeDisabled());
      await waitFor(() => expect(getDownloadUrl).toHaveBeenCalledTimes(1));
      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(rowButton(X.originalName));

      await waitFor(() => expect(getDownloadUrl).toHaveBeenCalledTimes(2));
      expect(open).toHaveBeenCalledTimes(2);
    },
  );

  it("F-1 [RED] chọn `a.svg` để tải lên ⇒ lỗi tại chỗ + KHÔNG gọi API tải lên (F-2 đối chứng: ca «tải lên THÀNH CÔNG» ở trên)", async () => {
    setCaps({ [VIEW_PAIR]: true, [UPLOAD_PAIR]: true });
    await renderRows();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(i18n.t("common:uploadPrecheck.activeMime", { name: "a.svg" }));
    expect(alert.textContent).toContain("a.svg");
    expect(uploadCandidateFile).not.toHaveBeenCalled();
  });
});
