# SPEC-09: ME - TRUNG TÂM CÁ NHÂN & CÀI ĐẶT TÀI KHOẢN

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · **SPEC-09 ME**
>
> **Liên quan:** [Chỉ mục tài liệu](<../README.md>) · [Ma trận phân quyền](<../permission-matrix-spec.md>)

---

## 1. Thông tin tài liệu

| Trường                     | Nội dung                                          |
| -------------------------- | ------------------------------------------------- |
| Mã tài liệu                | SPEC-09                                           |
| Tên tài liệu               | ME - Trung tâm cá nhân & Cài đặt tài khoản        |
| Module code                | ME                                                |
| Tài liệu cha               | SPEC-01: Tổng quan hệ thống                       |
| Module phụ thuộc trực tiếp | AUTH, HR                                          |
| Module liên quan           | ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION          |
| Phiên bản                  | v1.0                                              |
| Trạng thái                 | **Approved** (owner duyệt 23/07/2026 — nội dung chốt tại S5-ME-DOC-1 PR #195) |
| Giai đoạn                  | MVP Version 1.0 - bổ sung                         |
| Người viết                 |                                                   |
| Người duyệt                |                                                   |
| Ngày tạo                   | 13/07/2026                                        |
| Ngày cập nhật              | 13/07/2026                                        |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết module **ME - Trung tâm cá nhân & Cài đặt tài khoản** trong hệ thống quản lý doanh nghiệp nội bộ.

Module `ME` là không gian cá nhân tập trung dành cho **người dùng đang đăng nhập**, giúp người dùng xem và quản lý các thông tin liên quan trực tiếp đến bản thân trên một giao diện thống nhất.

Module `ME` tổng hợp dữ liệu từ các module nguồn gồm:

- `AUTH`: tài khoản, email đăng nhập, trạng thái tài khoản, vai trò, quyền, phiên đăng nhập, đổi mật khẩu và bảo mật.
- `HR`: hồ sơ nhân viên, thông tin cá nhân, thông tin liên hệ, thông tin công việc, phòng ban, chức vụ, quản lý trực tiếp, hợp đồng và yêu cầu cập nhật hồ sơ.
- `ATT`: trạng thái chấm công hôm nay, bảng công cá nhân, điều chỉnh công và remote work của tôi.
- `LEAVE`: số dư phép, đơn nghỉ của tôi và lịch nghỉ cá nhân.
- `TASK`: việc được giao, việc tôi tạo, việc tôi theo dõi và tiến độ công việc cá nhân.
- `NOTI`: thông báo của tôi và tùy chọn nhận thông báo.
- `DASH`: các chỉ số cá nhân hoặc widget tóm tắt phục vụ trang tổng quan ME.
- `FOUNDATION`: file avatar, cấu hình giao diện, ngôn ngữ, múi giờ và các cài đặt dùng chung.

`ME` không thay thế các module nguồn và không trở thành nơi sở hữu dữ liệu nghiệp vụ gốc. Module này đóng vai trò:

```text
Tổng hợp dữ liệu cá nhân
+ Chuẩn hóa trải nghiệm self-service
+ Điều hướng nhanh
+ Gửi yêu cầu cập nhật
+ Quản lý cài đặt cá nhân
```

---

## 3. Định nghĩa và nguyên tắc kiến trúc

### 3.1 Định nghĩa module ME

`ME` là một **Personal Hub / Self-service Workspace** dành cho user hiện tại.

Module trả lời các câu hỏi:

```text
Tôi là ai trong hệ thống?
Tài khoản của tôi đang ở trạng thái nào?
Hồ sơ cá nhân và công việc của tôi gồm những gì?
Hôm nay tôi đã chấm công chưa?
Tôi còn bao nhiêu ngày phép?
Tôi đang có những công việc nào?
Tôi có thông báo hoặc yêu cầu nào cần xử lý?
Tôi có thể tự thay đổi cài đặt nào?
```

### 3.2 Nguyên tắc không sao chép dữ liệu

ME không được tạo một bản dữ liệu nhân sự hoặc tài khoản độc lập nếu dữ liệu đã tồn tại trong module nguồn.

Ví dụ:

| Dữ liệu | Module sở hữu |
| --- | --- |
| Email đăng nhập, trạng thái tài khoản | AUTH |
| Vai trò, quyền, phiên đăng nhập | AUTH |
| Họ tên, ngày sinh, số điện thoại, địa chỉ | HR |
| Phòng ban, chức vụ, quản lý trực tiếp | HR |
| Bảng công | ATT |
| Số dư phép và đơn nghỉ | LEAVE |
| Task của người dùng | TASK |
| Thông báo | NOTI |
| Avatar/file | FOUNDATION hoặc AUTH/HR thông qua file service |

ME chỉ lưu các cấu hình riêng thuộc phạm vi cá nhân nếu chưa có module nguồn phù hợp, ví dụ:

- Giao diện sáng/tối.
- Ngôn ngữ hiển thị.
- Múi giờ cá nhân nếu công ty cho phép.
- Trang mặc định sau đăng nhập.
- Module yêu thích.
- Cấu hình hiển thị ME.
- Tùy chọn riêng tư trong phạm vi được cho phép.

### 3.3 Nguyên tắc cập nhật dữ liệu

Khi người dùng thay đổi dữ liệu trong ME:

1. Nếu dữ liệu thuộc AUTH, ME gọi nghiệp vụ AUTH.
2. Nếu dữ liệu thuộc HR và cho phép self-service có kiểm duyệt, ME tạo `profile change request`.
3. Nếu dữ liệu thuộc NOTI, ME cập nhật notification preference.
4. Nếu dữ liệu là UI preference cá nhân, ME cập nhật personal setting.
5. ME không được cập nhật trực tiếp bảng dữ liệu thuộc module khác bằng cách bỏ qua business rule.

### 3.4 Nguyên tắc Own scope

Toàn bộ dữ liệu nghiệp vụ trong ME mặc định dùng data scope:

```text
Own
```

User chỉ được xem và thao tác trên dữ liệu của chính mình, trừ các liên kết điều hướng sang module khác mà user có quyền rộng hơn.

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

Module ME cần giúp người dùng:

1. Có một nơi duy nhất để xem toàn bộ thông tin liên quan đến bản thân.
2. Không phải chuyển qua nhiều module chỉ để kiểm tra dữ liệu cá nhân cơ bản.
3. Quản lý tài khoản, mật khẩu, phiên đăng nhập và bảo mật cá nhân.
4. Xem hồ sơ nhân viên và gửi yêu cầu cập nhật thông tin được phép.
5. Xem nhanh trạng thái chấm công, nghỉ phép, task và thông báo.
6. Quản lý tùy chọn nhận thông báo.
7. Quản lý cài đặt giao diện và trải nghiệm cá nhân.
8. Theo dõi trạng thái các yêu cầu self-service đã gửi.
9. Truy cập nhanh đến các nghiệp vụ gốc khi cần thao tác chuyên sâu.

### 4.2 Mục tiêu kỹ thuật

Module ME cần đảm bảo:

1. Không trùng lặp nguồn dữ liệu với AUTH, HR, ATT, LEAVE, TASK và NOTI.
2. Backend resolve user hiện tại từ auth context, không nhận `user_id` tùy ý từ frontend.
3. API tổng hợp phải chịu lỗi cục bộ; lỗi một nguồn không làm toàn trang ME bị hỏng.
4. Dữ liệu nhạy cảm phải được mask theo quyền và cấu hình công ty.
5. Các mutation phải gọi service của module sở hữu dữ liệu.
6. Có cache hợp lý cho dữ liệu summary nhưng không cache sai dữ liệu nhạy cảm giữa các user.
7. Khi logout phải xóa toàn bộ cache ME của user.
8. Hỗ trợ web trước và có thể mở rộng cho mobile app.
9. Có audit log cho thao tác bảo mật, đổi cài đặt quan trọng và truy cập dữ liệu nhạy cảm.

---

## 5. Phạm vi module

### 5.1 Bao gồm trong MVP

| Mã chức năng | Tên chức năng | Nguồn dữ liệu | Độ ưu tiên |
| --- | --- | --- | --- |
| ME-FUNC-001 | Xem tổng quan cá nhân | AUTH, HR, ATT, LEAVE, TASK, NOTI | Rất cao |
| ME-FUNC-002 | Xem hồ sơ cá nhân & công việc | HR, AUTH | Rất cao |
| ME-FUNC-003 | Gửi yêu cầu cập nhật hồ sơ | HR | Rất cao |
| ME-FUNC-004 | Theo dõi yêu cầu cập nhật hồ sơ | HR | Cao |
| ME-FUNC-005 | Xem thông tin tài khoản | AUTH | Rất cao |
| ME-FUNC-006 | Đổi mật khẩu | AUTH | Rất cao |
| ME-FUNC-007 | Xem và đăng xuất phiên đăng nhập | AUTH | Cao |
| ME-FUNC-008 | Xem quyền và vai trò của tôi | AUTH | Trung bình |
| ME-FUNC-009 | Xem chấm công của tôi | ATT | Cao |
| ME-FUNC-010 | Xem nghỉ phép của tôi | LEAVE | Cao |
| ME-FUNC-011 | Xem công việc của tôi | TASK | Cao |
| ME-FUNC-012 | Xem thông báo của tôi | NOTI | Cao |
| ME-FUNC-013 | Cấu hình nhận thông báo | NOTI | Cao |
| ME-FUNC-014 | Cấu hình giao diện cá nhân | ME/FOUNDATION | Cao |
| ME-FUNC-015 | Quản lý avatar | FOUNDATION + AUTH/HR | Cao |
| ME-FUNC-016 | Xem hoạt động bảo mật gần đây | AUTH | Trung bình |
| ME-FUNC-017 | Liên kết nhanh đến nghiệp vụ gốc | Tất cả module | Rất cao |
| ME-FUNC-018 | Xuất bản sao dữ liệu cá nhân được phép | Cross-module | Có thể / P1 |

### 5.2 Không bao gồm trong MVP

- Tự sửa trực tiếp mọi trường hồ sơ nhân viên.
- Tự thay đổi phòng ban, chức vụ, quản lý trực tiếp hoặc trạng thái làm việc.
- Tự gán role hoặc permission.
- Tự mở khóa tài khoản.
- Xóa tài khoản doanh nghiệp.
- Xóa hồ sơ nhân viên.
- Chỉnh sửa trực tiếp bảng công, số dư phép hoặc task không qua module nguồn.
- Quản lý hồ sơ hoặc tài khoản của người dùng khác.
- SSO/MFA nâng cao nếu AUTH chưa triển khai.
- Data portability đầy đủ theo chuẩn pháp lý nâng cao.
- Quản lý thiết bị mobile nâng cao.

---

## 6. Nhóm người dùng

### 6.1 Người dùng chính

Tất cả người dùng đã đăng nhập hợp lệ.

### 6.2 Điều kiện sử dụng

| Trường hợp | Khả năng sử dụng ME |
| --- | --- |
| User có liên kết employee | Xem đầy đủ dữ liệu tài khoản + nhân sự + nghiệp vụ cá nhân |
| User chưa liên kết employee | Chỉ xem tài khoản, bảo mật, vai trò, cài đặt; phần HR/ATT/LEAVE có trạng thái chưa liên kết |
| User bị khóa hoặc inactive | Không đăng nhập được nên không truy cập ME |
| User có nhiều role | ME hiển thị toàn bộ role nhưng dữ liệu cá nhân vẫn là Own |
| Super Admin không liên kết employee | Dùng ME như tài khoản quản trị, không hiển thị dữ liệu nhân viên giả |

---

## 7. Mối liên kết với các module khác

### 7.1 AUTH

ME dùng AUTH để:

- Xác định user hiện tại.
- Lấy email đăng nhập, trạng thái tài khoản và lần đăng nhập gần nhất.
- Lấy role, permission và data scope.
- Đổi mật khẩu.
- Xem và thu hồi session.
- Xem hoạt động bảo mật.
- Đăng xuất tài khoản.

ME không được tự quản lý role hoặc permission.

### 7.2 HR

ME dùng HR để:

- Lấy hồ sơ nhân viên của user hiện tại.
- Lấy thông tin cá nhân, liên hệ và công việc.
- Lấy phòng ban, chức vụ, cấp bậc, quản lý trực tiếp.
- Lấy hợp đồng nếu cấu hình cho phép.
- Tạo yêu cầu cập nhật hồ sơ cá nhân.
- Theo dõi trạng thái yêu cầu cập nhật.

ME không cập nhật trực tiếp các trường HR cần phê duyệt.

### 7.3 ATT

ME dùng ATT để hiển thị:

- Trạng thái check-in/check-out hôm nay.
- Giờ vào, giờ ra.
- Ca làm và trạng thái ngày công.
- Đi muộn, về sớm, thiếu giờ nếu được phép.
- Các yêu cầu điều chỉnh công của tôi.
- Remote work/công tác của tôi.

Các thao tác check-in, check-out hoặc tạo điều chỉnh phải gọi API ATT.

### 7.4 LEAVE

ME dùng LEAVE để hiển thị:

- Số dư phép.
- Đơn nghỉ gần nhất.
- Đơn đang chờ duyệt.
- Lịch nghỉ cá nhân.
- Liên kết tạo đơn nghỉ.

ME không tự tính lại số dư phép.

### 7.5 TASK

ME dùng TASK để hiển thị:

- Task được giao cho tôi.
- Task tôi tạo.
- Task tôi theo dõi.
- Task hôm nay, sắp đến hạn và quá hạn.
- Tiến độ cá nhân cơ bản.

ME không thay thế trang My Tasks của TASK.

### 7.6 NOTI

ME dùng NOTI để:

- Hiển thị thông báo cá nhân.
- Đếm unread.
- Mark read.
- Cấu hình loại và kênh thông báo được phép tùy chỉnh.

Các notification bắt buộc vì bảo mật hoặc pháp lý không được tắt nếu company policy không cho phép.

### 7.7 DASH

DASH và ME có thể cùng dùng một số widget cá nhân nhưng khác mục tiêu:

| DASH | ME |
| --- | --- |
| Tổng quan công việc theo vai trò | Trung tâm dữ liệu và cài đặt của chính user |
| Có thể hiển thị Team/Department/Company | Chủ yếu Own |
| Tập trung cảnh báo và vận hành | Tập trung hồ sơ, tài khoản, self-service |

### 7.8 FOUNDATION

ME dùng FOUNDATION để:

- Upload/lưu avatar.
- Lưu personal settings nếu FOUNDATION cung cấp setting service.
- Ghi audit log.
- Đọc company policy liên quan đến self-service, bảo mật, locale và giao diện.

---

## 8. Cấu trúc thông tin module ME

### 8.1 Sidebar đề xuất

```text
ME
├── Tổng quan
├── Hồ sơ của tôi
│   ├── Thông tin cá nhân
│   ├── Thông tin công việc
│   ├── Hợp đồng của tôi
│   └── Yêu cầu cập nhật hồ sơ
├── Tài khoản & bảo mật
│   ├── Tài khoản
│   ├── Đổi mật khẩu
│   ├── Phiên đăng nhập
│   └── Hoạt động bảo mật
├── Công việc của tôi
│   ├── Chấm công
│   ├── Nghỉ phép
│   └── Task của tôi
├── Thông báo
│   ├── Thông báo của tôi
│   └── Tùy chọn thông báo
└── Cài đặt cá nhân
    ├── Giao diện
    ├── Ngôn ngữ & múi giờ
    ├── Ứng dụng yêu thích
    └── Tùy chọn hiển thị
```

### 8.2 Route đề xuất

```text
/me
/me/profile
/me/profile/personal
/me/profile/work
/me/profile/contracts
/me/profile/change-requests
/me/account
/me/security/password
/me/security/sessions
/me/security/activity
/me/attendance
/me/leave
/me/tasks
/me/notifications
/me/preferences/notifications
/me/preferences/appearance
/me/preferences/general
```

---

## 9. Danh sách màn hình

| Mã màn hình | Tên màn hình | Nguồn chính | Ưu tiên |
| --- | --- | --- | --- |
| ME-SCREEN-001 | Tổng quan ME | Cross-module | P0 |
| ME-SCREEN-002 | Hồ sơ của tôi | HR + AUTH | P0 |
| ME-SCREEN-003 | Yêu cầu cập nhật hồ sơ | HR | P0 |
| ME-SCREEN-004 | Lịch sử yêu cầu cập nhật | HR | P1 |
| ME-SCREEN-005 | Tài khoản cá nhân | AUTH | P0 |
| ME-SCREEN-006 | Đổi mật khẩu | AUTH | P0 |
| ME-SCREEN-007 | Phiên đăng nhập | AUTH | P1 |
| ME-SCREEN-008 | Hoạt động bảo mật | AUTH | P1 |
| ME-SCREEN-009 | Chấm công của tôi | ATT | P1 |
| ME-SCREEN-010 | Nghỉ phép của tôi | LEAVE | P1 |
| ME-SCREEN-011 | Task của tôi | TASK | P1 |
| ME-SCREEN-012 | Thông báo của tôi | NOTI | P1 |
| ME-SCREEN-013 | Tùy chọn thông báo | NOTI | P1 |
| ME-SCREEN-014 | Cài đặt giao diện | ME/FOUNDATION | P1 |
| ME-SCREEN-015 | Ngôn ngữ & múi giờ | ME/FOUNDATION | P2 |

---

## 10. Chi tiết chức năng

### 10.1 ME-FUNC-001: Xem tổng quan cá nhân

#### Mục tiêu

Cho phép user xem nhanh dữ liệu quan trọng của chính mình.

#### Nội dung hiển thị đề xuất

- Avatar, họ tên, mã nhân viên.
- Email đăng nhập.
- Phòng ban, chức vụ, quản lý trực tiếp.
- Trạng thái chấm công hôm nay.
- Số ngày phép còn lại.
- Task hôm nay/quá hạn.
- Thông báo chưa đọc.
- Yêu cầu cập nhật hồ sơ đang chờ xử lý.
- Quick actions.

#### Quick actions

```text
Chỉnh sửa hồ sơ
Đổi mật khẩu
Check-in / Check-out
Tạo đơn nghỉ
Xem task của tôi
Xem thông báo
```

#### Quy tắc

- Chỉ hiển thị card khi module nguồn được bật và user có quyền.
- Nếu một nguồn lỗi, hiển thị degraded state ở card tương ứng.
- Không hiển thị dữ liệu team/company trong trang ME mặc định.

### 10.2 ME-FUNC-002: Xem hồ sơ cá nhân & công việc

#### Nhóm dữ liệu

| Nhóm | Ví dụ dữ liệu |
| --- | --- |
| Nhận diện | Avatar, họ tên, mã nhân viên |
| Cá nhân | Ngày sinh, giới tính, tình trạng hôn nhân |
| Liên hệ | Email cá nhân, số điện thoại, địa chỉ |
| Khẩn cấp | Người liên hệ khẩn cấp |
| Công việc | Phòng ban, chức vụ, cấp bậc, quản lý |
| Việc làm | Ngày vào làm, trạng thái nhân viên |
| Hợp đồng | Loại hợp đồng, thời hạn nếu được phép |
| Tài khoản | Email đăng nhập, role, trạng thái |

#### Quy tắc dữ liệu nhạy cảm

- Field nhạy cảm phải mask theo company policy.
- User có thể xem dữ liệu của mình nhưng không mặc nhiên được tải mọi file hồ sơ.
- Mỗi lần mở file hợp đồng hoặc giấy tờ nhạy cảm có thể ghi access log.

### 10.3 ME-FUNC-003: Gửi yêu cầu cập nhật hồ sơ

#### Luồng chính

```text
User mở Hồ sơ của tôi
→ Chọn Chỉnh sửa
→ ME lấy danh sách field được phép tự đề xuất thay đổi
→ User nhập giá trị mới
→ Xem lại dữ liệu cũ và mới
→ Gửi yêu cầu
→ HR nhận yêu cầu duyệt
→ User theo dõi trạng thái trong ME
```

#### Field được phép

Tuân thủ cấu hình HR. Ví dụ:

- Số điện thoại.
- Email cá nhân.
- Địa chỉ hiện tại.
- Địa chỉ thường trú.
- Liên hệ khẩn cấp.
- Tình trạng hôn nhân.
- Một số giấy tờ nếu công ty cho phép.

#### Field không được phép

- Phòng ban.
- Chức vụ.
- Cấp bậc.
- Quản lý trực tiếp.
- Trạng thái làm việc.
- Role và permission.
- Số dư phép.
- Bảng công.

### 10.4 ME-FUNC-005: Xem thông tin tài khoản

Hiển thị:

- Avatar.
- Email đăng nhập.
- Trạng thái tài khoản.
- Danh sách role.
- Permission summary nếu sản phẩm cho phép.
- Employee liên kết.
- Lần đăng nhập gần nhất.
- Ngày tạo tài khoản.

Không cho phép user tự sửa role hoặc trạng thái tài khoản.

### 10.5 ME-FUNC-006: Đổi mật khẩu

ME sử dụng nghiệp vụ AUTH.

Yêu cầu:

- Nhập mật khẩu hiện tại.
- Nhập mật khẩu mới.
- Xác nhận mật khẩu mới.
- Kiểm tra password policy.
- Sau khi đổi mật khẩu có thể thu hồi các session khác theo policy.
- Ghi security event và gửi notification bảo mật.

### 10.6 ME-FUNC-007: Quản lý phiên đăng nhập

User có thể:

- Xem thiết bị/browser gần đúng.
- Xem IP đã mask nếu policy yêu cầu.
- Xem thời gian hoạt động gần nhất.
- Xác định phiên hiện tại.
- Đăng xuất một phiên khác.
- Đăng xuất tất cả phiên khác.

User không được thu hồi session của user khác.

### 10.7 ME-FUNC-013: Cấu hình nhận thông báo

Nhóm cấu hình:

| Nhóm | Ví dụ |
| --- | --- |
| Công việc | Giao task, mention, sắp đến hạn |
| Nghỉ phép | Kết quả duyệt, thay đổi số dư |
| Chấm công | Quên check-out, điều chỉnh công |
| Hồ sơ | Yêu cầu cập nhật được duyệt/từ chối |
| Hệ thống | Bảo trì, chính sách, bảo mật |

Kênh:

- In-app.
- Email nếu hệ thống hỗ trợ.
- Mobile push ở phase sau.

Rule:

- Notification bảo mật bắt buộc không được tắt.
- Company có thể khóa một số preference.
- Nếu kênh chưa cấu hình thì UI hiển thị unavailable, không giả lập đã bật.

### 10.8 ME-FUNC-014: Cài đặt giao diện cá nhân

MVP đề xuất hỗ trợ:

- Theme: System / Light / Dark.
- Ngôn ngữ: Vietnamese / English nếu hệ thống hỗ trợ.
- Múi giờ: mặc định theo company, cho phép override nếu policy cho phép.
- Format ngày giờ.
- Trang/module mặc định sau đăng nhập.
- App yêu thích.
- Mật độ hiển thị: Comfortable / Compact nếu có.

---

## 11. Permission đề xuất

### 11.1 Permission cơ bản

```text
ME.ACCESS
ME.OVERVIEW.VIEW
ME.PROFILE.VIEW
ME.PROFILE.CHANGE_REQUEST.CREATE
ME.PROFILE.CHANGE_REQUEST.VIEW_OWN
ME.ACCOUNT.VIEW
ME.PASSWORD.CHANGE
ME.SESSION.VIEW_OWN
ME.SESSION.REVOKE_OWN
ME.SECURITY_ACTIVITY.VIEW_OWN
ME.ATTENDANCE.VIEW_OWN
ME.LEAVE.VIEW_OWN
ME.TASK.VIEW_OWN
ME.NOTIFICATION.VIEW_OWN
ME.NOTIFICATION_PREFERENCE.UPDATE_OWN
ME.PREFERENCE.VIEW_OWN
ME.PREFERENCE.UPDATE_OWN
ME.AVATAR.UPDATE_OWN
ME.DATA_EXPORT.REQUEST_OWN
```

### 11.2 Mapping với permission module nguồn

ME permission chỉ quyết định user có truy cập khu vực ME hay không. Khi gọi nghiệp vụ nguồn, backend vẫn phải kiểm tra permission module nguồn.

Ví dụ:

```text
ME.ATTENDANCE.VIEW_OWN
+ ATT.ATTENDANCE.VIEW_OWN
```

hoặc có thể không tạo permission wrapper riêng và dùng trực tiếp permission nguồn. Quyết định đề xuất cho MVP:

- Dùng `ME.ACCESS` và permission nguồn để giảm trùng lặp.
- Chỉ tạo permission riêng cho các chức năng thực sự thuộc ME như personal preference.

### 11.3 Data scope

Mặc định:

```text
Own
```

Không cho phép frontend truyền employee ID khác để xem qua endpoint ME.

---

## 12. Quy tắc nghiệp vụ

### 12.1 Xác định hồ sơ hiện tại

```text
Access token
→ AUTH resolve user_id + company_id
→ HR resolve employee theo users.id
→ ME tạo current-person context
```

### 12.2 User chưa liên kết employee

ME vẫn hoạt động ở mức tài khoản.

Hiển thị:

```text
Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.
Vui lòng liên hệ HR hoặc quản trị viên.
```

Ẩn hoặc disable:

- Hồ sơ công việc.
- Chấm công.
- Nghỉ phép.
- Task theo employee nếu TASK dùng employee.

### 12.3 Module nguồn bị tắt

Nếu company tắt module:

- Không hiển thị menu/card tương ứng.
- API summary trả trạng thái `module_disabled`.
- Không hiển thị dữ liệu stale từ cache cũ.

### 12.4 Dữ liệu không đồng bộ

Nếu user liên kết employee sai hoặc có nhiều employee active bất thường:

- Không tự chọn ngẫu nhiên.
- Trả lỗi cấu hình dữ liệu.
- Ghi audit/system alert.
- Yêu cầu Admin/HR xử lý.

### 12.5 Deep link

Mọi quick action hoặc item tổng hợp điều hướng sang module gốc.

Ví dụ:

```text
ME → Task quá hạn → TASK detail
ME → Đơn nghỉ chờ duyệt → LEAVE detail
ME → Bảng công tháng → ATT records
```

Module gốc phải kiểm tra permission và business rule lại.

### 12.6 Cache

- Cache key phải có `company_id + user_id`.
- Không dùng cache chung giữa các user.
- Dữ liệu session/security không cache dài.
- Invalidate khi profile, attendance, leave, task, notification hoặc preference thay đổi.

---

## 13. Trạng thái UI bắt buộc

| State | Mô tả |
| --- | --- |
| Loading | Đang tải dữ liệu tổng hợp |
| Partial loading | Một số card đã tải, một số card đang tải |
| Empty | User chưa có dữ liệu tương ứng |
| Unlinked employee | User chưa liên kết hồ sơ nhân viên |
| Module disabled | Module nguồn bị tắt |
| Forbidden | User thiếu quyền |
| Masked | Field nhạy cảm bị che |
| Pending request | Có yêu cầu cập nhật hồ sơ đang chờ duyệt |
| Degraded | Một module nguồn lỗi nhưng ME vẫn hoạt động |
| Stale | Dữ liệu cache cũ, cần refresh |
| Error | Lỗi toàn bộ hoặc không resolve được current user |
| Success | Mutation thành công |

---

## 14. Yêu cầu API cấp SPEC

### 14.1 Prefix đề xuất

```http
/api/v1/me
```

### 14.2 Endpoint tổng hợp đề xuất

```http
GET    /api/v1/me
GET    /api/v1/me/overview
GET    /api/v1/me/profile
GET    /api/v1/me/account
GET    /api/v1/me/security/sessions
DELETE /api/v1/me/security/sessions/{session_id}
POST   /api/v1/me/security/sessions/revoke-others
GET    /api/v1/me/security/activity
GET    /api/v1/me/attendance-summary
GET    /api/v1/me/leave-summary
GET    /api/v1/me/task-summary
GET    /api/v1/me/notification-summary
GET    /api/v1/me/preferences
PATCH  /api/v1/me/preferences
PATCH  /api/v1/me/preferences/appearance
PATCH  /api/v1/me/preferences/notifications
POST   /api/v1/me/avatar
DELETE /api/v1/me/avatar
```

### 14.3 Endpoint nghiệp vụ nguồn được gọi lại

```http
POST /api/v1/hr/me/profile-change-requests
POST /api/v1/auth/change-password
POST /api/v1/attendance/check-in
POST /api/v1/attendance/check-out
POST /api/v1/leave/requests
GET  /api/v1/tasks/my-tasks
GET  /api/v1/notifications
```

### 14.4 Nguyên tắc API

- Không nhận `user_id` hoặc `employee_id` cho endpoint public ME.
- Resolve từ access token.
- Response summary có trạng thái riêng từng section.
- Không trả field nhạy cảm nếu không được phép.
- Mutation quan trọng ghi audit và security event.
- Backend không phụ thuộc dữ liệu role do frontend gửi.

---

## 15. Dữ liệu và lưu trữ

### 15.1 Dữ liệu không tạo mới trong ME

ME không tạo lại:

- users.
- employees.
- attendance_records.
- leave_requests.
- tasks.
- notifications.

### 15.2 Bảng đề xuất nếu cần personal preferences

```text
user_preferences
```

Field cấp cao đề xuất:

| Field | Ý nghĩa |
| --- | --- |
| id | UUID |
| company_id | Tenant |
| user_id | User sở hữu preference |
| locale | Ngôn ngữ |
| timezone | Múi giờ |
| theme | system/light/dark |
| date_format | Format ngày |
| time_format | 12h/24h |
| default_landing | Trang sau login |
| density | comfortable/compact |
| favorite_modules | JSONB hoặc bảng liên kết |
| me_layout_config | JSONB cấu hình ME |
| created_at | Thời gian tạo |
| updated_at | Thời gian cập nhật |

Unique:

```text
company_id + user_id
```

### 15.3 Có thể dùng lại bảng hiện có

Nếu FOUNDATION đã có hệ thống setting theo user, không cần tạo `user_preferences`; chỉ cần mở rộng setting scope:

```text
System
Company
Role
User
```

---

## 16. Sự kiện và thông báo

ME có thể phát các event:

```text
ME_PROFILE_CHANGE_REQUESTED
ME_PASSWORD_CHANGED
ME_SESSION_REVOKED
ME_ALL_OTHER_SESSIONS_REVOKED
ME_AVATAR_UPDATED
ME_NOTIFICATION_PREFERENCE_UPDATED
ME_PERSONAL_PREFERENCE_UPDATED
ME_PERSONAL_DATA_EXPORT_REQUESTED
```

Lưu ý:

- Event thay đổi hồ sơ thực chất nên dùng event HR nếu mutation do HR xử lý.
- Event đổi mật khẩu/session nên dùng event AUTH.
- ME chỉ phát event cho preference thực sự thuộc ME.

---

## 17. Audit và bảo mật

Bắt buộc ghi log với:

- Đổi mật khẩu.
- Thu hồi session.
- Upload/xóa avatar nếu avatar là file private.
- Gửi yêu cầu cập nhật hồ sơ.
- Xem hoặc tải file nhạy cảm.
- Thay đổi notification preference bắt buộc.
- Yêu cầu xuất dữ liệu cá nhân.

Không ghi vào audit log:

- Mật khẩu cũ/mới.
- Token.
- Secret.
- Nội dung nhạy cảm không cần thiết.

### 17.1 Bảo vệ dữ liệu

- Mọi endpoint ME yêu cầu authentication.
- Chống IDOR bằng cách không nhận owner ID từ client.
- Session revoke phải xác minh session thuộc user hiện tại.
- Avatar upload kiểm tra MIME, size và malware theo file service.
- Dữ liệu nhạy cảm phải mask.
- Không expose permission nội bộ chi tiết nếu có thể làm lộ cấu trúc bảo mật không cần thiết.

---

## 18. Non-functional requirements

### 18.1 Hiệu năng

- `GET /api/v1/me/overview` mục tiêu p95 dưới 800 ms khi cache warm.
- Mỗi section có thể lazy load.
- Không thực hiện query N+1 theo từng widget.
- Summary task/leave/attendance chỉ lấy dữ liệu cần thiết.

### 18.2 Khả dụng

- Một module nguồn lỗi không được làm toàn bộ ME lỗi.
- Hiển thị retry theo section.
- Có correlation/request ID để truy vết lỗi tổng hợp.

### 18.3 Responsive

- Desktop: sidebar + content nhiều cột.
- Tablet: sidebar drawer/collapse.
- Mobile: card một cột, form full-screen, security/session thành list.

### 18.4 Accessibility

- Điều hướng được bằng bàn phím.
- Focus rõ ràng.
- Form lỗi focus field đầu tiên.
- Field masked có label và mô tả phù hợp.
- Không dùng màu sắc là tín hiệu duy nhất.

---

## 19. Tiêu chí nghiệm thu tổng quát

1. User đã đăng nhập truy cập được `/me`.
2. User chỉ xem dữ liệu của chính mình.
3. User chưa liên kết employee vẫn xem được tài khoản và bảo mật.
4. Hồ sơ cá nhân lấy đúng từ HR, không tạo bản sao độc lập.
5. User gửi yêu cầu cập nhật hồ sơ và theo dõi trạng thái được.
6. User không thể tự sửa trường công việc hoặc quyền bị cấm.
7. Đổi mật khẩu gọi đúng nghiệp vụ AUTH.
8. User xem và thu hồi session của chính mình.
9. ME hiển thị summary ATT, LEAVE, TASK, NOTI khi module được bật.
10. Lỗi một module nguồn không làm toàn trang lỗi.
11. Quick action điều hướng đúng module gốc.
12. Notification preference tuân thủ policy bắt buộc.
13. Personal preference lưu riêng theo user và company.
14. Logout xóa cache ME.
15. Dữ liệu nhạy cảm được mask và ghi access log khi cần.
16. Backend không tin `user_id`, `employee_id`, role hoặc permission do frontend gửi.

---

## 20. Test scenario cấp cao

### 20.1 Authentication

- Token hợp lệ.
- Token hết hạn.
- User locked sau khi đã mở trang.
- Session bị revoke.

### 20.2 User-employee mapping

- User liên kết đúng một employee.
- User chưa liên kết employee.
- Employee inactive/resigned.
- Dữ liệu mapping bất thường.

### 20.3 Profile

- Xem hồ sơ cá nhân.
- Field nhạy cảm bị mask.
- Tạo request hợp lệ.
- Field không cho phép bị chặn.
- Có request pending trùng field.

### 20.4 Security

- Đổi mật khẩu đúng/sai.
- Revoke session thuộc mình.
- Cố revoke session người khác.
- Revoke all other sessions.

### 20.5 Aggregation

- Tất cả module hoạt động.
- ATT lỗi.
- LEAVE disabled.
- TASK timeout.
- NOTI unread count lỗi.
- Cache cũ bị invalidate sau mutation.

### 20.6 Preferences

- Cập nhật theme.
- Cập nhật locale.
- Company khóa timezone.
- Tắt notification tùy chọn.
- Cố tắt notification bắt buộc.

---

## 21. Quyết định nghiệp vụ đã chốt

> **Ngày chốt: 13/07/2026 (S5-ME-DOC-1).** Toàn bộ ME-DEC-001..010 lấy theo cột **Đề xuất** làm **quyết định chính thức** (decision-of-record). **Dấu Approved đã đóng ngày 23/07/2026** (owner duyệt, đồng bộ §1 Trạng thái + API-11 §1).

| Mã | Câu hỏi | Quyết định chốt (13/07/2026) |
| --- | --- | --- |
| ME-DEC-001 | ME là module độc lập hay menu tài khoản? | Module độc lập nhưng có thể mở từ avatar menu |
| ME-DEC-002 | Có tạo permission ME riêng không? | Chỉ `ME.ACCESS` + permission nguồn; preference dùng permission riêng |
| ME-DEC-003 | Có cho xem toàn bộ role/permission không? | Hiển thị role; permission chỉ hiển thị summary nếu cần |
| ME-DEC-004 | Avatar thuộc AUTH hay HR? | Dùng file service chung; chọn một nguồn canonical |
| ME-DEC-005 | Có cho tự sửa hồ sơ trực tiếp không? | Không; tiếp tục dùng HR approval flow |
| ME-DEC-006 | Có hiển thị hợp đồng trong ME không? | Có nếu company setting và permission cho phép |
| ME-DEC-007 | Có cho tắt notification bảo mật không? | Không |
| ME-DEC-008 | Có cho user đổi timezone? | Có nếu company policy cho phép |
| ME-DEC-009 | Có cho export dữ liệu cá nhân trong MVP? | Đưa P1 hoặc phase sau |
| ME-DEC-010 | Có dùng DASH widget trong ME? | Tái sử dụng query/component nhưng không biến ME thành dashboard thứ hai |

---

## 22. Tác động đến bộ tài liệu hiện tại

Sau khi chốt SPEC-09, cần cập nhật:

1. `SPEC-01`: thêm module ME vào danh sách module và sơ đồ phụ thuộc.
2. `PRD-00`: thêm Personal Hub / Employee Self-service vào phạm vi MVP bổ sung.
3. `DB-01`: thêm `user_preferences` hoặc user-scoped settings.
4. `DB-02`: bổ sung session/security API nếu chưa đủ.
5. `DB-03`: xác nhận HR My Profile và change request là nguồn canonical.
6. `DB-07`: xác nhận notification preference theo user.
7. `DB-08`: xác nhận file/avatar và setting scope user.
8. `DB-09`: thêm index cho `user_preferences(company_id, user_id)`.
9. `DB-10`: seed module `ME` và permission liên quan.
10. Tạo `API-11 ME API Design` (đánh số tiếp theo sau API-10; xem `docs/API Design/API-11_ME_API_Design.md`).
11. Cập nhật UI-02, UI-04, UI-06, UI-07, UI-09 và UI-10.
12. Cập nhật FRONTEND route registry, app registry, sidebar và query keys.
13. Cập nhật BACKEND module aggregation/service orchestration.
14. Cập nhật QA test matrix và IMPLEMENTATION backlog.

---

## 23. Definition of Done cho SPEC-09

SPEC-09 được xem là hoàn thành khi:

- Phạm vi ME được phê duyệt.
- Ranh giới dữ liệu giữa ME và module nguồn được chốt.
- Danh sách chức năng MVP được chốt.
- Danh sách màn hình và route được chốt.
- Permission và Own scope được chốt.
- Quy trình cập nhật hồ sơ qua HR approval được giữ nguyên.
- Quy trình tài khoản/bảo mật qua AUTH được giữ nguyên.
- Cấu trúc personal preference được chốt.
- Các trạng thái lỗi và degraded state được chốt.
- Danh sách tài liệu chịu tác động được lập kế hoạch cập nhật.

---

## 24. Kết luận

Module `ME` là lớp trải nghiệm self-service tập trung dành cho người dùng hiện tại. Giá trị chính của module không nằm ở việc tạo thêm một nguồn dữ liệu mới, mà nằm ở việc kết nối dữ liệu cá nhân đang phân tán giữa AUTH, HR, ATT, LEAVE, TASK và NOTI thành một trải nghiệm thống nhất, dễ hiểu và an toàn.

Nguyên tắc cốt lõi:

```text
ME tổng hợp nhưng không chiếm quyền sở hữu dữ liệu.
ME cho phép self-service nhưng không bỏ qua quy trình phê duyệt.
ME chỉ làm việc với dữ liệu của user hiện tại.
ME điều hướng về module gốc cho nghiệp vụ chuyên sâu.
```
