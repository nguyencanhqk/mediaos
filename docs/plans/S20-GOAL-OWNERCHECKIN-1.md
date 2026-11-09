# S20-GOAL-OWNERCHECKIN-1 — tên người phụ trách / người check-in + check-in cuối

Zone amber · FULL gate. Một đợt, một PR. Không migration (index `idx_goal_updates_goal (company_id, goal_id, created_at desc)` đã có).

## Quyết định
1. **Q14 = B**: `view:goal` thấy TÊN HIỂN THỊ, không cần `read:employee`; CHỈ `users.full_name`. Ghi ở SPEC-10 §3.3.
2. **DTO** (`packages/contracts/src/goal.ts`): `ownerName`, `lastCheckinAt` (core, nên cây/chi tiết/me thừa hưởng) và `actorName` (update) — `nullable().optional()`, không `.default()`. Mapper chỉ phát khoá khi có dữ liệu ⇒ phản hồi ghi/dashboard giữ hình cũ.
3. **Hai truy vấn gộp cho cả lô** (`GoalsService.identityOf`): `GoalsRepository.ownerNamesTx` (employee_profiles ⟕ users, `company_id` ở cả hai bảng) + `GoalUpdatesRepository.lastCheckinByGoalIdsTx` (GROUP BY goal_id, chỉ `update_type='checkin'`). Tên người check-in: LEFT JOIN trong `listByGoalTx` (không sửa `goal-checkin.service.ts`).
4. **Người nghỉ/xoá**: hồ sơ xoá mềm / tài khoản xoá / không tên ⇒ `null` («—»); `resigned|terminated` ⇒ `"<tên> (Đã nghỉ)"` (hằng `GOAL_OWNER_LEFT_SUFFIX`). Actor đã xoá tài khoản ⇒ `null`.
5. **Census chiếu danh tính**: 2 điểm mới (`goals.repository.ts#ownerNamesTx`, `goal-updates.repository.ts#listByGoalTx`) ⇒ 2 phán quyết căn cứ `membership` (tập hàng bị chặn bởi quyền đọc tài nguyên mục tiêu). Trần `membership` 12 → 14 CÓ CHỦ ĐÍCH (ghi lý do trong `BASIS_CEILINGS`) — reviewer cần soi.
6. **FE**: hàm thuần `goal-checkin-freshness.ts` (ngày lịch theo giờ công ty, `GOAL_CHECKIN_STALE_DAYS = 7`, chưa từng check-in ⇒ tính từ `createdAt`); `GoalCheckinCell` + `GoalNeedsCheckinBadge` dùng ở danh sách (cột «Phụ trách», «Check-in cuối» sắp tại chỗ bằng `accessorFn`), cây, chi tiết, thẻ /me (đẩy «Cần check-in» lên đầu, ổn định). Chi tiết bỏ query danh bạ nhân viên (dùng `ownerName`). Tab Lịch sử thêm cột «Người check-in». i18n `vi/goals.ts`.

## Ánh xạ done_when → test
| done_when | Test |
| --- | --- |
| 1 deny-path + DTO chỉ ba trường | `test/integration/s20-goal-owner-checkin.int-spec.ts` ca «DENY view@Own…», «DENY không email/SĐT/mã NV»; `goals.mapper.identity.spec.ts` |
| 2 bốn endpoint + MỘT truy vấn gộp + optional | int-spec ca ALLOW list/tree/me; `goal-updates.repository.lastcheckin.spec.ts` (đếm `select` = 1 cho N mục tiêu) |
| 3 ALLOW Department + read:employee, nghỉ/xoá | int-spec «ALLOW tên trưởng phòng + MAX check-in (bỏ finalize)», «(Đã nghỉ)/null»; ca «Q14 = B chỉ view:goal» |
| 4 FE cột/nhãn/thẻ /me/tự động không nhãn | `goal-checkin-freshness.spec.ts`, `GoalCheckinCell.spec.tsx`, `MeGoalsCard.spec.tsx` (đẩy lên đầu · tự động không nhãn) |
| 5 KPI #16 | agent khác đo — xem «Sổ vết KPI» |
| 6 SPEC-10 + census + security-reviewer | SPEC-10 §3.3 (Q14 = B); `identity-projection-verdicts.ts`; reviewer + `check.sh --lane-db` do brain chạy |

## Sổ vết
- RED: mapper+repo unit 4 ca đỏ / 5 (trước khi code); int-spec trên service CŨ: 4 đỏ / 5 (ca DENY-quyền đỏ-không-thể vì mã cũ không trả tên — đúng; ca ALLOW đỏ).
- GREEN: unit 5/5; int-spec 5/5 trên lane `mediaos_w3g`; ratchet `identity-projection` 9/9; `src/routes/goals` + MeGoalsCard 371/371; typecheck api + app xanh; eslint xanh; prettier đã áp.
- Sổ vết KPI: (điền sau)

## Nợ
- Chưa có test FE riêng cho cột danh sách / hàng cây / cột tab Lịch sử (phủ gián tiếp qua spec cũ + cell spec).
- `check.sh --lane-db` đầy đủ + security-reviewer/database-reviewer/silent-failure-hunter: brain chạy trước PR.
- «(Đã nghỉ)» là hậu tố tiếng Việt do server ghép (DTO chỉ cho phép một chuỗi tên); đa ngôn ngữ ⇒ đổi sang cờ riêng ở WO sau.
- `companyTimeZone()` hiện trả hằng mặc định (hạ tầng S20-FE-COMPANYTZ-1).
