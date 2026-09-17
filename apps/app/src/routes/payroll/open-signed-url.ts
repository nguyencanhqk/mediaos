/**
 * S15-PAYROLL-FE-4 — mở signed-URL (PDF phiếu lương 083/084/085) ở TAB MỚI mà không bị chặn popup.
 *
 * Trình duyệt chỉ coi `window.open` là thao tác của người dùng khi nó chạy CÙNG nhịp sự kiện click — mở SAU
 * `await` là bị chặn. Nên: mở tab trắng NGAY, cắt `opener` (tab đích không chạm được `window.opener`), rồi mới
 * gán URL khi server trả về.
 *
 * ⚠️ KHÔNG truyền `"noopener"` vào `window.open`: theo chuẩn HTML khi có cờ đó hàm TRẢ `null`, tab trắng mở ra
 * nhưng không bao giờ được điều hướng. Cắt opener bằng `w.opener = null` cho cùng hiệu quả.
 *
 * `resolveUrl` trả `null` = chưa có URL (vd lô PDF vừa chuyển sang đang sinh) ⇒ đóng tab trắng, trả `false`.
 * Lỗi ⇒ đóng tab trắng rồi ném lại cho caller hiện thông báo. URL KHÔNG được lưu ở đâu.
 * Popup vẫn bị chặn (không có tab) ⇒ điều hướng chính tab hiện tại — người dùng vẫn nhận được tệp.
 */
export async function openSignedUrlInNewTab(
  resolveUrl: () => Promise<string | null>,
): Promise<boolean> {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const url = await resolveUrl();
    if (url === null) {
      tab?.close();
      return false;
    }
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    return true;
  } catch (err) {
    tab?.close();
    throw err;
  }
}
