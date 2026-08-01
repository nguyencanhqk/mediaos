# S6-OPS-LOGWINDOW-1 — Cảnh báo vận hành đếm SAI cửa sổ + xoay log PROD

> **Một câu:** `ops-alert-check` đang báo **CRIT giả** vì nó đếm 5 ngày lịch sử log thành "lỗi trong 60
> phút"; sửa bằng cách đọc **timestamp từng dòng** thay vì suy từ `mtime` của file, đồng thời xoay
> `api.out.log` (721 MB) và chặn phình lặp lại.
>
> **Zone:** yellow · **Gate:** LIGHT (`typescript-reviewer` + `quality-gate`) · **Migration:** không ·
> **Chạm permission/RLS/secret/audit:** không.

---

## 1. Lỗi đang có — đo thật, không suy đoán

`scripts/ops-alert-check.mjs:163-179` (`collectErrorLines`) làm hai việc, và **cả hai đều sai**:

```js
const ageMin = (Date.now() - stat.mtimeMs) / 60000;
if (ageMin > WINDOW_MIN) return 0;              // (1) cổng bằng mtime của FILE
…
return (buf.toString("utf8").match(/\bERROR\b/g) ?? []).length;   // (2) đếm MỌI chữ ERROR trong 2MB cuối
```

**Đo trên PROD 2026-08-01 (`logs/api.err.log`, 2 079 KB):**

| Đo | Giá trị |
| --- | --- |
| `mtime` của file | **01/08/2026 07:47** (trong cửa sổ 60 phút) |
| Dòng `ERROR` **mới nhất** trong file | **30/07/2026 07:52** — cách đó **2 ngày** |
| `collectErrorLines()` trả về | **1787** |
| Phân bố thật theo ngày | `26/07: 891` · `27/07: 114` · `28/07: 27` · `30/07: 755` |

1787 ≥ `errorLogCrit = 200` ⇒ nhóm **"Lỗi ứng dụng trong log" = CRIT** ⇒ toàn cục **CRIT** ⇒ exit 2.
`RELEASE-09` §4 đăng ký task chạy **mỗi 10 phút** ⇒ chuông kêu 144 lần/ngày vì một sự cố đã đóng từ
hai ngày trước. Đó chính là **alert fatigue**: sau vài ngày không ai đọc nữa, và lúc đó hệ cảnh báo tệ
hơn không có. Nó cũng làm hỏng chính giá trị của cổng go-live `RELEASE-10` ô #12.

### Vì sao `mtime` không bao giờ là căn cứ được

Hai chiều hỏng, và cả hai đã xảy ra trên máy này:

- **Dương tính giả (đang xảy ra):** file có `mtime` mới nhưng nội dung cũ. Đo được ở trên — `mtime`
  01/08 07:47 trong khi byte cuối cùng là dòng stack trace của 30/07. Service khởi động lại (PID đổi
  `8736` → `51532`) làm NSSM chạm vào file mà không ghi dòng lỗi mới nào.
- **Âm tính giả (nguy hiểm hơn):** một dòng lỗi được ghi ở **phút 59** của cửa sổ, rồi im 61 phút.
  `ageMin > WINDOW_MIN` ⇒ **trả 0** ⇒ báo xanh trong khi vừa có lỗi. Cảnh báo báo xanh vì không nhìn
  là đúng chế độ hỏng mà `ops-alert-rules.mjs` đã dựng cả luật nền `unknown ≠ ok` để chống.

⇒ **`mtime` bị gỡ bỏ hoàn toàn**, không "vá thêm điều kiện".

---

## 2. Sửa gì

### 2.1 Đếm theo TIMESTAMP từng dòng

Nest `Logger` mặc định in `MM/DD/YYYY, h:mm:ss AM|PM`, có mã màu ANSI xen giữa:

```text
\x1b[31m[Nest] 8736  - \x1b[39m07/30/2026, 7:52:21 AM \x1b[31m  ERROR\x1b[39m \x1b[38;5;3m[WorkerSchedulerService]…
```

Logic mới, tách thành module thuần `scripts/lib/ops-log-window.mjs` để test được không cần hạ tầng
(cùng khuôn với `ops-alert-rules.mjs` — thu thập ở `ops-alert-check.mjs`, phán xét ở `lib/`):

| Hàm | Trách nhiệm |
| --- | --- |
| `parseLogTimestamp(line)` | regex → `Date` **giờ địa phương** (cùng múi với `Date.now()` và với chính Nest). `null` nếu không parse được. **KHÔNG** dùng `new Date(string)` — tránh phụ thuộc locale/định dạng của V8 |
| `countErrorLinesInWindow(text, {nowMs, windowMin, dropFirstLine})` | đếm dòng thoả **CẢ HAI**: có `\bERROR\b` **VÀ** timestamp ≥ mốc cắt |
| `countErrorLinesInFile(path, {…})` | đọc phần đuôi rồi gọi hàm trên; `null` = không đọc được (⇒ rule ra `unknown`, đúng luật fail-closed) |

