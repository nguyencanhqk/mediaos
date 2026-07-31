# RELEASE-13 — SUPPORT FAQ & TRIAGE (HANDOFF-009)

> Work Order **`S6-GOLIVE-1`** · `IMP09-HANDOFF-009` · `IMP09-IN-016`
> Người nhận: **đội hỗ trợ / người trực hypercare** · Soạn: 2026-07-31 · build tham chiếu `1.0.0-rc.1`
> Quy trình gốc (kênh · ngưỡng phản hồi · escalation): [`RELEASE-09`](RELEASE-09_Monitoring_Alerting_Support_Readiness.md) §6 — tài liệu này là **nội dung**, không định nghĩa lại quy trình.
>
> **Luật số 1 của trang này:** phần lớn "lỗi" người dùng báo **không phải lỗi** — mà là phân quyền đang
> chạy đúng, hoặc thao tác sai màn hình. Loại trừ theo thứ tự ở §3 trước khi báo động.

---

## 1. Phân loại nhanh (làm trong 60 giây đầu)

| Dấu hiệu | Mức | Làm gì ngay |
| --- | --- | --- |
| **Không ai** đăng nhập được · trang trắng toàn hệ thống | **P0** | `m prod-status` + `node scripts/ops-alert-check.mjs` → cân nhắc rollback (`RELEASE-08` §5) |
| Nghi **lộ dữ liệu** (thấy dữ liệu của người/phòng ban khác) | **P0** | Chụp màn hình + `request_id`, báo owner NGAY, **không** bảo người dùng thử lại |
| Nghi **mất dữ liệu** (bản ghi biến mất) | **P0** | Kiểm `/system/audit-logs` + thùng rác Console `/recycle-bin` trước khi kết luận |
| Một module hỏng, phần còn lại chạy | **P1** | Phản hồi trong 4 giờ làm việc; ghi `RELEASE-02` |
| **Một người** gặp vấn đề, người khác bình thường | **P2** | Gần như luôn là phân quyền / phiên / trình duyệt — xem §3 |
| Giao diện xấu · thiếu nhãn · sai chính tả | **P3/P4** | Ghi backlog, không làm gián đoạn |

> "Một người gặp, cả nhóm không gặp" gần như **không bao giờ** là sự cố hệ thống. Đừng leo thang sớm.

---

## 2. Mẫu tiếp nhận (dán vào kênh hỗ trợ)

```text
[LỖI] <một dòng mô tả>
Người báo:            <tên · vai trò>
Thời điểm:            <ngày giờ>
Ứng dụng:             <app funtimemediacorp.com | console | auth | train>
Màn hình / thao tác:  <đường dẫn trên thanh địa chỉ, bấm gì>
Kết quả thấy:         <thông báo lỗi NGUYÊN VĂN>
Kết quả mong đợi:     <đáng lẽ ra gì>
Ảnh chụp:             <đính kèm>
request_id:           <nếu màn hình có hiện>
Có lặp lại không:     <có/không>
Người khác có bị không: <có/không/chưa hỏi>
```

**Ba trường quyết định tốc độ xử lý:** `request_id` · **đường dẫn đầy đủ** · **người khác có bị không**.
Thiếu ba cái này thì mọi chẩn đoán chỉ là đoán.

`request_id` có trong **mọi** phản hồi của hệ thống và là khoá lần ngược tới đúng dòng log máy chủ.

---

## 3. Loại trừ theo thứ tự (làm trước khi kết luận "hệ thống lỗi")

1. **Đúng ứng dụng chưa?** Quản trị nằm ở `console.`, nghiệp vụ ở apex. "Không thấy menu" thường là
   đang đứng nhầm app.
2. **Đăng xuất → đăng nhập lại.** Quyền vừa cấp chỉ vào phiên mới. Đây là cách sửa cho phần lớn ca
   "tôi có quyền rồi mà vẫn không vào được".
3. **Người khác cùng vai có bị không?** Không → vấn đề của riêng tài khoản/thiết bị đó.
4. **Thử cửa sổ ẩn danh.** Loại trừ cache/extension trình duyệt.
5. **Xem `ops-alert-check`.** Nếu tất cả `ok` thì hạ tầng đang lành.

