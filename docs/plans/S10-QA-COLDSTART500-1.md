# S10-QA-COLDSTART500-1 — Truy nguồn 500 "cold-start" làm spec biên ĐỎ NGẪU NHIÊN

> **Loại WO: CHẨN ĐOÁN.** Không phải WO vá. Kết quả là một chỉ-đích-danh có stack thật, một phán
> quyết, và một dấu hiệu nhận diện cho phiên sau — cộng một WO vá được tách ra vì nó chạm vùng đỏ.
>
> Nhánh: `fix/s10-qa-coldstart500-1` · lane DB đo: `mediaos_coldstart` · ngày đo: **2026-08-28**.

---

## 0. Kết luận trước, bằng chứng sau

**Tầng ném 500 = `TwoFactorEnforcementGuard`** (`apps/api/src/auth/two-factor-enforcement.guard.ts`),
tại lời gọi `this.dbsvc.withTenant(...)` ở `isCompany2faEnforced` (**dòng 105**, gọi từ `canActivate`
**dòng 77**). Lời gọi đó **không nằm trong bất kỳ `try/catch` nào**, nên một lỗi hạ tầng ở vỏ
transaction (lấy connection · `BEGIN` · `set_config` · `COMMIT`) thoát ra nguyên trạng và
`AllExceptionsFilter` map nó thành **500 `SYSTEM-ERR-001` · `error.type:"Error"`**.

Guard này chạy **TRƯỚC** mọi pipe, nên nó cướp được cái 400 mà `ParseUUIDPipe` lẽ ra trả về — đúng
hình dạng flake đã quan sát ở `S10-FND-PARAMUUID-2` §L4.8.

⚠️ Cái bẫy đọc-lướt: `SecurityPolicyService.getEffectiveTwoFactorRequired` **CÓ** `try/catch` và
fail-to-floor — nhưng nó nằm **BÊN TRONG** callback của `withTenant`. Phần hỏng được là **vỏ**
transaction, phần không ai bọc. Nhìn qua rất giống "đã xử lý rồi".

---

## 1. Tái hiện — số đo, kể cả số đo "không tái hiện được"

Khuôn chạy (`repro.sh`, mỗi vòng: `lane-db-setup.sh coldstart --reset` = DROP + CREATE +
chain-migrate `0000→latest`, rồi chạy int-spec NGAY):

| Arm | Điều kiện | N | Tái hiện 500 | Ghi chú |
| --- | --- | --- | --- | --- |
| A | lane DB SẠCH vừa chain-migrate, chạy `leave-param-uuid.int-spec.ts` một mình, máy KHÔNG tải | **12** | **0/12** | 11 vòng 50/50 xanh; **1 vòng chết vì `ERR_IPC_CHANNEL_CLOSED` ("Channel closed") của tinypool** — crash worker, KHÔNG phải 500 |

⇒ **Trên máy khoẻ, flake KHÔNG tái hiện ở N=12.** Đó cũng là một số đo: điều kiện đủ KHÔNG phải
"DB vừa chain-migrate", mà là "DB vừa chain-migrate **+ một trục trặc hạ tầng đồng thời**". Khớp với
việc chính phiên quan sát được flake, `check.sh` báo `@mediaos/api: 3 lần chạy lại (crash hạ tầng)` —
và arm A cũng nhặt được đúng một sự cố cùng họ trong 12 vòng.

Vì tái hiện tự nhiên không đáng tin ở quy mô này, việc chỉ-đích-danh được làm bằng **đo bề mặt +
tiêm lỗi có kiểm soát**, không bằng chờ may.

---

## 2. Bề mặt TRƯỚC-pipe — đo bằng stack thật, không bằng đọc code

Spec đo: `apps/api/test/integration/prepipe-500-surface.int-spec.ts` (5 ca, chạy trên
`LANE_DB=mediaos_coldstart`).

Một request `PATCH /leave/types/khong-phai-uuid` (actor đã đăng nhập, body hợp lệ, KHÔNG
`Idempotency-Key`) chạm `DatabaseService.withTenant` **ĐÚNG 2 lần TRƯỚC khi pipe kịp từ chối**:

```
#1  TwoFactorEnforcementGuard.canActivate            two-factor-enforcement.guard.ts:77
      → TwoFactorEnforcementGuard.isCompany2faEnforced   two-factor-enforcement.guard.ts:105
        → DatabaseService.withTenant

#2  PermissionGuard.canActivate                      permission/guards/permission.guard.ts:128
      → PermissionService.can                        permission/permission.service.ts:273
        → CachedPermissionRepository.getCompanyRoleGrants  permission/permission.cache.ts:75
          → PermissionRepository.getCompanyRoleGrants      permission/permission.repository.ts:29
            → DatabaseService.withTenant
```

Hai chỗ xử lỗi **khác nhau**, và sự khác nhau đó chính là câu trả lời:

