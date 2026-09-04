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
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
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