---

## 4. Câu hỏi thường gặp

### 4.1 Đăng nhập

**"Sai email hoặc mật khẩu" dù tôi chắc là đúng**
Nhiều khả năng tài khoản đã bị **khoá tạm thời** do nhập sai quá số lần (`ACCOUNT_LOCKED`). Chờ hết thời
gian khoá, hoặc nhờ Admin mở. Bảo người dùng **ngừng thử lại** — mỗi lần thử làm khoá lâu thêm.

**Đăng nhập xong bị đá về trang đăng nhập ngay**
Thường là cookie: trình duyệt chặn cookie bên thứ ba, hoặc đồng hồ máy lệch giờ nhiều. Thử cửa sổ ẩn
danh; kiểm giờ hệ thống của máy.

**Hiện 403 `TWO_FACTOR_SETUP_REQUIRED` ở mọi màn hình**
Không phải hỏng. Tài khoản thuộc vai **bắt buộc 2FA** nhưng chưa bật. Vào `/me/security/2fa` bật là hết.

**Không tắt được 2FA — báo `TWO_FACTOR_ENFORCED`**
Đúng thiết kế: vai của tài khoản đó bắt buộc 2FA. Muốn tắt thì phải đổi vai — việc của Admin.

**Mất điện thoại chứa mã 2FA**
Dùng **mã khôi phục** đã lưu lúc bật. Không còn → nhờ Super Admin gỡ 2FA cho tài khoản đó.

**Mã 2FA báo sai dù nhập đúng**
Hai nguyên nhân: (1) đồng hồ điện thoại lệch — bật đồng bộ giờ tự động; (2) nhập mã của **cửa sổ 30 giây
trước**. Chờ mã mới rồi nhập.

### 4.2 Quyền & hiển thị

**"Tôi không thấy nhân viên/phòng ban X"**
Gần như luôn là **phạm vi dữ liệu** đúng như thiết kế. Quản lý thấy nhóm mình, HR thấy phạm vi được cấp.
Cần rộng hơn thì Admin chỉnh cặp quyền + phạm vi ở Console `/system/permissions`.

**"Một số ô hiện `***` hoặc trống"**
Che dữ liệu nhạy cảm **do máy chủ** — nội dung đó không hề được gửi về máy người dùng. Không phải lỗi
hiển thị, và không "F5 cho hiện ra" được.

**"Tôi được cấp quyền rồi mà vẫn 403"**
Đăng xuất → đăng nhập lại. Nếu vẫn 403, kiểm ở Console `/system/permissions` xem cặp quyền đã gắn đúng
**phạm vi** chưa — có quyền nhưng sai phạm vi vẫn bị chặn.

**"Người này ghi được mà đọc không được" (hoặc ngược lại)**
Là lệch cặp quyền đọc/ghi. Báo Admin đối chiếu cả hai cặp cho cùng phạm vi.

### 4.3 Chấm công & nghỉ phép

**Quên chấm công**
Không sửa trực tiếp được. Gửi **đơn điều chỉnh công** ở `/attendance/adjustment-requests/new`, có lý do,
chờ duyệt.

**"Tôi không duyệt được đơn của chính mình"**
Đúng thiết kế, chặn ở máy chủ. Nhờ người duyệt khác.

**Số ngày phép hiển thị sai**
Xem `/leave/me/balances`, mở lịch sử giao dịch để biết cộng/trừ từ đâu. Số dư là kết quả của sổ giao
dịch — nếu sổ đúng mà số dư sai thì mới là lỗi thật, khi đó báo P1 kèm ảnh chụp cả hai.

**Nghỉ đã duyệt nhưng bảng công vẫn tính vắng**
Đồng bộ chạy nền, không tức thì. Quá một ngày làm việc mà chưa phản ánh → báo P2.

### 4.4 Thông báo

**Không nhận được thông báo cho vài sự kiện chấm công**
Hạn chế đã biết `KI-021` — 3 sự kiện ATT có trong danh mục nhưng chưa có nơi phát. Không phải lỗi máy
người dùng, và **không có workaround** ngoài việc xem trực tiếp trên màn hình liên quan.

