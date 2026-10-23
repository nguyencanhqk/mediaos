import { signedUrlDisposition } from "./signed-url-disposition";

/**
 * Mở / tải tệp qua URL ký do server phát, không bị chặn popup và không để lại tab trắng.
 *
 * Caller (5): TASK `routes/tasks/TaskFilePanel.tsx` (DownloadTaskFileButton) · phiếu lương
 * `routes/payroll/MePayslipsPage.tsx` (084) · `routes/payroll/PayslipDetailPage.tsx` (083) ·
 * `routes/payroll/components/PayslipPdfBatchControl.tsx` (085, ZIP) · CV `routes/recruit/components/CandidateCvTab.tsx`.
 * HR (`EmployeeFilesTab` · `EmployeeContractsPage`) · SYSTEM (`FileDetailPage`) · CHAT (URL gắn lúc render)
 * CHƯA đi qua helper này — thuộc S19-FE-SIGNEDTAB-2.
 *
 * Trình duyệt chỉ coi `window.open` là thao tác của người dùng khi nó chạy CÙNG nhịp sự kiện click — mở SAU
 * `await` là bị chặn. Nên: mở tab trắng NGAY, cắt `opener` (tab đích không chạm được `window.opener`), rồi mới
 * quyết định khi server trả URL về.
 *
 * ⚠️ KHÔNG truyền `"noopener"` vào `window.open`: theo chuẩn HTML khi có cờ đó hàm TRẢ `null`, tab trắng mở ra
 * nhưng không bao giờ được điều hướng. Cắt opener bằng `w.opener = null` cho cùng hiệu quả.
 *
 * Thứ tự sau khi có URL (S16-SOCIAL-FILEOPENUX-1 D4) — đổi thứ tự là mở lại lỗ:
 *   1. `resolveUrl` trả `null` = chưa có URL (vd lô PDF vừa chuyển sang đang sinh) ⇒ đóng tab trắng, trả `false`.
 *   2. Kiểm scheme `http(s)` TRƯỚC mọi thứ khác — URL `javascript:`/`data:` vẫn có phần query đọc được.
 *   3. Cách phục vụ do SERVER đã ký vào URL (`signedUrlDisposition`, không đoán theo đuôi tệp):
 *      - `attachment` ⇒ đóng tab trắng và tải trên tab app (trình duyệt tải xuống, trang đứng yên — trước đây tab
 *        trắng đứng lại ở `about:blank`). Không hỏi `isCurrent`: tải xuống không rời trang.
 *      - `inline` / không rõ ⇒ điều hướng tab mới; popup bị chặn ⇒ điều hướng tab app, nhưng CHỈ khi lượt bấm còn
 *        hiện hành (`isCurrent`, F1 của S19-FE-SIGNEDTAB-1) — đây là đường duy nhất THAY trang app.
 * Mọi điều hướng dùng `href` của URL đã qua bước 2. Lỗi ⇒ đóng tab trắng rồi ném lại cho caller hiện thông báo.
 * URL KHÔNG được lưu ở đâu.
 */
export interface OpenSignedUrlOptions {
  /**
   * Lượt bấm còn hiện hành (vd component còn mount)? Chỉ được hỏi ngay trước khi điều hướng TAB APP tới tệp
   * `inline`/không rõ (popup bị chặn). `false` ⇒ không điều hướng, trả `false`. Vắng ⇒ coi như còn hiện hành.
   */
  isCurrent?: () => boolean;
}

export async function openSignedUrlInNewTab(
  resolveUrl: () => Promise<string | null>,
  options: OpenSignedUrlOptions = {},
): Promise<boolean> {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const url = await resolveUrl();
    if (url === null) {
      tab?.close();
      return false;
    }
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsafe-url");
    if (signedUrlDisposition(parsed) === "attachment") {
      tab?.close();
      window.location.assign(parsed.href);
      return true;
    }
    if (tab) {
      tab.location.href = parsed.href;
      return true;
    }
    if (options.isCurrent && !options.isCurrent()) return false;
    window.location.assign(parsed.href);
    return true;
  } catch (err) {
    tab?.close();
    throw err;
  }
}
