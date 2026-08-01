# S6-LEAVE-TYPEADMIN-1 — Màn Loại nghỉ hết là cửa một chiều

> WO `S6-LEAVE-TYPEADMIN-1` · zone **vàng** · LIGHT gate · **KHÔNG migration, KHÔNG cặp quyền mới**
> Loại CR (RELEASE-05 §4.1): **UX blocker** — người dùng không hoàn thành được flow "bật lại loại nghỉ đã ngưng"

---

## 1. Sự cố thật, không phải giả định

**PROD 2026-08-01.** Owner vào màn *Loại nghỉ phép* định bỏ trừ quỹ cho `SICK`, bấm nhầm sang trạng
thái **"Ngưng áp dụng"** cho cả `SICK` lẫn `COMPENSATORY`. Hai dòng **biến mất khỏi màn hình** và
**không có đường nào bật lại bằng giao diện**.

Hậu quả tức thời: nhân viên không chọn được nghỉ ốm / nghỉ bù nữa — nặng hơn trạng thái trước đó
(chọn được nhưng bị chặn ở số dư).

## 2. Gốc rễ

`listTypesAdmin()` ([leave-api.ts:218](../../packages/web-core/src/lib/leave-api.ts)) gọi
`GET /leave/types` → `LeaveReadRepository.findActiveTypesTx` → **lọc cứng `status='active'`**.

Không có endpoint quản trị nào liệt kê loại `inactive`, nên bản ghi vẫn nằm trong DB mà không đường
đọc nào của giao diện với tới.

> Đáng chú ý: hạn chế này **đã được ghi thành comment trong chính file đó từ trước** ("HẠN CHẾ ĐÃ
> BIẾT (BE gap)"). Biết mà chưa xử lý — cùng một hình dạng với `accrual_method` và
> `max_negative_days` vá sáng cùng ngày. Xem memory `ui-promises-backend-never-reads`.

## 3. Cách vá

| Tầng | Thay đổi |
| --- | --- |
| Repository | `findAllTypesTx` — khác `findActiveTypesTx` **đúng một vị từ**: bỏ `status='active'`. Vẫn loại `deleted_at` |
| Service | `LeaveAdminService.listTypes` — gate `view:leave-type` (không sensitive), map qua `toTypeAdminView` sẵn có |
| Controller | `GET /leave/admin/types` |
| FE | `listTypesAdmin` trỏ route mới, validate bằng `leaveTypeAdminViewSchema` THẬT ⇒ bỏ vá `allowNegativeBalance: null` (form sửa nay prefill đúng giá trị đang lưu) |

### 3.1 Hai quyết định có chủ đích

**Giữ TÁCH hai đường đọc.** Không sửa `GET /leave/types` cho trả cả `inactive`. Route đó nuôi ô chọn
loại nghỉ lúc nhân viên tạo đơn — cho `inactive` lọt vào là **đổi một cửa kẹt lấy một lỗ nghiệp vụ**
(nhân viên nộp đơn theo loại công ty đã ngưng). Test khoá **cả hai chiều**.

**Cổng dùng ĐÚNG cặp `view:leave-type`** mà `leaveTypesMeta.requiredAnyPermissions` đang gate — không
mạnh hơn, không yếu hơn. Gate đường-tải lệch gate màn-hình là cách repo này từng sinh lỗ scope.

**KHÔNG đụng `MasterDataCrudScreen`** (dùng chung 5 màn khác). Bảng đã có cột trạng thái + badge, nên
loại `inactive` hiện ra là đủ để sửa. Thêm bộ lọc là mở rộng phạm vi không cần cho việc đóng lỗ này.

## 4. Test

| # | Ca | |
| --- | --- | --- |
| 1 | `GET /leave/admin/types` **trả** loại `inactive`, rồi `PATCH` bật lại được | đóng vòng: thấy → sửa → sống lại |
| 2 | `GET /leave/types` **KHÔNG** trả `inactive` | chống đổi-lỗ, ca này quan trọng ngang ca 1 |
| 3 | Thiếu `view:leave-type` → **403** | |
| 4 | Không rò loại của tenant khác | RLS |

**RED đã chứng minh:** bỏ route đi thì ca 1 · 3 · 4 đỏ (`404 Cannot GET /leave/admin/types`), riêng
ca 2 **vẫn xanh** — đúng, vì nó canh đường đọc cũ không được đổi.

## 5. Phát hiện phụ (đã sửa trong cùng WO)

Fixture `HR_ADMIN_PAIRS` của int-spec cấp `create/update/delete:leave-type` mà **thiếu
`view:leave-type`** — persona HR **ghi được nhưng đọc không được**, đúng hình dạng đã sinh lỗ scope ở
repo này. Vai thật CÓ cặp đó (mig 0455 cấp @Company cho employee/manager/hr/company-admin), nên bổ
sung là đưa fixture về đúng thực tế, **không phải nới quyền cho test dễ xanh**.

## 6. Ngoài phạm vi

- Không thêm bộ lọc trạng thái (bảng đã có cột trạng thái).
- Không đụng màn thùng rác / soft-delete — đó là quyết định khác.
- Không gộp/xoá route `GET /leave/types` legacy.
