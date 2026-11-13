# S20-GOAL-SUGGEST-1 — Gợi ý mục tiêu khi tạo việc (US-GOAL-NV-92 / NV-93)

Chỉ FE (apps/app). Không đổi DTO, quyền, schema, API.

## Quyết định

1. **Q28 chưa chốt** ⇒ dùng khuyến nghị A: ô «Tính vào mục tiêu của việc cha» KHÔNG chọn sẵn. Gom vào một
   hằng `GOAL_SUGGEST_SUBTASK_PRESELECT` (`routes/goals/goal-suggest.ts`); đổi sang B = sửa một dòng.
2. **Helper thuần** `goal-suggest.ts`: ứng viên = Active · chưa chốt · `progressMode==='tasks'` · kỳ chứa
   ngày hạn việc theo giờ công ty (không hạn ⇒ hôm nay) · khớp neo (cá nhân/dự án/phòng); xếp cá nhân >
   dự án > phòng. Việc không người phụ trách VÀ không dự án ⇒ không ứng viên.
3. **Hook** `use-goal-suggestions.ts`: tối đa 3 truy vấn GET /goals có lọc Ở SERVER (`level` + neo +
   `status=Active` + `periodFrom=periodTo=ngày` + `limit=50`) — API GOAL đã hỗ trợ đủ các tham số này, không
   sửa API. Chỉ bật khi có cả `update:goal` và `update:task` (useCan). Bản mệnh lệnh `fetchGoalCandidates`
   cho tạo nhanh.
4. **Luật chọn sẵn**: đúng 1 ứng viên VÀ `employeeId === ownerEmployeeId ===` tôi (từ /auth/me) ⇒ chọn sẵn
   - nhãn «Gợi ý»; 1 ứng viên khác ⇒ chip một chạm; nhiều ⇒ dropdown, không chọn sẵn.
5. **Hai lời gọi**: POST /tasks rồi POST /goals/:id/tasks (`use-goal-suggestions-link.ts`). Bước 2 lỗi ⇒ việc
   vẫn còn; form hiện hộp «Đã tạo việc «‹tên›» nhưng chưa gắn: ‹lý do›» + «Thử gắn lại» (chặn bấm Lưu lần
   hai gây tạo trùng); GOAL-ERR-005 ⇒ «mục tiêu đã chốt kỳ», 404 ⇒ «không có quyền ghi việc này vào mục tiêu».
   Thành công ⇒ toast «Đã gắn vào ‹G› · Gỡ» (Gỡ = DELETE /goals/:id/tasks/:taskId).
6. **Tạo nhanh** (`TaskQuickAdd`, dùng chung cho KanbanQuickCreate và «Việc của tôi»): toast «Đã tạo ‹tên› ·
   Tính vào ‹G›?» khi đúng 1 ứng viên; chạm mới gắn.
7. **Chi tiết việc** (`TaskGoalField`): dùng hook chung; sửa lỗi cũ (dropdown liệt kê mục tiêu manual/
   children/project); việc CHƯA gắn + đúng 1 ứng viên ⇒ chip; việc đang gắn mục tiêu khác ⇒ không gợi ý.
8. **Việc con**: thêm việc con hiện là ô nhập inline (`TaskSubtaskPanelQuickAdd`), không còn hộp thoại;
   `TaskSubtaskDialogs` chỉ còn Sửa/Xoá nên không đổi. Ô nằm ở `TaskSubtaskPanelQuickAdd.goal.tsx`: hiện
   khi mục tiêu của cha còn nhận việc; KHOÁ kèm lý do khi mục tiêu cá nhân (việc con thêm nhanh chưa có
   người phụ trách ⇒ GOAL-ERR-008) hoặc ngoài phạm vi ghi; ẩn khi thiếu quyền / đã chốt / huỷ.
9. i18n: `vi/goals.ts` (`goalSuggest`: toast + lý do) và `vi/tasks-workux.ts` (`goalSuggest`: ô/chip/việc con).
   Task core DTO không có mã việc ⇒ thông điệp dùng tiêu đề việc.

## done_when → test

