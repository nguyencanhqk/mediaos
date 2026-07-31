# RELEASE-12 — USER GUIDE (HANDOFF-008)

> Work Order **`S6-GOLIVE-1`** · `IMP09-HANDOFF-008` · `IMP09-IN-017`
> Người nhận: **Nhân viên · Quản lý · HR** · Soạn: 2026-07-31 · build tham chiếu `1.0.0-rc.1`
>
> Hướng dẫn dùng hằng ngày, viết cho người **không** phải dân kỹ thuật. Chỉ mô tả màn hình có thật.
> Việc quản trị hệ thống ở [`RELEASE-11`](RELEASE-11_Admin_Guide.md). Gặp lỗi → [`RELEASE-13`](RELEASE-13_Support_FAQ.md).

---

## 1. Đăng nhập lần đầu

1. Mở **`funtimemediacorp.com`** → hệ thống tự chuyển sang trang đăng nhập.
2. Nhập **email công ty** + **mật khẩu** được cấp.
3. Nếu tài khoản bật xác thực 2 bước, nhập thêm **mã 6 số** từ ứng dụng xác thực.
4. Lần đầu vào, hệ thống có thể yêu cầu **đổi mật khẩu** — đây là bình thường.

**Vào không được?** → `RELEASE-13` §1. Đừng thử đi thử lại nhiều lần: nhập sai quá số lần cho phép sẽ
**khoá tài khoản tạm thời**, và lúc đó dù gõ đúng mật khẩu cũng không vào được.

---

## 2. Màn hình chính

| Khu vực | Đường dẫn | Bạn làm gì ở đây |
| --- | --- | --- |
| **Trang chủ** | `/dashboard` | Nhìn tổng quan: công hôm nay, đơn chờ duyệt, việc của bạn, thông báo |
| **Của tôi** | `/me` | Mọi thứ của riêng bạn gom một chỗ (§3) |
| **Chấm công** | `/attendance/today` | Vào ca / ra ca, xem công hôm nay |
| **Nghỉ phép** | `/leave` | Số ngày phép còn lại, gửi đơn, xem lịch nghỉ |
| **Công việc** | `/tasks` | Dự án, bảng kanban, việc được giao |
| **Mục tiêu** | `/goals` | Mục tiêu cá nhân/nhóm và tiến độ |
| **Thông báo** | `/notifications` | Tất cả thông báo hệ thống |
| **Đào tạo** | `train.funtimemediacorp.com` | Khoá học (đăng nhập tự động từ hệ thống) |

---

## 3. "Của tôi" — nơi gom mọi thứ của bạn

| Việc | Đường dẫn |
| --- | --- |
| Hồ sơ của tôi | `/me/profile` |
| **Đề nghị sửa hồ sơ** | `/me/profile/edit` → tạo yêu cầu · theo dõi ở `/me/profile/change-requests` |
| Công của tôi | `/me/attendance` |
| Phép của tôi | `/me/leave` |
| Việc của tôi | `/me/tasks` |
| Khoá học của tôi | `/me/training` |
| Thông báo của tôi | `/me/notifications` |
| Đổi mật khẩu | `/me/security/password` |
| **Bật xác thực 2 bước** | `/me/security/2fa` |
| Thiết bị/phiên đang đăng nhập | `/me/security/sessions` |
| Hoạt động đăng nhập gần đây | `/me/security/activity` |
| Giao diện sáng/tối · thông báo | `/me/preferences/appearance` · `/me/preferences/notifications` |

> **Bạn không sửa trực tiếp hồ sơ của mình.** Bấm sửa sẽ tạo một **yêu cầu** gửi HR duyệt. Đây là cố ý:
> hồ sơ nhân sự là dữ liệu có giá trị pháp lý, mọi thay đổi phải có người duyệt và có vết.

---

## 4. Chấm công

### 4.1 Hằng ngày

1. Vào `/attendance/today` (hoặc widget ở trang chủ).
2. Bấm **Vào ca** khi bắt đầu, **Ra ca** khi kết thúc.
3. Xem lại bảng công của mình ở `/attendance/my-records`.

### 4.2 Quên chấm công / chấm sai giờ

Không sửa được trực tiếp — gửi **đơn điều chỉnh công**:

1. `/attendance/adjustment-requests/new`
2. Chọn ngày, ghi giờ đúng, **nêu lý do** (bắt buộc — người duyệt cần căn cứ).
3. Theo dõi ở `/attendance/adjustment-requests/my`.

### 4.3 Làm việc từ xa

Đăng ký trước ở `/attendance/remote-work-requests/new`, theo dõi ở `/attendance/remote-work-requests`.

---

## 5. Nghỉ phép

### 5.1 Xem số ngày phép còn lại

`/leave/me/balances` — hiển thị theo từng loại phép, kèm số đã dùng và còn lại.

### 5.2 Gửi đơn nghỉ

