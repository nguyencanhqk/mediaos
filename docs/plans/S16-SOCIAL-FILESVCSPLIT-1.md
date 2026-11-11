# S16-SOCIAL-FILESVCSPLIT-1 — tách files.service.ts và files.service.spec.ts

Lát A của S16-SOCIAL-FILEDEBT-1. Thuần di chuyển mã, KHÔNG đổi hành vi.

## Quyết định

- `FileService` giữ làm MẶT TIỀN: constructor 8 tham số, DI token, mọi method public và chữ ký không đổi.
  `files.module.ts` và mọi nơi gọi bên ngoài (attendance · chat · employees · company · …) không phải sửa.
- Tách theo trách nhiệm, bằng thành phần KHÔNG phải provider Nest (không thêm DI, không đổi module):
  - `file-upload-support.ts` — hàm thuần của pha đăng ký: `loadUploadLimits` (system_settings),
    `sanitizeFilename`, `buildKeyOrThrow`, `signUploadOrReject`, `mimeRejected`, `newFileId`.
    `this.x` đổi thành tham số tường minh (settings · storage · logger); thân hàm giữ nguyên.
  - `file-confirm-flow.ts` — lớp `FileConfirmFlow` (pha 3 confirm + `failConfirm`). `FileService` dựng nó
    trong constructor từ CHÍNH các phụ thuộc đã giữ và truyền `logger` của FileService ⇒ dòng warn vẫn
    mang context `FileService`; spec bắt `Logger.prototype.warn` vẫn thấy đúng số dòng.
  - `file-deny-log.ts` — `logFileDeny` (dòng access-log DENY trong tx tenant riêng); `FileService.logDeny`
    còn là uỷ quyền một dòng nên mọi điểm gọi trong mặt tiền giữ nguyên.
- Ở lại trong mặt tiền: upload · getMetadata · getDownloadUrl · link/preflight · unlink · deleteFile —
  các luồng này đan quyền → log từ chối → ghi, tách nữa sẽ phải đổi thứ tự/cấu trúc gọi.
- Spec: harness chung (`makeHarness`, `makeFileRow`, hằng) ra `files.service.harness.ts`;
  `files.service.confirm.spec.ts` nhận 3 describe cuối (confirmUpload · download_count · audit masking).
  `files.service.spec.ts` giữ phần còn lại. KHÔNG sửa kỳ vọng nào.

## Kích thước (dòng)

| Tệp | Trước | Sau |
| --- | --- | --- |
| files.service.ts | 1000 | 736 |
| files.service.spec.ts | 991 | 618 |
| file-upload-support.ts · file-confirm-flow.ts · file-deny-log.ts | — | 138 · 185 · 46 |
| files.service.harness.ts · files.service.confirm.spec.ts | — | 222 · 180 |

## Bảng đếm ca (lane `mediaos_w4c`)

| Phạm vi | Trước | Sau |
| --- | --- | --- |
| `src/foundation/files` (vitest, gồm 2 `.int.spec`) | 20 tệp · 625 ca | 21 tệp · 625 ca (+1 tệp do tách) |
| `test/integration/*file*.int-spec.ts` (22 tệp) | 333 pass · 22 skip (gồm 19 ca của 2 `.int.spec` trên) | cùng số |
| Gộp | 43 tệp · 939 pass · 22 skip (suy từ hai lượt) | 43 tệp · 939 pass · 22 skip |
| Số `it(`/`it.each` của files.service.spec | 47 | 47 (spec + confirm.spec) |

22 skip là ca storage-live có sẵn (hồ sơ offline) — bằng nhau trước/sau, không phát sinh skip mới.

## Ánh xạ done_when → bằng chứng

1. Mỗi tệp < 800, tệp mới < 400 — bảng kích thước.
2. Không đổi hành vi, chữ ký public giữ nguyên — bảng đếm ca bằng nhau; typecheck API xanh; không sửa
   kỳ vọng spec nào; không có chỗ gọi ngoài module nào bị đổi.
3. Không đổi quyền/truy vấn/RLS/thứ tự kiểm tra — thân hàm chép nguyên văn (thứ tự kiểm tra, thông điệp
   lỗi, log, audit giữ); chờ database-reviewer + security-reviewer xác nhận (brain spawn).
4. `check.sh --lane-db` — CHƯA chạy ở chuỗi này (ngân sách/máy yếu); chạy ở bước gate của brain.

## Nợ

- `files.service.ts` còn 736 dòng; tách tiếp luồng link/unlink/delete nếu WO FILE sau cần thêm chỗ.
- `git diff -M --color-moved` chưa đính kèm vào PR; reviewer nên chạy để xác nhận thân hàm chỉ di chuyển.
- Gate FULL (database-reviewer + security-reviewer + silent-failure-hunter) và `check.sh --lane-db` chưa chạy.