**Bốn quyết định, kèm lý do:**

1. **Dòng không parse được timestamp KHÔNG được tính** (`done_when` #2). Stack trace nhiều dòng, dòng
   đầu bị cắt ngang khi đọc đuôi, rác ANSI — tất cả đều vô định thời gian. Tính chúng vào là quay lại
   đúng lỗi đang sửa. Đổi lại, `Error:` ở dòng stack không bị đếm trùng với `ERROR` ở dòng tiêu đề
   Nest — vốn đã đúng vì regex phân biệt hoa/thường.
2. **Không có chặn trên cho timestamp.** Dòng có timestamp ở tương lai (lệch đồng hồ) vẫn được tính:
   với một công cụ giám sát, bỏ sót lỗi thật nguy hiểm hơn một cảnh báo thừa. Cửa sổ là "từ mốc cắt
   trở về sau", không phải một khoảng đóng.
3. **Bỏ dòng đầu tiên khi đọc từ giữa file.** `readSync` tại `size - readBytes` gần như chắc chắn rơi
   vào giữa một dòng — và giữa một ký tự UTF-8 nhiều byte. Dòng cụt đó bị loại thẳng.
4. **Đuôi đọc 2 MB → 8 MB** (`OPS_LOG_TAIL_BYTES` chỉnh được). Với đếm-theo-mtime, đọc bao nhiêu cũng
   ra số sai nên 2 MB là đủ; với đếm-theo-timestamp, đuôi quá ngắn thành **đếm thiếu** khi log đang
   phun mạnh. 8 MB + xoay log ở §2.2 giữ cửa sổ 60 phút nằm gọn trong phần đọc. Con số này là **cận
   dưới** — chỉ có thể báo thiếu, không bao giờ báo thừa.

`collectErrorLines()` ở `ops-alert-check.mjs` co lại thành một lời gọi uỷ quyền. **Không** đụng
`ops-alert-rules.mjs`: ngưỡng `errorLogWarn/Crit` giữ nguyên — cái sai là **phép đo**, không phải
ngưỡng.

### 2.2 Xoay log + chặn phình lặp lại

**Đo 2026-08-01:** `api.out.log` = **721 968 261 B (688 MB)** · `api.err.log` = 2 079 KB. Lấy mẫu 8 MB
giữa `api.out.log`: **99 %** là `RetentionCleanupJob` + `RetentionCleanupJobHandler` lặp lại. Service
NSSM `MediaOS-API` hiện **tắt hoàn toàn xoay log**:

```text
AppRotateFiles = 0   AppRotateOnline = 0   AppRotateBytes = 0   AppRotateSeconds = 0
```

⇒ hai file này **chưa từng được xoay** kể từ ngày cài. Bản vá 24/07 là cắt tay
(`api.err.log.2026-07-24-truncated-tail`) — chứng cứ cho thấy chuyện này đã xảy ra một lần và không có
cơ chế nào chặn nó lặp lại.

| Việc | Ở đâu |
| --- | --- |
| Bật xoay theo dung lượng cho cài mới | `scripts/windows/04-build-install-service.ps1` (4 dòng `nssm set`) |
| Áp cho service **đang chạy** + dọn định kỳ | `scripts/windows/08-log-rotate.ps1` (mới) |
| Ghi vào sổ vận hành | `RELEASE-09` §5 · `RELEASE-11` §6.2 (đăng ký task) |

`08-log-rotate.ps1` có hai chế độ, tách theo **quyền cần có** — đây là điểm thiết kế chính:

- **mặc định (KHÔNG cần Administrator)** — dọn: giữ `-Keep` bản xoay mới nhất mỗi luồng, cắt phần
  giữa của bản xoay vượt `-MaxFileMb` thành `.trimmed.log` (giữ đầu + đuôi, đúng khuôn bản vá 24/07 đã
  dùng). Chạy được từ Task Scheduler hằng ngày.
- **`-Configure` (CẦN Administrator)** — `nssm set` 4 tham số xoay rồi **restart service**. NSSM chỉ
  đọc tham số I/O lúc khởi động, nên không restart thì cấu hình nằm im trong registry; và chính lúc
  khởi động NSSM xoay ngay file đang vượt ngưỡng ⇒ đây cũng là đường xử lý file 688 MB hiện tại.

> ⚠️ `-Configure` làm **API PROD gián đoạn ~10-20 giây**. Không tự chạy trong phiên tự động — owner
> bấm, hoặc nó tự có hiệu lực ở lần deploy kế tiếp (deploy vốn restart service).

---

## 3. Thứ tự thi công (RED trước)

| # | Bước | Bằng chứng phải có |
| --- | --- | --- |
| 1 | `scripts/lib/ops-log-window.test.mjs` — ca lõi: file chứa **chỉ** dòng lỗi CŨ (ngoài cửa sổ) + `mtime` đặt về **HIỆN TẠI** ⇒ phải trả **0** | spec **ĐỎ trên code hiện tại** (chụp lại số nó trả về) |
| 2 | `scripts/lib/ops-log-window.mjs` | spec xanh |
| 3 | Nối vào `ops-alert-check.mjs` | `node scripts/ops-alert-check.mjs` trên PROD ⇒ nhóm "Lỗi ứng dụng trong log" = `ok`, **7 nhóm còn lại giữ nguyên kết luận** |
| 4 | Gắn spec vào `harness/check.sh` + `.github/workflows/api.yml` | test mới thật sự chạy ở CI (bài học: *spec không nằm trong lệnh chạy = spec không tồn tại*) |
| 5 | `08-log-rotate.ps1` + 4 dòng `nssm set` ở `04` | chạy chế độ dọn (không admin) ⇒ báo cáo trước/sau |
| 6 | `RELEASE-09` §3/§5 · `RELEASE-11` §6.2 | bảng rule #5 mô tả đúng phép đo mới |

### Ca test bắt buộc

| Ca | Kỳ vọng |
| --- | --- |
| Dòng lỗi CŨ + `mtime` MỚI *(chính là lỗi PROD)* | `0` |
| Dòng lỗi MỚI + `mtime` CŨ *(âm tính giả)* | đếm đủ |
| Dòng `ERROR` không có timestamp | không tính |
| Stack trace nhiều dòng dưới 1 tiêu đề `ERROR` | tính **1** |
| Trộn `LOG`/`WARN`/`DEBUG` cùng cửa sổ | chỉ đếm `ERROR` |
| Ranh giới 12:00:00 AM / 12:00:00 PM | AM ⇒ giờ 0 · PM ⇒ giờ 12 |
| Đúng mốc cắt (`ts == cutoff`) | tính (biên đóng) |
| File không tồn tại | `null` (⇒ `unknown`, không phải `0`) |
| Đuôi cắt giữa dòng | dòng cụt bị bỏ |

---

## 4. Ngoài phạm vi — nói rõ để không ai tưởng đã sửa

| Việc | Vì sao không làm ở WO này |
| --- | --- |
| `RetentionCleanupJob` log 3 dòng mỗi nhịp ở mức `LOG`/`DEBUG` trên PROD | đụng `apps/api/**`, ngoài `paths`. Xoay log đã chặn hậu quả. **Đề xuất** đưa vào `RELEASE-14` — WO này KHÔNG tự ghi vào đó |
| Lỗi `assertWorkerRoleSafe` 30/07 sinh 755 dòng | sự cố đã đóng; WO này chỉ sửa **phép đếm** |
| Log có cấu trúc JSON (KI-009) | đã có mã riêng, `S3`, không chặn go-live. JSON log sẽ khiến việc parse này thành một dòng `JSON.parse` |
| Ngưỡng `errorLogWarn=20 / Crit=200` | giữ nguyên — cái hỏng là phép đo, không phải ngưỡng. Đổi ngưỡng lúc này sẽ che mất bằng chứng bản vá có tác dụng |

---

## 5. Rủi ro

| Rủi ro | Chặn bằng |
| --- | --- |
| Nest đổi định dạng timestamp ⇒ **mọi** dòng thành không-parse-được ⇒ luôn `0` = mù âm thầm | `parseLogTimestamp` có spec riêng bám đúng chuỗi thật lấy từ log PROD; §6 dưới ghi cách kiểm lại bằng tay |
| Đuôi 8 MB vẫn không phủ hết cửa sổ khi phun log cực mạnh | đếm là **cận dưới** (chỉ thiếu, không thừa) + xoay log giữ file nhỏ |
| `-Configure` restart PROD sai lúc | mặc định KHÔNG chạy; cần cờ tường minh + Administrator; ghi cảnh báo ngay đầu script |
| Xoá nhầm log còn giá trị điều tra | không xoá thẳng: cắt thành `.trimmed.log` giữ **đầu + đuôi**, đúng khuôn bản vá 24/07 |

## 6. Kiểm lại bằng tay khi nghi ngờ

```bash
# Số dòng lỗi thật trong 60 phút gần nhất, không qua script cảnh báo:
node -e "const{countErrorLinesInFile}=await import('./scripts/lib/ops-log-window.mjs');\
console.log(countErrorLinesInFile('logs/api.err.log',{nowMs:Date.now(),windowMin:60}))" --input-type=module

# Dòng ERROR mới nhất trong file (phải khớp với kết luận ở trên):
grep -a 'ERROR' logs/api.err.log | tail -1
```
