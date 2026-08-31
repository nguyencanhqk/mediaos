# S10-AUTH-2FAGUARD-FAILMODE-1 — chốt fail-mode cho `TwoFactorEnforcementGuard` (KI-083)

> Vùng ĐỎ (crown). Chẩn đoán đã xong ở `S10-QA-COLDSTART500-1` — plan này **chỉ chốt ngữ nghĩa + vá**.
> Nguồn số đo: `docs/plans/S10-QA-COLDSTART500-1.md` · `apps/api/test/integration/prepipe-500-surface.int-spec.ts`.

---

## 1. Vấn đề (một câu)

`TwoFactorEnforcementGuard` mở **ba** transaction `withTenant` KHÔNG bọc, chạy **trước mọi pipe** cho **mọi**
route không `@Public()`/`@AllowWithoutTwoFactor()`. Lỗi hạ tầng ở **vỏ** transaction (lấy connection · BEGIN ·
`set_config` · COMMIT) thoát nguyên trạng ⇒ `AllExceptionsFilter` map thành **500 `SYSTEM-ERR-001` ·
`error.type:"Error"`** — một 500 GIẢ làm loãng tín hiệu 500 THẬT trên PROD.

| #   | Vị trí                                                                             | Có cache?                                        | Chạy khi nào                                              |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| :77 | `isCompany2faEnforced` → `:105` `withTenant`                                       | ✅ `company2faCache`, TTL 30s, khoá theo CÔNG TY | mọi request (cache lạnh)                                  |
| :78 | `twoFactor.requiresTwoFactor` (`two-factor.service.ts:129-131`, `withTenant` TRẦN) | ❌                                               | **mọi** request khi `globalEnabled` — = **mặc định PROD** |
| :84 | `twoFactor.isEnabled`                                                              | ❌                                               | khi `mustHaveTwoFactor`                                   |

⚠️ `SecurityPolicyService.getEffectiveTwoFactorRequired` CÓ `try/catch` fail-to-floor nhưng nằm **bên trong**
callback ⇒ không đỡ được lỗi vỏ. Chỗ cần bọc là **ngoài** `withTenant`.

---

## 2. Quyết định — **(b) fail-closed CÓ PHÂN LOẠI** (owner chốt 31/08/2026)

Lỗi hạ tầng ở cả ba chỗ ⇒ ném `ServiceUnavailableException` mang mã riêng
**`AUTH-ERR-2FA-UNAVAILABLE`** → HTTP **503**, `error.type:"ServiceUnavailableException"`.

### 2.1 Census — tập route bị ảnh hưởng nếu chọn (a)

Nguồn: `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` (**runtime từ AppModule đã boot, 0 regex**),
regen `ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts`
— đã regen ở head này, **không đổi**: 507 route · 468 gated · 12 public · 27 ungated.

27 route không `@RequirePermission` và không `@Public()`, **trừ**:

- 9 route `AuthController` — miễn guard bằng `@AllowWithoutTwoFactor()` **cấp class**
  (`auth.controller.ts:59`) ⇒ fail-mode không áp;
- 2 route `internal/v1/*` — đi `InternalGuard` (kênh máy, không `req.user`) ⇒ guard `return true` ở
  `if (!user)`.

⇒ **16 route** thật sự mất ép-2FA nếu chọn (a):

```
GET    /api/v1/foundation/company/branding
GET    /api/v1/foundation/modules/my-apps
GET    /api/v1/foundation/settings/public
GET    /api/v1/notifications/preferences
PUT    /api/v1/notifications/preferences
POST   /api/v1/notifications/devices
DELETE /api/v1/notifications/devices/:token
GET    /api/v1/org/units
GET    /api/v1/org/units/tree
GET    /api/v1/org/departments
GET    /api/v1/org/roles
POST   /api/v1/tasks/:taskId/attachments
GET    /api/v1/tasks/:taskId/attachments
GET    /api/v1/tasks/:taskId/attachments/:attachmentId/download
DELETE /api/v1/tasks/:taskId/attachments/:attachmentId
PATCH  /api/v1/users/me
```

### 2.2 Vì sao (b), không (a)

|                                   | (a) fail-to-floor                                                                                                | (b) fail-closed có phân loại                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 468 route CÓ `@RequirePermission` | **403 `AUTH-ERR-FORBIDDEN`** — nói "thiếu quyền" trong khi thật ra DB hỏng; 4xx ⇒ **tàng hình với cảnh báo 5xx** | **503 mã riêng** — đúng bản chất, lên đúng bảng cảnh báo, client retry được |
| 16 route KHÔNG gate quyền         | đi tiếp, 2FA **không** được ép                                                                                   | vẫn từ chối                                                                 |
| Chuẩn 2FA khi DB lỗi              | **hạ** (+ nếu cache giá trị fallback thì hạ thêm 30s)                                                            | giữ nguyên                                                                  |
| 16 route đó có thật sự dùng được? | **KHÔNG** — cả 16 đều đọc tenant DB; DB hỏng thì chúng cũng hỏng                                                 | không                                                                       |

Điểm chốt: (a) **không** giữ API sống — nó chỉ đổi 500 thành 403, một mã **sai ngữ nghĩa** khiến sự cố
hạ tầng biến mất khỏi radar 5xx. Lợi ích duy nhất của (a) là **ảo** vì 16 route đó cùng phụ thuộc DB đang hỏng.
Thêm nữa (b) **không có giá trị fallback** ⇒ tự nhiên không dính bẫy "cache 30s một quyết định sinh từ lỗi".

