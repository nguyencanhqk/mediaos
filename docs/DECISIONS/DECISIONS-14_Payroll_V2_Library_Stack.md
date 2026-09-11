# DECISIONS-14 — Ba thư viện của wave S15-PAYROLL-V2: `decimal.js` · Recharts · `pdfmake`

> **Trạng thái:** ĐÃ CHỐT (owner ký PAY-DEC-011..020 ngày **2026-09-02**; ADR viết **2026-09-11** bởi WO
> `S15-PAYROLL-DOC-1`).
> **Thi công:** `S15-PAYROLL-BE-2`/`BE-3` (`decimal.js`) · `S15-PAYROLL-FE-4` (Recharts) ·
> `S15-PAYROLL-BE-5` (`pdfmake`).
> **Liên quan:** `DECISIONS-02` (Khoá stack & 3 bất biến) · `CLAUDE.md` §4 (bảng stack) ·
> [SPEC-11 §3.9 · §13.6 · §19.1](<../SPEC/SPEC-11 PAYROLL.md>) ·
> [kế hoạch wave S15](<../plans/S15-PAYROLL-V2-WAVE.md>).
>
> ⚠️ **Cả ba thư viện CHƯA CÀI.** ADR này chốt **lựa chọn**; lệnh `pnpm add` nằm ở WO thi công.

---

## 1. Vì sao ADR này tồn tại — một PHÉP ĐO, không phải một sở thích

Đo ngày **11/09/2026**:

```bash
grep -rniE "recharts|pdfmake|decimal" docs/DECISIONS/    # → 0 hit
```

**Không ADR nào trong repo nói gì về ba thư viện này.** Trong khi đó
[`docs/plans/S15-PAYROLL-V2-WAVE.md`](<../plans/S15-PAYROLL-V2-WAVE.md>) §3 (PAY-DEC-018) viết về Recharts:

> _"Biểu đồ: **cài Recharts** (đã chốt stack DECISIONS, chưa cài)."_

**Câu đó dẫn nguồn sai.** Nguồn thật của "Recharts" là bảng stack ở `CLAUDE.md` §4
(`Charts | Recharts + Tremor`) — **không phải** bộ `DECISIONS/`. Câu dẫn sai đã được sửa trong chính wave
plan cùng WO này (trỏ về DECISIONS-14).

Hai lý do phải **mở ADR** thay vì để nguyên:

1. Hồ sơ **wave** có vòng đời của một wave; quyết định **stack** sống lâu hơn thế. Để một quyết định stack
   sống duy nhất trong hồ sơ wave là chỗ sinh ra đúng lớp lỗi "dẫn nguồn sai" ở trên.
2. `decimal.js` và `pdfmake` **chưa hề** xuất hiện ở bất kỳ bảng stack nào — `CLAUDE.md` §4 không nhắc,
   `DECISIONS-02` không nhắc. Không ADR = không nơi nào giải thích **vì sao**, và WO sau sẽ hỏi lại từ đầu
   (hoặc tệ hơn: tự đổi sang thư viện khác giữa wave).

---

## 2. Quyết định 1 — `decimal.js` cho số học TIỀN ở TypeScript

### 2.1 Bối cảnh — PAY-DEC-012 đẩy số học lên TS

PAY-DEC-012 **đảo một phần** PAY-DEC-004 ("tiền tính ở SQL"): công thức thành phần lương do **người dùng
định nghĩa** (SPEC-11 §13.6), nên cộng/trừ/nhân/chia và làm tròn chuyển lên TS. Ba thứ **ở lại SQL** —
clamp `net ≥ 0`, CHECK, bất biến tổng (SPEC-11 §3.9).

Ràng buộc cứng của bài toán:

| Ràng buộc | Nguồn |
| --- | --- |
| `numeric` từ driver `pg` về JS là **chuỗi** — một `parseFloat` ở giữa là mất chính xác **vĩnh viễn** | SPEC-11 §3.9 · §13.6 F |
| Làm tròn tiền `ROUND_HALF_UP`, **scale 2**; phép trung gian giữ **scale 10** | SPEC-11 §13.6 F |
| Tràn `numeric(18,2)` phải bắt **trước** khi bind xuống SQL ⇒ 422 `PAYROLL-ERR-020` | SPEC-11 §13.6 F |
| Gross-up NET là vòng lặp ≤ 30 vòng/dòng — sai số tích luỹ qua vòng lặp là hỏng **âm thầm** | SPEC-11 §13.8 · §19.1 |

### 2.2 Các phương án đã cân nhắc

