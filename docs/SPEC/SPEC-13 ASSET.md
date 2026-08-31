# SPEC-13: ASSET — QUẢN LÝ TÀI SẢN (DANH MỤC · HỒ SƠ · CẤP PHÁT · THU HỒI · BẢO TRÌ · KIỂM KÊ · THANH LÝ)

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>) · [SPEC-10 GOAL](<SPEC-10 GOAL.md>) · [SPEC-12 RECRUIT](<SPEC-12 RECRUIT.md>) · **SPEC-13 ASSET** · [SPEC-14 ROOM](<SPEC-14 ROOM.md>) · [SPEC-15 CHAT](<SPEC-15 CHAT.md>)
>
> **Liên quan:** [Chỉ mục tài liệu](<../README.md>) · [DB-15 ASSET Database Design](<../DB/DB-15 ASSET Database Design.md>) · [Thiết kế API: API-14 ASSET](<../API Design/API-14_ASSET_API_Design.md>) · [Ma trận phân quyền §9d](<../permission-matrix-spec.md>) · [HR nền: SPEC-03](<SPEC-03 HR.md>) · [NOTI nền: SPEC-08](<SPEC-08 NOTI.md>) · [Kế hoạch wave: S11-OFFICE](<../plans/S11-OFFICE-WAVE.md>)
>
> **Đánh số:** ASSET giữ đúng số **SPEC-13** đã khoá tại [SPEC-01 §7.2/§8](<SPEC-01 Tổng quan.md>). Tài liệu DB/API lấy **DB-15 / API-14** (OFFICE-DEC-001 — DB-13/14 đã bị IMPLEMENTATION-10 đặt trước cho PAYROLL/RECRUIT, giữ nguyên chỗ đặt đó, không dồn số).

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | SPEC-13 |
| Tên tài liệu | ASSET - Quản lý tài sản |
| Module code | ASSET |
| Tài liệu cha | SPEC-01: Tổng quan hệ thống (§12.10) |
| Module phụ thuộc trực tiếp | AUTH (RBAC), HR (employees/departments — người giữ tài sản), FOUNDATION (audit · sequences · files) |
| Module liên quan | NOTI (cấp phát · thu hồi · bảo trì đến hạn), DASH (widget thống kê), ME («tài sản của tôi») |
| Phiên bản | v1.0 |
| Trạng thái | **Approved** — owner duyệt nguyên gói hồ sơ wave S11-OFFICE ngày **28/08/2026**, ký OFFICE-DEC-001 + ASSET-DEC-001..004 (§22) |
| Giai đoạn | **Phase 3 «Quản trị văn phòng» · wave S11-OFFICE** — hậu go-live |
| Ngày tạo | 28/08/2026 |
| Ngày cập nhật | 28/08/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả module **ASSET — Quản lý tài sản**: nơi công ty ghi nhận từng tài sản (laptop, màn hình, điện thoại, xe, thiết bị văn phòng…), biết **ai đang giữ cái gì**, lịch sử cấp phát/thu hồi, lượt bảo trì, kết quả kiểm kê từng đợt, và kết thúc vòng đời bằng thanh lý hoặc ghi nhận mất.

ASSET trả lời các câu hỏi:

```text
Công ty có bao nhiêu tài sản, thuộc loại nào, đang ở trạng thái nào?
Chiếc laptop mã TS-LT-0042 hiện ai giữ, nhận từ ngày nào, tình trạng lúc nhận ra sao?
Nhân viên A nghỉ việc — A đang giữ những tài sản nào cần thu hồi?
Tài sản nào đang bảo trì, tài sản nào sắp đến hạn bảo trì?
Đợt kiểm kê quý này: bao nhiêu cái thấy, bao nhiêu cái không thấy, cái nào chưa kiểm?
Tôi đang giữ tài sản gì của công ty?
```

ASSET **không sở hữu** dữ liệu của module khác: nhân sự vẫn thuộc HR (tài sản chỉ **trỏ** về `employees`), tài khoản thuộc AUTH, tệp/ảnh thuộc FOUNDATION Files. ASSET chỉ sở hữu **loại tài sản · hồ sơ tài sản · lượt cấp phát · lượt bảo trì · đợt kiểm kê và kết quả từng dòng**.

---

## 3. Định nghĩa và nguyên tắc kiến trúc

### 3.1 Tài sản là một hồ sơ vật lý có máy trạng thái (FSM)

Mỗi hàng `assets` là **một** vật (không phải một loại, không phải số lượng). Vòng đời của nó là một FSM đóng — ASSET-DEC-003:

```text
tài sản      : In Stock · Assigned · Under Maintenance · Disposed · Lost
lượt cấp phát: Active · Returned
```

Bộ giá trị này được **hợp thức tại SPEC-01 §17.8–17.9** (luật §17.7: module không tự thêm trạng thái). Chuyển tiếp hợp lệ ở §13.1; **service ép FSM**, DB chỉ CHECK tập giá trị (CHECK không ép được chuyển tiếp — bài học `check-cannot-enforce-fsm-transitions`).

### 3.2 Một tài sản — tối đa MỘT lượt cấp phát đang hiệu lực

"Ai đang giữ" là **dẫn xuất** từ hàng `asset_assignments` có `status = 'Active'`, không lưu cứng `holder_employee_id` trên `assets`. Ràng buộc **partial unique index** `(company_id, asset_id) WHERE status = 'Active'` ở tầng DB là chốt cuối chống hai lượt cấp phát cùng sống (hai request song song lọt qua kiểm-rồi-ghi ở service).

### 3.3 Cấp phát MỘT bước — ASSET-DEC-002

Asset Manager ghi nhận cấp phát ⇒ tài sản sang `Assigned` ngay, nhân viên **không** phải bấm xác nhận. Biên bản bàn giao **in từ FE** từ dữ liệu lượt cấp phát (không sinh PDF ở server). Luồng 2 bước (nhân viên xác nhận đã nhận) để Phase sau — chừa cột `acknowledged_at` trên `asset_assignments`, v1 luôn NULL.

### 3.4 Thanh lý = chuyển trạng thái, không workflow phê duyệt — ASSET-DEC-001

`Disposed` và `Lost` là hai trạng thái **kết thúc**: đặt bằng một hành động có **lý do bắt buộc** + audit, **không** có FSM phê duyệt riêng (tránh dựng thêm một crown-jewel ở v1). Đúng một ngoại lệ có chủ đích: `Lost → In Stock` («tìm thấy lại», §13.1) — cùng cặp quyền với thanh lý, cũng cần lý do, cũng audit.

### 3.5 Mã tài sản sinh ở server, QR render ở client — ASSET-DEC-001/004

`asset_code` dạng **`TS-<PREFIX LOẠI>-<seq>`** (ví dụ `TS-LT-0042`), cấp qua `sequence_counters` **per-company, per-loại** (§13.5). Mã **bất biến** sau khi tạo. QR chỉ là **hình ảnh của chuỗi `asset_code`** do FE render — không có service sinh ảnh, không lưu ảnh QR.

### 3.6 Không sao chép dữ liệu nguồn

Tên/mã/phòng ban của người giữ luôn **JOIN** từ HR lúc đọc, không denormalize vào ASSET. Duy nhất **ảnh chụp có chủ đích** là ở đợt kiểm kê: `asset_inventory_items` chụp `expected_status` + `expected_holder_employee_id` **tại thời điểm mở đợt** — vì đối chiếu "đáng lẽ ai giữ" phải cố định trong suốt đợt, không trôi theo cấp phát mới.

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

- Một nguồn sự thật về tài sản công ty: **cái gì · ở đâu · ai giữ · tình trạng**.
- Cấp phát / thu hồi có dấu vết, có biên bản; nhân viên nghỉ việc biết ngay phải thu hồi gì.
- Theo dõi bảo trì (đang sửa · sắp đến hạn) và kiểm kê định kỳ có kết quả từng dòng.
- Nhân viên tự xem «tài sản của tôi» mà không phải hỏi hành chính.

### 4.2 Mục tiêu kỹ thuật

- Tái dùng tối đa hạ tầng đã có: RBAC per-pair + data_scope, `withTenant` + RLS, `sequence_counters`, audit, outbox NOTI, Files.
- FSM ép ở **service**, chốt cuối ở **DB** (partial unique), chuyển tiếp sai trả **4xx đúng mã `ASSET-ERR`**, không 500.
- Mọi `:id` là UUID ở biên ngay từ đầu (ratchet param-uuid đang siết về 1 — không thêm nợ).

---

## 5. Phạm vi module

### 5.1 Trong v1 (wave S11-OFFICE — SPEC-01 §12.10)

| # | Hạng mục | Story (wave §4) |
| --- | --- | --- |
| 1 | Danh mục **loại tài sản** (mã · tên · prefix mã · chu kỳ bảo trì mặc định) | AS-01 |
| 2 | **Hồ sơ tài sản**: mã tự sinh + QR, tên, serial, hãng/model, ngày mua, giá mua, bảo hành, vị trí | AS-02 |
| 3 | **Cấp phát** cho nhân viên (1 bước, biên bản in từ FE) | AS-03 |
| 4 | **Thu hồi** — ghi tình trạng khi thu (`Good` / `Damaged` / `Lost`) | AS-04 |
| 5 | **Bảo trì**: mở/đóng lượt, tài sản sang `Under Maintenance`, hạn bảo trì kế tiếp | AS-05 |
| 6 | **Kiểm kê**: mở đợt (toàn bộ hoặc theo loại) → đánh dấu từng tài sản Thấy/Không thấy → đóng đợt | AS-06 |
| 7 | **Thanh lý** (`Disposed`) / ghi nhận **mất** (`Lost`) / tìm thấy lại | AS-07 |
| 8 | **«Tài sản của tôi»** (`/me/assets`, own-scope) | AS-08 |
| 9 | Sự kiện NOTI: cấp phát · thu hồi · bảo trì đến hạn | AS-09 |
| 10 | Widget DASH thống kê theo trạng thái/loại | AS-10 |