**Bấm thông báo không nhảy đúng chỗ**
Chụp màn hình + `request_id` → P2.

### 4.5 Tệp & hình ảnh

**Tải tệp lên báo lỗi / ảnh đại diện không hiện**
Kiểm dung lượng và định dạng trước. Nếu đúng chuẩn mà vẫn lỗi → có thể là kho lưu trữ; người trực kiểm
`node scripts/ops-alert-check.mjs` và log máy chủ.

### 4.6 Đào tạo (LMS)

**`train.` bắt đăng nhập lại / không vào được**
LMS dùng **đăng nhập một lần** từ hệ thống chính. Đăng nhập ở `funtimemediacorp.com` trước rồi mở lại
`train.`. LMS **không** có đường đăng nhập riêng — đó là chủ ý.

---

## 5. Người trực: kiểm tra hệ thống

```powershell
m prod-status
```

```bash
node scripts/ops-alert-check.mjs                 # 8 nhóm: backend · DB · migration · job · log · đĩa · backup · TLS
curl -s http://localhost:3100/api/v1/health      # data.build = đang chạy bản nào
```

Log: `logs\api.err.log` · `logs\api.out.log` · `logs\ops-alerts.log`.

**Cách đọc `ops-alert-check`:**

| Kết quả | Nghĩa |
| --- | --- |
| `ok` | Có đo được và đạt |
| `warn` | Có đo được, chưa đạt ngưỡng |
| `crit` | Có đo được, hỏng |
| **`unknown`** | **KHÔNG có dữ liệu để đo** — coi NẶNG hơn `ok`, đừng bỏ qua |

> `unknown` nguy hiểm hơn `warn`: nó nghĩa là bạn đang **mù** ở mục đó, không phải mục đó ổn. Chính luật
> này đã phát hiện ra chuyện hệ thống chưa từng có bản backup nào (`KI-050`).

---

## 6. Hạn chế đã biết — trả lời được ngay, không cần điều tra

| Người dùng nói | Thực tế | Mã |
| --- | --- | --- |
| "Không nhận thông báo chấm công" | 3 sự kiện ATT chưa có nơi phát | `KI-021` |
| "Có xem được phiếu lương không?" | Chưa có — Phase 2 | — |
| "Có app điện thoại không?" | Chưa — dùng trình duyệt di động | — |
| "Chat trong hệ thống?" | Chưa — Phase 4 | — |
| "Đặt phòng họp / quản lý tài sản?" | Chưa — Phase 3 | — |
| "Widget số lượng nhân sự thấy cả phòng ban khác" | Đếm-số-lượng xuyên phòng ban, rủi ro đã được chấp nhận có chữ ký | `KI-012` |

Danh sách đầy đủ: [`RELEASE-02`](RELEASE-02_Known_Issues_MVP.md).

---

## 7. Khi nào leo thang

| Tình huống | Leo thang tới | Trong bao lâu |
| --- | --- | --- |
| P0 (sập · lộ dữ liệu · mất dữ liệu) | Owner — ngay lập tức | phản hồi < 1 giờ |
| P1 (một module chính hỏng, có workaround) | Owner | < 4 giờ làm việc |
| P2 trở xuống | Ghi `RELEASE-02`, xử theo backlog | — |
| Nghi vấn bảo mật ở bất kỳ mức nào | Owner — **không** thảo luận chi tiết trên kênh chung | ngay |

> Với nghi vấn bảo mật: **đừng dán ảnh chụp chứa dữ liệu người khác lên kênh chung** — làm vậy là biến
> một sự cố nghi ngờ thành một sự cố có thật.

---

## 8. Trong hypercare (T+0 → T+7)

- `ops-alert-check` tự chạy mỗi 10 phút (sau khi owner đăng ký lịch — `RELEASE-11` §6.2).
- Chạy `release-smoke` 2 lần/ngày.
- Mọi vấn đề mới ghi vào `RELEASE-02` kèm mức + workaround + chủ.
- **Điều kiện thoát:** 0 `S0`/`S1` mở · không `crit` trong 48 giờ liên tục · smoke PASS 3 lần liên tiếp
  (`RELEASE-09` §6.3).
