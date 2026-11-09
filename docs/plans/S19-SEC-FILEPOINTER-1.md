# S19-SEC-FILEPOINTER-1 — con trỏ tệp trên thực thể theo cùng quyết định xem từng tệp

> Plan · 09/11/2026 · FULL gate. Số đo chi tiết ở kênh owner ngoài repo.

## Bất biến

- Ghi con trỏ tệp chỉ khi người ghi xem được tệp theo cùng hàm quyết định với `GET /foundation/files/:id`
  (`FileService.preflightLinkerView` + so lại trong tx ghi). Từ chối mặc định: chỉ `allow` đi tiếp, mọi nhánh khác ném.
- Đường ký avatar danh bạ chỉ ký ảnh độc quyền: liên kết avatar sống + primary + không có liên kết sống nào khác.
- Logo công ty ở đường ngoài branding (hồ sơ công ty) chỉ nhận rỗng / http(s) / giữ giá trị hiện có; fileId chỉ qua endpoint branding.
- Tệp hợp đồng chỉ gắn qua `POST /hr/contracts/:id/file`; DTO tạo/sửa không còn `fileId` (khoá lạ bị bỏ qua; patch rỗng sau khi bỏ = không ghi, không audit).
- Đính kèm đơn điều chỉnh công / làm từ xa: người nộp phải xem được tệp; chuyển sang liên kết = `S19-SEC-FILEATTLINK-1`.
- Cột con trỏ chưa có đường ghi: đường ghi mới phải qua hàm chung.

## Ngoại lệ directory-class

Avatar nhân viên hiển thị cho mọi người đọc được nhân viên (gate `read:employee` + data-scope ở caller), không qua quyết định xem từng tệp.
Ngoại lệ chỉ đứng cho ảnh độc quyền (xem bất biến thứ hai). Mọi đường ghi avatar mới phải tạo liên kết ME/avatar qua hàm chung;
cột `avatar_url` không bao giờ là nguồn quyền.

## Lát

| Lát | Nội dung | Tệp chính |
| --- | -------- | --------- |
| L1 | vị từ độc quyền cho đường ký avatar danh bạ | `foundation/files/file.repository.ts` (`findVerifiedAvatarsTx`) |
| L2 | luật ghi logo ngoài branding; lối branding tường minh | `foundation/company/company-logo-ref.ts`, `company.service.ts`, `settings/settings.*.ts` |
| L3 | bỏ `fileId` khỏi DTO tạo/sửa hợp đồng; patch rỗng không ghi | `contracts/hr/contracts.ts`, `employees/contract.service.ts` |
| L4/L5 | đính kèm đơn ATT qua quyết định xem tệp (trước khi cấp mã; so lại trong tx) | `foundation/files/file-pointer-guard.ts`, `attendance/*-request.service.ts` |

## Test

`test/integration/s19-sec-filepointer-1.int-spec.ts` (mỗi ca từ chối có ca cho phép cạnh nó) · `company-logo-ref.spec.ts` ·
`file-pointer-guard.spec.ts` · `attendance-adjustment.service.spec.ts`.
Hồi quy: avatar-presign · social-avatarpresign-1 · hr-employee-avatar · company-branding-deny · hr-contract · filelinkgate/filelinkpaths · attendance allocate-guard.

## Nợ

- Con trỏ favicon trên đường cấu hình công ty chung: đóng cùng bất biến (chỉ rỗng / http(s) / giữ nguyên ngoài endpoint thương hiệu).
- Ngưỡng scan avatar `≠Infected` so với phòng chat `Clean|NotRequired`: căn lại khi có WO phù hợp.
- Người duyệt đơn ATT chưa mở được đính kèm: thuộc `S19-SEC-FILEATTLINK-1`.