|  | Hướng | Kết |
| --- | --- | --- |
| **A** | `Number` (float64) của JS | **LOẠI.** Mất chính xác thập phân ngay ở phép đầu tiên (`0.1 + 0.2`). Nguy hiểm hơn cả sai số: **ca test toàn số tròn vẫn XANH** — hỏng chỉ lộ ra ở dữ liệu thật, trên phiếu lương thật. Đây là lý do SPEC-11 §3.9 **cấm tường minh** `Number` trên mọi giá trị tiền. |
| **B** | `BigInt` scaled (lưu ×100 hoặc ×10⁶) | **LOẠI.** Đúng về toán nhưng **cồng kềnh**: mọi phép nhân/chia phải tự rescale, và `BigInt` **không có** hàm làm tròn tiền — `ROUND_HALF_UP` ở scale 2 phải tự viết. Một hàm làm tròn tự viết trong vùng crown là một bề mặt lỗi mới, không phải một khoản tiết kiệm. |
| **C** | Giữ tính ở SQL (`numeric`), TS chỉ điều phối | **LOẠI.** Công thức là **dữ liệu người dùng nhập** ⇒ muốn chạy ở SQL thì phải **viết compiler công thức → SQL**. Chi phí ~×3, và kết quả **không audit được** như AST đi trên evaluator (không chỉ ra được node nào ra số nào). Thêm nữa: nối chuỗi công thức người dùng vào SQL là bề mặt injection ngay giữa vùng crown. |
| **D** | **`decimal.js`** | **CHỌN.** Thập phân độ chính xác tuỳ ý; nhận **chuỗi** vào thẳng constructor (`new Decimal(str)` — đúng thứ driver `pg` trả về); có `ROUND_HALF_UP` là chế độ làm tròn dựng sẵn; `precision`/`rounding` đặt **một chỗ**. |

> **Vì sao `decimal.js` chứ không phải anh em cùng họ** (`big.js` · `bignumber.js` · `decimal.js-light`):
> chọn bản **đầy đủ** vì evaluator cần cả `ROUND_*` dựng sẵn lẫn các phép ngoài bốn phép cơ bản
> (`MIN`/`MAX`/`ROUND`/`ABS`/`CEIL`/`FLOOR` là hàm trong grammar — SPEC-11 §13.6 A). Bản "light" tiết kiệm
> vài KB nhưng đổi lấy việc tự cài mấy hàm đó — đúng thứ phương án B bị loại vì nó.

### 2.3 Ràng buộc thi công (bắt buộc, không phải khuyến nghị)

1. **Cấu hình một chỗ duy nhất**: `Decimal.set({ rounding: Decimal.ROUND_HALF_UP, … })`. Hai chỗ cấu hình
   khác nhau = hai quy tắc làm tròn trong cùng một phiếu lương.
2. **Cấm `Number` / `parseFloat` / `+str` trên mọi giá trị tiền**, từ lúc đọc khỏi driver tới lúc bind trả
   lại. Cần **census/ratchet** cho điều cấm này — một điều cấm sống trong văn xuôi là một điều cấm sẽ trôi.
3. **Làm tròn ĐÚNG MỘT LẦN, ở một chỗ**: giá trị mỗi thành phần về scale 2 **ngay khi ghi** vào
   `component_values_json`; trung gian giữ scale 10 (SPEC-11 §13.6 F).
4. **FE dùng decimal.js để HIỂN THỊ, không để tính lại**. Số hiển thị đến từ server; FE format (VND,
   `tabular-nums`), không cộng trừ lại.

### 2.4 Điều ADR này **KHÔNG** hứa

`decimal.js` **không** thay được chốt cuối ở DB. Clamp `net ≥ 0` (`GREATEST(…, 0)`), CHECK `≥ 0`, và bất
biến `SUM(payslip_items.amount) = gross − deduction + adjustment` **ở lại SQL** (SPEC-11 §3.9,
`clamp-must-be-sql-not-js`). Đọc ADR này thành "tính ở TS rồi thì clamp ở TS cũng được" là **đọc sai**, và
là cách đọc sai đắt nhất của cả wave.

---

## 3. Quyết định 2 — **Recharts** cho biểu đồ

### 3.1 Bối cảnh — PAY-DEC-018

`PAY-SCREEN-015` "Tổng quan `/payroll`" là **6 khối biểu đồ** (phân bố mức lương · cơ cấu thu nhập · ngân
sách gauge · chi phí theo thời gian · thu nhập BQ theo thời gian · thu nhập BQ theo đơn vị), cộng widget
DASH `PAYROLL_BUDGET` (SPEC-11 §10.1b).

### 3.2 Trạng thái đo được 11/09/2026 — "có trong bảng stack" ≠ "đã cài"