### 5.2 Ngoài v1 (chừa thiết kế, KHÔNG làm đợt này)

- **Khấu hao / giá trị kế toán** — giá mua chỉ là thông tin tham khảo, không có bảng khấu hao.
- **Mua sắm / đề xuất cấp phát tự phục vụ** (nhân viên xin cấp, duyệt) — không có FSM phê duyệt.
- **Cấp phát 2 bước** (nhân viên xác nhận đã nhận) — cột `acknowledged_at` chừa sẵn, v1 luôn NULL.
- **Ứng dụng quét barcode/QR** — v1 chỉ render QR để dán nhãn; quét bằng camera là việc của Phase MOBILE.
- **Cấp phát cho phòng ban / vị trí** (không gắn người) — v1 chỉ cấp cho **nhân viên**; tài sản dùng chung để `In Stock` + cột `location`.
- Nhập Excel hàng loạt, xuất báo cáo Excel.

### 5.3 Không có tài sản cũ nào bị khai tử

Đo ngày 28/08/2026: **không** có bảng `assets` trần trong DB (chỉ `content_assets` thuộc cụm media đã park — tên khác, không đụng). Wave này **tạo mới 6 bảng**, không ALTER/DROP bảng nào có sẵn.

---

## 6. Nhóm người dùng

| Nhóm | Vai trò trong ASSET |
| --- | --- |
| **Asset Manager** (SPEC-01 §10.8 — role hệ thống **mới** `asset-manager`) | Toàn quyền nghiệp vụ: danh mục loại · hồ sơ · cấp phát · thu hồi · bảo trì · kiểm kê · thanh lý, phạm vi **Company** |
| Company Admin | Như Asset Manager (phạm vi Company) |
| HR | **Xem** toàn công ty — phục vụ offboarding (nhân viên nghỉ đang giữ gì) |
| Trưởng đơn vị (manager) | **Xem** tài sản do nhân viên **trong đơn vị mình** đang giữ |
| Nhân viên (employee) | **Xem** tài sản **mình đang giữ** + lịch sử của mình (`/me/assets`) |
| Super Admin | Nhận mọi cặp qua `SuperAdminBootstrapService` — **không** phải chủ thể để test (tautology) |

---

## 7. Mối liên kết với các module khác

| Module | ASSET đọc / gọi | Module kia đọc ASSET |
| --- | --- | --- |
| HR (SPEC-03) | `employees` (người giữ; chỉ nhân viên `active` mới được cấp), `departments`/`org_units` (data scope Department) | Màn offboarding có thể gọi `GET /assets?holderEmployeeId=` để liệt kê tài sản cần thu hồi |
| AUTH (SPEC-02) | RBAC per-pair + data_scope; `users` cho `*_by` | — |
| FOUNDATION | `sequence_counters` (mã tài sản), `audit_logs`, Files (ảnh tài sản qua `file_links`, tuỳ chọn) | — |
| NOTI (SPEC-08) | Outbox bridge: `ASSET_ASSIGNED` · `ASSET_REVOKED` · `ASSET_MAINTENANCE_DUE` (§17) | — |
| DASH (SPEC-07) | — | Widget thống kê tài sản đọc `GET /assets/summary` theo quyền (§15) |
| ME (SPEC-09) | — | Mục «Tài sản của tôi» trong `/me` gọi `GET /me/assets` |

---

## 8. Cấu trúc thông tin

Chi tiết cột/kiểu/constraint: [DB-15](<../DB/DB-15 ASSET Database Design.md>). Sáu bảng, tất cả có `company_id` + RLS FORCE + composite tenant FK:

