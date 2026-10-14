# DECISIONS-16 — Object storage của PROD chuyển sang Cloudflare R2; storage tự host giữ cho dev · CI · lane

| | |
| --- | --- |
| **Trạng thái** | 🟢 **ĐÃ CHỐT 2026-10-14** (owner chọn hướng R2 + chấp nhận mất `x-content-type-options: nosniff`) · thi hành trong WO `S19-OPS-STORAGEPUBLIC-1` (plan `docs/plans/S19-OPS-STORAGEPUBLIC-1.md` v2) |
| **Ngày** | 2026-10-14 |
| **Bối cảnh** | Storage PROD (container tự host) chỉ nghe ở địa chỉ nội bộ của máy chủ và API ký URL bằng chính địa chỉ đó ⇒ URL ký phát cho trình duyệt (tải lên · xem · tải về tệp) chỉ dùng được TRÊN máy chủ (đo 09/10/2026). Mọi tính năng tệp — đính kèm chat · avatar · tệp hồ sơ · đính kèm SOCIAL · phiếu lương — hỏng với người dùng ở máy khác |
| **Vùng** | 🔴 ĐỎ — nơi lưu tệp của mọi module + đường chuyển dữ liệu cá nhân |
| **Phạm vi** | Chỉ GIÁ TRỊ 6 biến `S3_*` của PROD đổi. **KHÔNG** đổi mã ký URL, **KHÔNG** thêm biến env, **KHÔNG** migration |

---

## 1. Quyết định

1. **PROD** dùng một bucket Cloudflare R2 RIÊNG TƯ: đường công khai của nhà cung cấp TẮT, không gắn tên miền riêng; mọi
   lượt đọc / ghi của trình duyệt đi bằng URL ký (SigV4) trên miền S3 API của R2, TTL giữ nguyên (`S3_PRESIGN_TTL_SEC`).
2. **dev · CI · lane · dev-online** giữ storage tự host như cũ. Không môi trường nào ngoài PROD chạm bucket PROD.
3. Khoá ký là token R2 «Object Read & Write» CHỈ cho bucket PROD, không quyền quản trị (đo 14/10: token loại này không
   đọc / đổi được CORS của bucket), token RIÊNG — không dùng lại token của app khác.
4. CORS theo bucket: CHỈ `PUT` + header `content-type` từ origin các app FE có tải lên. Mọi lượt đọc đi bằng `<img>` /
   điều hướng nên không cần CORS. Tải tệp TASK hôm nay đọc byte bằng JS sau redirect 302 kèm credentials — R2 không có
   CORS cho credentials ⇒ phải chuyển sang «lấy URL JSON rồi điều hướng» (`S19-OPS-TASKFILEURL-1`) TRƯỚC lúc chuyển.

## 2. Ba hướng đã cân nhắc

| Hướng | Mô tả | Kết luận |
| --- | --- | --- |
| **a** | Mở một đường vào công khai cho storage tự host + endpoint KÝ công khai tách khỏi endpoint nội bộ | **LOẠI.** Đưa cổng API của bản storage tự host ra Internet trong khi kênh bản vá của nó đã ngừng (`DEVOPS-03` §13.4); sửa cấu hình tunnel đang chở mọi hostname PROD; khoá ký theo script cài là tài khoản gốc của storage; cookie phiên của tên miền công ty đi kèm mọi lượt tải ảnh |
| **b** | API tự nhận / phục vụ byte, storage không ra ngoài | **LOẠI lúc này.** Viết lại đường tải lên / tải về (Range, trần cỡ, phân quyền từng lượt), byte đi qua tiến trình API |
| **c** | Object storage S3-compatible được quản lý — Cloudflare R2 | **CHỌN.** Đổi env, không đổi mã; nhóm int-spec S1–S9 của `S16-SOCIAL-FILEDISPOSITION-1` chạy trên R2 = 19/20 xanh (14/10) |

## 3. Đánh đổi đã chấp nhận (owner 2026-10-14)

- **R2 không gửi `x-content-type-options: nosniff`** khi phục vụ URL ký (storage tự host có gửi); API không đặt được header
  này qua tham số ký. Lớp bảo vệ chính còn nguyên: kiểu nội dung nằm trong chữ ký lượt ghi; kiểu trả + cách phục vụ do
  server ép (mọi thứ ngoài danh sách hiển thị trực tiếp đều `attachment`); tệp nằm ở tên miền của nhà cung cấp, tách khỏi
  tên miền ứng dụng. Test ghim hành vi ĐO được theo nhà cung cấp (`apps/api/test/helpers/storage-provider.ts`).
- Phụ thuộc thêm một nhà cung cấp ngoài: gián đoạn của R2 = mọi tính năng tệp gián đoạn.
- Tệp hồ sơ nhân sự · CV · phiếu lương nằm ở máy chủ ngoài Việt Nam — nghĩa vụ về chuyển dữ liệu cá nhân phải được owner
  xác nhận TRƯỚC lượt chép dữ liệu PROD đầu tiên (hợp đồng WO `done_when[7]`).

## 4. Hệ quả và LUẬT cho code tương lai

1. **CI không bao giờ chứng minh tương thích R2.** Trước mỗi lần nâng `@aws-sdk/*` và trước lần chuyển PROD: chạy
   `scripts/storage-r2-compat.sh` trên bucket R2 thử (`DEVOPS-03` §13.5). Đỏ ở đó = không nâng.
2. Không thêm hành vi phụ thuộc header do storage tự gắn; chỗ hai nhà cung cấp khác nhau theo số đo phải đi qua
   `storage-provider.ts`, không ghim cứng một phía.
3. Không đường FE nào được đọc byte storage bằng JS (fetch / XHR GET). Đọc = `<img>` hoặc điều hướng tới URL ký.
4. `.env` gốc của máy chủ PROD mang token R2 sau lúc chuyển ⇒ không chạy int-spec từ checkout chính; dev-online phải tự
   mang đủ 6 `S3_*` của nó.

## 5. Đường lùi

Trả 6 dòng `S3_*` cũ ở CẢ `.env` lẫn `.env.prod` → khởi động lại API → chép ngược các tệp tạo SAU lúc chuyển
(`scripts/windows/storage-migrate-r2.ps1`, đảo hai file cấu hình). Dữ liệu trên storage tự host giữ nguyên ít nhất 30 ngày
sau lúc chuyển; không bước nào xoá dữ liệu ở phía nào. Runbook: `RELEASE-08` §9.