1. `/leave/me/requests/new`
2. Chọn **loại phép** · khoảng ngày · lý do.
3. Gửi → đơn chuyển sang **Chờ duyệt**, người duyệt nhận thông báo.
4. Theo dõi ở `/leave/me/requests`.

### 5.3 Đơn đi qua những trạng thái nào

```text
Nháp → Chờ duyệt → Đã duyệt / Từ chối
                 ↘ Đã huỷ (bạn tự huỷ khi còn Chờ duyệt)
```

- **Sửa được** khi còn **Nháp**. Đã gửi rồi thì huỷ và tạo đơn mới.
- Đơn **đã duyệt** mà cần đổi → báo HR.
- Nghỉ phép đã duyệt **tự động phản ánh sang bảng công** — không cần làm gì thêm.

### 5.4 Lịch nghỉ & ngày lễ

`/leave/calendar` — xem ai nghỉ khi nào. Ngày lễ: `/leave/public-holidays`.

---

## 6. Dành cho người duyệt (quản lý · HR)

| Việc | Đường dẫn |
| --- | --- |
| Duyệt đơn nghỉ | `/leave/approvals` |
| Tất cả đơn nghỉ | `/leave/requests` |
| Duyệt điều chỉnh công | `/attendance/adjustment-requests` |
| Duyệt làm từ xa | `/attendance/remote-work-requests` |
| Công của nhóm | `/attendance/team-records` |
| Duyệt yêu cầu sửa hồ sơ | `/hr/profile-change-requests` |

**Hai luật không lách được** (chặn ở máy chủ, không phải chỉ ẩn nút):

1. **Không tự duyệt đơn của chính mình** — kể cả khi bạn có quyền duyệt.
2. **Chỉ thấy dữ liệu trong phạm vi của mình** — quản lý thấy nhóm mình, HR thấy theo phạm vi được cấp.
   Không thấy ai đó **không phải lỗi**, mà là phân quyền đang hoạt động đúng.

---

## 7. Công việc

| Việc | Đường dẫn |
| --- | --- |
| Việc được giao cho tôi | `/tasks/my-tasks` · `/me/tasks` |
| Việc quá hạn | `/tasks/overdue` |
| Danh sách dự án | `/tasks/projects` |

Trong một dự án: bảng **kanban** kéo-thả đổi trạng thái · **việc con** (1 cấp) · **bình luận + nhắc tên**
(người được nhắc nhận thông báo) · đính kèm tệp · ảnh bìa.

> Vai trò **trong dự án** (`projectRole`) quyết định bạn làm được gì bên trong dự án đó — nó tách biệt
> với vai trò toàn hệ thống của bạn.

---

## 8. Thông báo

- Chuông trên thanh trên cùng — số là **số chưa đọc**.
- `/notifications` xem tất cả; bấm vào một thông báo sẽ **nhảy thẳng tới đúng màn hình** liên quan.
- Chọn loại thông báo muốn nhận: `/me/preferences/notifications`.

> **Chưa nhận được thông báo cho một vài sự kiện chấm công?** Đó là hạn chế đã biết (`KI-021`), không
> phải máy bạn hỏng. Đơn/duyệt vẫn chạy bình thường.

---

## 9. Mẹo & lưu ý

| Tình huống | Cần biết |
| --- | --- |
| Một số ô hiện `***` hoặc để trống | Dữ liệu nhạy cảm bị **che theo quyền**. Máy chủ không gửi nội dung đó về máy bạn — không phải lỗi hiển thị |
| Menu của tôi ít hơn đồng nghiệp | Menu hiện theo **quyền**. Cần thêm thì đề nghị Admin |
| Vừa được cấp quyền mới nhưng chưa thấy | **Đăng xuất rồi đăng nhập lại** để phiên nhận quyền mới |
| Đổi mật khẩu xong | Các thiết bị khác bị đăng xuất — đăng nhập lại là bình thường |
| Mất điện thoại có mã 2FA | Dùng **mã khôi phục** đã lưu. Không còn mã → nhờ Admin gỡ 2FA |
| Giờ hiển thị | Toàn hệ thống dùng giờ Việt Nam |

---

## 10. Chưa có trong bản này

| Mong đợi | Trạng thái |
| --- | --- |
| Ứng dụng di động | ❌ Dùng trình duyệt trên điện thoại (giao diện co giãn được) |
| Xem phiếu lương | ❌ Phase 2 |
| Chat nội bộ | ❌ Phase 4 |
| Đặt phòng họp · quản lý tài sản | ❌ Phase 3 |
| Nhận thông báo qua email cho mọi sự kiện | ⚠️ Một phần — thông báo trong hệ thống là kênh chính |

---

## 11. Cần giúp đỡ

1. Tra `RELEASE-13` (FAQ) — phần lớn tình huống đã có ở đó.
2. Vẫn không được → báo theo mẫu `RELEASE-13` §2, **kèm ảnh chụp màn hình** và **`request_id`** nếu
   màn hình có hiện. Có `request_id` thì tìm ra nguyên nhân nhanh hơn nhiều.