| Đo | Kết quả |
| --- | --- |
| `CLAUDE.md` §4 | `Charts \| Recharts + Tremor` — **đã nằm trong bảng stack từ trước** |
| `grep '"recharts"' --include=package.json` (trừ `node_modules`) | **một** hit: `apps/lms/package.json:82` = `2.15.4` |
| `pnpm-workspace.yaml` | loại **tường minh** `apps/lms` (`- "!apps/lms"`) và `apps/fbpost` khỏi workspace |

⇒ Bản `recharts` đang tồn tại **nằm NGOÀI pnpm workspace của MediaOS**: nó có lock riêng, `pnpm install` ở
root không đụng tới, và **`pnpm audit` của cổng Security không quét nó**. Với `apps/app`, Recharts **chưa
cài** — và bản của `apps/lms` **không** tái dùng được.

### 3.3 Các phương án đã cân nhắc

|  | Hướng | Kết |
| --- | --- | --- |
| **A** | Tự vẽ SVG 6 loại biểu đồ | **LOẠI.** Sáu loại biểu đồ tự vẽ = một thư viện biểu đồ viết tay không ai bảo trì, chưa kể trục/tooltip/responsive/a11y. Wave plan §3 ghi đúng cái giá này ở cột "nếu không". |
| **B** | **Tremor** (bảng stack `CLAUDE.md` §4 ghi kèm) | **Không dùng ở wave này.** Tremor là **lớp component dựng TRÊN** thư viện vẽ, không thay thế nó; thêm một tầng phụ thuộc cho 6 khối biểu đồ là chi phí không có lợi ích rõ. Để mở cho wave sau — ADR này **không** bác Tremor, chỉ không kéo nó vào S15. |
| **C** | Thư viện biểu đồ thương mại (Highcharts / AG Charts Enterprise) | **LOẠI.** Bẫy license — cùng đúng lý do `CLAUDE.md` §4 đã loại MUI X Pro / AG Grid Enterprise. |
| **D** | **Recharts** | **CHỌN.** Đã ở trong bảng stack (không mở stack mới), MIT, React-native-composable, đủ cho cả 6 khối + gauge. |

### 3.4 Ràng buộc thi công

1. **Cài vào `apps/app`** (bên **trong** pnpm workspace). **Không** mượn bản ở `apps/lms` — xem §5.
2. **Recharts là lớp VẼ, không phải lớp QUYỀN.** Cổng của `PAY-SCREEN-015/016` là
   `('view','payroll-report')` **+ SÀN scope `Company`** + audit, ép ở **server** (SPEC-11 §9.1). Không có
   dữ liệu thì không có gì để vẽ — đó mới là cổng.
3. Widget DASH dùng cặp **`is_sensitive`** ⇒ FE gác bằng `useCanExact`, **không** `<PermissionGate>`
   (SPEC-11 §10.1b, `sensitive-pair-widget-needs-usecanexact`).

---

## 4. Quyết định 3 — **`pdfmake`** cho PDF phiếu lương (font Việt **NHÚNG**)

### 4.1 Bối cảnh — PAY-DEC-019

PDF phiếu lương sinh ở **server**, tải qua **signed-URL** của file-service; cặp `('export','payroll')` cho
batch, **Own** cho phiếu của chính mình (SPEC-11 §11.3 — **không cấp cặp mới** `export:payslip-pdf`).

### 4.2 Ràng buộc SỐNG-CÒN: font Việt phải NHÚNG

> Rơi về font mặc định ⇒ phiếu lương **mất dấu tiếng Việt**. Không exception, không log, không ca test nào
> đỏ — **hỏng thầm lặng**, và thứ hỏng là chứng từ lương gửi cho từng nhân viên.

⇒ Font `Be Vietnam Pro` / `Roboto` **nhúng vào tệp PDF** (vfs), và QA có **ca đối chiếu chuỗi có dấu đọc
lại từ PDF sinh ra** (SPEC-11 §19.1). Đây là điều kiện hiệu lực, không phải "nên làm".

### 4.3 Các phương án đã cân nhắc

|  | Hướng | Kết |
| --- | --- | --- |
| **A** | `puppeteer` / headless Chrome render HTML → PDF | **LOẠI.** Kéo **cả một trình duyệt** vào runtime của `apps/api` (dung lượng, bề mặt CVE, sandbox). Quá nhiều cho một chứng từ một trang. |
| **B** | `pdfkit` | **LOẠI.** Thấp hơn một tầng: phải **tự layout bảng** (phiếu lương = bảng khoản mục). Tự layout bảng là chỗ mất dấu/tràn cột lộ ra muộn nhất. |
| **C** | `@react-pdf/renderer` | **LOẠI.** Kéo React vào runtime **backend** cho một việc không có UI. |
| **D** | **`pdfmake`** | **CHỌN.** Tài liệu mô tả bằng **JSON** (`docDefinition`) — hợp với "sinh từ snapshot"; có `table`/`columns` dựng sẵn; **font nhúng là API tường minh** (vfs), tức yêu cầu §4.2 là một bước khai báo thấy được trong code, không phải một mặc định ngầm. |

