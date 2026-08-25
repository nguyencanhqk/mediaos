# S10-FND-BODYVALIDATE-1 — KI-068: 4 route GHI trả 500 thay vì 400 khi body sai hợp đồng

> Zone 🟡 · LIGHT gate (`typescript-reviewer` + `quality-gate`) · KHÔNG chạm permission/RLS/secret/migration.
> Seed: `harness/backlog.mjs` · KI: `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` hàng **KI-068**.

## §0 — Phát biểu mức độ TRƯỚC khi làm

Hỏng **đúng chiều an toàn**: request vẫn bị từ chối (fail-closed), không có payload sai nào lọt vào
service. ⇒ **KHÔNG phải lỗ bảo mật.** Giá trị của WO là:

1. **Hợp đồng API** — client không phân biệt được "tôi gửi sai" với "server hỏng";
2. **Giám sát** — mọi payload sai bơm một `500 SYSTEM-ERR-001` **GIẢ** vào cảnh báo, làm loãng tín hiệu 500 thật.

Đừng viết plan/PR bằng giọng lỗ bảo mật.

## §1 — Số đo (24/08/2026, không chép số cũ)

Census quét mọi `apps/api/src/**/*.controller.ts`, đối chiếu type của `@Body()` với tập **233** class
`createZodDto` (sau vá: 237) tìm được trong `apps/api/src` + `packages/contracts/src`:

|                                                                                   | Trước vá | Sau vá  |
| --------------------------------------------------------------------------------- | -------- | ------- |
| Handler GHI (`@Post`/`@Patch`/`@Put`/`@Delete`) có `@Body()`                      | **193**  | 193     |
| Validate **Ở BIÊN** (class DTO runtime \| pipe tại chỗ \| `@UsePipes` cấp method) | **189**  | **193** |
| **KHÔNG** validate ở biên                                                         | **4**    | **0**   |

> ⟲ **ĐÍNH CHÍNH mẫu số.** Bản census đầu của WO viết bằng **regex** và cho `177/173/4`. Số **4 và danh
> sách 4 route thì ĐÚNG**, nhưng mẫu số sai — regex bỏ sót **16** handler. Bảng trên là bản **AST**
> (`test/foundation/body-validation-census.ts`), và đó là số dùng được. Xem §1.1: regex còn đếm sai
> **4→2** rồi **4→5** trước khi tình cờ ra 4.

Con số 4 của KI-068 **vẫn đúng, không trôi**. Bốn route:

| Route                                                           | `@Body()` type        | Trạng thái bằng chứng                          |
| --------------------------------------------------------------- | --------------------- | ---------------------------------------------- |
| `POST /api-keys` (`api-keys.controller.ts:42`)                  | `CreateApiKeyRequest` | **ĐÃ ĐO HTTP** — 500 + `error.type='ZodError'` |
| `POST /foundation/files/upload` (`files.controller.ts:56`)      | `UploadFileInput`     | ✅ **ĐÃ ĐO 24/08** — 500 + `ZodError`          |
| `POST /foundation/files/:id/confirm` (`files.controller.ts:68`) | `ConfirmUploadInput`  | ✅ **ĐÃ ĐO 24/08** — 500 + `ZodError`          |
| `POST /foundation/files/:id/links` (`files.controller.ts:123`)  | `LinkFileInput`       | ✅ **ĐÃ ĐO 24/08** — 500 + `ZodError`          |

### §1.1 — Bẫy đo (ghi lại vì bản nháp đầu đã sập vào nó)

Cả hai controller **đều có `@UsePipes(ZodValidationPipe)` cấp class**
(`api-keys.controller.ts:37` · `files.controller.ts:48`) — và đó **chính là thứ không cứu được gì**:
`ZodValidationPipe` của nestjs-zod lấy schema từ **metatype** của tham số. `CreateApiKeyRequest` là
`z.infer<...>` (`contracts/src/api-key.ts:47`) ⇒ **type**, bị xoá lúc chạy ⇒ metatype là `Object` ⇒
pipe không có gì để chiếu ⇒ body đi thẳng vào handler.

Bản nháp census đầu tiên đếm nhầm **4 thành 2** vì coi `@UsePipes` cấp class là pipe của method.
Dấu hiệu phân biệt rẻ và chắc bằng regex: decorator cấp class ở cột 0, decorator của method thì thụt lề.
**Nhưng kết luận cuối cùng là: đừng dùng regex.** Ratchet của WO dùng TypeScript compiler API — AST không
có khái niệm 'trên/dưới' hay 'cột 0'.

Bẫy thứ hai: `@UsePipes` của method có thể nằm **DƯỚI** `@Post()` (khuôn của
`profile-change-request.controller.ts` là `@Post` → `@HttpCode` → `@RequirePermission` → `@UsePipes`),
nên census chỉ quét ngược lên trên sẽ bỏ sót và báo dương tính giả.

## §2 — Cơ chế lỗi (3 bước)