| #   | Tiêu chí                                                             | Test                                                                                                                                         |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Helper + hook, lọc server, hai cổng                                  | `goal-suggest.spec.ts` (31 ca) · `TaskGoalField.spec.tsx` («lọc Ở SERVER», «thiếu update:task ⇒ không gọi GET /goals»)                       |
| 2   | Form tạo: chọn sẵn / chip / dropdown; hai lời gọi; lỗi bước 2; toast | `TaskFormDrawer.goal.spec.tsx` (chọn sẵn+Gợi ý, quản lý tạo ⇒ chip, ERR-005 + Thử gắn lại, 404, thiếu quyền)                                 |
| 3   | Tạo nhanh + Kanban toast; chi tiết chip; không gợi ý chuyển          | `TaskQuickAdd.goal.spec.tsx` (1 / 0 / 2 ứng viên, từ chối, Gỡ, thiếu quyền) · `TaskGoalField.spec.tsx` (chip, đang gắn khác, nhiều ứng viên) |
| 4   | Việc con: ô, khoá, ẩn, Gỡ                                            | `TaskSubtaskPanelQuickAdd.goal.spec.tsx` (7 ca)                                                                                              |
| 5   | Deny-path + chốt kỳ + không ứng viên + KPI #26                       | các ca deny ở trên; ca chốt kỳ giữa chừng = ERR-005 ở form; không ứng viên = helper + tạo nhanh. KPI: xem Sổ vết                             |

## Sổ vết

- RED: `goal-suggest.spec.ts` đỏ (thiếu module) trước khi viết helper. `TaskGoalField.spec.tsx` bản mới chạy
  trên mã cũ: **3 ca đỏ** (loại manual/children, lọc ở server, chip) / 15 xanh; trên mã mới 18/18 xanh.
- Xanh: app typecheck; eslint `--max-warnings 0` trên routes/goals + routes/tasks + 2 tệp locale; vitest
  `routes/tasks` + `routes/goals` + quick-create + MessageToTaskDialog = 94 tệp / 1301 ca; 4 spec vỏ
  (QuickCreateHost · ProtectedShell · GlobalTopbar · notifications flow) = 54 ca.
- Sổ vết KPI: (điền sau)

## Nợ

- API GOAL chưa có bộ lọc `progressMode` và `finalized` ⇒ lọc ở client (tối đa 3×50 dòng).
- Việc con thêm nhanh chưa có người phụ trách ⇒ mục tiêu cá nhân luôn khoá; mở được khi ô inline hỗ trợ chọn
  người phụ trách lúc tạo.
- Việc chưa có phòng ⇒ không gợi ý mục tiêu phòng (khác hành vi cũ liệt kê mọi mục tiêu phòng).
- Tạo việc từ chat (MessageToTaskDialog) hưởng ô mới nhờ `TaskFormDrawer`; chưa có test riêng cho nhánh này.
- Q27/Q28 chờ owner trên trang duyệt; đọc lại câu trả lời trước khi đổi hằng số.

## Sổ vết — vá review (đợt 5)

- L1 (hộp thoại «chưa gắn» đóng được bằng Esc/nền khi đang thử lại): vá `onClose` của Dialog chặn khi `busy`; ca `TaskFormDrawer.goal.spec` (Esc giữa lúc thử lại) đỏ trên mã cũ → xanh.
- L2 (truy vấn ứng viên hỏng một phần bị nuốt, ra một ứng viên sai): hook trả `[]` khi `isError` (ô tự ẩn, mode none); `fetchGoalCandidates` dùng `allSettled`, có truy vấn hỏng ⇒ `[]` + `console.warn`; ca `use-goal-suggestions.spec` + `TaskQuickAdd.goal.spec` đỏ → xanh.
- L3 (bỏ qua `warnings`/`linked` của kết quả gắn): `link` đọc kết quả — `linked=0` ⇒ toast cảnh báo «đã được gắn từ trước»; có `warnings` ⇒ toast cảnh báo kèm nội dung (giữ nút Gỡ); khoá i18n `goalSuggest.linkedWarning`/`alreadyLinked`; 2 ca `TaskQuickAdd.goal.spec` đỏ → xanh.
- L4 (smoke: gắn/gỡ bắn 3 GET `/tasks` trùng — `refresh()` ghép `linkTasks` + `detail` + `list`, prefix lặp): thêm `uniqueKeys` (so JSON queryKey) trước khi invalidate; ca `use-goal-suggestions-link.spec` đỏ (11 khoá khác nhau / 18 lời gọi) → xanh. Nợ ngoài phạm vi: `/tasks` ở 375px cuộn ngang do bảng 814px (có từ trước).