### 4.4 Ràng buộc thi công

1. **Sinh từ SNAPSHOT** (`payslips` + `payslip_items`), **KHÔNG tính lại** (SPEC-11 §19.1). Số trong PDF
   phải bằng số trong phiếu — mãi mãi, kể cả sau khi công thức của mẫu bị sửa.
2. Trần: **< 1,5s** một phiếu (`PAYROLL-API-083/084`); **batch ≤ 2.000 phiếu** chạy nền → signed-URL
   (`085`); vượt trần ⇒ **422 `PAYROLL-ERR-031`**.
3. **Không cấp cặp quyền mới** cho PDF (PAY-DEC-019 đã ký đường khác) — cấp thêm ở đây là **đảo một quyết
   định owner đã ký**.

---

## 5. License + cổng SCA — điều kiện chung của cả BA

| Thư viện | License | Vào runtime nào | WO cài |
| --- | --- | --- | --- |
| `decimal.js` | **MIT** | `apps/api` (evaluator công thức, engine luật định, gross-up) | `S15-PAYROLL-BE-2`/`BE-3` |
| `recharts` | **MIT** | `apps/app` (PAY-SCREEN-015/016 + widget) | `S15-PAYROLL-FE-4` |
| `pdfmake` | **MIT** | `apps/api` (PDF phiếu lương) | `S15-PAYROLL-BE-5` |

**Cổng SCA của repo** = job `dependency-scan` trong `.github/workflows/security.yml`
(`pnpm audit --audit-level=high`, FAIL ở `high|critical`), là **required status check** của `master` —
auto-merge chỉ squash sau khi nó xanh.

> ⚠️ **Hai bẫy ĐO ĐƯỢC, không phải giả định:**
>
> 1. **`pnpm audit` chỉ thấy cây của pnpm workspace.** `pnpm-workspace.yaml` loại **tường minh**
>    `apps/lms` và `apps/fbpost` ⇒ dep cài ở hai chỗ đó **nằm ngoài tầm quét của cổng**
>    (`sca-gate-blind-to-lms-and-fbpost`). Đây chính là lý do bản `recharts@2.15.4` ở
>    `apps/lms/package.json:82` **không tính là "đã có"** — ba thư viện này phải cài vào `apps/api` /
>    `apps/app`, **trong** workspace, để cổng nhìn thấy chúng.
> 2. **Repo chặn gói vừa phát hành** (`minimumReleaseAgeExclude` ở `pnpm-workspace.yaml`) ⇒ pin bản **đã
>    đủ tuổi**. Nếu buộc dùng một bản mới (ví dụ bản vá bảo mật), phải thêm vào danh sách miễn trừ **cùng
>    lượt**, nếu không `pnpm install` từ chối **chính bản đã vá**.

Cả ba là dep **MỚI** ⇒ WO thi công chạy `pnpm audit --audit-level=high` tại chỗ **trước khi mở PR**. Đỏ thì
xử lý theo khuôn `overrides` đang có trong `pnpm-workspace.yaml` (range-scoped, ghi rõ đường tới và có/không
vào runtime bundle), **KHÔNG suppress GHSA** — owner đã bác cách đó ngày 25/07/2026 ("luôn vá, không ỉm").

---

## 6. Điều kiện — ADR này CHỈ có hiệu lực khi thi công kèm đủ bốn thứ

1. **`decimal.js`**: census/ratchet **cấm `Number`/`parseFloat` trên đường tiền**, **cộng** ca fixture cố ý
   lẻ (`1.005` · `0.385` · lương `19.999.999,99` — SPEC-11 §13.6 F). Fixture toàn số tròn làm ca này
   **xanh-RỖNG**, tức là tệ hơn không có ca.
2. **`pdfmake`**: ca QA **đọc lại PDF sinh ra** và đối chiếu **chuỗi có dấu**. Không có ca này thì mất dấu
   là lỗi **im lặng** đúng nghĩa — đến tay nhân viên mới lộ.
3. **Recharts**: cổng quyền của `PAY-SCREEN-015/016` nằm ở **server** (cặp + sàn scope `Company` + audit).
   Thư viện vẽ **không** là cổng, và không được viện nó làm cổng.
4. **Cả ba**: nằm **trong** pnpm workspace + `pnpm audit --audit-level=high` xanh.

Thiếu (1) hoặc (2) ⇒ hai lớp lỗi **im lặng nhất** của cả wave — mất chính xác tiền, và mất dấu trên chứng
từ lương — không có ai bắt. Người review FULL gate đọc §6 này trước.