### 2.3 Ranh giới — cái gì KHÔNG đổi

- **Không** đụng `getEffectiveTwoFactorRequired` (fail-to-floor bên trong callback giữ nguyên: nó xử lỗi
  **đọc policy**, khác lỗi **vỏ transaction**). WO này chỉ thêm một lớp ngoài.
- **Không** đụng `ParseUUIDPipe` / `PermissionGuard` — ca (3) và (4) của spec chẩn đoán là đối chứng, phải
  giữ **nguyên trạng và vẫn xanh**.
- **Không** cache kết quả khi lỗi (không có giá trị để cache — ta ném).
- `ForbiddenException` `TWO_FACTOR_SETUP_REQUIRED` (đường nghiệp vụ) giữ nguyên: chỉ lỗi **hạ tầng** mới
  thành 503. Phân biệt bằng cách **chỉ bọc lời gọi `withTenant`**, không bọc cả thân `canActivate`.

---

## 3. Bản vá

`apps/api/src/auth/two-factor-enforcement.guard.ts` — một helper `guardedRead<T>(label, fn)` bọc **cả ba**:

```
private async guardedRead<T>(label: string, read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (err) {
    // KHÔNG nuốt HttpException nghiệp vụ (vd Forbidden từ tầng dưới) — chỉ phân loại lỗi HẠ TẦNG.
    if (err instanceof HttpException) throw err;
    this.logger.error(`2FA enforcement: đọc ${label} lỗi hạ tầng`, ...);
    throw new ServiceUnavailableException({
      code: TWO_FACTOR_UNAVAILABLE,               // 'AUTH-ERR-2FA-UNAVAILABLE'
      message: "Không xác minh được trạng thái 2FA — vui lòng thử lại.",
    });
  }
}
```

- `:77` bọc **quanh** `this.dbsvc.withTenant(...)` trong `isCompany2faEnforced`, **NGOÀI** `withTenant`,
  và **chỉ set cache khi thành công** (đường lỗi không chạm `company2faCache`).
- `:78`, `:84` bọc tại call-site trong `canActivate`.
- Message **không** mang chi tiết nội bộ (security.md); lý do thật đi vào log server-side.

---

## 4. Test (RED trước)

`apps/api/test/integration/prepipe-500-surface.int-spec.ts` — hai ca đang **ghim cái lỗ**, sửa CÓ CHỦ ĐÍCH:

| Ca                              | Trước                                               | Sau                                                                                                      |
| ------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| (2) THỦ PHẠM · `:77` cache lạnh | 500 `SYSTEM-ERR-001` · `type:"Error"`               | **503 `AUTH-ERR-2FA-UNAVAILABLE`** · `type:"ServiceUnavailableException"`; stack vẫn chỉ đích danh guard |
| (5) HÌNH DẠNG PROD · `:78`      | lỗi thô thoát, `instanceof HttpException === false` | **`ServiceUnavailableException`**, `getStatus() === 503`, mã đúng                                        |
| (3) ĐỐI CHỨNG cache ấm          | 400                                                 | **giữ nguyên 400** (chứng minh không bọc nhầm cả `canActivate`)                                          |
| (4) PHÂN LẬP PermissionGuard    | 403                                                 | **giữ nguyên 403**                                                                                       |

Ca **MỚI**:

- (6) `:84` `isEnabled` hỏng ⇒ 503 mã đúng — dựng guard THẬT (như ca 5), ép `globalEnabled=true`,
  `requiresTwoFactor` trả `true` để chạm đúng nhánh `:84`.
- (7) **KHÔNG cache khi lỗi**: `:77` hỏng ⇒ 503; DB khoẻ lại ⇒ request sau **thành công** (chứng minh
  đường lỗi không đóng dấu `company2faCache` 30s).
- (8) **Không nuốt nghiệp vụ**: user bị ép 2FA + chưa enroll, DB khoẻ ⇒ vẫn **403
  `TWO_FACTOR_SETUP_REQUIRED`**, KHÔNG bị helper đổi thành 503.

Đột biến bắt buộc đo: gỡ `guardedRead` ở **từng** chỗ (:77 / :78 / :84) ⇒ phải có ca ĐỎ tương ứng
(chống "vá một chỗ, ba ca vẫn xanh" — memory `asset-guards-pairs-in-two-layers`).

---

## 5. Rủi ro

- **Bán kính nổ = toàn API**: guard chạy trước mọi route. Nhưng đổi từ 500→503 **không** đổi tập
  request bị từ chối — chỉ đổi _mã_ và _thế quan sát_. Không có route nào đang-xanh thành đỏ.
- FE: 503 là mã mới với client. Chưa có màn nào bắt riêng `AUTH-ERR-2FA-UNAVAILABLE` ⇒ rơi vào xử lý lỗi
  chung (toast + retry). Ghi vào RELEASE-02 làm nợ FE, KHÔNG mở rộng phạm vi WO này.
- Cấu hình alerting hiện đếm 5xx: sau vá, 500-giả biến mất nhưng 503 xuất hiện ⇒ **số 5xx tổng không
  giảm**, chỉ **phân loại được**. Ghi rõ ở KI-083 để không ai đọc nhầm là "chưa vá".
