# S5-LMS-BE-4 — Job đối soát LMS chỉ ghi audit khi CÓ THAY ĐỔI THẬT

> Zone: **red** (diff chạm audit) · Gate: **FULL** = `security-reviewer` + `database-reviewer` +
> `silent-failure-hunter` + `santa-method` (tiêu đề chứa "audit" ⇒ regex crown bắn — `harness/policy.md:12`;
> vòng 3 header ghi thiếu 2 reviewer) · Track: **PR** (trừ §3C đi track LOCAL)
> depends_on: `S5-LMS-BE-1` (đã ship #261) · Nguồn: phát hiện lúc verify PROD sau khi owner restart API 2026-07-23
> Owner chốt phương án **(2)**: LMS trả số thay đổi → MediaOS chỉ audit khi khác 0.

---

## 1. Vấn đề (đo trên PROD, không phải suy đoán)

`LmsUserSyncJobHandler` ghi **1 dòng `audit_logs` mỗi lần chạy**, mà scheduler chạy mọi
`@SystemJobHandler` **mỗi 60 giây** (`worker-scheduler.service.ts:79-83`, không có lịch riêng per-job).

Đo lúc 07:01 UTC 23/7 trên DB `mediaos`:

- `LMS_USER_SYNC`: 47 lần chạy / 47 phút, lần nào cũng `Success total=45 ok=45 fail=0`
- `audit_logs` `lms_sync/lms_user_sync`: **47 dòng / 47 phút** → **1.441 dòng/ngày ≈ 526.000 dòng/năm**
- Toàn bộ `audit_logs` hiện chỉ có 5.080 dòng ⇒ trong ~4 ngày rác này sẽ vượt mọi audit thật

**Gốc rễ — ý định lệch code:** [`lms-user-sync.job-handler.ts:89`](../../apps/api/src/integrations/lms/lms-user-sync.job-handler.ts)
comment ghi _"Audit summary (chỉ khi có việc thật)"_ nhưng điều kiện là `if (total > 0)`.
`total` = **số user trong công ty** (luôn 45), KHÔNG phải số thay đổi ⇒ điều kiện luôn đúng.

**Vì sao nghiêm trọng hơn bloat thường:** `audit_logs` **append-only theo BẤT BIẾN #2** — app role
không có DELETE/UPDATE. Rác này **không dọn được** bằng retention job trong luật hiện hành.

> Ghi nhận công bằng: BE-1 làm ĐÚNG mẫu được chỉ định (`task-reminder.job-handler.ts`). Đây là hệ quả
> kiến trúc lộ ra khi chạy thật, không phải lỗi ẩu của WO đó.

## 2. LMS đã trả sẵn số liệu cần

`POST /api/admin/sync-users` (`apps/lms/app/api/admin/sync-users/route.ts:61-109`) trả:
`{ ok, summary: { created, existing, reactivated, deactivated, skipped } }`

- **Thay đổi THẬT** = `created` + `reactivated` + `deactivated`
- **Không đổi gì** = `existing` + `skipped`

MediaOS đang vứt đi vì `LmsHttpClient.syncUsers()` khai `Promise<void>` và cố ý không đọc body.

### 2.1 QUAN SÁT THẬT — response bắt được từ bản LMS ĐANG CHẠY

Gọi thật `POST http://localhost:3400/api/admin/sync-users` (NSSM `MediaOS-LMS`) ngày 2026-07-23 với
payload 1 user đang active (⇒ rơi vào nhánh `existing` route.ts:84-86 = **chỉ đếm, KHÔNG ghi gì**):

```text
HTTP 200
{"ok":true,"summary":{"created":0,"existing":1,"reactivated":0,"deactivated":0,"skipped":0}}
```

⇒ Bản đang chạy **có** trả `summary`, đúng shape source. Đây là quan sát, không phải suy từ mốc build.
Bất biến tổng nghiệm đúng: `0+1+0+0+0 = 1 = users.length`.

### 2.2 SUY RA (mô phỏng route.ts:68-107 trên dữ liệu PROD, KHÔNG phải response quan sát được)

Số nền lấy từ truy vấn thật: PG `mediaos` (đúng query job handler) + SQLite `apps/lms/data/app.db`.

| Chỉ số | Giá trị | Nguồn |
| --- | --- | --- |
| MediaOS gửi mỗi nhịp | **45** user = 34 `active` + 11 `inactive` (đã nghỉ) | đo (PG) |
| LMS tổng user | **36**, `disabled_at NOT NULL`: **0** | đo (SQLite) |
| summary mỗi nhịp | `created=0 existing=34 reactivated=0 deactivated=0 skipped=11` | **suy ra** |
| **`changed`** | **0** | **suy ra** |

⇒ **Trên dữ liệu HÔM NAY, phương án này chặn được đúng 100% audit rác.** 11 người đã nghỉ
KHÔNG có tài khoản LMS nên rơi vào nhánh `skipped` (route.ts:104-106), không phải `deactivated`.

> Đính chính (plan-review vòng 1): bản đầu tôi ghi ví dụ `{existing:45, skipped:0}` dưới mục tự nhận
> là "đo trên PROD" — đó là **ví dụ bịa, chưa đo**. Số thật là 34/11.
> Đính chính (plan-review vòng 2): hàng `summary` ở bảng trên là **suy ra**, không phải response
> quan sát được; response quan sát được nằm ở §2.1.

### 2.3 BOM HẸN GIỜ — `deactivated` KHÔNG idempotent (plan-review BLOCKING #1)

Nhánh vô hiệu hoá của LMS **không kiểm `existing.disabled_at`** (`route.ts:91-103`):

```ts
} else if (existing) {
  await sqlite.run("DELETE FROM sessions WHERE user_id = ?", [existing.id]);
  await sqlite.run("UPDATE users SET password_hash = ?, disabled_at = COALESCE(disabled_at, ?), ...");
  summary.deactivated += 1;      // ← tăng KỂ CẢ khi user đã disabled từ lâu
}
```

`COALESCE(disabled_at, ?)` cho thấy tác giả biết nhánh này chạy lặp, nhưng counter vẫn tăng vô điều kiện.
Kịch bản chắc chắn xảy ra: **một nhân viên ĐANG có tài khoản LMS nghỉ việc** →

1. Nhịp đầu: `deactivated=1`, `disabled_at` được set → `changed=1` → **audit ĐÚNG, cần giữ**
2. Mọi nhịp sau: vẫn `deactivated=1` → `changed=1` **vĩnh viễn** → audit lại 1 dòng/60s

⇒ Lợi ích của WO bốc hơi **vĩnh viễn** ngay lần nghỉ việc đầu tiên của người có account LMS.
Tác hại phụ: mỗi phút LMS chạy `DELETE FROM sessions` + `hashPassword()` =
`scryptSync` **đồng bộ, chặn event-loop Next** (`apps/lms/lib/platform/auth/password.ts:7-10`).

**⇒ WO này BẮT BUỘC gồm cả vá phía LMS (track LOCAL).** Không vá = ship một quả bom hẹn giờ.
**CẤM** phương án "bỏ `deactivated` khỏi `changed`": khoá tài khoản là sự kiện an ninh quan trọng
NHẤT của luồng này, mất audit ở đó là hỏng đúng thứ cần giữ.

## 3. Thay đổi

### A. `lms-http-client.service.ts` — trả summary thay vì `void`

```ts
/**
 * LUẬT KIỂU (plan-review vòng 3 BLOCKING #1): MỌI field CHỈ được `number` hoặc `boolean`.
 * CẤM `string` vĩnh viễn — đây là thứ chặn đường body-text LMS lọt vào `metadata` audit_logs
 * (append-only, không xoá được) và `system_job_runs.error_message`.
 *
 * PHÂN HOẠCH per-user (6 counter, tổng === users.length):
 *   THAY ĐỔI  : created + reactivated + deactivated   → vào `changed`
 *   KHÔNG ĐỔI : existing + skipped + alreadyDisabled  → KHÔNG vào `changed`, NHƯNG VÀO tổng
 */
export interface LmsSyncSummary {
  created: number; reactivated: number; deactivated: number;
  existing: number; skipped: number;
  /** HỢP ĐỒNG (không phải field lạ) — user vốn ĐÃ khoá từ trước, LMS không ghi gì thêm. §3C. */
  alreadyDisabled: number;
  /** true khi KHÔNG đọc/parse được summary → caller PHẢI fail-safe (coi như có thể có thay đổi). */
  unknown: boolean;
}
```

> **Vá vòng 3 BLOCKING #1 — bản vá vòng 2 mới áp một nửa.** Vòng 2 sửa phần chữ (luật 4 nói "6 trường")
> nhưng khối interface chuẩn tắc này — thứ implementer copy — vẫn khai **5** counter. Ai copy khối cũ sẽ
> cộng 5 counter, `5 < users.length` ngay khi có 1 người đã khoá ⇒ `unknown:true` **mỗi nhịp** ⇒ đúng quả
> bom cũ đội tên mới. Nay khối code và phần chữ đã khớp.

Luật đọc body (giữ **BẤT BIẾN #3**) — 4 luật, luật 2 và 3 là must-fix từ plan-review:

1. CHỈ đọc body ở **success path** (`res.ok`). Error path (`!res.ok`) **giữ nguyên** — không đọc,
   không log (body lỗi có thể vọng lại email).
2. **Body-read nằm trong `try/catch` RIÊNG, tách khỏi `try` bọc `fetch`.** Lý do (plan-review #4):
   `AbortSignal.timeout(10s)` tạo trước `fetch` **vẫn còn hiệu lực** khi đọc body ⇒ gộp chung sẽ biến
   một `AbortError` lúc đọc body (LMS **đã áp thành công**) thành `LMS sync network error` → cả lô bị
   đếm `failed` → `resultStatus: "Failure"` SAI. **Luật cứng: 2xx = thành công, KHÔNG BAO GIỜ bị hạ
   cấp thành failure vì lý do đọc body.**
3. **Catch của body-read chỉ log CHUỖI CỐ ĐỊNH**, ví dụ `"LMS sync: không đọc được summary (shape lạ)"`.
   **CẤM `err.message`, CẤM object lỗi.** Lý do (plan-review #3): V8 sinh
   `SyntaxError: Unexpected token 'x', "<body…>" is not valid JSON` — **message CHỨA tiền tố body**.
   Đường ống hiện có sẽ nuốt nó vào 2 nơi bền: `job-handler.ts:81-84` `logger.warn(...${message})`,
   và nếu lan lên JobRunner → `system_job_runs.error_message` (scrubber `job-error-scrubber.ts:17-24`
   chỉ che `key=value` + credential-in-URL, **KHÔNG che email**).
4. Whitelist **6** trường (`created`, `existing`, `reactivated`, `deactivated`, `skipped`,
   **`alreadyDisabled`**), nhận khi `Number.isInteger(v) && v >= 0`, thiếu → 0, field ngoài whitelist
   → **bỏ qua im lặng (KHÔNG bật `unknown`)**.
   **Kiểm bất biến tổng trên ĐỦ 6 counter** `=== users.length` — lệch ⇒ `unknown: true`.

   **Counter CÓ MẶT nhưng sai kiểu** (`created:"3"`, `-1`, `1.5`, `NaN`) ⇒ **set `unknown = true` TƯỜNG
   MINH ngay tại chỗ**. Phân biệt rõ hai ca: *vắng mặt* → 0 (tương thích ngược với LMS bản cũ);
   *có mặt nhưng không thoả `Number.isInteger(v) && v >= 0`* → `unknown`.

   > **Vá vòng 4 BLOCKING #2 — logic vòng 4 của tôi SAI, và sai về hướng nguy hiểm.** Vòng 4 viết "coi
   > như 0 **và vì thế** tổng sẽ lệch ⇒ `unknown`". Suy luận đó chỉ đúng với fixture đã chọn. Phản ví dụ
   > plan-review đưa ra, tôi kiểm lại thấy đúng: `{deactivated:"1", skipped:1, alreadyDisabled:1}` với
   > `users.length = 2` → hạ `deactivated` về 0 → tổng parse `0+1+1 = 2 === 2` ⇒ **`unknown:false`,
   > `changed:0`** ⇒ **một lần KHOÁ TÀI KHOẢN THẬT không để lại dòng audit nào**. Đây là mất-dấu-vết
   > (nguy hiểm hơn thừa-dấu-vết) — đúng thứ WO này phải bảo vệ. Không được dựa vào phép trừ tổng để suy
   > ra lỗi kiểu; phải bắt tại chỗ.

   > **Vá plan-review vòng 2 BLOCKING #1 — chính hai bản vá của tôi đá nhau.** Bản trước tính bất
   > biến trên 5 counter, trong khi §3C thêm counter thứ 6 `alreadyDisabled` lấy user RA KHỎI 5
   > counter kia ⇒ tổng 5 < `users.length` ⇒ `unknown:true` **mỗi nhịp** ⇒ `shouldAudit` luôn true
   > ⇒ **1 dòng audit/60s vĩnh viễn** — bom cũ chỉ đổi tên. Câu "thứ tự deploy không quan trọng"
   > cũng SAI: vấn đề không ở cửa sổ deploy mà ở **trạng thái ổn định sau khi cả hai track đã lên**.
   >
   > **Luật hợp đồng (ghi vào cả 2 phía):** `alreadyDisabled` là **HỢP ĐỒNG**, KHÔNG phải field lạ;
   > nó thuộc nhóm "không đổi" cùng `existing`/`skipped`. LMS chỉ được thêm counter **NGOÀI phân
   > hoạch per-user** (vd tổng thời gian); counter **thuộc phân hoạch** phải cập nhật whitelist
   > MediaOS **trong cùng thay đổi**. LMS bản cũ không gửi `alreadyDisabled` → mặc định 0 →
   > tổng 6 vẫn `=== users.length` ⇒ **tương thích ngược thật**, không phải tương thích bằng lời.

⚠️ **Object trả về phải DỰNG TỪ WHITELIST, CẤM spread body** (`{...body.summary}`): nếu spread, một
`unknown:true` do LMS gửi kèm sẽ **ghi đè cờ do MediaOS tự tính** — cờ fail-safe không được để nguồn
ngoài điều khiển.

`normalizeSummary()` đặt **trong `LmsHttpClient`** (không rải `?? {unknown:true}` ở handler) ⇒ mọi
caller nhận đúng một shape, `silent-failure-hunter` không phải chất vấn nhánh undefined rải rác.

Hai nhánh nhỏ nhưng bắt buộc:

- `users.length === 0` (`lms-http-client.service.ts:39` đang `return;`) → trả summary toàn 0,
  `unknown: false`. Không được trả `undefined`.
- **Handler PHẢI coi giá trị trả về `undefined`/`null` là `unknown: true`** trước khi đụng field.
  Nếu không, `TypeError` sẽ bị **`catch` sẵn có nuốt** (`job-handler.ts:78-85`) → đếm nhầm
  `failed += batch.length` + `resultStatus:"Failure"` sai. Đây là đường ngụy trang lỗi lập trình
  thành lỗi mạng — đúng thứ `silent-failure-hunter` sẽ chặn.

### B. `lms-user-sync.job-handler.ts` — cộng dồn + audit có điều kiện

```ts
// Gộp qua các lô. ĐỊNH NGHĨA CỨNG (vá vòng 4 BLOCKING #1) — 3 trạng thái lô, KHÔNG chồng lấn:
//   lô THROW           → failed += batch.length        (KHÔNG set unknown — đó là lỗi mạng/HTTP)
//   lô ok, parse ĐƯỢC  → cộng 6 counter vào tổng
//   lô ok, parse KHÔNG → anyUnknown = true, counter của lô này BỊ BỎ (không cộng vào đâu cả)
const changed = t.created + t.reactivated + t.deactivated;   // CHỈ từ các lô parse được
const abnormal = failed > 0 || anyUnknown;
```

> **Vá vòng 4 BLOCKING #1 — `changed` đi vòng qua trần.** Vòng 4 cộng `changed` từ counter **vô điều
> kiện**, trong khi trần §3B1 chỉ áp cho nhánh `abnormal`. Kịch bản durable (và **rất dễ** xảy ra vì
> `apps/lms` không CI/không VCS/không vào diff PR): ai đó sửa tay `route.ts` nửa vời ⇒ tổng lệch ⇒
> `unknown:true`, **đồng thời** `deactivated=1` mỗi nhịp ⇒ `changed=1` mỗi nhịp ⇒ **audit mỗi 60s quay
> lại nguyên vẹn**, tệ hơn nữa là dòng audit mang nhãn `auditPhase:'changed'` nên **trông hợp lệ**, không
> ai đi điều tra. Đúng lớp lỗi mà §3B1 tuyên bố đã bịt.
>
> ⇒ Counter của lô `unknown` **KHÔNG được cộng vào đâu** (kể cả `metadata`): số không đọc hiểu được thì
> không phải dữ liệu, đưa vào metadata chỉ tạo con số sai để người sau tin nhầm. `metadata.unknown=true`
> đã nói đủ rằng các counter là **thiếu** (under-count) — ghi rõ trong §3B để người đọc audit không nhầm.

### B1. Hai nhánh fail-safe PHẢI có trần (vá vòng 3 BLOCKING #3)

Bản vòng 3 dùng `shouldAudit = failed > 0 || changed > 0 || t.unknown`. Sai lầm: `failed`/`unknown` là
**TRẠNG THÁI BỀN**, không phải sự kiện — nên hai nhánh này **tự tái tạo đúng quả bom đang đi gỡ**:

- `failed > 0`: LMS chết / 4xx bền → [`job-handler.ts:75-86`](../../apps/api/src/integrations/lms/lms-user-sync.job-handler.ts) đếm `failed`
  **mỗi nhịp** → audit mỗi 60s. Đường này **chắc chắn xảy ra ngay trong chính WO này**: §3C bắt buộc
  `next build` + NSSM restart LMS ⇒ có cửa sổ connection-refused.
- `unknown`: `apps/lms` không CI/không VCS ⇒ drift shape là kịch bản thường trực. **1 lần drift = audit
  mỗi 60s vĩnh viễn**, và `audit_logs` append-only nên không xoá được.

"WARN 1-lần-per-process" KHÔNG bound audit (nó chỉ bound log).

**Luật: audit bất thường theo CHUYỂN TRẠNG THÁI + trần thời gian, per-company, giữ trong process.**

```ts
/** Literal union — CẤM khai `string` (xem "Vì sao literal union" bên dưới). */
type AuditPhase = "changed" | "abnormal" | "recovered";

const ABNORMAL_REAUDIT_MS = 60 * 60 * 1000;                  // trần: tối đa 1 dòng/giờ/company khi bám lỗi
private readonly abnormalAuditedAt = new Map<string, number>(); // companyId → ts dòng audit bất thường gần nhất

const now = Date.now();   // KHAI TƯỜNG MINH — test 24 dùng vi.setSystemTime; performance.now() sẽ làm nó xanh-giả
const last = this.abnormalAuditedAt.get(companyId);
const wasAbnormal = last !== undefined;

// (1) QUYẾT ĐỊNH — thuần đọc, KHÔNG đụng state.
let auditPhase: AuditPhase | null = null;
if (changed > 0) auditPhase = "changed";
else if (abnormal && (!wasAbnormal || now - last >= ABNORMAL_REAUDIT_MS)) auditPhase = "abnormal";
else if (!abnormal && wasAbnormal) auditPhase = "recovered";

// (2) GHI TRƯỚC, cập nhật state SAU — thứ tự này là bắt buộc (vá vòng 4 BLOCKING #3).
if (auditPhase !== null) {
  await this.db.withTenant(companyId, (tx) => this.audit.record(tx, { /* … */ }));
  // Chỉ tới đây mới coi là "đã có dấu vết". audit.record ném ⇒ state KHÔNG đổi ⇒ nhịp sau audit lại.
  if (abnormal) this.abnormalAuditedAt.set(companyId, now);
  else this.abnormalAuditedAt.delete(companyId);
}
```

> **Vá vòng 4 BLOCKING #3 — trần đánh dấu "đã audit" TRƯỚC khi audit thật sự ghi.** Bản vòng 4
> `set(companyId, now)` nằm trong khối quyết định, tức **trước** `audit.record`. Nếu `record` ném (DB
> nghẽn, hoặc `object_type='lms_sync'` chưa có vì DB lệch mig 0509 — memory
> `dev-online-db-migration-drift` cho thấy DB lệch migration là chuyện có thật), kết quả là: **không có
> dòng audit nào, nhưng Map đã ghi "vừa audit xong"** ⇒ suy giảm im lặng về không-dấu-vết suốt 1 giờ.
> Đúng thứ `silent-failure-hunter` sẽ chặn ở gate. Nay state chỉ đổi **sau khi ghi thành công**.
>
> **Vì sao `abnormal` + `changed>0` cùng lúc vẫn `set()`:** dòng audit đó mang `fail`/`unknown` nên **đã
> là** dấu vết của sự cố — đánh dấu để không ghi thêm dòng `abnormal` trùng lặp ngay nhịp sau.
>
> **Vì sao literal union, không phải `string`** (phản biện của plan-review vòng 4, tôi đồng ý): rủi ro
> không nằm ở "kiểu string" mà ở **XUẤT XỨ**. Khai `AuditPhase` là literal union khiến một chuỗi lấy từ
> body LMS **không thể gán vào được** — trình biên dịch thành người gác. Khai `string` thì mất lớp gác đó.

| Ca | Audit? | Lý do |
| --- | --- | --- |
| `changed > 0` | ✅ mỗi lần | có việc thật — bị chặn tự nhiên bởi số thay đổi thật, KHÔNG cần trần |
| `abnormal` lần đầu (ok→lỗi) | ✅ 1 dòng | sự cố PHẢI có dấu vết |
| `abnormal` bám dai | ✅ **≤1 dòng/giờ** | vẫn thấy được "còn lỗi", nhưng có trần |
| `abnormal` → hết (lỗi→ok) | ✅ 1 dòng `recovered` | đóng ngoặc sự cố |
| toàn `existing`/`skipped`/`alreadyDisabled` | ❌ | không có gì xảy ra |

`auditPhase` (hằng nội bộ, **không** phải dữ liệu ngoài) vào `metadata` để phân biệt 3 loại dòng.

> **Ngoại lệ phải ghi cho người đọc audit** (cảnh báo vòng 4): nhịp hồi phục mà **đồng thời** có
> `changed>0` thì dòng đóng-ngoặc mang nhãn `'changed'`, **không có dòng `'recovered'` riêng**. Vẫn đọc
> được hết lỗi qua `fail=0`/`unknown=false` trên chính dòng đó. Đừng giả định "mọi sự cố đều có dòng
> `recovered` đóng lại" khi viết truy vấn/cảnh báo về sau.

**Trần thật sự là bao nhiêu:** xấu nhất 24 dòng/ngày/company khi LMS chết liên tục (so với 1.440), cộng
**1 dòng mỗi lần restart API** — `Map` nằm trong process nên restart làm mất trạng thái và audit lại 1 lần.
Chấp nhận có ý thức: bị chặn bởi số lần restart, và mất-thừa-1-dòng an toàn hơn mất-dấu-vết. PROD chạy
**một** service NSSM nên không có chuyện N instance nhân bản dòng; nếu sau này scale-out thì trần thành
24×N/ngày — vẫn bounded, ghi lại đây để người sau không phải suy lại.

**Restart-loop KHÔNG khai thác được thành audit-mỗi-phút** (bằng chứng, không phải khẳng định chay —
plan-review vòng 4 kiểm giúp): `worker-scheduler.service.ts:134-137` cho thấy nhịp đầu chỉ chạy **SAU**
trọn `intervalMs`. API restart nhanh hơn chu kỳ ⇒ job **không chạy lần nào** ⇒ không sinh audit nào.

**Bằng chứng per-run KHÔNG mất:** `system_job_runs` ghi **mọi** nhịp kèm status (§3D) — đó mới là nơi đọc
"job có chạy không", `audit_logs` chỉ trả lời "có gì thay đổi / có sự cố mới không".

> **GIẢ ĐỊNH CẦN OWNER XÁC NHẬN (câu hỏi mở vòng 3):** giả định là **không có yêu cầu tuân thủ nào đòi
> dấu vết "job đã chạy" nằm trong `audit_logs`** — `system_job_runs` là đủ. Đây là giả định hợp lý cho hệ
> nội bộ N=1 và là tiền đề của cả WO; nếu owner nói ngược lại thì **toàn bộ hướng "giảm ghi audit" sai** và
> phải quay về phương án giãn nhịp (§3E) thay vì lọc điều kiện. Ghi ra để không ai phải đoán về sau.

**Chống suy biến im lặng (plan-review #5)** — `unknown` phải ĐO ĐƯỢC, nếu không hệ thống lặng lẽ
quay về 1 audit/phút mà không ai phân biệt "audit vì có thay đổi" với "audit vì mù":

- `unknown` vào **audit `metadata`**
- `unknown` + `created/reactivated/deactivated` vào **`JobRunResult.metadata`** → chảy xuống
  `system_job_runs` qua `job-runner.ts:119-126` (đã mask sẵn). Điều này cũng làm luận điểm §3C
  ("`system_job_runs` gánh nhịp job") **có nội dung thật**, chứ không chỉ `total/ok/fail`
- **WARN log 1-lần-per-process** khi `unknown` (mẫu `warnedDisabled`
  [`lms-user-sync.bridge.ts:24,44-49`](../../apps/api/src/integrations/lms/lms-user-sync.bridge.ts) — vòng 3
  gọi nhầm là `bridge.ts`, **file thật tên `lms-user-sync.bridge.ts`**; đừng tạo file mới)

`metadata` CHỈ ĐẾM + cờ: `{total, ok, fail, created, reactivated, deactivated, unknown, auditPhase}` —
KHÔNG email, KHÔNG chuỗi ngoài (`auditPhase` là 1 trong 3 hằng `changed|abnormal|recovered`).

> **Lưu ý người đọc audit — `created/reactivated/deactivated` là UNDER-COUNT trong 2 ca** (không phải
> bug, nhưng đọc nhầm con số thì thành kết luận sai):
>
> 1. `failed > 0` — lô lỗi không có summary nên không đóng góp gì.
> 2. `unknown = true` — counter của lô parse-không-được **bị bỏ hoàn toàn** (§3B luật 3 trạng thái lô).
>
> Cả hai đều đã có cờ tương ứng (`fail`, `unknown`) ngay trên cùng dòng ⇒ luôn tự phát hiện được.
>
> **Hệ quả của trần (§3B1) cần biết khi viết truy vấn/cảnh báo:** trong cửa sổ trần 1 giờ đang
> `abnormal`, một thay đổi thật rơi vào lô parse-không-được sẽ **không có dòng `lms_sync` riêng** cho tới
> khi hết trần hoặc hồi phục. Chấp nhận được — dòng `abnormal` đã báo "lớp sync đang mù", và audit **gốc**
> của hành động (HR đổi trạng thái / admin khoá user) nằm ở AUTH/HR chứ không ở đây.
>
> **Ca đối xứng:** dòng `'recovered'` có thể xuất hiện **không kèm** dòng `'abnormal'` nào trước đó —
> khi nhịp bất thường ấy đã được ghi dưới nhãn `'changed'`. Đừng ghép cặp abnormal↔recovered 1-1.

### C. `apps/lms` (track LOCAL) — `deactivated` idempotent

> **Lỗ hổng quy trình (plan-review vòng 2 BLOCKING #3):** `.gitignore:5-8` ignore `/apps/lms/`, và
> `apps/lms` KHÔNG có repo riêng ⇒ bản vá này **không bao giờ vào diff PR**: `security-reviewer` +
> `silent-failure-hunter` không nhìn thấy, CI không chạy, `git revert` không tồn tại. Thêm
> `apps/lms/**` vào `paths` chỉ tác động `guard-scope` (warn-only) — KHÔNG kéo file vào gate.
>
> **Bù bằng 4 việc bắt buộc:** (a) dán nguyên văn before/after ngay dưới đây để plan doc + mô tả PR
> trở thành **vật thể review được** — và dán **diff cuối cùng THỰC TẾ** (không phải diff dự kiến) vào body
> PR kèm 1 dòng xác nhận reviewer đã đọc; (b) sao lưu `route.ts` ra
> `c:\tmp\lms-route-sync-users.2026-07-23.bak` **TRƯỚC** khi sửa (đây là đường rollback duy nhất);
> (b2) sao lưu **DB** cùng lúc — nghiệm thu §6 **mutate DB**, không chỉ code, nên backup code một mình
> là rollback nửa vời (vá vòng 3 BLOCKING #4). ⚠️ **CẤM copy mình `app.db`** (vá vòng 4 BLOCKING #4):
> `connection.ts:23` bật `journal_mode = WAL` và trên đĩa **đang có thật** `app.db-wal` + `app.db-shm`
> ⇒ copy trần cho ra bản **rách/cũ**, và đặt một `app.db` cũ cạnh `-wal` đang sống có thể **làm hỏng DB**.
> Dùng một trong hai cách:
>
> ```bash
> # (1) ƯU TIÊN — không cần sqlite3 CLI, không cần quyền admin: dùng chính better-sqlite3 của LMS
> node -e "require('better-sqlite3')('apps/lms/data/app.db').backup('c:/tmp/lms-app.db.2026-07-23.bak')"
> # (2) nếu máy CÓ sqlite3 CLI:
> sqlite3 apps/lms/data/app.db ".backup 'c:/tmp/lms-app.db.2026-07-23.bak'"
> # (3) cuối: dừng NSSM MediaOS-LMS → copy CẢ 3 file (app.db, app.db-wal, app.db-shm) → chạy lại
> #     (cần quyền admin — UAC hay fail khi gọi từ tool, nên để cuối)
> ```
> (c) nghiệm thu tay 2-lần-gọi ở §6.

**TRƯỚC** (`route.ts:91-103`):

```ts
} else if (existing) {
  await sqlite.run("DELETE FROM sessions WHERE user_id = ?", [existing.id]);
  await sqlite.run(
    "UPDATE users SET password_hash = ?, disabled_at = COALESCE(disabled_at, ?), updated_at = ? WHERE id = ?",
    [hashPassword(randomBytes(24).toString("base64url")), new Date().toISOString(), new Date().toISOString(), existing.id],
  );
  summary.deactivated += 1;
} else {
  summary.skipped += 1;
}
```

**SAU**:

```ts
} else if (existing) {
  if (existing.disabled_at) {
    // Đã khoá bền từ trước → KHÔNG ghi lại: tránh scryptSync chặn event-loop + churn SQLite mỗi nhịp
    // job (60s). Counter riêng để MediaOS phân biệt "vừa khoá" với "vốn đã khoá" (S5-LMS-BE-4).
    summary.alreadyDisabled += 1;
  } else {
    await sqlite.run("DELETE FROM sessions WHERE user_id = ?", [existing.id]);
    await sqlite.run(
      "UPDATE users SET password_hash = ?, disabled_at = COALESCE(disabled_at, ?), updated_at = ? WHERE id = ?",
      [hashPassword(randomBytes(24).toString("base64url")), new Date().toISOString(), new Date().toISOString(), existing.id],
    );
    summary.deactivated += 1;
  }
} else {
  summary.skipped += 1;
}
```

Kèm `alreadyDisabled: 0` vào khởi tạo `summary` (route.ts:61-67).

**Bằng chứng bỏ `DELETE FROM sessions` mỗi nhịp là AN TOÀN** (không phải khẳng định suông — user
đã disabled không thể còn đường vào): `apps/lms/lib/platform/auth/auth.ts:151-154` xoá phiên ngay
lúc validate khi thấy `disabled_at` · `:243` chặn SSO · `:310` chặn sign-in · `:268` chặn reset
mật khẩu. Phiên cũ (nếu có) bị giết ở lần chạm đầu tiên, không cần job quét lại mỗi phút.

**Thứ tự deploy** (duyệt cả hai chiều): MediaOS trước → cửa sổ giữa 2 bước LMS bản cũ vẫn tăng
`deactivated` mỗi nhịp ⇒ WO **chưa có tác dụng** (không hỏng dữ liệu). LMS trước → vô hại (MediaOS
cũ bỏ body). **Không chiều nào hỏng; cái từng hỏng là TRẠNG THÁI CUỐI** — đã vá ở §3A luật 4.

### D. Không mất bằng chứng "job đã chạy"

`system_job_runs` ghi **mỗi** lần chạy (`job-runner.ts:109-126`, mọi tenant mọi nhịp; app role chỉ
`SELECT` — `migrations/0475:99-102`, retention KHÔNG xoá được). `audit_logs` chỉ giữ "có thay đổi
tài khoản". Đường đọc sẵn có: `GET /foundation/system-jobs[/:jobName/runs]` (quyền `view:foundation-job`).

⚠️ **Nhưng bảng này KHÔNG nằm trong `PROTECTED_TABLES`** (`retention.service.ts:43-73`) và **đã bị
purge tay 2026-07-22**. Nếu WO dọn tương lai xoá sạch thì "bằng chứng thay thế" biến mất.
**Chốt cửa sổ lưu tối thiểu: giữ ≥90 ngày cho `LMS_USER_SYNC`; row `Failed`/`Partial` giữ vĩnh viễn.**
Ghi ràng buộc này vào WO dọn khi seed.

### E. Biện pháp bổ trợ TỨC THÌ — 0 dòng code

`SYSTEM_JOBS_POLL_MS` **đã tồn tại** (`worker-scheduler.config.ts:23-41`). Đặt
`SYSTEM_JOBS_POLL_MS=900000` (15 phút) → giảm **15×** cả `audit_logs` lẫn `system_job_runs`
**ngay hôm nay**, độc lập với PR này. Việc của owner: sửa env + restart API.

**Đích danh file/service** (cảnh báo vòng 3 — memory `lms-env-pairing-and-ports` +
`prod-dist-shared-with-devonline`):

- **PROD** (NSSM, cổng 3100) đọc `.env.prod`. ⚠️ `m prod-env` **ghi đè** file này ⇒ nếu dùng lệnh đó thì
  phải thêm khoá vào **nguồn sinh**, không sửa tay file đầu ra rồi tưởng là xong.
- **dev-online** (cổng 3200) đọc `.env` riêng — **không** bị ảnh hưởng, và cũng **không** cần đổi (job LMS
  gate theo `LMS_COMPANY_ID`, dev-online không phải company LMS).
- **Verify BẮT BUỘC bằng log boot**, không tin giá trị đã gõ: `worker-scheduler.service.ts:82-84` in
  interval thật. Thấy `60000` = giá trị đã bị loại (ngoài biên `[1_000, 3_600_000]` → **rơi về DEFAULT**).
  `900000` nằm trong biên nên hợp lệ; `9000000` (thừa 1 số 0) thì **im lặng quay lại 60s**.

**Giãn nhịp KHÔNG làm chậm việc khoá tài khoản** (nêu trước để dập câu chất vấn hiển nhiên của
security-reviewer): đường khoá thời-gian-thực đi qua outbox →
[`lms-user-sync.bridge.ts:39-56`](../../apps/api/src/integrations/lms/lms-user-sync.bridge.ts), chạy theo
`outboxPollMs` **riêng**. Job 15 phút chỉ là lưới đối soát/self-heal, không phải đường chính.

> ⚠️ **Đính chính của tôi (plan-review vòng 2):** tôi đã mô tả cơ chế này là "clamp `[1s,1h]`" —
> **SAI**. `worker-scheduler.config.ts:37-39` **không clamp**: giá trị ngoài biên **rơi về DEFAULT
> 60_000**. Hậu quả thực tế: gõ thừa số 0 (`9000000`) → im lặng quay lại 60s trong khi tưởng đã đặt
> 15 phút. **Bắt buộc xác minh bằng log boot** `worker-scheduler.service.ts:83` (in interval thật)
> sau khi restart, không tin vào giá trị đã gõ.
>
> Đính chính 2: tôi viết "cả 4 job đều idempotent" — sai thuộc tính. Cái cần là **bất biến theo chu
> kỳ** (giãn nhịp không đổi kết quả). Kết luận vẫn đúng: `task-reminder.job-handler.ts:24,42-46,69-71`
> dùng cửa sổ 24h + `dedupeKey` theo NGÀY nên giãn 60s→15ph không đổi hành vi.

### F. Rủi ro TỒN DƯ đã cân nhắc và CỐ Ý không xử ở WO này

Nhánh `changed > 0` **không có trần theo thiết kế**, nên tính đúng đắn của nó dựa hoàn toàn vào việc
`apps/lms` idempotent — mà file đó không CI, không VCS, không vào diff PR. Plan-review vòng 4 đề xuất
thêm lưới: nếu `changed>0` với **bộ counter y hệt** ≥N nhịp liên tiếp → vẫn audit nhưng gắn cờ
`suspectNonIdempotent`. **Quyết định: KHÔNG làm ở WO này**, vì:

- WO đã qua 4 vòng plan-review và **mỗi vòng thêm cơ chế lại đẻ ra lỗ mới** (vòng 4: 4/5 BLOCKING là lỗ
  do chính bản vá vòng 3→4 tạo ra). Thêm state machine thứ hai lúc này là đánh đổi xấu.
- Đã có **hai** lớp bắt cùng kịch bản đó: §3C vá gốc + §6 bước 3 chứng minh idempotent tại thời điểm
  ship, và §6 verify PROD ("audit `lms_sync` đứng yên qua ≥3 nhịp") **chính là** phép đo đó chạy trên
  dữ liệu thật.

**Tín hiệu phát hiện nếu nó tái phát về sau** (ghi ra để không ai phải suy lại): dòng `lms_sync` có
`auditPhase='changed'` xuất hiện **mỗi nhịp** với **bộ counter không đổi** ⇒ LMS đã mất idempotent, quay
lại §3C. Một câu SQL đếm theo `metadata` là đủ, không cần cơ chế thường trú.

### Ngoài phạm vi (KHÔNG làm ở WO này)

Lịch riêng **per-job** cho scheduler (phương án 3 — `SYSTEM_JOBS_POLL_MS` là mức toàn cục, đủ dùng
trước mắt) · dọn 47.126 dòng `system_job_runs` (seed WO riêng, kèm ràng buộc §3D) · đụng
bridge/producer.

> **Quyết định có ý thức:** `LmsUserSyncBridge` (đường event thời-gian-thực, `bridge.ts:39-56`)
> **không ghi audit**. Sau WO này, tài khoản LMS được tạo/khoá qua bridge sẽ không để lại dấu
> `lms_sync` (job chạy sau chỉ thấy `existing`). Chấp nhận được vì hành động MediaOS gốc
> (HR đổi trạng thái / admin khoá user) **đã có audit riêng** ở AUTH/HR — `lms_sync` chỉ là dấu vết
> của lớp đồng bộ, không phải nguồn sự thật.

## 4. Rủi ro & cách chặn

| Rủi ro | Chặn |
| --- | --- |
| Đọc body làm rò email vào log | Chỉ đọc success path; whitelist **6** số + luật kiểu `number\|boolean` (CẤM `string`); **catch chỉ log chuỗi cố định, CẤM `err.message`** (§3A luật 3) |
| Fail-safe (`unknown`/`failed`) tự tái tạo audit-mỗi-phút | Trần theo chuyển-trạng-thái + ≤1 dòng/giờ/company (§3B1) — test 20–25 |
| 2xx bị hạ cấp thành Failure vì lỗi đọc body | `try` riêng cho body-read, tách khỏi `try` bọc `fetch` (§3A luật 2) |
| Mất audit khi LMS đổi shape response | `unknown: true` → **vẫn audit**, + ghi `unknown` vào audit metadata & `JobRunResult` & WARN 1 lần |
| Bridge gãy vì đổi kiểu trả về | Bridge `await` rồi bỏ giá trị (`bridge.ts:55`) — thêm giá trị trả về là tương thích ngược |
| Mock cũ trả `undefined` → nổ runtime khi đọc `s.created` | `normalizeSummary()` nằm TRONG `LmsHttpClient`; đồng thời **sửa mock ở 2 file spec** (`job-handler.spec.ts:16`, `test/integration/lms-user-sync.int-spec.ts:99-102,172,187,195`) trả summary thật — `http as never` khiến TS KHÔNG bắt được, phải sửa tay |
| Bom hẹn giờ `deactivated` | Vá LMS §3C — nếu KHÔNG vá thì WO vô nghĩa ngay lần nghỉ việc đầu của người có account LMS |
| Che mất sự cố "job chạy nhưng LMS không làm gì" | `failed>0` vẫn audit; `system_job_runs` giữ đủ nhịp + nay mang cả `created/…/unknown` |

## 5. Test (RED trước — CLAUDE.md §6)

Unit `lms-http-client.service.spec.ts`:

1. body hợp lệ → trả đúng 6 số, `unknown:false`
2. body `null`/không phải JSON → `unknown:true`, KHÔNG throw
3. `summary` thiếu hẳn → `unknown:true`
4. **field NGOÀI phân hoạch** (vd `durationMs: 12`) + đủ 6 counter khớp tổng → bỏ qua,
   `unknown` VẪN `false`
   > Vá vòng 2 BLOCKING #2: bản trước dùng "field lạ" chung chung với fixture vô hại nên **không
   > kiểm được** đúng counter mới duy nhất đã biết trước. Nay tách rõ 2 ca 4 và 4b.
4b. **`alreadyDisabled` là HỢP ĐỒNG**: `{created:0, existing:33, reactivated:0, deactivated:0,
    skipped:11, alreadyDisabled:1}` với `users.length=45` → `unknown:false` và `changed=0`
5. tổng **6** counter ≠ `users.length` → `unknown:true`; thêm ca `tổng > users.length` → `unknown:true`
5b. **counter sai kiểu → `unknown:true` TƯỜNG MINH**, KHÔNG throw. Fixture **BẮT BUỘC** gồm ca
    *"sai kiểu NHƯNG các counter còn lại vẫn khớp tổng"* — đây là ca **duy nhất** phân biệt được
    "bắt tại chỗ" với "suy ra từ phép trừ tổng" (bản vòng 4 sai chính ở đây):
    `{created:0, existing:0, reactivated:0, deactivated:"1", skipped:1, alreadyDisabled:1}` với
    `users.length = 2` → tổng parse = 2 = `users.length` mà **VẪN PHẢI** `unknown:true`.
    Thêm ca `-1` và `1.5` cho đủ biên.
6. `res.json` reject bằng `AbortError` → `unknown:true`, **KHÔNG throw** (2xx không bị hạ cấp)
7. catch body-read KHÔNG log `err.message`: spy `Logger.prototype.warn/error`, assert không lời gọi
   nào chứa nội dung body
8. `!res.ok` → vẫn throw **và KHÔNG đọc body**: spy `res.json`/`res.text` → `not.toHaveBeenCalled()`
   (spec cũ dòng 50-55 chỉ assert `rejects.toThrow(/HTTP 500/)` nên **không pin được gì** — phải nâng)
9. `users.length === 0` → summary toàn 0, `unknown:false`, KHÔNG gọi fetch

Unit `lms-user-sync.job-handler.spec.ts`:

10. summary toàn `existing`/`skipped` → **KHÔNG** gọi `audit.record` (test RED chính)
11. `created>0` → có audit, metadata mang `created`; `success` vẫn tăng đủ lô
12. `deactivated>0` → có audit
12b. **`reactivated>0` → có audit** (vá vòng 3: mở khoá tài khoản là sự kiện an ninh NGANG HÀNG
    `deactivated`; vòng 3 chỉ phủ `created`/`deactivated` nên counter này chưa có gì pin nó vào `changed`)
13. **đa lô** (≥2 lô: lô1 `created:1`, lô2 toàn `existing`) → cộng dồn đúng, 1 dòng audit
    (`BATCH_SIZE=100` mà PROD chỉ 45 user ⇒ nhánh cộng dồn KHÔNG BAO GIỜ chạy thật, phải test tay)
14. **lô hỗn hợp** (lô1 ok có `created:1`, lô2 throw) → đúng **1** audit, `resultStatus:"Failure"`,
    `created` vẫn giữ 1 (KHÔNG nuốt mất thay đổi)
15. summary `unknown` → có audit + `metadata.unknown === true`
16. `syncUsers` trả `undefined`/`null` → coi là `unknown`, **KHÔNG** đếm `failed` (chống nguỵ trang
    `TypeError` thành lỗi mạng qua catch `job-handler.ts:78-85`)
17. `JobRunResult.metadata` mang `created/reactivated/deactivated/unknown` (bản vá #5 phải có assert)
18. WARN `unknown` chỉ log **1 lần** dù chạy nhiều nhịp
19. metadata KHÔNG chứa `@` (không rò email) — giữ assert cũ

**Trần fail-safe (vá vòng 3 BLOCKING #3) — nhóm test bắt buộc, CÙNG một instance handler:**

20. **N nhịp liên tiếp `unknown`** (chạy `run()` 5 lần) → **ĐÚNG 1** lời gọi `audit.record`
20b. **`unknown:true` KÈM counter thay đổi khác 0** (`{deactivated:1, unknown:true}`), 5 nhịp cùng
    instance → **ĐÚNG 1** audit. Đây là test chốt của vá vòng 4 BLOCKING #1: test 20 dùng fixture
    counter=0 nên **KHÔNG phân biệt được** hai cách hiện thực (`changed` có lọc lô `unknown` hay không).
20c. **`audit.record` reject ở nhịp 1 → nhịp 2 VẪN gọi `audit.record`** (state chỉ đổi sau khi ghi
    thành công — pin vá vòng 4 BLOCKING #3)
21. **N nhịp liên tiếp `failed>0`** (syncUsers throw 5 lần) → **ĐÚNG 1** audit
22. **lỗi → hồi phục**: 2 nhịp `failed` rồi 1 nhịp sạch (toàn `existing`) → **2** audit tổng, dòng thứ 2
    có `metadata.auditPhase === "recovered"`; nhịp sạch TIẾP THEO → **không** thêm dòng nào
23. **hồi phục rồi lỗi lại** → audit lại ngay (state đã xoá, không bị trần chặn oan)
24. **trần thời gian**: `vi.setSystemTime` nhảy > `ABNORMAL_REAUDIT_MS` trong lúc vẫn `failed` → thêm
    đúng 1 dòng nữa
25. **`changed>0` KHÔNG bị trần chặn**: 3 nhịp liên tiếp đều `created:1` → **3** audit

**Test cô lập KHÔNG được nới (cảnh báo plan-review vòng 3):**

- `job-handler.spec.ts:41` và `int-spec:189` dùng `expect(res).toEqual({total:0,success:0,failed:0})` —
  đây là 2 assert ISOLATION mạnh nhất. **GIỮ NGUYÊN shape early-return** (`job-handler.ts:46`): CẤM thêm
  `metadata` vào nhánh early-return, CẤM hạ `toEqual` → `toMatchObject` để chiều metadata mới.
- `job-handler.spec.ts:76` `expect(entry.metadata).toEqual({total:2, ok:2, fail:0})` **chắc chắn vỡ** khi
  metadata nở ra. Phải **SIẾT** nó sang metadata đầy đủ mới (liệt kê đủ 8 khoá), **KHÔNG** đổi sang
  `toMatchObject` — `toEqual` ở đây chính là thứ chứng minh "metadata không có field lạ/không có email".

**Integration `test/integration/lms-user-sync.int-spec.ts` (Postgres thật, LANE_DB)** — vá vòng 2
BLOCKING #4. Hiện mock `mockResolvedValue(undefined)` (dòng 172/187/195) sẽ khiến `unknown:true` →
vẫn audit → assert `audits.length===1` (dòng 180) **vẫn xanh nhưng không còn chứng minh gì**:

- **TIỀN ĐỀ BẮT BUỘC — reset `audit_logs` giữa các test** (vá vòng 3 BLOCKING #2). `beforeEach`
  (`int-spec:81-91`) hiện **chỉ** `DELETE FROM outbox_events`; `audit_logs` chỉ được dọn ở `afterAll`
  qua `cleanupTenants` (`test/helpers/seed.ts:571,612`), còn `auditSummaries()` (`:163-169`) đếm
  **toàn bộ** dòng `lms_sync` của company A. Vitest chạy `it` theo thứ tự khai báo ⇒ **I9 ghi 1 dòng
  TRƯỚC I13** ⇒ I13 assert "0 dòng" sẽ **ĐỎ vì lý do sai**, và đường sửa dễ dãi nhất (hạ xuống
  `toBeGreaterThan`/đo delta) sẽ **xoá đúng thứ WO này tồn tại để chứng minh**. Thêm vào `beforeEach`:

  ```ts
  // audit_logs append-only với app role → dọn bằng `direct` (superuser), đúng mẫu cleanupTenants.
  await direct.query(`DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[])`, [
    [A.companyId, B.companyId],
  ]);
  ```

  ⚠️ **TUYỆT ĐỐI không** dọn qua `app` pool — app role KHÔNG có DELETE trên `audit_logs` (BẤT BIẾN #2);
  nếu thấy cần cấp quyền đó thì đã đi sai đường.
- **I9 phải đổi mock sang summary CÓ thay đổi** (`created:1`): sau WO này, mock cũ
  `mockResolvedValue(undefined)` → `unknown:true` → vẫn audit ⇒ I9 xanh **vì fail-safe**, không còn
  chứng minh điều nó tuyên bố ("job reconcile ghi audit").
- I13: mock trả `{created:0, existing:1, …, unknown:false}` → `audit_logs` `lms_sync` = **0 dòng**
  ← **đây là assert quan trọng NHẤT của cả WO**
- I14: mock trả `{created:1, …}` → **1 dòng** + `metadata.created === 1`, **và assert chéo-đường
  `system_job_runs.metadata.created === 1`** — đây chính là "bằng chứng thay thế" mà §3D viện dẫn;
  không assert thì luận điểm §3D không được pin bởi test nào (cảnh báo vòng 4)
- I15: **2 nhịp liên tiếp cùng trạng thái bất thường** (mock throw cả 2 lần, CÙNG một instance handler)
  → **ĐÚNG 1 dòng** audit (chứng minh trần §3B1 hoạt động trên DB thật, không chỉ trong unit mock)
- Sửa kiểu fake `int-spec:99-102` sang `Promise<LmsSyncSummary>` + cập nhật 3 mock nêu trên
  (TS KHÔNG bắt được vì `http as never` — phải sửa tay)

## 6. Done

- Job chạy khi không có thay đổi → `system_job_runs` +1, `audit_logs` **+0**
- **Nghiệm thu PHẢI chạy int-spec thật:** `bash harness/check.sh --lane-db`.
  `pnpm --filter @mediaos/api test` KHÔNG đủ — `test/integration/lms-user-sync.int-spec.ts:33` gate
  `hasDb && LANE_DB` nên assert dòng 180 bị **SKIP** ⇒ xanh-giả (memory
  `ci-skips-most-integration-specs` + `src-green-is-not-integration-green`).
  ⚠️ `REQUIRE_LANE_DB=1` **KHÔNG** thay thế được: `harness/check.sh:84,108` cho thấy nó chỉ escalate
  skip thành ĐỎ, **không provision DB** ⇒ không làm int-spec chạy.
- **Hai assert là điều kiện Done, nêu đích danh:** I13 (summary toàn `existing`/`skipped` →
  `audit_logs` `lms_sync` = **0 dòng** trên Postgres thật) và I14 (`created:1` → **1 dòng** +
  `metadata.created===1`). Không có 2 assert này thì int-spec xanh **vì lý do sai**.
- **Nghiệm thu tay phía LMS** (bù việc §3C không vào được CI/gate).
  ⛔ **CẤM dùng tài khoản nhân viên thật** (vá vòng 3 BLOCKING #4): LMS PROD đang có **36 user thật đang
  học**, mà nhánh `active:false` **xoá sạch session + xáo `password_hash`** ⇒ chạy thử trên người thật =
  đá họ ra giữa buổi học. Dùng **email tổng hợp KHÔNG tồn tại trong MediaOS**
  (`qa-be4-<ngày>@funtime.invalid` — TLD `.invalid` reserved, không thể trùng người thật):
  1. `POST` `{active:true}` → `created=1` (tạo account rác có kiểm soát)
  2. `POST` `{active:false}` → `deactivated=1`, **kiểm SQL `disabled_at IS NOT NULL`** (counter đúng
     KHÔNG chứng minh đã khoá thật)
  3. `POST` `{active:false}` lần nữa → `deactivated=0`, `alreadyDisabled=1`, và `users.updated_at`
     **KHÔNG đổi** so với bước 2
  4. **Dọn:** `DELETE FROM users WHERE email='qa-be4-…@funtime.invalid'` — ghi lại đã dọn, không để
     account rác nằm lại PROD. FK bật (`connection.ts:22`) ⇒ vướng bảng con thì xoá con trước.

  🔑 **Token:** gọi bằng biến env (`$MEDIAOS_SYNC_TOKEN`), **KHÔNG dán thẳng vào dòng lệnh** — history
  shell/log là nơi secret hay rò nhất (BẤT BIẾN #3).
- Verify PROD sau deploy: đếm `audit_logs` `lms_sync` **đứng yên** qua ≥3 nhịp job, trong khi
  `system_job_runs` vẫn tăng
- FULL gate **đủ 4** (`security-reviewer` + `database-reviewer` + `silent-failure-hunter` +
  `santa-method`) PASS · typecheck xanh — đồng bộ với header, vòng 3 ghi thiếu 2 ở mục này
- ~~Khi seed WO dọn `system_job_runs`: chép sang ràng buộc…~~ **ĐÃ XONG (vòng 4):** ràng buộc "giữ
  ≥90 ngày cho `LMS_USER_SYNC` + giữ vĩnh viễn row `Failed`/`Partial`" nay có chủ — WO
  **`S5-SYS-CLEAN-1`** (`depends_on: S5-LMS-BE-4`), seed trong cùng thay đổi này. Không còn mồ côi.

> Lưu ý người đọc `system_job_runs`: ca proxy trả **200 kèm HTML** (LMS chưa làm gì) → theo luật 2
> vẫn tính `success` + `unknown:true` ⇒ `status='Success'` dù LMS không áp gì. Phân biệt bằng
> `metadata.unknown`.

## 7. Rollback

**MediaOS (PR):** revert commit. Không migration, không backfill, không feature-flag, không đổi
schema (`object_type='lms_sync'` đã có trong union từ mig 0509; `metadata` là jsonb; không quyền mới).

**LMS (LOCAL, KHÔNG có VCS):** khôi phục `route.ts` từ bản sao lưu bắt buộc ở §3C(b)
`c:\tmp\lms-route-sync-users.2026-07-23.bak` → `next build` → NSSM restart. **Không có bản sao lưu này
thì KHÔNG có đường lùi** — phải tạo trước khi gõ dòng sửa đầu tiên.

**⚠️ Dọn dữ liệu sau §6 — THỨ TỰ BẮT BUỘC** (vá vòng 4 BLOCKING #4): restore `app.db` **KHÔNG** phải
bước 1. `app.db` chứa **tiến độ học của 36 người thật**; restore nguyên DB sẽ **xoá sạch mọi tiến độ kể
từ mốc backup** — "rollback" gây thiệt hại lớn hơn chính sự cố.

1. **Xoá có mục tiêu** account QA (§6 bước 4) — đây là đường dọn ĐÚNG cho 99% trường hợp.
   FK phía LMS bật (`connection.ts:22` `foreign_keys = ON`) ⇒ vướng bảng con (sessions/enrollment/
   progress) thì xoá bảng con trước; ghi lại đã dọn những gì.
2. Restore toàn bộ `app.db` từ §3C(b2): **phương án CUỐI**, chỉ khi DB thật sự hỏng cấu trúc, và phải
   báo trước vì mất dữ liệu học.

**⚠️ LUẬT CẶP — lùi lệch chiều là hỏng im lặng** (cảnh báo vòng 3): vòng 3 chỉ xét revert từng phía riêng.
Lùi **LMS một mình** (giữ MediaOS mới) → LMS cũ lại tăng `deactivated` mỗi nhịp ngay khi có 1 người có
account nghỉ việc → **audit mỗi 60s quay lại, không ai được báo**. ⇒ Lùi LMS thì **phải** lùi MediaOS,
hoặc ghi nhận có ý thức là đã chấp nhận rác trở lại. Chiều ngược (lùi MediaOS một mình) vô hại.

---

## 8. Kết quả FULL gate (2026-07-23, trên commit `a0d41fd5`)

| Reviewer | Verdict | Phát hiện |
| --- | --- | --- |
| `security-reviewer` | **PASS** | 0 CRIT · 0 HIGH · 2 MEDIUM · 5 LOW |
| `silent-failure-hunter` | **PASS có điều kiện** | 0 CRIT · **1 HIGH (F1) must-fix** · 4 MEDIUM · 5 LOW |

Cả hai đều **chạy test thật** (không tin commit message): 90 unit + 13 int-spec trên Postgres cô lập,
`I13/I10` xác nhận CHẠY chứ không SKIP. `security-reviewer` còn tự đọc `apps/lms/lib/platform/auth/auth.ts`
để kiểm phần **BỊ XOÁ** (`DELETE FROM sessions` trong nhánh `alreadyDisabled`) thay vì tin comment —
điểm mù cố hữu của review gate (chỉ soi code THÊM).

### 8.1 Đã vá trong cùng WO

- **F1 (HIGH) — mất dấu vết VĨNH VIỄN khi `audit.record` ném đúng nhịp `changed`.** Thay đổi là sự kiện
  NHẤT THỜI, còn LMS thì idempotent (chính nhánh `alreadyDisabled` của §3C) ⇒ nhịp sau `changed=0`,
  `wasAbnormal=false` ⇒ **không nhịp nào tái tạo được dòng đã mất**. Khác hẳn pha `abnormal` (trạng thái
  BỀN, tự retry). Test 20c của bản đầu chỉ phủ pha `abnormal` nên là **false-comfort**.
  → Vá: `pendingChanged` Map đệm counter khi ghi hỏng, nhịp sau cộng dồn ghi bù rồi xoá nợ; vẫn NÉM TIẾP
  để JobRunner đánh dấu `Failed`. Test 20d/20e.
- **F3/MEDIUM-2 — dòng báo bất thường tự khai `result_status='Success'`.** Sự cố phổ biến nhất (LMS trả
  200 + body rác) có `failed===0` ⇒ mọi alert lọc theo cột trạng thái **mù hoàn toàn**. → `failed>0`
  → `Failure`; `unknown` → **`Error`** (phân biệt "không xác minh được" với "gọi hỏng"); còn lại
  `Success`. `Error` hợp lệ ở cả app enum (`audit.service.ts:61`) lẫn DB CHECK (`mig 0432:80`) ⇒ KHÔNG
  cần migration. Test F3.
- **F5 — `changed` thắng `recovered` ⇒ sự cố mở mà không bao giờ đóng.** → thêm cờ `metadata.recovered`
  ĐỘC LẬP với `auditPhase`; query ghép cặp dùng cờ này, không dùng nhãn. Test F5.
- **F7 — `warnedUnknown` không reset** ⇒ sự cố unknown thứ hai im lặng. → reset khi hồi phục (warn 1 lần
  mỗi SỰ CỐ, không phải mỗi process). Test F7.
- **F9 — `!s || s.unknown` không chống object thiếu field** ⇒ `created += undefined` ⇒ `NaN > 0` false ⇒
  im lặng không audit. → siết tới từng counter bằng `Number.isInteger`. Test F9.
- **LOW (security) — `res.json()` không giới hạn**: đọc body là NĂNG LỰC MỚI của WO. → chặn sai
  content-type + `content-length` > 64KB TRƯỚC khi parse, 2 test kèm.

### 8.2 Điểm mù CÓ Ý THỨC (không vá — ghi để người sau không phải suy lại)

- **F2 — trần 1 giờ làm mất độ phân giải timeline sự cố.** Trong cửa sổ bất thường bền, một thay đổi thật
  rơi vào lô parse-không-được sẽ không có dòng riêng cho tới khi hết trần/hồi phục. **Không phải
  regression**: bản cũ ghi mỗi 60s nhưng metadata chỉ `{total, ok, fail}`, cũng không hề mang thông tin
  thay đổi. `system_job_runs` vẫn giữ đủ nhịp. Đóng hẳn thì cần hash trạng thái mong muốn per-lô — cơ chế
  thứ ba, không tương xứng.
- **F6 — restart API giữa lúc bất thường + LMS hồi phục trước nhịp kế ⇒ mất dòng `recovered`**, dòng
  `abnormal` cũ treo. Bounded bởi số lần restart.
- **F10 — hợp đồng shape nằm NGOÀI repo, không CI nào verify.** `apps/lms` bị `.gitignore`; không test nào
  chạy client THẬT + job THẬT. LMS đổi shape ⇒ `unknown` vĩnh viễn ⇒ hệ suy biến thành "1 dòng/giờ,
  `changed` không bao giờ > 0" mà **không test nào đỏ**. Giảm nhẹ sau vá F3: dòng đó nay mang
  `result_status='Error'` nên **alert theo cột trạng thái bắt được**. Việc còn lại (ngoài WO): ngưỡng
  cảnh báo trên `system_job_runs.metadata->>'unknown'` kéo dài.
- **`ok` KHÔNG phải "đã xác minh"** (F4): `success += batch.length` cộng ngay khi HTTP 2xx — đây là luật
  CỐ Ý của §3A ("2xx = thành công, KHÔNG BAO GIỜ hạ cấp"), giữ nguyên. Đã ghi rõ vào comment metadata.

### 8.3 THỨ TỰ DEPLOY — bắt buộc **LMS TRƯỚC**, MediaOS SAU

Cả hai reviewer độc lập chỉ ra cùng điều: nếu MediaOS lên trước, LMS bản cũ vẫn tăng `deactivated` mỗi
nhịp cho user đã khoá ⇒ `changed>0` mỗi 60s ⇒ **quả bom 526k dòng/năm quay lại y nguyên**, kèm
`scryptSync` chặn event-loop Next mỗi phút. Hôm nay chỉ là *tiềm ẩn* (PROD chưa có user LMS nào
`disabled`), nhưng nó nổ ngay lần nghỉ việc đầu tiên của người CÓ account.

⇒ **Deploy LMS (§3C) trước, MediaOS (PR) sau**, rồi mới verify PROD theo `done_when`.