**Loại tài sản (`asset_categories`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Định danh | `code`, `name`, `code_prefix` | `code_prefix` (2–6 ký tự A–Z0–9) đi vào mã tài sản `TS-<code_prefix>-<seq>`; **bất biến** sau khi đã sinh mã đầu tiên |
| Mặc định | `default_maintenance_interval_days` | dùng gợi ý `next_maintenance_due` khi đóng lượt bảo trì |
| Vòng đời | `is_active`, `sort_order`, `deleted_at` | soft delete; loại còn tài sản chưa `Disposed` không xoá được (ASSET-ERR-010) |

**Hồ sơ tài sản (`assets`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Định danh | `asset_code`, `name`, `serial_number` | `asset_code` sinh qua `sequence_counters`, unique theo company, **không sửa**; `serial_number` unique theo company khi khác NULL |
| Phân loại | `category_id`, `brand`, `model` | |
| Mua sắm | `purchase_date`, `purchase_price`, `supplier`, `warranty_end_date` | `purchase_price` + `supplier` là **trường tài chính** — **chỉ trả ở scope Company**, vắng khoá ở Own **và** Department, và **không bao giờ** ở `/me/assets` (§18) |
| Vị trí & tình trạng | `location`, `condition_note` | `location` = nơi để khi không ai giữ |
| Trạng thái | `status` | 5 giá trị §3.1; ai giữ = dẫn xuất từ lượt cấp phát Active (§3.2) |
| Bảo trì | `next_maintenance_due` | job nhắc §17 |
| Kết thúc | `status_reason`, `status_changed_at`, `status_changed_by` | lý do Disposed/Lost/tìm thấy lại — bắt buộc (ASSET-ERR-009) |
| Vòng đời | `deleted_at` | soft delete chỉ cho hồ sơ nhập nhầm (ASSET-ERR-015) |

**Lượt cấp phát (`asset_assignments`)** — sổ lịch sử, **không xoá**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `asset_id`, `employee_id` | composite tenant FK |
| Giao | `assigned_at`, `assigned_by`, `issue_condition`, `issue_note`, `expected_return_date` | |
| Trạng thái | `status` (`Active` / `Returned`) | partial unique 1 Active/tài sản (§3.2) |
| Thu | `returned_at`, `returned_by`, `return_condition` (`Good` / `Damaged` / `Lost`), `return_note` | chỉ các cột này được UPDATE (column-level GRANT) |
| Chừa | `acknowledged_at` | cấp phát 2 bước Phase sau — v1 luôn NULL |

**Lượt bảo trì (`asset_maintenances`)** — sổ lịch sử, **không xoá**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Mở | `asset_id`, `opened_at`, `opened_by`, `reason`, `vendor` | partial unique 1 `Open`/tài sản |
| Đóng | `status` (`Open` / `Closed`), `closed_at`, `closed_by`, `result_note`, `cost`, `next_due_date` | `cost` là trường tài chính (§18) |

**Đợt kiểm kê (`asset_inventories`)** + **dòng kiểm kê (`asset_inventory_items`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Đợt | `name`, `category_id` (NULL = toàn bộ), `status` (`Open` / `Closed`), `opened_at/by`, `closed_at/by`, `note` | partial unique **1 đợt Open/company** |
| Tổng kết (cache lúc đóng) | `total_items`, `found_count`, `missing_count`, `not_checked_count` | ghi **một lần** khi đóng đợt; không cập nhật sau |
| Dòng | `inventory_id`, `asset_id`, `expected_status`, `expected_holder_employee_id`, `result` (`Found` / `Missing` / `Not Checked`), `checked_at/by`, `note` | dòng tạo **lúc mở đợt** (ảnh chụp §3.6); unique `(inventory_id, asset_id)` |

---

## 9. Danh sách màn hình

| Mã | Màn hình | Ghi chú |
| --- | --- | --- |
| ASSET-SCREEN-001 | Danh sách tài sản (`/assets`) | Bảng + lọc loại/trạng thái/người giữ/tìm theo mã-tên-serial; nút «+ Thêm tài sản» theo quyền; badge đếm theo trạng thái |
| ASSET-SCREEN-002 | Chi tiết tài sản (`/assets/:id`) | QR render từ `asset_code`; 3 tab: **Thông tin** ‖ **Lịch sử cấp phát** ‖ **Bảo trì**; nút hành động theo FSM + quyền (Cấp phát · Thu hồi · Mở bảo trì · Thanh lý/Mất · Tìm thấy lại) — **không** hiện nút mà server sẽ trả 409 |
| ASSET-SCREEN-003 | Form tạo / sửa tài sản | `asset_code` chỉ hiện (read-only) sau khi tạo; validate ngày (ASSET-ERR-014) |
| ASSET-SCREEN-004 | Form cấp phát / thu hồi | Chọn nhân viên từ danh bạ HR (chỉ `active`), tình trạng lúc giao/thu, ghi chú; sau khi lưu có nút **In biên bản** (render từ FE, ASSET-DEC-002) |
| ASSET-SCREEN-005 | Kiểm kê theo đợt (`/assets/inventories`, `/assets/inventories/:id`) | Mở đợt (toàn bộ / theo loại) → bảng dòng với bộ lọc `result` → đánh dấu Thấy/Không thấy từng dòng (hoặc chọn nhiều) → đóng đợt kèm tổng kết; dòng `Missing` có gợi ý «Ghi nhận mất» **mở màn 002**, không tự đổi trạng thái |
| ASSET-SCREEN-006 | «Tài sản của tôi» (`/me/assets`) | Gắn khu vực ME; danh sách đang giữ + lịch sử đã trả; **không** có trường tài chính |
| ASSET-SCREEN-007 | Quản trị loại tài sản | Hộp thoại/tab trong 001 cho `('manage','asset-category')`; sửa `code_prefix` bị khoá khi loại đã có tài sản; bộ lọc «Đã xoá» (`?includeDeleted=true`) với nút **Khôi phục** (`PATCH { restore: true }`) — đường duy nhất dùng lại prefix |

Mọi màn: `<PermissionGate>` + `useCan()`, trạng thái loading/error/empty (§14), i18n vi namespace `asset`, nhãn trạng thái dùng constants chuẩn §17.

---

## 10. Chi tiết chức năng

| Mã | Chức năng | Mô tả ngắn |
| --- | --- | --- |
| ASSET-FUNC-001 | Quản lý loại tài sản | CRUD loại; `code_prefix` khoá sau mã đầu tiên; tạo loại ⇒ tạo `sequence_counters` tương ứng **trong cùng transaction** (§13.5); **khôi phục** loại đã xoá mềm qua `PATCH { restore: true }` (`deleted_at = NULL`, giữ counter — đường duy nhất để dùng lại prefix, §13.5) |
| ASSET-FUNC-002 | Tạo / sửa hồ sơ tài sản | sinh `asset_code`; sửa thông tin mô tả — **không** đổi `status`/`asset_code` qua PATCH |
| ASSET-FUNC-003 | Xoá mềm hồ sơ nhập nhầm | chỉ khi `In Stock` **và** 0 lượt cấp phát/bảo trì (ASSET-ERR-015) |
| ASSET-FUNC-004 | Cấp phát | 1 bước; `In Stock → Assigned`; tạo lượt `Active`; audit + `ASSET_ASSIGNED` |
| ASSET-FUNC-005 | Thu hồi | `Assigned → In Stock`; đóng lượt `Returned` với `return_condition`; audit + `ASSET_REVOKED`; `return_condition='Lost'` ⇒ tài sản sang `Lost` thay vì `In Stock` (§13.2) |
| ASSET-FUNC-006 | Mở lượt bảo trì | từ `In Stock` **hoặc** `Assigned` (người giữ vẫn giữ lượt Active); tài sản sang `Under Maintenance` |
| ASSET-FUNC-007 | Đóng lượt bảo trì | về `Assigned` nếu còn lượt cấp phát Active, ngược lại `In Stock` (**dẫn xuất**, không lưu "trạng thái trước"); cập nhật `next_maintenance_due` |
| ASSET-FUNC-008 | Mở đợt kiểm kê | ảnh chụp mọi tài sản trong phạm vi (trừ `Disposed`/`Lost`) thành dòng `Not Checked` |
| ASSET-FUNC-009 | Đánh dấu kiểm kê | từng dòng hoặc nhiều dòng: `Found` / `Missing` + ghi chú; chỉ khi đợt `Open` |
| ASSET-FUNC-010 | Đóng đợt kiểm kê | dòng chưa đánh dấu giữ `Not Checked`; cache 4 số tổng kết; **không** tự đổi trạng thái tài sản |
| ASSET-FUNC-011 | Thanh lý / ghi nhận mất | `→ Disposed` (từ `In Stock`/`Under Maintenance`) · `→ Lost` (từ `In Stock`/`Assigned`/`Under Maintenance`); lý do bắt buộc; tự đóng lượt bảo trì Open / lượt cấp phát Active kèm theo (§13.1) |
| ASSET-FUNC-012 | Tìm thấy lại | `Lost → In Stock`, lý do bắt buộc, audit |
| ASSET-FUNC-013 | Tài sản của tôi | own-scope, employee resolve từ token, **không** nhận `employeeId` từ client |
| ASSET-FUNC-014 | Thống kê | đếm theo trạng thái × loại trong phạm vi data_scope của người gọi — nguồn cho widget DASH |
| ASSET-FUNC-015 | Nhắc bảo trì đến hạn | system job hằng ngày quét `next_maintenance_due ≤ hôm nay + 7`, phát `ASSET_MAINTENANCE_DUE` idempotent theo `(asset, hạn)` |

---

## 11. Permission đề xuất — **ĐÃ CHỐT cùng gói duyệt 28/08/2026**

Theo chuẩn per-pair `(action, resource)` + data_scope per-(permission, role). Module `ASSET` đứng riêng. Bảng dưới là **cặp engine thực thi**; mã dotted `ASSET.RESOURCE.ACTION` (SPEC-01 §9.5) chỉ là tên hiển thị.

| Cặp quyền | Mã hiển thị | Ý nghĩa | Nhân viên | Trưởng đơn vị | HR | Asset Manager · BOD/Admin |
| --- | --- | --- | --- | --- | --- | --- |
| `('access','asset')` | `ASSET.ACCESS` | cổng nav menu Tài sản | có (Own) | có (Own) | có (Own) | có (Own) |
| `('view','asset')` | `ASSET.ASSET.VIEW` | xem loại · tài sản · lịch sử cấp phát/bảo trì · đợt kiểm kê · thống kê · **`/me/assets`** | **Own** (tài sản mình đang/đã giữ) | **Department** (tài sản nhân viên đơn vị mình đang giữ) | Company | Company |
| `('create','asset')` | `ASSET.ASSET.CREATE` | tạo hồ sơ tài sản | — | — | — | Company |
| `('update','asset')` | `ASSET.ASSET.UPDATE` | sửa thông tin mô tả | — | — | — | Company |
| `('delete','asset')` | `ASSET.ASSET.DELETE` | xoá mềm hồ sơ nhập nhầm | — | — | — | Company |
| `('assign','asset')` | `ASSET.ASSIGNMENT.CREATE` | cấp phát | — | — | — | Company |
| `('revoke','asset')` | `ASSET.ASSIGNMENT.REVOKE` | thu hồi | — | — | — | Company |
| `('dispose','asset')` | `ASSET.ASSET.DISPOSE` | thanh lý · ghi nhận mất · tìm thấy lại | — | — | — | Company |
| `('manage','asset-category')` | `ASSET.CATEGORY.MANAGE` | CRUD loại tài sản | — | — | — | Company |
| `('manage','asset-maintenance')` | `ASSET.MAINTENANCE.MANAGE` | mở/đóng lượt bảo trì | — | — | — | Company |
| `('manage','asset-inventory')` | `ASSET.INVENTORY.MANAGE` | mở/đánh dấu/đóng đợt kiểm kê | — | — | — | Company |

Ghi chú bắt buộc:

- **Đúng 11 cặp, `is_sensitive = false` cho cả 11** — chốt cùng seed, không để mở sau (bẫy `canonical-seed-pin-regression`: flip sau seed làm đỏ pin `auth-seed-canonical-roles` và phải sửa allowlist sensitive cùng lúc). Dữ liệu tài sản **không** thuộc danh sách nhạy cảm SPEC-01 §11.3; riêng trường **tài chính** chỉ trả ở scope Company (che ở Own **và** Department bằng masking server, §18), không bằng cặp nhạy cảm.
- **Đường «tài sản của tôi» dùng CHÍNH cặp đọc `('view','asset')` ở scope Own** — không tách cặp `ASSET.ASSIGNMENT.VIEW` riêng như bản dự kiến trong hồ sơ duyệt HTML. Tách cặp đọc thành hai sẽ đẻ ra role "thấy danh sách của mình mà không mở được chi tiết" — đúng họ lỗi `read-path-gate-pair-must-match-download-pair` (S5-TASK-COVER-1). Đây là **tinh chỉnh cách thi công**, không đổi phạm vi đã duyệt.
- **Đọc loại tài sản** (dropdown trong form, bộ lọc) đi theo `('view','asset')`; `('manage','asset-category')` chỉ gate **ghi**.
- **Role `asset-manager` là role hệ thống MỚI** (`roles.company_id IS NULL`, `is_system = true`, tiền lệ `hr-manager` mig `0019` · `guest`), giữ **cả 11 cặp** scope Company. Nó **không** phải role canonical — 4 role canonical vẫn là `employee` · `manager` · `hr` · `company-admin` (`DashCanonicalRole`); WO DB **không** được thêm nó vào các enumerate canonical, và pin `auth-seed-canonical-roles` chỉ kiểm 4 role kia.
- Cột "Trưởng đơn vị = Department" là ràng buộc **thật**: người giữ `view:asset@Department` chỉ thấy tài sản mà nhân viên **trong đơn vị mình (∪ đơn vị mình làm trưởng)** đang giữ; tài sản `In Stock` (không ai giữ) **chỉ** hiện ở scope Company.
- Data scope ép ở **service layer** (`buildReadScopeExists` pattern như GOAL), **không** phải RLS (RLS chỉ cô lập tenant).

---

## 12. Quy tắc nghiệp vụ và mã lỗi

| Mã lỗi | HTTP | Quy tắc |
| --- | --- | --- |
| ASSET-ERR-001 | 409 | Chuyển trạng thái **không hợp lệ theo FSM §13.1** (ví dụ cấp phát tài sản đang `Assigned`, thanh lý tài sản đang `Assigned`, tìm-thấy-lại tài sản không `Lost`). Thông điệp nêu trạng thái hiện tại + hành động bị chặn |
| ASSET-ERR-002 | 404 / 422 | Cấp phát cho nhân viên **không tồn tại trong company** → **404** (giống hệt không tồn tại — không thành oracle dò nhân sự tenant khác); nhân viên tồn tại nhưng **không `active`** (nghỉ việc/tạm ngưng) → **422**. `error.details.kind` = `employee-not-found` / `employee-inactive` (test neo theo `kind`, không theo HTTP) |
| ASSET-ERR-003 | 409 | Thu hồi khi tài sản **không có** lượt cấp phát `Active` |
| ASSET-ERR-004 | 409 | Mở lượt bảo trì khi đã có lượt `Open` (chốt cuối: partial unique) |
| ASSET-ERR-005 | 409 / 404 | Đóng lượt bảo trì đã `Closed` → **409** (`details.kind = already-closed`); lượt không thuộc tài sản trong path → **404** (`details.kind = maintenance-not-found`) |
| ASSET-ERR-006 | 409 | Mở đợt kiểm kê khi company đã có đợt `Open` (chốt cuối: partial unique) |
| ASSET-ERR-007 | 409 | Đánh dấu dòng / đóng đợt trên đợt đã `Closed` |
| ASSET-ERR-008 | 409 | Thanh lý (`Disposed`) khi **tồn tại lượt cấp phát `Active`** — bất kể `status` hiện tại là `Assigned` **hay `Under Maintenance`** (tài sản đang bảo trì vẫn có thể còn người giữ, §13.1) — **phải thu hồi trước**. Điều kiện kiểm theo **sự tồn tại hàng Active**, không theo `status`. Ghi nhận `Lost` thì **được** (tự đóng lượt với `return_condition='Lost'`) |
| ASSET-ERR-009 | 422 | Thanh lý / ghi nhận mất / tìm thấy lại **thiếu `reason`** (tối thiểu 3 ký tự) |
| ASSET-ERR-010 | 409 | Loại tài sản — **hai vế khác nhau**: (a) `code` trùng với loại **đang sống** trong company (`deleted_at IS NULL` — loại đã xoá mềm **được** dùng lại `code`; DB-15 §6.1 `uq_asset_categories_company_code_active` partial); (b) `code_prefix` trùng với **bất kỳ** loại nào kể cả đã xoá mềm (unique **không** partial: prefix đã từng dùng thì mã `TS-<PREFIX>-0001` đã tồn tại, cấp lại là đụng mã cũ); xoá/vô hiệu loại còn tài sản chưa `Disposed`/`Lost`; đổi `code_prefix` khi loại đã sinh mã. `details.kind` = `code-taken` / `prefix-taken` / `has-assets` / `prefix-locked`; riêng `prefix-taken` trả thêm `details.categoryId` + `details.deleted` (true nếu loại đang chiếm prefix đã xoá mềm) để FE gợi ý «Khôi phục loại» thay vì tạo mới |
| ASSET-ERR-011 | 409 / 422 | `serial_number` trùng trong company → **409** (`details.kind = serial-taken`); gửi `assetCode`/`status` trong body PATCH → **422** (`details.kind = readonly-field`) |
| ASSET-ERR-012 | 404 | Sentinel `ASSET-ERR-NOT-FOUND`: tài sản/loại/lượt/đợt **không thuộc company** hoặc không tồn tại — **cùng một phản hồi** cho cả hai (chống dò chéo tenant) |
| ASSET-ERR-013 | 404 | Own-scope: nhân viên mở tài sản mình **không** giữ → **404**, giống hệt ASSET-ERR-012 (không 403 — 403 xác nhận tài sản tồn tại) |
| ASSET-ERR-014 | 422 | Ngày: `purchase_date` > hôm nay · `warranty_end_date` < `purchase_date` · `expected_return_date` < ngày cấp · `next_due_date` ≤ ngày đóng bảo trì |
| ASSET-ERR-015 | 409 | Xoá mềm tài sản khi **không** `In Stock` hoặc đã có ≥ 1 lượt cấp phát/bảo trì — hồ sơ có lịch sử thì **thanh lý**, không xoá |
| ASSET-ERR-016 | 422 | Thu hồi thiếu `returnCondition` hoặc giá trị ngoài bộ đóng `Good` / `Damaged` / `Lost` (ép ở **CHECK cấp DB**, không chỉ Zod) |
| ASSET-ERR-COUNTER-MISSING | 409 | *(sentinel, S11-ASSET-BE-1)* Tạo hồ sơ khi loại **không có bộ đếm mã** (`sequence_counters` bị xoá tay — bộ đếm luôn tạo cùng tx với loại, FUNC-001) — `SequenceNotFoundError` map ra mã này, không 500 |
| ASSET-ERR-INVENTORY-SNAPSHOT-INVALID | 409 | *(sentinel, S11-ASSET-BE-1)* Ảnh chụp đợt kiểm kê chứa tài sản `Disposed`/`Lost` (`23514 chk_asset_inventory_items_expected`) — chỉ nổ khi service sót lọc; đường đúng không bao giờ tới đây |

> **Đính chính hiện thực (S11-ASSET-BE-1, 30/08/2026):** `error.details` là **mảng** `ErrorDetail {field,message,rule}` (API-01) — `details.kind` = phần tử `field:"kind"`. Các vế "lỗi hình thức" chặn ở Zod trả **400** `VALIDATION-ERR-001` thay vì 422: ASSET-ERR-009 (`reason` < 3), ASSET-ERR-011 vế `readonly-field` (PATCH gửi `assetCode`/`status` — schema `.strict()`), ASSET-ERR-016 (`returnCondition` thiếu/sai). Ô `Assigned → Disposed` của §13.1 trả **008** (guard theo lượt Active chạy TRƯỚC FSM) — câu ví dụ "thanh lý tài sản đang Assigned" ở ASSET-ERR-001 là ví dụ SAI, giữ để đối chiếu.

Quy tắc bổ sung (không cần mã riêng):

- `/me/assets` **không nhận tham số nhân viên** — employee resolve từ token; không có employee profile → danh sách rỗng (không lỗi).
- Cấp phát nhận header `Idempotency-Key` **do client sinh một lần khi mở form** (chuẩn API-01 §21, cùng cách `clientMessageId` của CHAT) — server **không** tự suy khoá từ payload (ngày cấp không nằm trong body ⇒ mọi khoá "suy từ payload" đều phải lấy đồng hồ server, vi phạm `period-key-idempotency-needs-frozen-source`; và nó chặn nhầm ca "thu hồi rồi cấp lại cùng người trong ngày"). Cơ chế = **`@Idempotent()` dùng chung** (`apps/api/src/common/idempotency/`, BACKEND-12 §14.1) — **không fork**: khoá scope theo `company_id + user_id + method + path + key`, **TTL 15 phút** (hằng `IDEMPOTENCY_TTL_SEC`, không phải 24h của ví dụ API-01 §21.3), header **không bắt buộc ở interceptor** (client cũ không gửi vẫn chạy — back-compat có chủ ý), replay **phát lại envelope nguyên trạng** kèm header `Idempotency-Replayed: true` (không có `meta.idempotent_replay`). FE ASSET **luôn** gửi header. Chống trùng **nghiệp vụ** (hai lượt Active) là việc của partial unique, không phải của idempotency.
- Nhân viên **nghỉ việc** (HR đổi `status` ≠ `active`) **không** tự thu hồi tài sản — HR/Asset Manager thu hồi tay; ASSET chỉ cung cấp bộ lọc `holderEmployeeId` cho màn offboarding. Tự động hoá là việc Phase sau.
- Mọi mutation trạng thái (cấp phát · thu hồi · mở/đóng bảo trì · mở/đóng kiểm kê · thanh lý/mất/tìm thấy lại · xoá mềm) ghi `audit_logs`; **giá mua/chi phí không vào payload audit** (chỉ id + hành động + trạng thái trước/sau).

---

## 13. Lõi nghiệp vụ

### 13.1 FSM trạng thái tài sản

| Từ ↓ / Tới → | `In Stock` | `Assigned` | `Under Maintenance` | `Disposed` | `Lost` |
| --- | --- | --- | --- | --- | --- |
| **`In Stock`** | — | cấp phát (FUNC-004) | mở bảo trì (FUNC-006) | thanh lý (FUNC-011) | ghi nhận mất (FUNC-011) |
| **`Assigned`** | thu hồi `Good`/`Damaged` (FUNC-005) | — | mở bảo trì — lượt cấp phát **vẫn Active** | ✗ ASSET-ERR-008 | thu hồi `Lost` **hoặc** ghi nhận mất — tự đóng lượt với `return_condition='Lost'` |
| **`Under Maintenance`** | đóng bảo trì, **không** còn lượt Active (FUNC-007) | đóng bảo trì, **còn** lượt Active | thu hồi `Good`/`Damaged` — **status giữ nguyên**, chỉ lượt → `Returned` (FUNC-005, ghi chú dưới) | thanh lý **chỉ khi KHÔNG còn lượt Active** (còn ⇒ ✗ ASSET-ERR-008) — tự đóng lượt bảo trì `Closed` (`result_note` = lý do) | ghi nhận mất — tự đóng lượt bảo trì + lượt cấp phát Active (nếu có) |
| **`Disposed`** | ✗ | ✗ | ✗ | — | ✗ |
| **`Lost`** | tìm thấy lại (FUNC-012) | ✗ | ✗ | ✗ | — |

- Mọi ô ✗ ⇒ **ASSET-ERR-001** (409). Bảng này là **hợp đồng**, service viết đúng một hàm `assertTransition(from, to, action)`; không controller nào tự kiểm. Ô đường chéo `Under Maintenance × Under Maintenance` là chuyển tiếp **hợp lệ có chủ đích** (thu hồi khi đang bảo trì) — `assertTransition` phải cho qua cặp `(Under Maintenance, Under Maintenance, 'revoke')`.
- **Thứ tự kiểm khi mở lượt bảo trì:** `assertNoOpenMaintenance` (**ASSET-ERR-004**) chạy **trước** `assertTransition` — tài sản đang `Under Maintenance` mà mở lượt thứ hai trả **004**, không phải 001; chốt cuối là `uq_asset_maintenances_open` (map `23505` → 004).
- **`assertTransition` chỉ nhìn `status` — CHƯA ĐỦ.** Trạng thái `Under Maintenance` có thể mang lượt cấp phát Active (ô `Assigned → Under Maintenance`), nên mọi hành động kết thúc vòng đời (`Disposed`) và mọi hành động đổi người giữ phải đi qua guard thứ hai **`assertNoActiveAssignment(assetId)`** / đọc lượt Active **trong cùng transaction** (`SELECT … FOR UPDATE` trên hàng `assets`). Thiếu guard này là thanh lý được tài sản nhân viên đang giữ mà mọi CHECK vẫn xanh.
- **`revoke` khi `status = 'Under Maintenance'` — ĐƯỢC PHÉP** (nhân viên nghỉ việc trong lúc tài sản ở tiệm sửa vẫn phải thu hồi được): lượt Active → `Returned`; `return_condition` `Good`/`Damaged` ⇒ **`status` tài sản KHÔNG đổi** (vẫn `Under Maintenance`; khi đóng bảo trì sẽ về `In Stock` vì không còn lượt Active); `return_condition='Lost'` ⇒ tài sản sang `Lost` **và** tự đóng lượt bảo trì Open. Không có lượt Active ⇒ ASSET-ERR-003 như thường.
- "Trạng thái sau khi đóng bảo trì" là **dẫn xuất** từ việc còn lượt cấp phát Active hay không — **không** lưu cột "trạng thái trước bảo trì" (cột ghi-rồi-bỏ là thứ để gỡ, không phải để nối dây).
- Mọi bước "tự đóng kèm theo" (lượt bảo trì / lượt cấp phát) chạy **trong cùng transaction** với đổi trạng thái; rollback là rollback tất cả.

### 13.2 Cấp phát và thu hồi

- Cấp phát: kiểm nhân viên thuộc company + `active` (ASSET-ERR-002) → kiểm FSM → INSERT lượt `Active` (partial unique là chốt cuối; vi phạm unique ⇒ map về ASSET-ERR-001, **không** 500 — drizzle giấu mã PG trong `cause`, phải bóc) → UPDATE `assets.status='Assigned'` → audit → outbox `ASSET_ASSIGNED`. Tất cả một transaction.
- Thu hồi: UPDATE lượt Active → `Returned` + `return_condition` + `returned_at/by`; `Good`/`Damaged` ⇒ `In Stock` (ghi `condition_note` nếu `Damaged`) — **trừ khi** tài sản đang `Under Maintenance`: giữ nguyên `status` (§13.1); `Lost` ⇒ tài sản `Lost` + `status_reason` = ghi chú thu hồi (+ đóng lượt bảo trì Open nếu có). Audit + outbox `ASSET_REVOKED` (kể cả trường hợp Lost — người giữ vẫn cần biết hồ sơ mình đã đóng).
- **Biên bản**: FE render từ DTO lượt cấp phát (mã · tên tài sản · serial · người giao · người nhận · ngày · tình trạng · ghi chú); server **không** sinh và không lưu PDF.

### 13.3 Bảo trì

- Một tài sản tại một thời điểm **một** lượt `Open` (partial unique). Mở từ `In Stock` hoặc `Assigned`; đóng theo §13.1.
- `next_due_date` khi đóng (tuỳ chọn) → ghi vào `assets.next_maintenance_due`; gợi ý mặc định từ `asset_categories.default_maintenance_interval_days` (FE tính, không bắt buộc).
- Job `ASSET_MAINTENANCE_DUE` (§17) là `@SystemJobHandler` idempotent, `@Optional()` cho DI (thiếu là sập `AppModule` — `systemjobhandler-optional-dbw-di`).

### 13.4 Kiểm kê

- Mở đợt: tạo hàng `asset_inventories` `Open` + **INSERT hàng loạt** `asset_inventory_items` cho mọi tài sản trong phạm vi (`category_id` hoặc toàn bộ), `status NOT IN ('Disposed','Lost')`, `deleted_at IS NULL` — chụp `expected_status` + `expected_holder_employee_id` (từ lượt Active). Một transaction; 1 đợt Open/company (partial unique).
- Tài sản **tạo sau khi mở đợt** không thuộc đợt (đợt là ảnh chụp). Tài sản bị thanh lý/mất **trong** đợt vẫn giữ dòng; người kiểm đánh dấu theo thực tế.
- Đánh dấu: `result` ∈ `Found` / `Missing` (+ ghi chú, người kiểm, thời điểm). Cho phép sửa lại kết quả khi đợt còn `Open`.
- Đóng đợt: dòng chưa đánh dấu giữ `Not Checked`; ghi 4 số tổng kết vào đợt **một lần**; **không** tự chuyển tài sản `Missing` sang `Lost` — Asset Manager xác nhận từng cái ở màn 002 (một đợt kiểm đếm sai không được phép xoá sổ tài sản trong im lặng).

### 13.5 Mã tài sản và QR — ASSET-DEC-004

- Counter: `sequence_counters` với `module_code='ASSET'`, `sequence_key='asset_code'`, `scope_type='Custom'`, `scope_reference_id = asset_categories.id`, `prefix = 'TS-' || code_prefix || '-'`, `padding_length = 4`, `reset_policy='Never'` ⇒ `TS-LT-0001`, `TS-LT-0002`…
- Counter được **tạo cùng transaction với loại tài sản** (FUNC-001). Sinh mã đi qua `SequenceService` (`SELECT … FOR UPDATE`, **không** `MAX(code)+1`); thiếu counter ⇒ `SequenceNotFoundError` fail-loud, không tự tạo lúc sinh mã (bug `QA2-CRIT-002` của `task_code`).
- `code_prefix` **khoá** sau khi loại đã sinh mã đầu tiên (ASSET-ERR-010) — đổi prefix làm mã cũ/mới lệch họ.
- `code_prefix` **không bao giờ được cấp lại**, kể cả sau khi loại bị xoá mềm: unique index trên `(company_id, code_prefix)` **không** có vế `deleted_at IS NULL` (DB-15 §6.1). Nếu cho phép, loại mới cùng prefix nhận counter mới `current_value=0` ⇒ `TS-LT-0001` đụng mã của tài sản `Disposed` cũ ⇒ 500 unique-violation không có mã lỗi. Muốn dùng lại loại ⇒ **khôi phục** loại đã xoá mềm (`is_active=true`, cùng counter), không tạo loại mới.
- QR = ảnh của chuỗi `asset_code` do FE render (`ASSET-SCREEN-002`), có nút in nhãn; **không** có endpoint/ảnh QR ở server (ASSET-DEC-001).

### 13.6 Data scope

| Scope | Tập tài sản nhìn thấy |
| --- | --- |
| Own | tài sản có lượt cấp phát của **employee của tôi** (Active **hoặc** Returned — lịch sử của mình) |
| Department | tài sản có lượt **Active** mà `employee_id` thuộc đơn vị của tôi ∪ đơn vị tôi làm trưởng |
| Company | toàn bộ |

Loại tài sản, đợt kiểm kê, thống kê: đọc theo cùng scope (Own/Department chỉ thấy đếm trên tập của mình). Đợt kiểm kê chỉ thuộc Company: **danh sách** (`ASSET-API-018`) trả rỗng ở Own/Department (không 403); **chi tiết** (`ASSET-API-020`) trả **404 ASSET-ERR-012** — giống hệt đợt không tồn tại.

**Che danh tính theo scope (bắt buộc, không chỉ che tiền):** scope Own bám theo *lịch sử của tôi*, nên **người giữ cũ vẫn ở trong scope Own của tài sản đó vĩnh viễn**. Vì vậy ở scope hiệu dụng **Own**: `currentHolder` chỉ được trả khi người giữ hiện tại **chính là caller** (ngược lại **vắng khoá**, không `null`); `GET /assets/:id/assignments` chỉ trả các hàng có `employee_id` = employee của caller; `counts.assignments` đếm trên tập đã lọc. Ở scope **Department**: chỉ trả `currentHolder`/hàng lịch sử của nhân viên **trong đơn vị** (∪ đơn vị mình làm trưởng); hàng của người ngoài đơn vị **không** trả. Company: đầy đủ. Đây là masking **ở server** (SPEC-01 §11.3) — FE không được tự lọc.

---

## 14. Trạng thái UI bắt buộc

Mọi màn ASSET phải xử lý: **loading** (skeleton bảng/thẻ) · **error** (thông điệp + thử lại) · **empty** ("chưa có tài sản nào" + nút thêm theo quyền; «tài sản của tôi» rỗng = "bạn chưa được cấp tài sản nào") · **không có quyền** (ẩn bằng `<PermissionGate>`, không hard-code) · **hành động bị FSM chặn** (nút **không hiện** thay vì hiện rồi 409) · **409 từ server** (race: hiển thị thông điệp + tải lại chi tiết, không mất form) · **trường tài chính bị che** (schema Zod FE khai `.optional()` — thiếu là `ZodError` trắng trang đúng cho người vừa được bảo vệ, `server-masking-needs-optional-fe-schema`).

---

## 15. Yêu cầu API cấp SPEC

Envelope/error/pagination theo API-01. Chi tiết: [API-14](<../API Design/API-14_ASSET_API_Design.md>). Mọi `:id` là **UUID** ở biên (pipe cấp method, **không** `@UsePipes` cấp class — `nestjs-zod-class-level-pipe-does-nothing`).

| Mã | Endpoint | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| ASSET-API-001 | `GET /asset-categories` | `('view','asset')` | danh mục loại (cả `is_active=false` khi `?includeInactive=true`); **`?includeDeleted=true`** trả thêm loại **đã xoá mềm** (kèm `deletedAt`) — tham số này **chỉ** được honour khi caller có `('manage','asset-category')`, ngược lại bỏ qua — để màn 007 dựng nút «Khôi phục» (không có đường này thì `restore` là route chết: không endpoint nào phát ra id loại đã xoá) |
| ASSET-API-002 | `POST /asset-categories` | `('manage','asset-category')` | tạo loại + counter cùng tx (§13.5) · audit |
| ASSET-API-003 | `PATCH /asset-categories/:id` | `('manage','asset-category')` | `code_prefix` khoá khi đã sinh mã (ASSET-ERR-010); `{ isActive?, restore?: true }` — `restore` khôi phục loại đã xoá mềm (`deleted_at = NULL`, giữ counter, tiếp tục đếm) · audit |
| ASSET-API-004 | `DELETE /asset-categories/:id` | `('manage','asset-category')` | soft delete; chặn khi còn tài sản (ASSET-ERR-010) · audit |
| ASSET-API-005 | `GET /assets` | `('view','asset')` | filter `categoryId` · `status[]` · `holderEmployeeId` · `q` (mã/tên/serial) · `maintenanceDueBefore`; pagination; data_scope §13.6 |
| ASSET-API-006 | `POST /assets` | `('create','asset')` | sinh `asset_code`; audit |
| ASSET-API-007 | `GET /assets/:id` | `('view','asset')` | chi tiết + người giữ hiện tại (JOIN HR) + đếm lượt cấp phát/bảo trì; ngoài scope → 404 |
| ASSET-API-008 | `PATCH /assets/:id` | `('update','asset')` | thông tin mô tả; **không** nhận `assetCode`/`status` (ASSET-ERR-011) · audit |
| ASSET-API-009 | `DELETE /assets/:id` | `('delete','asset')` | soft delete có điều kiện (ASSET-ERR-015) · audit |
| ASSET-API-010 | `POST /assets/:id/assign` | `('assign','asset')` | body `{ employeeId, issueCondition?, issueNote?, expectedReturnDate? }`; `Idempotency-Key` **do client sinh** khi mở form (§12, API-14 §6.10); audit + NOTI |
| ASSET-API-011 | `POST /assets/:id/revoke` | `('revoke','asset')` | body `{ returnCondition, returnNote? }`; audit + NOTI |
| ASSET-API-012 | `GET /assets/:id/assignments` | `('view','asset')` | lịch sử cấp phát, pagination, mới nhất trước |
| ASSET-API-013 | `POST /assets/:id/maintenances` | `('manage','asset-maintenance')` | mở lượt `{ reason, vendor? }`; audit |
| ASSET-API-014 | `POST /assets/:id/maintenances/:maintenanceId/close` | `('manage','asset-maintenance')` | `{ resultNote?, cost?, nextDueDate? }`; trạng thái sau = dẫn xuất §13.1; audit |
| ASSET-API-015 | `GET /assets/:id/maintenances` | `('view','asset')` | lịch sử bảo trì, pagination |
| ASSET-API-016 | `POST /assets/:id/dispose` | `('dispose','asset')` | `{ kind: 'Disposed' \| 'Lost', reason }`; audit; phát `ASSET_REVOKED` **nếu** có lượt Active bị tự đóng (§13.1) |
| ASSET-API-017 | `POST /assets/:id/recover` | `('dispose','asset')` | `Lost → In Stock`, `{ reason }`; audit |
| ASSET-API-018 | `GET /asset-inventories` | `('view','asset')` | danh sách đợt (Company scope; scope khác trả rỗng) |
| ASSET-API-019 | `POST /asset-inventories` | `('manage','asset-inventory')` | mở đợt `{ name, categoryId?, note? }` + snapshot dòng; audit |
| ASSET-API-020 | `GET /asset-inventories/:id` · `GET /asset-inventories/:id/items` | `('view','asset')` | chi tiết đợt + dòng (filter `result`, pagination) |
| ASSET-API-021 | `PATCH /asset-inventories/:id/items/:itemId` · `POST /asset-inventories/:id/items/bulk-mark` | `('manage','asset-inventory')` | đánh dấu 1 / nhiều dòng `{ result, note? }`; ASSET-ERR-007 |
| ASSET-API-022 | `POST /asset-inventories/:id/close` | `('manage','asset-inventory')` | đóng đợt + tổng kết; audit |
| ASSET-API-023 | `GET /me/assets` | `('view','asset')` scope Own | employee từ token; `?includeReturned=true`; **không bao giờ** trả trường tài chính — **bất kể** data_scope của caller (company-admin gọi `/me/assets` cũng không thấy giá) |
| ASSET-API-024 | `GET /assets/summary` | `('view','asset')` | đếm theo `status` × `categoryId` trong scope người gọi — nguồn widget DASH. Route khai **trước** `/assets/:id` |

> ⚠️ **Không có endpoint QR** (ASSET-DEC-001) và **không có endpoint biên bản PDF** (ASSET-DEC-002) — cả hai render ở FE. Thêm sau phải cấp mã mới `ASSET-API-025+` và **đo lại dải** bằng grep, không mặc định còn trống.

---

## 16. Dữ liệu và lưu trữ

Nguồn chuẩn: [DB-15](<../DB/DB-15 ASSET Database Design.md>). Tóm tắt:

- **6 bảng mới**: `asset_categories` · `assets` · `asset_assignments` · `asset_maintenances` · `asset_inventories` · `asset_inventory_items` — RLS + FORCE, policy literal-GUC, composite tenant FK cho **mọi** FK chéo (mẫu `0535`), soft delete ở `asset_categories`/`assets`; 4 bảng sổ **không có DELETE**, UPDATE **cấp cột**.
- Seed đi kèm **bắt buộc** (thiếu là 500 ngay bản ghi đầu):
  1. module `ASSET` vào `modules` (`ON CONFLICT DO NOTHING`);
  2. role hệ thống `asset-manager` (tiền lệ `hr-manager` `0019`), `ON CONFLICT DO NOTHING`;
  3. **11 cặp permission** §11, `is_sensitive=false`, grant per-pair data_scope (DELETE-wrong-scope + INSERT ON CONFLICT, verify fail-loud) cho 4 role canonical + `asset-manager`;
  4. `audit_logs.object_type` **UNION-ADD** 5 giá trị `asset` · `asset_category` · `asset_assignment` · `asset_maintenance` · `asset_inventory` — **clone nguyên khối UNION-ADD của `0545`** (neo 2 tầng vào `object_type = ANY(…)`, fail-closed, NO-LOSS/NO-GAIN — KHÔNG clone `0506` (chưa neo tầng-1, đúng bẫy `audit-check-union-parse-anchor-trap`; đính chính 29/08/2026 khi thi công `0550`) + verify regex biên **từng** giá trị) + `AUDIT_OBJECT_TYPES` cùng commit. **Dòng kiểm kê KHÔNG có `object_type` riêng**: đánh dấu dòng (kể cả bulk) audit dưới aggregate `asset_inventory` với `object_id = inventory_id`, payload liệt kê `itemIds` + `result` (tiền lệ `workflow_template` gói item);
  5. catalog + template **3 event NOTI** §17 với **`dedupe_strategy = 'DedupeKey'`** (mặc định `'None'` của `0479` làm `dedupeKey` thành chuỗi trang trí — job nhắc bảo trì sẽ nhân đôi thông báo mỗi ngày; sửa sau = migration thứ hai như `0507`) và **nới CHECK trên CẢ HAI bảng** `notification_events` **lẫn** `notifications` (`module_code += 'ASSET'`, `notification_type += 'Asset'`) — quên vế `notifications` là lỗi đã ship thật ở `0507` (`noti-catalog-check-lives-on-two-tables`).
- **Không seed `sequence_counters`** ở migration: counter sinh theo loại **lúc tạo loại** (§13.5); DB chưa có loại nào.
- **Teardown test:** `apps/api/test/helpers/seed.ts` `cleanupTenants()` xoá **tường minh** từng bảng con ⇒ WO DB thêm 6 bảng theo thứ tự con→cha (`asset_inventory_items` → `asset_inventories` → `asset_maintenances` → `asset_assignments` → `assets` → `asset_categories`) **cùng commit** với migration (quên là đỏ hàng loạt ở `afterAll` — bài học `drop-table-must-clean-test-teardown`). FK nội bộ dùng `ON DELETE NO ACTION` (kiểm cuối câu lệnh), **không** `RESTRICT` (kiểm ngay — nổ khi cascade từ `companies` xoá hai bảng anh em theo thứ tự bất định) — DB-15 §4.
- Migration nối tiếp head **THẬT** lúc chạy (`migrations/meta/_journal.json`; head lúc viết = idx 215 / `0548` ⇒ dự kiến `0549+`).

---

## 17. Sự kiện và thông báo

| Event code | Mã chuẩn (SPEC-01 §20.2 · SPEC-08 §15.0) | Khi nào | Người nhận | Gộp / dedupe |
| --- | --- | --- | --- | --- |
| `ASSET_ASSIGNED` | NOTI-EVENT-010 | lượt cấp phát tạo xong (commit) | user của nhân viên được cấp | không gộp; `dedupe_key` lưu thật = `ASSET_ASSIGNED:{assignmentId}` (engine ghép `eventCode:` + `dedupeKeyOf` = assignmentId — S11-ASSET-BE-1) |
| `ASSET_REVOKED` | NOTI-EVENT-011 | lượt cấp phát đóng (`Returned`, kể cả `Lost`) | user của nhân viên bị thu hồi | `dedupe_key = ASSET_REVOKED:{assignmentId}` |
| `ASSET_MAINTENANCE_DUE` | NOTI-EVENT-012 | job mỗi nhịp scheduler (60s — dedupe làm thành 1 lần/(asset, hạn); "hằng ngày" là nhịp hạ tầng chung, ghi nợ): `next_maintenance_due ≤ hôm nay + 7` và tài sản không `Disposed`/`Lost` | **user đang giữ role `asset-manager` hoặc `company-admin`** trong company (tra `user_roles` còn hiệu lực: `deleted_at IS NULL`, chưa `expires_at`; phát với `recipient.mode='UserIds'`) — xem ghi chú | `dedupe_key = ASSET_MAINTENANCE_DUE:{assetId}:{dueDate}` — cùng hạn không nhắc lại; đổi hạn ⇒ khoá mới |

- **Người nhận của 012 resolve theo ROLE, không theo cặp quyền** (đo 28/08/2026): `NotificationRecipientResolverService` chỉ có `mode: 'UserIds' | 'EmployeeIds'`, và `PermissionService` **không có** tra ngược "user nào giữ cặp X" (mọi hàm đều tra theo một user). Dựng tra-ngược permission engine là việc vùng đỏ ngoài phạm vi wave ⇒ v1 liệt kê user qua `user_roles` của hai role trên. Nếu Phase sau có tra-ngược, đổi sang cặp `('manage','asset-maintenance')` và ghi lại đây. *(Không có tiền lệ `HR_CONTRACT_EXPIRING` để noi theo — mã đó chỉ nằm trong catalog, chưa có producer.)*
- `notification_type = 'Asset'`, `module_code = 'ASSET'`, `priority` Normal (010/011) · High (012), `isEnabled=true`, `isSystemEvent=false`, **`dedupe_strategy='DedupeKey'`** (catalog thắng `DEFAULT_DEDUPE` — không thêm entry vào `notification-dedupe.const.ts`, tránh hai nguồn sự thật).
- Payload chỉ chứa **mã + tên tài sản + tên người liên quan + liên kết** (`/me/assets` hoặc `/assets/:id`); **không** giá mua/chi phí.
- Phát qua **OutboxNotificationBridge** (enqueue trong transaction, map `eventCode` verbatim). **Bẫy boot:** `registerSource()` fail-loud lúc boot nếu `eventCode` chưa có trong catalog `isEnabled=true` ⇒ seed (DB-15 §9 bước C) phải xong **trước** khi WO backend đăng ký registrar.
- Đo dải mã chuẩn ngày 28/08/2026: SPEC-01 §20.2 dừng ở **NOTI-EVENT-009**; GOAL/CHAT/LMS **không** cấp mã chuẩn (chỉ là mở rộng §15.1–15.6). ASSET là module đầu tiên cấp tiếp: **010–012**. ROOM (SPEC-14) lấy **013+** — đo lại bằng grep trước khi cấp.

---

## 18. Audit và bảo mật

- **RLS + FORCE** theo `company_id` trên cả 6 bảng, tạo policy **trước** mọi INSERT; mọi repository qua `withTenant`.
- **Sổ không xoá**: `asset_assignments` · `asset_maintenances` · `asset_inventories` · `asset_inventory_items` — app role **không có DELETE**; UPDATE chỉ **cấp cột** (các cột "đóng"/"kết quả"). Hồ sơ có lịch sử thì thanh lý, không xoá (ASSET-ERR-015).
- **Che ở server — tiền:** trường tài chính (`assets.purchase_price`, `assets.supplier`, `asset_maintenances.cost`) **chỉ trả khi scope hiệu dụng là Company**; ở **Own và Department** đều vắng khoá (trưởng đơn vị không có nhu cầu biết giá mua thiết bị của nhân viên — chốt tường minh, không để "cố ý không che" thành mặc định ngầm). Payload WS (nếu có sau) đi cùng DTO — cấm emit thẳng row. Riêng **`/me/assets` không bao giờ** trả trường tài chính, **bất kể** data_scope của caller (đường "của tôi" là đường nhân viên; luật "scope hiệu dụng Company" chỉ áp cho `/assets*`).
- **Che ở server — danh tính:** `currentHolder` và lịch sử cấp phát lọc theo scope (§13.6): Own chỉ thấy hàng của chính mình, Department chỉ thấy nhân viên trong đơn vị. Người giữ **cũ** không được thấy ai đang giữ hiện tại.
- **404 chứ không 403** cho tài sản ngoài scope/tenant (ASSET-ERR-012/013) — chống dò sự tồn tại; **403** chỉ khi thiếu cặp quyền.
- **Audit** mọi mutation trạng thái + danh mục (§12); payload audit không chứa số tiền.
- `/me/assets` **không nhận** `employeeId` — chống IDOR (chuẩn SPEC-09 §14.4).
- Cấp phát/thu hồi/thanh lý là hành động có hậu quả pháp lý nội bộ (biên bản) — `audit_logs` là bằng chứng; UI chi tiết (màn 002 tab lịch sử) phải đọc được lịch sử này, không chỉ nằm trong bảng audit.

---

## 19. Non-functional requirements

- Danh sách tài sản 10k hàng có lọc trạng thái/loại/người giữ < 300ms (index `(company_id, status, category_id)` + index người giữ trên lượt Active — DB-15 §8).
- Chi tiết tài sản + người giữ + đếm lịch sử **một truy vấn** (không N+1).
- Mở đợt kiểm kê 10k tài sản: một `INSERT … SELECT`, < 2s; đóng đợt tính tổng kết bằng một `GROUP BY`.
- Job nhắc bảo trì: `@SystemJobHandler` idempotent, chạy 1 lần/ngày theo múi giờ công ty (`companies.timezone`).
- i18n: nhãn qua react-i18next namespace `asset`; trạng thái hiển thị từ constants chuẩn SPEC-01 §17.8–17.9.

---

## 20. Tiêu chí nghiệm thu tổng quát

1. Tạo loại «Laptop» prefix `LT` → tạo 2 tài sản → mã `TS-LT-0001`, `TS-LT-0002`; đổi prefix bị chặn (ASSET-ERR-010); QR ở màn 002 giải mã ra đúng `asset_code`.
2. Cấp phát `TS-LT-0001` cho nhân viên A → A nhận `ASSET_ASSIGNED`, `/me/assets` của A thấy tài sản, **không** thấy giá mua; B (cùng phòng, không giữ) mở `/assets/:id` → **404**.
3. Cấp phát lần 2 khi đang `Assigned` → **409 ASSET-ERR-001**; hai request cấp phát **song song** trên cùng tài sản → đúng **một** lượt Active (int-spec race, partial unique là chốt cuối).
4. Mở bảo trì khi A đang giữ → `Under Maintenance`, lượt của A vẫn Active; đóng bảo trì → về `Assigned` (không phải `In Stock`).
5. Thu hồi với `Lost` → tài sản `Lost`, lượt `Returned`; tìm thấy lại (lý do bắt buộc) → `In Stock`; thanh lý khi đang `Assigned` → **409 ASSET-ERR-008**; **mở bảo trì khi A đang giữ rồi thanh lý ngay (đang `Under Maintenance`, còn lượt Active)** → **409 ASSET-ERR-008** (không phải 200); thu hồi khi đang `Under Maintenance` → lượt `Returned`, tài sản **vẫn** `Under Maintenance`, đóng bảo trì sau đó → `In Stock`.
5b. A đã trả laptop, B đang giữ: A mở `/assets/:id` → 200 nhưng **không có khoá `currentHolder`**; `/assets/:id/assignments` của A chỉ có lượt của A. Trưởng đơn vị của B thấy B nhưng **không** thấy `purchasePrice`.
6. Mở đợt kiểm kê toàn bộ → số dòng = số tài sản không `Disposed`/`Lost`; tài sản tạo sau đó **không** vào đợt; đánh dấu 1 `Missing`, đóng đợt → tổng kết đúng, tài sản `Missing` **vẫn** giữ trạng thái cũ.
7. Trưởng đơn vị X chỉ thấy tài sản nhân viên đơn vị X đang giữ; tài sản `In Stock` không hiện với X; HR thấy toàn bộ nhưng **không** cấp phát được (403).
8. Cross-tenant: mọi endpoint deny dữ liệu company khác bằng **404** (int-spec bắt buộc, `LANE_DB`).
9. Deny-path: role **không** có `('assign','asset')` gọi `/assign` → 403; **chủ thể = role dựng trong test**, không dùng Super Admin (tautology `*:*`).
10. Đặt `next_maintenance_due` = hôm nay + 3 → job phát **đúng một** `ASSET_MAINTENANCE_DUE` cho **mỗi user giữ role `asset-manager` hoặc `company-admin`** (tra `user_roles`, `recipient.mode='UserIds'` — §17, không tra ngược cặp quyền); chạy job lần 2 → 0 thông báo mới.
11. Widget DASH «Tài sản» hiện đúng số theo trạng thái cho Asset Manager; nhân viên thường **không** thấy widget (không gọi API).

---

## 21. Test scenario cấp cao

| Nhóm | Scenario |
| --- | --- |
| Deny-path (RED trước) | thiếu từng cặp trong 11 cặp → 403 trên endpoint tương ứng; employee gọi `/assets/:id` của tài sản không giữ → 404; cross-tenant mọi endpoint → 404; `/me/assets?employeeId=` bị bỏ qua/400. Chủ thể = role dựng trong test, **không** SA |
| FSM | mọi ô ✗ ở §13.1 → ASSET-ERR-001; mọi ô hợp lệ → đúng trạng thái sau; đóng bảo trì về `Assigned`/`In Stock` theo lượt Active; ghi nhận mất từ `Assigned` tự đóng lượt `Lost`; **dispose `Disposed` từ `Under Maintenance` khi còn lượt Active → 409 ERR-008** (guard `assertNoActiveAssignment`, không chỉ `assertTransition`); **revoke khi `Under Maintenance`** → lượt `Returned`, status giữ nguyên (`Good`/`Damaged`) hoặc `Lost` + đóng bảo trì |
| Masking danh tính | người giữ cũ (Own) mở tài sản → không có `currentHolder`, lịch sử chỉ có hàng của mình; Department → chỉ hàng nhân viên trong đơn vị; Company → đầy đủ. Ca đối chứng ALLOW cho từng scope để ca DENY không xanh rỗng |
| Race | 2 assign song song → 1 Active; 2 mở bảo trì song song → 1 Open; 2 mở đợt kiểm kê song song → 1 Open (đều map về 409, không 500 — bóc mã PG từ `cause`) |
| Validate | **16** mã lỗi §12, mỗi mã ≥ 1 ca; CHECK DB `return_condition`/`result`/`status` mirror Zod **hai chiều, đúng bằng** |
| Idempotent | assign lặp cùng `Idempotency-Key` (trong 15′) → 1 lượt, lần 2 trả **cùng envelope** + header `Idempotency-Replayed: true` (interceptor dùng chung — §12); khác user/company cùng key → **không** phát lại chéo |
| Mã & counter | tạo loại ⇒ counter tồn tại; xoá counter rồi tạo tài sản ⇒ `SequenceNotFoundError` fail-loud, không tự tạo |
| Kiểm kê | snapshot đúng phạm vi (loại / toàn bộ), loại trừ Disposed/Lost; đánh dấu sau khi đóng → 409; tổng kết = đếm thật |
| Masking tiền | Own **và Department** không có `purchasePrice`/`supplier`/`cost`; Company có; FE schema `.optional()` — đo cả ba scope, không chỉ Own vs Company |
| Mã & prefix | tạo loại prefix `LT` → xoá mềm (sau khi thanh lý hết) → tạo loại mới prefix `LT` → **409 ERR-010 `prefix-taken`** kèm `details.categoryId` + `deleted=true`, không 500; `GET /asset-categories?includeDeleted=true` với `('manage','asset-category')` **thấy** loại đã xoá, với chỉ `('view','asset')` **không** thấy; `PATCH { restore: true }` → loại sống lại, tạo tài sản mới ra **`TS-LT-0003`** (counter tiếp tục, không reset) |
| Idempotent (interceptor chung) | bấm-đúp khi request đầu **chưa xong** → 409 `IN_PROGRESS` (không phải ERR-001); cùng key khác payload → 409 `KEY_REUSED`; key sai định dạng → 409 `INVALID_KEY` |
| Sổ không xoá | app role `DELETE` trên 4 bảng sổ bị từ chối ở **DB**; UPDATE cột ngoài allowlist bị từ chối |
| Tenant | `rls-tenant-isolation-tester` xanh cho 6 bảng trên `LANE_DB` |
| NOTI | 3 event seed đúng; CHECK `module_code`/`notification_type` nới **cả hai bảng**; job nhắc idempotent theo `(asset, hạn)` |
| Audit | mỗi mutation trạng thái +1 hàng `audit_logs` đúng `object_type`; payload không có số tiền |

---

## 22. Quyết định nghiệp vụ — **OWNER ĐÃ KÝ 28/08/2026**

> Owner duyệt nguyên gói hồ sơ [`docs/plans/S11-OFFICE-WAVE-review.html`](<../plans/S11-OFFICE-WAVE-review.html>) («ok tôi duyệt») ⇒ 5 mã dưới đây chốt **đúng cột «Đề xuất»** của [wave plan §3](<../plans/S11-OFFICE-WAVE.md>). Bảng này là bản chép kết luận; không hỏi lại.

| Mã | Câu hỏi | Kết quả owner chốt | Trạng thái |
| --- | --- | --- | --- |
| OFFICE-DEC-001 | Đánh số tài liệu khi DB-13/14 đã bị PAYROLL/RECRUIT đặt trước | **DB-15 ASSET · DB-16 ROOM** · API-14 ASSET · API-15 ROOM · permission-matrix **§9d/§9e** · IMPLEMENTATION-02 **EPIC-17 (§8.18) / EPIC-18 (§8.19)**; giữ nguyên chỗ đặt của IMP-10 | ✅ chốt |
| ASSET-DEC-001 | Phạm vi v1: thanh lý & QR làm tới đâu | Thanh lý = chuyển trạng thái `Disposed` + lý do (không workflow phê duyệt riêng); QR = render từ `asset_code` ở FE, không service sinh ảnh — §3.4, §3.5 | ✅ chốt |
| ASSET-DEC-002 | Cấp phát 1 bước hay 2 bước | **1 bước** do Asset Manager ghi nhận (in biên bản từ FE); 2 bước để Phase sau (`acknowledged_at` chừa, luôn NULL) — §3.3 | ✅ chốt |
| ASSET-DEC-003 | Bộ trạng thái tài sản | `In Stock · Assigned · Under Maintenance · Disposed · Lost` (assignment: `Active · Returned`) — hợp thức **SPEC-01 §17.8–17.9**; ma trận chuyển tiếp §13.1 | ✅ chốt |
| ASSET-DEC-004 | Sinh mã tài sản | `sequence_counters` per-company theo prefix loại, dạng `TS-<LOẠI>-<seq>` — §13.5 | ✅ chốt |

> **Tinh chỉnh thi công trong phạm vi đã duyệt (ghi để minh bạch, không phải DEC mới):** (a) §11 dùng `('view','asset')@Own` cho `/me/assets` thay vì cặp `ASSET.ASSIGNMENT.VIEW` riêng như bảng dự kiến của hồ sơ HTML — lý do ở ghi chú §11; (b) §13.1 cho phép `Lost → In Stock` («tìm thấy lại») dưới cùng cặp `('dispose','asset')` — DEC-003 chốt **tập giá trị**, không chốt "Lost là vĩnh viễn"; không thêm trạng thái mới; (c) §11 có thêm cặp `('delete','asset')` cho hồ sơ nhập nhầm và `('dispose','asset')` tách khỏi `update` vì thanh lý là hành động kết thúc vòng đời, không phải sửa mô tả. Tổng **11 cặp**.
>
> Điều kiện mở WO code của track ASSET: 5 quyết định chốt (✅) · §1 = `Approved` (✅) · `plan-reviewer` đối kháng **PASS** trên SPEC-13 + DB-15 (làm ở cuối `S11-ASSET-DOC-1`, trước khi mở `S11-ASSET-DB-1`).

---

## 23. Tác động đến bộ tài liệu hiện tại (WO S11-ASSET-DOC-1)

1. **SPEC-01**: §7.2/§8 trỏ ASSET → SPEC-13 (đã viết); §12.10 liên kết; **§17.8–17.9** hợp thức trạng thái tài sản/lượt cấp phát + ghi chú §17.7 cho bảo trì/kiểm kê; §20.2 cấp NOTI-EVENT-010..012; thanh điều hướng các file SPEC thêm SPEC-13.
2. **SPEC-08**: §15.0 bảng ánh xạ thêm 010–012; §15.7 ASSET events.
3. **docs/README.md** §2/§3/§4/§9: thêm SPEC-13 · DB-15 · API-14 và hàng module ASSET.
4. **docs/permission-matrix-spec.md**: **§9d ASSET** — 11 cặp + scope per-(perm, role) + role `asset-manager`.
5. **DB-01** §3.2 + nhóm bảng §7.10 · **DB-09** §8.16 index ASSET · **DB-10** §10 seed module + §12.9 permission + §15 event.
6. Tạo **DB-15** và **API-14** (stub endpoint khoá theo §15).
7. **docs/erd-current.md**: thêm nhóm ASSET (thiết kế có, code chưa build — A4).
8. **RELEASE-14 §5**: ASSET có bộ tài liệu, wave `S11-OFFICE`.
9. **IMPLEMENTATION-02** §8.18 **EPIC-17 ASSET** (IMP02-STORY-153..162) + §9 Sprint 11; **ISSUE-BOARD-01** §8.2 hàng ASSET/EPIC-17.
10. **harness**: `lib/stories.mjs` (`EPIC_MODULE[17]`, `sprintOfStory` S11, override story→WO) · `dashboard/server.mjs` (`MODULE_SPEC` ASSET, đặt **trước** AUTH vì tiêu đề WO chứa "permission") · `backlog.mjs` (DOC-1 đóng, DB/BE nhận số liệu thật).
11. **Nợ để lại cho WO FE (`S11-ASSET-FE-1`)**: thêm **11 mã dotted `ASSET.*`** (§11) vào `PERMISSION_CODE_TO_PAIR` ở `packages/web-core/src/lib/registry.ts` — bảng này **fail-closed** với mã lạ (`resolveKey`), chưa thêm là **toàn bộ màn ASSET ẩn với mọi người** dù DB đã grant (họ lỗi `capability-allowlist-hides-admin-screens`).

---

## 24. Definition of Done cho SPEC-13

- [x] Owner ký OFFICE-DEC-001 + ASSET-DEC-001..004 (28/08/2026) → §1 = **Approved**
- [x] DB-15 + API-14 + permission-matrix §9d đồng bộ, không mâu thuẫn SPEC-13
- [x] SPEC-01 §17 hợp thức bộ trạng thái; §20.2/SPEC-08 §15.0 cấp mã NOTI-EVENT sau khi **đo**
- [x] `plan-reviewer` đối kháng **PASS** trên SPEC-13 + DB-15 (29/08/2026, sau 3 vòng: 5B+4H+6M → 4B+2H+8M+4L → 2B → PASS) — cổng mở `S11-ASSET-DB-1` đã qua
- [ ] Mọi WO code của track ASSET lấy SPEC-13 + DB-15 làm nguồn sự thật; lệch → sửa code, không sửa ngầm spec

---

## 25. Kết luận

ASSET là module Phase 3 đầu tiên: gọn về nghiệp vụ nhưng là nơi thử luật FSM-ép-ở-service + chốt-cuối-ở-DB một cách sạch nhất trong hệ thống. Ba lựa chọn cứng — **một tài sản một lượt cấp phát đang sống (partial unique)**, **cấp phát một bước có biên bản in từ FE**, **thanh lý là trạng thái chứ không phải quy trình** — giữ v1 nằm ngoài vùng crown-jewel **về nghiệp vụ** (không FSM phê duyệt, không lương/secret) trong khi vẫn để dấu vết đầy đủ (4 bảng sổ không xoá + audit) — WO backend vẫn là **🔴 red** vì data-scope + masking ở server + audit (không hạ gate theo câu này). Phần thật sự mới chỉ là 6 bảng, 11 cặp quyền, 24 mã API (26 route HTTP — route-census đếm route) và 7 màn hình; mọi thứ còn lại tái dùng nền đã có.
