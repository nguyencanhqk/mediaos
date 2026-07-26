# RELEASE-03 — RELEASE NOTES NỘI BỘ (MVP, cuối Sprint 5)

> Bản ghi **nội bộ** (đội dự án + business owner), KHÔNG phải thông báo cho toàn công ty.
> Chốt: **2026-07-26** · `master` `153e2101` · migration head **`0529_s5_lmsnoti1_noti_catalog_lms`**
> (197 migration) · FE: 3 SPA `auth` · `console` · `app`.
>
> Câu hỏi tài liệu này trả lời: *"Tính tới hôm nay, người dùng mở hệ thống lên thì làm được những gì?"*

---

## 1. Tóm tắt

Hệ thống quản lý doanh nghiệp nội bộ **đã đủ 7 module lõi** (AUTH · HR · ATT · LEAVE · TASK · DASH ·
NOTI) chạy được đầu-cuối, cộng thêm 4 nhánh mở rộng đã ship trong Sprint 5: **ME** (trang cá nhân),
**GOAL** (mục tiêu), **LMS** (tích hợp học tập), **BRAND** (thương hiệu công ty).

- **Kiến trúc:** modular monolith NestJS + PostgreSQL 16/17 (RLS + FORCE, `company_id` mọi truy vấn) +
  Valkey + BullMQ; frontend Vite + React 19 SPA.
- **Chất lượng đo được:** 10.086 test tự động xanh (0 fail) · 0 lỗ bảo mật CRITICAL/HIGH mở · p95 ≤
  30ms trên 5 endpoint SLA lõi.
- **Chưa xong:** nghiệm thu nghiệp vụ (UAT) — xem `RELEASE-04`.

---

## 2. Dùng được gì, theo module

### AUTH / Tài khoản

Đăng nhập · đăng xuất · làm mới phiên (có phát hiện tái dùng token) · quên/đặt lại mật khẩu · đổi mật
khẩu · **2FA (TOTP)** kèm mã khôi phục · quản lý phiên đăng nhập (xem + thu hồi) · khoá/mở khoá tài
khoản · chống dò mật khẩu (chặn theo IP + theo tài khoản) · nhật ký đăng nhập + sự kiện bảo mật.
Màn hình: `/me/security/*` · `/account/*` · `/system/users` · `/system/login-logs` · `/system/security-events`.

### Phân quyền

Vai trò + ma trận quyền theo cặp `MODULE.RESOURCE.ACTION` + **phạm vi dữ liệu per-cặp**
(Own · Team · Department · Company · System). Backend là lớp quyết định cuối (`PermissionGuard`
fail-closed); frontend chỉ ẩn/hiện. Nhân bản vai trò · gán/thu hồi vai trò · xem thành viên vai trò.
Màn hình: `/system/roles` · `/system/permissions`.

### HR / Nhân sự

Danh sách + hồ sơ nhân viên (che dữ liệu nhạy cảm **ở phía server**) · tạo/sửa/đổi trạng thái · mã nhân
viên tự sinh liên tục · hợp đồng + loại hợp đồng + cảnh báo sắp hết hạn · tệp hồ sơ · ảnh đại diện ·
**yêu cầu sửa hồ sơ cá nhân theo quy trình duyệt** (không sửa thẳng) · sơ đồ tổ chức (đổi phòng ban,
đổi quản lý) · phòng ban/vị trí/cấp bậc · **nhập nhân viên hàng loạt** (xem trước → báo lỗi từng dòng)
· xuất danh sách (**ép loại lương/CCCD**) · nhật ký kiểm toán HR.
Màn hình: `/hr/**`.

### ATT / Chấm công

Hôm nay + chấm vào/ra (chống chấm trùng, chống đua) · bảng công cá nhân/nhóm/công ty · ca làm việc +
phân ca + quy tắc chấm công (có fallback mặc định) · **đơn điều chỉnh công** (cấm tự phê duyệt, chống
duyệt đồng thời) · **đơn làm từ xa** · điều chỉnh trực tiếp (quyền cao) · báo cáo + xuất file · nhật ký
kiểm toán ATT.
Màn hình: `/attendance/**`.

### LEAVE / Nghỉ phép

Số dư phép (sổ giao dịch **append-only**: giữ chỗ → nhả → trừ → hoàn) · tạo/gửi/sửa nháp/huỷ đơn ·
duyệt/từ chối theo phạm vi (duyệt ngoài phạm vi → chặn) · **đồng bộ sang chấm công** khi duyệt và
**hoàn lại khi huỷ đơn đã duyệt** · lịch nghỉ · loại phép + chính sách · báo cáo · nhật ký kiểm toán.
Màn hình: `/leave/**`.

### TASK / Công việc

Dự án + thành viên + **vai trò theo từng dự án** (nguồn quyền ở tầng service) · bảng Kanban (cột tách
khỏi trạng thái) · danh sách + lọc theo phòng ban · chi tiết việc: bình luận (có nhắc tên) · checklist ·
**việc con** (1 cấp, đếm theo lá) · người theo dõi · tệp đính kèm · ảnh bìa · nhãn · chuyển việc sang dự
án khác · việc quá hạn · báo cáo tiến độ dự án.
Màn hình: `/tasks/**`.

### NOTI / Thông báo