| Chỗ | Tiêm lỗi `withTenant` | Kết quả ĐO ĐƯỢC | Vì sao |
| --- | --- | --- | --- |
| #1 guard 2FA | cache 2FA LẠNH | **500 · `SYSTEM-ERR-001` · `type:"Error"`** | không try/catch quanh `withTenant` |
| #2 PermissionGuard | cache 2FA ẤM, cache quyền LẠNH | **403 · `AUTH-ERR-FORBIDDEN`** | `permission.guard.ts:144-155` bắt mọi lỗi → `ForbiddenException` |
| — | CẢ HAI cache ẤM | **400 · `BadRequestException`** | không request nào chạm DB ⇒ pipe thắng |

Ca thứ ba là đối chứng quan trọng nhất: **pipe không hỏng**. Cùng một lỗi hạ tầng, chỉ khác chỗ
cache, cho ra 400 hay 500 — tức 500 không đến từ `:id`, nó đến từ **cái chạy trước `:id`**.

### 2.1 Cửa sổ kích hoạt

`company2faCache` TTL **30 000 ms**, khoá theo **công ty**. Chỉ request rơi trúng lần cache MISS mới
chạm DB ở guard ⇒ trong mỗi cửa sổ 30 s, chỉ **một** request có thể ăn cái 500 đó. Đó là lý do flake
chỉ đánh **một** ca DENY, không kéo theo 14 ca còn lại — và cũng là lý do nó rơi vào ca DENY ĐẦU
TIÊN của khối (`PATCH /leave/types/:id`): ca đó là request có quyền đầu tiên sau `beforeAll`.

### 2.2 ⚠️ Ở PROD lỗ này RỘNG HƠN — cache không che gì cả

`TWO_FACTOR_ENFORCEMENT_ENABLED` mặc định **`'true'`** (`config/env.schema.ts:102`; `vitest.config.ts`
ép `'false'` cho toàn suite test). Khi bật:

```ts
const roleRequired = this.globalEnabled
  ? await this.twoFactor.requiresTwoFactor(user.id, user.companyId)   // guard:78
  : false;
```

`TwoFactorService.requiresTwoFactor` = `withTenant(...)` **trần, KHÔNG cache, KHÔNG try/catch**
(`two-factor.service.ts:129-131`). Ca (5) của spec đo trực tiếp trên guard THẬT với `globalEnabled=true`
và cache L77 đã ẤM: `canActivate` **ném `Error("Connection terminated unexpectedly")` nguyên trạng**,
`err instanceof HttpException === false` ⇒ filter buộc phải map 500 vô danh.

⇒ Ở PROD, **mọi** request đã xác thực đều mở một transaction không được bọc trong guard này. Cửa sổ
30 s ở trên là hiện tượng của môi trường TEST, không phải của PROD. Nhánh `isEnabled` (guard:84) cùng
hình dạng.

---

## 3. Ba nghi phạm của WO — phán quyết từng cái

| # | Nghi phạm (chép từ `src` của WO) | Phán quyết | Bằng chứng |
| --- | --- | --- | --- |
| 1 | guard/interceptor chạy trước pipe ném lỗi không được filter phân loại | ✅ **ĐÚNG — và đã khoanh về ĐÚNG MỘT guard, MỘT dòng** | stack thật ở §2 |
| 2 | pool lạnh qua **PgBouncer** | ❌ **BÁC BỎ — PgBouncer KHÔNG nằm trên đường test** | `apps/api/vitest.config.ts` ("Force direct-postgres URL for tests… userlist.txt not committed") + `test/db-target.ts:133` (`PG_HOSTPORT` mặc định `localhost:5432`); PgBouncer bind host **:6432** (`docker-compose.yml:82`) |
| 3 | permission-cache lạnh, trượt thì **ném thay vì 403** | ❌ **BÁC BỎ bằng số đo** | ca (4): tiêm lỗi đúng nhánh đó ⇒ **403 `AUTH-ERR-FORBIDDEN`**, không 500 |

Bốn tầng còn lại của chuỗi cũng đã loại, mỗi cái vì một lý do đọc được trong 5 dòng:

- `JwtAuthGuard` — **đồng bộ, không I/O**; mọi lỗi verify → 401 (`jwt-auth.guard.ts:82-84`).
- `CompanyGuard` — đồng bộ, chỉ đọc `req.user.companyId` → 403.
- `ApiKeyAuthGuard` — **KHÔNG còn đăng ký** (`app.module.ts:113` — gỡ ở CLEAN-DECOUPLE-1).
- `IdempotencyInterceptor` — thoát sớm khi route không `@Idempotent()` hoặc không có header
  (`idempotency.interceptor.ts:59-72`); các ca đo cố ý không gửi `Idempotency-Key`.

---

## 4. Đính chính số đo của WO seed