1. `@Body() dto: CreateApiKeyRequest` — TYPE, không phải class ⇒ pipe không chiếu được ⇒ **không validate ở biên**;
2. handler tự `createApiKeyRequestSchema.parse(dto)` ⇒ ném **`ZodError` THÔ**;
3. `AllExceptionsFilter` chỉ hiểu `ZodValidationException` của nestjs-zod (`getZodError()`), không hiểu
   `ZodError` thô ⇒ rơi vào nhánh 500.

⚠️ Comment tại `api-keys.controller.ts:45` khẳng định _"ZodValidationPipe đã chạy, nhưng giữ rõ ràng"_ —
**SAI**, đúng lớp bẫy [[ui-promises-backend-never-reads]]. Comment này phải sửa, không phải để lại.

## §3 — Hướng vá: **(a) class `createZodDto`** — CHỐT

Hai hướng đã cân nhắc:

|                                                          | (a) `createZodDto` class                                         | (b) `@UsePipes(new ZodValidationPipe(schema))` cấp method |
| -------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| Khuôn nhà                                                | ✅ **233 class**, mỗi module có `<module>.dto.ts`                | ⚠️ thiểu số (`profile-change-request`)                    |
| Ăn khớp `@UsePipes(ZodValidationPipe)` cấp class đang có | ✅ pipe tự tìm được schema, **không phải đụng decorator**        | ❌ thêm decorator thứ hai chồng lên pipe cấp class        |
| OpenAPI                                                  | ✅ DTO class ⇒ schema body hiện ra                               | ❌ body vẫn rỗng schema                                   |
| Đụng `packages/contracts`                                | ❌ **KHÔNG** — DTO class sống ở `apps/api/src/<module>/*.dto.ts` | ❌ không                                                  |

**Chọn (a).** Lý do quyết định: `api-keys` và `foundation/files` là **hai module DUY NHẤT không có file
`*.dto.ts`** — chúng không phải "trường hợp đặc biệt", chúng là **hai chỗ bị bỏ sót**. Vá bằng (a) là
đưa chúng về khuôn chung; vá bằng (b) là hợp thức hoá ngoại lệ.

> ⟲ **ĐÍNH CHÍNH ghi chú seed:** `notes` của WO viết hướng (a) _"đụng `packages/contracts`"_ — **SAI**.
> DTO class dựng TỪ schema có sẵn của contracts, khai ở `apps/api`. Contracts không đổi một dòng.

### §3.1 — Không trộn hai hướng

Cả 4 route đi hướng (a). Trộn là để lại đúng câu hỏi "vì sao route này khác route kia" cho người sau.

## §4 — Việc phải làm

1. **Đo trước (RED)** — spec HTTP mới cho 3 route `files`. Hôm nay `test/foundation/file-security.int-spec.ts`
   - `files-service.int-spec.ts` **gọi thẳng service, không có supertest** ⇒ biên HTTP của 3 route này
     thật sự chưa từng chạy. Nếu route nào **không** trả 500 ⇒ **ghi lại sự thật đó**, đừng ép số cho khớp KI-068.
2. `apps/api/src/api-keys/api-keys.dto.ts` (mới) + `apps/api/src/foundation/files/files.dto.ts` (mới) —
   khuôn `auth.dto.ts`.
3. Đổi `@Body()` của 4 handler sang class DTO.
4. Bỏ `.parse()` thừa ở 3 chỗ thuần-validate; **giữ** ở `link()` vì chỗ đó `.parse({ ...body, fileId: id })`
   **ép `fileId` từ route** — đó là coercion, không phải validate. Xử lý riêng, ghi rõ trong docblock.
5. Sửa comment nói dối `api-keys.controller.ts:45`.
6. **LẬT** ca ghim `invite-apikeys-http.int-spec.ts:289` sang `expect(400)`. **Cấm** nới thành `expect([400,500])`.
7. Ca **ALLOW** cho cả 4: body đúng ⇒ 2xx + DTO không đổi hình dạng ([[deny-cases-vacuous-without-allow-case]]).
8. **RATCHET**: đưa census §1 thành ca tự động — số handler GHI `@Body()` không validate ở biên **PHẢI = 0**.
   Neo theo **ĐỊNH NGHĨA** (đối chiếu metatype với tập `createZodDto`), không theo tên route
   ([[index-ratchet-must-pin-definition-not-name]]).
9. RELEASE-02 đóng KI-068 kèm số census AST 193/189/4 → 193/193/0 + ghi rõ 3/4 route đã LẬT từ suy-luận sang đo-bằng-HTTP.

## §5 — Rủi ro đã biết

- **OpenAPI**: thêm DTO class làm body schema hiện ra ⇒ `openapi-contract.e2e-spec.ts` có thể ĐỎ. Đó là
  tín hiệu ĐÚNG (contract giàu hơn), không phải hồi quy — nhưng phải xem từng dòng, không regen mù.
  Module mới phải khai `API_MODULE_TAGS` ([[openapi-enrich-derived-from-guard-metadata]]).
- **Route census runtime là CỔNG** ([[route-census-runtime-gate]]): WO này **không thêm route** nên không
  nên đụng. Nếu ĐỎ ⇒ đọc kỹ, đừng regen bằng `ROUTE_CENSUS_WRITE=1` theo phản xạ.