Chuông + đếm chưa đọc · danh sách + chi tiết · **deep-link đúng đối tượng nguồn và vẫn bị chặn khi
người nhận mất quyền** · đánh dấu đã đọc · tuỳ chọn nhận thông báo theo người dùng · mẫu thông báo +
danh mục sự kiện (quản trị) · nhật ký gửi (append-only) · chống trùng theo `dedupeKey`.
Sự kiện nối từ: LEAVE · ATT · TASK · HR · GOAL · LMS.
Màn hình: `/notifications/**` · `/me/preferences/notifications`.

### DASH / Dashboard

Dashboard theo vai + widget (có cache TTL + tự vô hiệu khi có sự kiện nguồn) · quick action · trạng thái
suy giảm cục bộ (1 widget lỗi **không** kéo sập cả trang) · cấu hình dashboard.
Màn hình: `/dashboard` · `/dashboard/configs`.

### FOUNDATION / Hệ thống

Hồ sơ công ty + **thương hiệu (logo/favicon)** · cài đặt hệ thống (giá trị nhạy cảm hiển thị dạng che) ·
danh mục module + bật/tắt (ảnh hưởng Home Portal ngay) · ngày lễ · chính sách lưu trữ · nhật ký truy cập
tệp · **nhật ký kiểm toán append-only** · job nền + lịch sử chạy · bộ đếm mã tự sinh · quản lý seed ·
trang sức khoẻ hệ thống · giao diện sáng/tối đạt tương phản AA.
Màn hình: `/system/**`.

### ME — trang cá nhân (mới Sprint 5)

`/me` gom một chỗ: hồ sơ · công · phép · việc · đào tạo · thông báo · bảo mật · tuỳ chọn giao diện · ảnh
đại diện (phạm vi own).

### GOAL — mục tiêu (mới Sprint 5)

Cây mục tiêu phòng ban → dự án/nhân viên → việc · 4 kiểu đo tiến độ · check-in định kỳ · **phân rã mục
tiêu thành việc trong một giao dịch** từ danh mục việc mẫu · gắn/tháo việc · chốt kỳ · widget dashboard.
Màn hình: `/goals/**`.

### LMS — tích hợp học tập (mới Sprint 5)

Đăng nhập một lần từ MediaOS (chỉ SSO) · đồng bộ người dùng tự động · tiến độ học hiện ở `/me/training`
· đẩy sự kiện học tập về chuông thông báo MediaOS.
⚠️ **Phần thông báo chưa chạy được** (còn token + deploy; catalog đã áp) — xem `RELEASE-02` KI-006.

---

## 3. Điểm đáng chú ý về an toàn dữ liệu

| Cam kết | Cách ép |
| --- | --- |
| Dữ liệu không rò giữa công ty | RLS + **FORCE** ở tầng DB, mọi repository qua `withTenant(companyId, …)`; đang chạy N=1 nhưng hạ tầng giữ nguyên |
| Không mất dữ liệu quan trọng | Xoá mềm (`deleted_at`); bảng kiểm toán/sổ/nhật ký gửi **append-only** — role ứng dụng không có quyền UPDATE/DELETE |
| Không lộ secret | Mật khẩu hash argon2id; secret hệ thống qua env/secret manager; DTO + payload realtime đi chung một lớp che |
| Che dữ liệu nhạy cảm | Làm ở **server** — client không nhận được thì không render được |
| Truy vết | `request_id` xuyên suốt; mọi hành động quan trọng ghi nhật ký kiểm toán |

---

## 4. Thay đổi hạ tầng/vận hành trong Sprint 5

- `m prod-update` **áp migration TRƯỚC khi restart** (fail-closed); `m prod-status` đếm migration tồn đọng.
- `scripts/migrate-verify-ephemeral.sh` — chứng minh migrate từ DB trống trên DB dùng-một-lần, có guard
  cấm drop nhầm `mediaos`/`mediaos_dev`; đã nối vào CI.
- `scripts/seed-staging-accounts.mjs` — seed 4 tài khoản UAT, idempotent, cred qua env.
- `scripts/perf-smoke.mjs` · `scripts/canary-watch.sh` — đo hiệu năng + canary sau deploy.
- OpenAPI sinh từ metadata guard; thực thi `Idempotency-Key`.

---

## 5. Cần biết trước khi dùng

Đọc `RELEASE-02_Known_Issues_MVP.md`. Ba thứ ảnh hưởng trực tiếp tới trải nghiệm ngay:

1. **Thông báo từ LMS chưa về MediaOS** (KI-006). Catalog `0529` **đã áp cho PROD ngày 2026-07-26**
   (PROD nay 197/197); còn thiếu biến `LMS_NOTI_TOKEN` hai phía + deploy theo `docs/plans/S5-LMS-NOTI-2.md` §4.
2. **Widget "Thông báo" trên dashboard có thể trễ ~10 giây** (KI-005) — chuông thì không trễ.
3. **Chưa nhập ngày lễ** ⇒ tính ngày nghỉ chưa trừ lễ (KI-004).

---

## 6. Chưa có trong MVP

Payroll · Tuyển dụng · Tài sản · Phòng họp · Chat · Mạng nội bộ · app mobile native · BI nâng cao ·
realtime đầy đủ · đa công ty (SaaS). Module media/kênh/nội dung và tài chính-theo-kênh đã **loại khỏi
phạm vi sản phẩm** từ 2026-06-20.
