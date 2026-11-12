# S16-SOCIAL-FEADMINSIGNAL-1 · S16-SOCIAL-FESTATSBUSY-1 — plan gộp (FE thuần)

Hai WO quản trị SOCIAL làm chung một PR, mỗi WO một commit. Không đổi BE, contract, quyền.

## 1. FEADMINSIGNAL — lượt ghi 049 · 050 · 051 và xuất 053 nhận `signal`

Quyết định
- `social-kudos-api.ts`: `createBadge(body, attemptId, signal?)` · `updateBadge(id, body, signal?)` · `deactivateBadge(id, signal?)`;
  `social-stats-api.ts`: `exportEngagement(query?, signal?)`. Khoá `signal` CHỈ có mặt khi nơi gọi truyền (khuôn `moderatePost`) ⇒
  mọi nơi gọi cũ giữ nguyên `init`.
- Ba nơi gọi `useGuardedMutation` truyền `signal` do hook sinh: `BadgeFormDialog` (`sendSave`) · `use-badge-toggle` (`sendToggle`) ·
  `ExportEngagementButton` (`fetchExport`).
- `outcomeUnknown` giữ nguyên (huỷ trên dây không chứng minh server chưa ghi ⇒ vẫn đọc lại, «Thử lại» cùng `attemptId`).
- KHÔNG sửa `registry.ts` (chú thích «ghim ở social-wiring.spec» còn trong ghi chú 📌 của WO — xem Nợ).

Ánh xạ done_when → test
- «bốn hàm nhận signal»: `social-kudos-api.spec.ts` (3 hàm chuyển đúng signal · đối chứng vắng signal ⇒ không có khoá) ·
  `social-stats-api.spec.ts` (053).
- «request bị huỷ khi hết hạn + đối chứng không huỷ»: `BadgeFormDialog.errors.spec.tsx` (049 · 050 · đối chứng thành công) ·
  `BadgeSettingsPage.actions.spec.tsx` (051 · 050 «Bật lại» · đối chứng) · `ExportEngagementButton.spec.tsx` (053 · đối chứng).
- «outcomeUnknown giữ nguyên»: các ca treo-30-giây có sẵn ở cùng spec (không sửa, vẫn xanh).
- Ba spec cũ khẳng định `mock.calls` đúng hai đối số được cập nhật thành `expect.any(AbortSignal)` ở đối số cuối.

## 2. FESTATSBUSY — thanh bộ lọc Thống kê + phần dư focus

Quyết định
- Thanh bộ lọc dựng từ khoảng ĐÃ YÊU CẦU: `requestedRange(urlRange, response.range)` (`lib/stats-range.ts`) — URL có `from`/`to` thì
  lấy chúng + số tuần suy từ hai đầu (không tròn tuần ⇒ rơi về response); URL mặc định ⇒ response. Chọn cách này thay vì
  `aria-disabled` để hai cú ‹ / › dịch đúng 2 bước và nút KHÔNG bao giờ bị khoá lúc giữ focus. Ô «Số tuần» hưởng cùng nguồn.
- Ba lối thoát của dải lỗi («Bỏ lọc đơn vị» · «Về mặc định» · «Thử lại») đưa focus về tiêu đề `h1` (`tabIndex=-1`, tái dùng
  `useOutcomeFocus`). Không đặt trong `go()` chung: ‹ › và ô đơn vị phải giữ focus.
- 403 của hộp thoại sửa huy hiệu: chỉ kéo focus sang dải khi `done` hoặc `invalidate` (hàng đổi); lỗi không làm mới để
  `Dialog` trả focus về nút «Sửa».
- Xuất xong: vùng `<p role="status" class="sr-only">` luôn có mặt, mang `admin.stats.export.done` («Đã xuất tệp thống kê.») cho
  đúng bộ tham số vừa xuất; gỡ khi xuất lượt mới. i18n ở `vi/social-admin-stats.ts` (không thêm namespace).
- `AdminErrorNotice` KHÔNG đổi ⇒ không có ca hồi quy mới ở Kiểm duyệt; cả thư mục `routes/social/moderation` chạy xanh.

Ánh xạ done_when → test
- ‹ ‹ liên tiếp dịch 2 bước · › sau ‹ · «Số tuần» giữ giá trị: `stats/StatsPage.busy.spec.tsx` (3 ca).
- Focus sau ba lối thoát: cùng spec (3 ca). Focus sau 403 hộp thoại sửa: `BadgeSettingsPage.form.spec.tsx`.
- `role="status"` sau xuất: `ExportEngagementButton.spec.tsx` (2 ca).

## Sổ vết

- RED trên mã cũ (đã chạy, sửa tạm rồi khôi phục): FEADMINSIGNAL — app 8 ca đỏ (BadgeFormDialog 3 · actions 3 · export 2),
  web-core 2 ca đỏ. FESTATSBUSY — `StatsPage.busy.spec` 6/6 đỏ; badge 403 focus 1 đỏ; export «đã xuất» 2 đỏ.
- GREEN: vitest `routes/social/{badges,stats,admin,moderation}` + `social-wiring.spec` = 44 tệp / 919 ca; web-core 2 spec = 20 ca;
  typecheck app + web-core, eslint tệp đã chạm: xanh. Đã build lại contracts + web-core.
- Sổ vết KPI: (điền sau)

## Nợ

- `registry.ts`: ba chú thích «ghim ở social-wiring.spec.ts ca W1» + docblock `social-wiring.spec.ts` (ghi chú 📌 PR-C của WO
  FEADMINSIGNAL) chưa sửa — lượt này bị cấm chạm registry.ts; gieo WO nhỏ.
- Khoảng URL không tròn tuần (sửa tay URL) ⇒ thanh bộ lọc rơi về `range` của response; server nắn tuần ISO rồi thì nhãn đổi theo.
- KPI trình duyệt thật (bàn phím + chuột) do bước sau đo; done_when FESTATSBUSY còn mục «đã nhìn trên trình duyệt thật».
- Chưa tách `use-guarded-mutation` ra thư mục dùng chung (WO FEADMINSHARED).