- **`ConfirmUploadInput` body rỗng là HỢP LỆ** (docblock `files.controller.ts:64` — `fileId` lấy từ route).
  DTO class không được biến body rỗng thành 400 — đó sẽ là hồi quy do chính bản vá đẻ ra. Phải có ca ALLOW
  cho body rỗng.
- **`LinkFileInput`**: `fileId` bị **ép từ route** sau khi parse. Nếu DTO class validate `fileId` bắt buộc
  **TRƯỚC** khi handler ép, request hợp lệ (không gửi `fileId` trong body) sẽ ăn 400 ⇒ hồi quy. Đây là
  điểm nguy hiểm nhất của WO — xem §6.
- Verify phải chạy dưới `LANE_DB` ([[integration-test-lane-db-gate]]), **không** `source .env`
  ([[sourcing-dotenv-poisons-test-run-node-env]]).

## §6 — `POST /:id/links`: điểm phải nghĩ, không được chép

`link()` hiện làm: `linkFileInputSchema.parse({ ...body, fileId: id })` — body **không cần** chứa `fileId`,
handler tự ép từ route. Nếu đưa `LinkFileInput` thành DTO class:

- pipe validate **body thô** ⇒ `fileId` thiếu ⇒ **400** cho request vốn hợp lệ.

Ba lối ra; **đã chọn (i)** sau khi đo hành vi hôm nay:

- **(i) ✅ ĐÃ CHỌN** — DTO class dựng từ `linkFileInputSchema.omit({ fileId: true })`, handler vẫn ép
  `fileId` rồi `.parse()` schema đầy đủ. Giữ nguyên hợp đồng client. Hai lớp KHÁC vai: biên bắt sai hợp
  đồng của phần client thực sự gửi; handler chốt bất biến `fileId = :id`.
- **(ii)** Cho `fileId` `.optional()` trong DTO class — nới schema ở biên, dở hơn (i).
- **(iii)** Bắt client gửi `fileId` khớp route — **ĐỔI HỢP ĐỒNG API**, ngoài phạm vi WO này.

Ca ALLOW bắt buộc: link **không** gửi `fileId` trong body vẫn 2xx.

## §6b — Phát sinh khi thi công: lỗ CÙNG HÌNH DẠNG ở kênh PARAM (→ KI-077)

Không đến từ KI-068 mà từ việc **tự đọc lại diff của chính bản vá**: `link()` giữ `.parse({ ...body,
fileId: id })` để chốt bất biến `fileId = :id`, nhưng `@Param("id") id: string` không có `ParseUUIDPipe`
⇒ `:id` rác làm CHÍNH dòng đó ném `ZodError` THÔ ⇒ **500**. Tức bản sao của KI-068 nằm cách bản vá **một
dòng**, chỉ đổi kênh đầu vào.

**ĐO (24/08, `LANE_DB=mediaos_bodyvalidate`), hai route GHI:**

| Route                                | `:id` rác → trước | `error.type`                           | Sau vá  |
| ------------------------------------ | ----------------- | -------------------------------------- | ------- |
| `POST /foundation/files/:id/links`   | **500**           | `ZodError` (từ `.parse()` của handler) | **400** |
| `POST /foundation/files/:id/confirm` | **500**           | `Error` (DB `22P02`, cột `uuid`)       | **400** |

Hai hình dạng lỗi KHÁC nhau, cùng một hậu quả — nên đo cả hai chứ đừng suy từ một.

**Phạm vi:** chỉ vá 2 route GHI (trong tầm WO, đã đo). **Năm tham số READ/DELETE còn lại** (`getOne` :90 ·
`downloadUrl` :100 · `download` :113 · `unlink` :145 · `remove` :153) **CHƯA ĐO** ⇒ tách thành **KI-077**
thay vì vá mù. Vá không-đo là đúng thứ dự án này chống.

## §7 — Nghiệm thu

- [x] 3 route `files` có số đo HTTP THẬT trước khi vá — cả ba **500 + `ZodError`**
- [x] 4/4 route trả **400** cho body sai; ca ghim `invite-apikeys-http.int-spec.ts` đã LẬT sang `expect(400)`
- [x] Ca ALLOW cho cả 4 (gồm body rỗng của `confirm` + link không có `fileId` trong body), oracle
      `expectPassedBoundary()` phân biệt 400-của-BIÊN với 400-của-SERVICE
- [x] Ratchet census = 0, neo theo định nghĩa (AST), **đã kiểm chứng đột biến** — trả một tham số về TYPE ⇒ ĐỎ đúng handler
- [x] Comment nói dối `api-keys.controller.ts:45` đã gỡ
- [x] `bash harness/check.sh --lane-db=bodyvalidate` XANH (api 566/566, cả 6 cổng)
- [x] RELEASE-02 đóng KI-068 kèm số AST 193/189/4 → 193/193/0
- [x] §6b: lỗ kênh PARAM — 2 route GHI đã đo + vá; 5 tham số READ/DELETE tách thành **KI-077**