`src` của WO ghi flake là `500 InternalServerErrorException / SYSTEM-ERR-001`. Đường này **không thể**
sinh ra `error.type="InternalServerErrorException"`: lỗi thoát từ guard là `Error` thô, filter nhánh
(3) đặt `type = exception.name` ⇒ **`"Error"`**. `"InternalServerErrorException"` là giá trị
**TRƯỚC-VÁ** của chính route đó trong bảng `ROUTES` (do `leave.service.ts#mapError` bọc lại) — gần như
chắc chắn bị chép nhầm sang. Bản ghi gần thời điểm nhất (`docs/plans/S10-FND-PARAMUUID-2.md` §L4.8)
chỉ nói "500 `SYSTEM-ERR-001`", không nói `error.type`.

⇒ **Chữ ký đúng để nhận diện là `type:"Error"`**, không phải `InternalServerErrorException`.

---

## 5. PHÁN QUYẾT: CHẤP NHẬN ở WO này + tách WO vá

**Không vá trong WO này.** Lý do, nói thẳng:

1. Bản vá nằm trên `two-factor-enforcement.guard.ts` ⇒ diff chạm **auth/2FA enforcement** ⇒ theo
   chính `notes` của WO này, WO đổi tier và phải leo **FULL gate** (CLAUDE.md §6).
2. Lỗ **không phải một chỗ mà ba**: guard:77 (`isCompany2faEnforced`), guard:78 (`requiresTwoFactor`),
   guard:84 (`isEnabled`). Hai chỗ sau là **đường mặc định của PROD** và không có cache nào che.
   Vá một chỗ rồi tuyên bố xong là đúng thứ WO này tồn tại để chặn.
3. Chọn ngữ nghĩa fail-mode là **quyết định an ninh**, phải do người chốt: fail-to-floor (coi như
   không ép) hay fail-closed-CÓ-PHÂN-LOẠI (503 mang mã riêng).

**Số đo giúp quyết định (đã đo, không phải suy luận):** bọc `try/catch` + `return false` quanh
guard:105 rồi chạy lại spec ⇒ ca (2) chuyển từ 500 sang **403 `AUTH-ERR-FORBIDDEN`**. Nghĩa là với
route có `@RequirePermission`, fail-to-floor ở guard 2FA **KHÔNG mở cửa cho ai** — `PermissionGuard`
phía sau vẫn fail-closed. Nỗi lo "vá thành fail-open" chỉ còn đúng với route KHÔNG gắn
`@RequirePermission`.

WO vá được seed: **`S10-AUTH-2FAGUARD-FAILMODE-1`** (crown, FULL gate).

### 5.1 Dấu hiệu nhận diện — phân biệt 500-cold-start với 500-THẬT trong một lượt nhìn

Gặp một spec biên đỏ vì 500 thay vì 4xx, kiểm theo thứ tự này:

1. **Body**: `error.code = "SYSTEM-ERR-001"` **và** `error.type = "Error"` (không phải
   `"InternalServerErrorException"`, không phải `"ZodError"`).
2. **Log server** (`AllExceptionsFilter`): dòng `<METHOD> <path> -> 500 [SYSTEM-ERR-001] req=…` kèm
   stack chứa **`TwoFactorEnforcementGuard`** và **`two-factor-enforcement.guard.ts`**. Nếu stack có
   frame đó ⇒ **cold-start, KHÔNG phải lỗ của route**.
3. **Chạy lại spec đó một mình trên lane DB đã ẤM**. 500 biến mất ⇒ cold-start. 500 lặp lại ĐỀU ĐẶN
   ⇒ hồi quy thật, soi tiếp ở guard, KHÔNG ở dòng `@Param`.
4. Kèm theo thường có tín hiệu hạ tầng cùng phiên: `check.sh` báo "N lần chạy lại (crash hạ tầng)",
   hoặc vitest ném `ERR_IPC_CHANNEL_CLOSED` / "Channel closed".

⛔ Cách xử lý SAI: thêm retry vào spec, hoặc nới `expect(400)` thành `expect(...).not.toBe(200)`. Đó
là tháo đúng cái van mà `S10-FND-PARAMUUID-*` vừa lắp ([[tests-can-pin-a-hole-open]]).

---

## 6. Bàn giao

- `apps/api/test/integration/prepipe-500-surface.int-spec.ts` — 5 ca, **ĐÃ KIỂM CHỨNG BẰNG ĐỘT BIẾN**:
  bọc `try/catch` quanh guard:105 ⇒ ca (2) ĐỎ (403 ≠ 500), 4 ca kia giữ xanh ⇒ spec không xanh-rỗng.
  ⚠️ Ca (2) và (5) **ghim một cái LỖ**, không phải hợp đồng — khi `S10-AUTH-2FAGUARD-FAILMODE-1` vá
  xong thì hai ca đó PHẢI đỏ và phải sửa CÓ CHỦ ĐÍCH.
- `harness/backlog.mjs` — WO này `done`; note dán vào `S10-FND-PARAMUUID-2`; seed
  `S10-AUTH-2FAGUARD-FAILMODE-1`.
- `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` — **KI-083** (mở).
