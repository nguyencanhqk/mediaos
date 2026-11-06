# S19-OPS-ZOD4-1 — Plan v1 (L0, chỉ đọc) — nâng zod 3 → 4 toàn monorepo

> Lập 26/10/2026 trên master `3970b82a` (checkout chính, không sửa tệp nào trong kho). Nguồn đo: `git grep` · đọc
> `apps/fbpost/node_modules/zod` (bản 4.6.7 có sẵn) · context7 (`/colinhacks/zod/v4.6.5`, `/benlorantfy/nestjs-zod`).
> Số đếm có ghi «gồm chú thích» là thô (regex), số ghi «thật» đã lọc tay.
>
> **Ghi chú quy trình:** 1 lần lỡ dùng `node -e` CHỈ để in `package.json` của zod trong `apps/fbpost/node_modules` (đọc,
> không ghi). Ngoài lần đó: không pnpm/node/install/test/build, không đọc `.env`.
>
> **Ghi chú phạm vi:** yêu cầu owner được chuyển tiếp cho lượt chạy này là «có thể chuyển sang R2 luôn không cần back up»
> (chuyện chuyển storage sang R2), KHÔNG phải ZOD4. Plan này không đụng R2. Luồng chính cần hỏi lại owner.

---

## §1 Phạm vi + hạn

- **Mục tiêu:** zod ≥ 4.6.6 (đề xuất ghim **4.6.7**, cùng bản fbpost đang chạy) ở MỌI gói: `apps/api` · `apps/app` ·
  `apps/auth` · `apps/console` · `packages/contracts` · `packages/web-core`. Kéo theo: `nestjs-zod` 4.3.1 → **^5**,
  `@hookform/resolvers` 3.10.0 → **^5.2** (app + auth). `packages/ui` không dùng zod. `apps/fbpost` (npm riêng) đã ở 4.6.7.
  `apps/lms` (repo git riêng) NGOÀI phạm vi.
- **Vì sao phải nâng cả nestjs-zod:** trong lockfile, `nestjs-zod@4.3.1` có `zod: 3.25.76` + `@nest-zod/z@2.0.0` là
  **dependency riêng** (`pnpm-lock.yaml:9444-9448`) ⇒ chỉ nâng zod của ta thì lockfile vẫn còn zod 3 ⇒ audit vẫn đỏ.
  nestjs-zod 5 chỉ còn dep runtime `deepmerge` và nhận peer `zod ^3.25 || ^4`.
- **CẤM** shim `zod/v3` (audit xanh nhưng mã 3.x chưa vá vẫn chạy). **CẤM** để 2 bản zod cùng sống trong lockfile.
- **Hạn:** ngoại lệ `GHSA-mrhx-c7xc-m3w5` có hạn **2026-11-23** (`scripts/check-audit-ignore-expiry.mjs:34-40`). Quá hạn ⇒
  job audit bắt buộc tự ĐỎ trên mọi PR. Muốn xong: merge + deploy API (cài deps trên checkout chính) TRƯỚC 23/11.
- **Kết thúc khi:** gỡ khối `auditConfig.ignoreGhsas` trong `pnpm-workspace.yaml` + mục `EXPIRY` tương ứng
  (`EXPIRY = {}`), `pnpm audit --audit-level=high` = 0 HIGH; phong bì lỗi trên dây không đổi (ca ghim); FULL gate PASS;
  `bash harness/check.sh --all --lane-db` xanh.

---

## §2 Census THEO GÓI

### 2.1 Phụ thuộc + số tệp import

| Gói | `zod` (package.json) | tệp import `zod` | ghi chú |
| --- | --- | --- | --- |
| `apps/api` | ^3.25.0 | 14 (src 11) | lấy schema chủ yếu từ contracts. **nestjs-zod ở 184 tệp**: `ZodValidationPipe` 124 · `createZodDto` 60 · `ZodValidationException` 5 · `patchNestJsSwagger` 1 · `validate` 1 |
| `packages/contracts` | ^3.25.0 | 95 | NGUỒN DTO; dual build CJS (`moduleResolution: Node`) + ESM (`Bundler`) |
| `packages/web-core` | ^3.25.0 | 54 | parse RESPONSE bằng zod ⇒ id/record lệch là màn vỡ dù HTTP 200 |
| `apps/app` | ^3.25.0 | 54 | `@hookform/resolvers` 3.10.0, `zodResolver` ở 29 tệp, `useForm<T>` 30 chỗ |
| `apps/auth` | ^3.25.0 | 3 | `@hookform/resolvers` 3.10.0, `zodResolver` 3 form |
| `apps/console` | ^3.25.0 | 8 | không có resolvers |
| lockfile | `zod@3.25.76` duy nhất; `nestjs-zod@4.3.1`; `@nest-zod/z@2.0.0`; `@hookform/resolvers@3.10.0` | | |

### 2.2 API zod 3 bị đổi/bỏ ở zod 4 mà mã đang dùng

Phân bố viết `api/app/auth/console/contracts/web-core`. «Còn chạy» = zod 4 vẫn hỗ trợ (đa số là deprecated), không bắt buộc sửa.

| # | Mục | Số chỗ | Ví dụ file:dòng | zod 4 | Hành động |
| --- | --- | --- | --- | --- | --- |
| 1 | `required_error` / `invalid_type_error` | **2** (app 1, contracts 1) | `apps/app/src/routes/leave/leave-form-schema.ts:26` · `packages/contracts/src/employees.ts:77` (thông điệp xoá avatar, ĐI RA DÂY) | **BỎ** (`errorMap` cũng bỏ; 0 chỗ) | đổi sang `message` (chạy được cả v3 ≥3.23 lẫn v4) ⇒ làm ở pha chuẩn bị. TS bắt được (thừa thuộc tính) |
| 2 | `message` trong check | 42 (app 27, auth 11, contracts 4) | `apps/app/src/routes/account/change-password-form-schema.ts:13,16` | còn chạy (deprecated → `error`) | giữ |
| 3 | `.flatten()` / `.format()` / `formErrors` / `fieldErrors` | **0** | — | deprecated | — |
| 4 | `ZodError.errors` | **1 thật** | `apps/api/src/employees/hr-employee-import.service.ts:353` | **BỎ** (chỉ còn `.issues`) | `.issues` (chạy cả v3) |
| 5 | `z.nativeEnum` · `.Enum/.Values` · `z.function` · `.ip()/.cidr()` · `.deepPartial` · `.nonstrict` · `isOptional` | **0** | — | — | — |
| 6 | `.merge()` | **0 thật** (1 khớp là method service `salary-components.service.ts:287`) | — | ném nếu object có refine | — |
| 7 | `z.record` một tham số | **10** (contracts) | `auth.ts:120,160` · `chat.ts:969` · `notification.ts:63,145` · `my-notification.ts:155` · `notification-admin.ts:96` · `payroll.ts:685` · `recruit.ts:450` · `template.ts:60` | runtime có nhánh v3-compat, kiểu TS đòi 2 tham số | đổi `z.record(z.string(), X)` (chạy cả v3) |
| 7b | `z.record(<enum>, X)` | **2** | `packages/contracts/src/asset.ts:297` (`byStatus` — RESPONSE) · `packages/contracts/src/payroll-catalog.ts:412` (`inputs` — BODY, `.default({})`) | **ĐỔI NGHĨA: enum-key thành VÉT CẠN** (thiếu khoá = lỗi) | `z.partialRecord` (hoặc chứng minh API luôn trả đủ khoá) + ca test map thiếu khoá |
| 8 | `.strict()` | ~314 gồm chú thích (contracts 199, app 37, web-core 21, api 57 phần lớn chú thích/test) | `packages/contracts/src/asset.ts:156,229` · `auth/user-admin.ts:181` | còn chạy (deprecated → `z.strictObject`); mã lỗi vẫn `unrecognized_keys` | giữ |
| 9 | `.passthrough()` | **1 thật** | `packages/web-core/src/lib/api.ts:35` | còn chạy | giữ |
| 10 | `.default()` | contracts 308 · app 10 · web-core 1 (api 557 phần lớn là `.default` của DRIZZLE, không phải zod) | `packages/contracts/src/ai.ts:34-37` · `.optional().default()` 3: `hr/master-data.ts:84`, `task-collab.ts:139,141` | **ĐỔI NGHĨA ×2:** (a) default trả NGAY, không chạy qua transform/trim/preprocess, phải khớp kiểu OUTPUT; (b) **`optional(default(x))` với `undefined` ⇒ ÁP default** (đã đọc `zod/v4/core/schemas.js` 4.6.7: `$ZodOptional` gọi inner khi `optin === "defaulted"`) | xem 10b |
| 10b | **`.partial()` trên object có `.default()`** | **33 chỗ `.partial()`** (contracts) — đã xác nhận ít nhất 1 ca thật | `packages/contracts/src/attendance.ts:684` `updateShiftSchema = createShiftSchema.partial().extend(…)` trên `createShiftSchema` (`:660`) có **8 `.default()`** (`:664,669,673-677,679`) | zod 3: PATCH thiếu field ⇒ không đụng; **zod 4: PATCH `{name}` ⇒ trả về cả `shiftType:"Fixed"`, `breakMinutes:0`, `allowEarlyCheckIn:true`, `isDefault:false`… ⇒ GHI ĐÈ IM LẶNG** | tách «core không default» + create = core với default; update = core.partial(). Census test cấm `optional(default)` trong mọi schema update/patch |
| 11 | `superRefine` | ~53 gồm chú thích (contracts 27, api 23, app 3) | `apps/api/src/config/env.schema.ts:404` · `apps/api/src/social/social-input-text.pipe.ts:116` · `apps/app/src/routes/goals/goal-form-schema.ts:39` | còn chạy (deprecated → `.check`); `ctx.addIssue` còn; `ctx.path`/`fatal` 0 chỗ | giữ |
| 12 | `z.ZodIssueCode.custom` | 48 | `apps/api/src/config/env.schema.ts:409,416` | còn xuất (deprecated) | giữ |
| 13 | Mã issue đi ra DÂY (`rule: issue.code`) | filter `apps/api/src/common/filters/all-exceptions.filter.ts:77-88` | `details[] = {field: path.join("."), message: issue.message, rule: issue.code}` | **ĐỔI:** `invalid_string→invalid_format` (uuid/email/url/regex/datetime) · `invalid_enum_value`/`invalid_literal→invalid_value` · `invalid_union_discriminator→invalid_union` · `invalid_date→invalid_type`; thông điệp mặc định đổi (`"Required"` → `"Invalid input: expected string, received undefined"`) | bảng alias v3 trong filter (§3) + ca ghim |
| 14 | `ZodError` (tham chiếu) | 144 gồm chú thích; **`instanceof ZodError` = 0** | `apps/app/src/routes/social/admin/lib/admin-errors.spec.ts:11` | `.issues` giữ nguyên | — |
| 15 | `ZodIssue` (kiểu) | 4 | `apps/api/src/common/filters/all-exceptions.filter.spec.ts:9,89` · `apps/api/src/payroll/payroll-reports.service.ts:3` | còn (alias deprecated) | kiểm TS |
| 16 | `ZodType<…>` | 32 (web-core 18, contracts 7) | `packages/contracts/src/goal.ts:127` · `org.ts:56` · `hr/org-chart.ts:35` (z.lazy) | generic thành `<Output, Input=unknown>` (bỏ Def) — lỏng hơn | kiểm TS |
| 17 | `ZodTypeAny` | 10 | `packages/contracts/src/index.ts:64` · `me.ts:85` · `payroll.ts:49` · `room.ts:70` | còn (deprecated) | giữ |
| 18 | `ZodObject<Shape,"strip",ZodTypeAny,Out>` (4 generic) | **2** | `packages/contracts/src/leave.ts:396,795` | ZodObject chỉ còn `<Shape, Config>` | viết lại generic theo `z.output<…>` |
| 19 | `.innerType()` trên schema đã `superRefine` (ZodEffects v3) | **2** | `apps/api/test/helpers/bootstrap-app.ts:57` · `apps/api/test/foundation/permmemo-wiring-structure.unit-spec.ts:42` | v4 refine KHÔNG bọc ⇒ `envSchema` vẫn là ZodObject, không có `innerType` | đổi `.shape` |
| 20 | **`.uuid()`** | **1.130** (contracts 1.094, app 11, web-core 13, api 8, console 5); **1.122 chỗ đúng dạng `z.string().uuid()`**; 1 chỗ có thông điệp: `apps/app/src/routes/leave/leave-policy-form.ts:34` | `apps/api/src/auth/auth.service.ts:85` · `apps/api/src/config/env.schema.ts:54` | **CHẶT RFC** (nibble version 1–8, variant 8/9/a/b) ⇒ TỪ CHỐI id canonical đang sống: `00000000-…-000000000010/11` (`0444_…canonical_roles_perms.sql:59-61`), `…00a1-a3` (`0231_…saas_scaffold.sql:174-176`); đếm lại: **23 literal khác nhau không chuẩn RFC trong 48 tệp migration** | `idSchema` dùng chung = `z.guid()` (regex GUID của v4 = đúng regex `.uuid()` của v3) + ratchet cấm `.uuid(` |
| 21 | `.email()` | 46 (contracts 32) | `apps/api/src/config/env.schema.ts:217,237` | regex v4 `^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$` — gần tương đương v3 | đếm PROD ở §7 câu 3 |
| 22 | `.url()` | 55 (contracts 40) | `apps/api/src/config/env.schema.ts:26` | còn chạy | giữ |
| 23 | `.datetime()` / `.date()` | 475 (contracts 465) | `apps/api/src/social/social.mapper.ts:54` | còn chạy (deprecated → `z.iso.*`) | giữ |
| 24 | `z.coerce.*` | 214 (contracts 176) | `apps/api/src/config/env.schema.ts:64,92` | kiểu INPUT thành `unknown` (ảnh hưởng `useForm` + kiểu DTO) | kiểm TS |
| 24b | `z.coerce.date()` | **27** (contracts) | `packages/contracts/src/auth.ts:377-378,432` | **OpenAPI:** `z.date` là «unrepresentable» với `z.toJSONSchema` (nestjs-zod 5 dùng nó) ⇒ nguy cơ ném lúc dựng `/docs-json` / `gen:openapi` | ca smoke `/docs-json` + xử lý theo cách nestjs-zod 5 hỗ trợ (override metadata), KHÔNG đổi nghĩa validate |
| 25 | `z.preprocess` / `.transform` | 19 / 28 (contracts 15 / 21) | `packages/contracts/src/asset.ts:105,179` · `auth/user-admin.ts:124` | trả `ZodPipe` thay `ZodEffects` | soi chuỗi `transform/preprocess … .default(` (mục 10a) |
| 26 | `.pick/.omit/.extend` | 106 (contracts 91) | `apps/api/src/foundation/files/files.dto.ts:41` · `packages/contracts/src/attendance.ts:684` | **ném lúc import** nếu gọi `.pick/.omit/.partial/.merge` trên object đã `.refine` (`.extend` ném khi trùng khoá). Mã v3 hiện không thể gọi (ZodEffects không có các method này) ⇒ hiện 0, nhưng typecheck v4 KHÔNG chặn ca mới | toàn suite import mọi module contracts = lưới |
| 27 | `.refine` | 163 (contracts 117, app 41) | `packages/contracts/src/leave.ts:396-400` | refine trên object giữ kiểu ZodObject | — |
| 28 | `z.discriminatedUnion` | 6 | `packages/contracts/src/dashboard.ts:183` · `hr/employee-import.ts:137` · `realtime.ts:475` | mã lỗi `invalid_union_discriminator` → `invalid_union` | alias ở mục 13 |
| 29 | `z.lazy` | 6 | `packages/contracts/src/auth.ts:411,460` | OK | — |

**Không có** ESLint `no-deprecated` ⇒ các API deprecated còn chạy (mục 2, 8, 11, 12, 17, 23) không làm đỏ lint.

### 2.3 nestjs-zod 4.3.1 → ^5 (đọc MIGRATION.md 4→5)

- `patchNestJsSwagger` **bị thay** bằng `cleanupOpenApiDoc(doc)` ⇒ `apps/api/src/config/swagger.ts:5` + chỗ nạp
  `SchemaObjectFactory` qua `createRequire` (`swagger.ts:21-26`, kiểu `SchemaObjectFactoryType`) phải viết lại.
- `ZodValidationException.getZodError()` trả **`unknown`** ⇒ `all-exceptions.filter.ts:78` (`.issues.map`) phải thu hẹp kiểu.
  KHÔNG dùng `instanceof ZodError` (nhạy với số bản cài) — thu hẹp theo hình dạng (`issues` là mảng) + fallback 400 không chi
  tiết, KHÔNG rơi về 500.
- OpenAPI sinh bằng `z.toJSONSchema` (mặc định schema INPUT; `.Output` cho response); kiểu «unrepresentable» ném ⇒ mục 24b.
  `openapi-components.spec.ts`, `openapi-enrich` và tài liệu `/docs-json` sẽ đổi hình ⇒ cập nhật kỳ vọng có chủ đích.
- Peer: `zod ^3.25 || ^4`, `@nestjs/swagger ^11` (đang 11.4.5) ⇒ hợp. Bỏ hẳn `@nest-zod/z` khỏi lockfile.
- `validate` (`apps/api/src/social/social-input-text.pipe.ts:2,140`): CHƯA xác minh còn xuất ở v5 — nếu bỏ, thay bằng
  `safeParse` + `throw new ZodValidationException(error)` (cùng đường với pipe).

### 2.4 @hookform/resolvers 3.10 → ^5.2 (app + auth)

- ≥ 5.1 hỗ trợ zod 4; react-hook-form cần ≥ 7.55 (đang ^7.80) ⇒ hợp.
- `zodResolver` v5 suy kiểu Input/Output ⇒ `useForm<T>({ resolver: zodResolver(s) })` đỏ TS khi input ≠ output (schema có
  `.default` / `z.coerce` / transform). Ca đã thấy: `apps/app/src/routes/leave/leave-form-schema.ts:39` (`.default(false)`),
  `apps/app/src/routes/system/ops/sequence-form-schema.ts:18-19` (`z.coerce.number()`). Sửa: `useForm<z.input<S>, unknown, z.output<S>>`.

---

## §3 Cách làm

### 3.1 Một PR, commit theo PHA (khuyến nghị) — không tách theo gói

- **Không tách theo gói được:** contracts là MỘT bản zod dùng chung cho api (nestjs-zod), app (zodResolver), web-core
  (parse response). Hai major cùng sống ⇒ kiểu TS lệch nhau + lockfile còn zod 3 ⇒ audit không gỡ được.
- **Không tách PR theo pha (mặc định):** pha chuẩn bị trung tính về hành vi trên zod 3 (kiểm bằng script + suite), tách PR
  riêng tốn thêm 1 FULL gate + 1 lượt suite + 1 lần deploy ≈ 80–120 USD mà không giảm rủi ro.
- **Đường lui thích nghi:** nếu C3 nổ lỗi TS ngoài dự kiến (vượt ngưỡng chi ở §6) ⇒ cắt C1+C2 thành PR-A (zod 3, không đổi
  deps, deploy thường) để giữ thành quả, PR-B làm tiếp. KHÔNG xếp chồng PR (squash-merge làm vỡ PR chồng) — PR-B nhánh từ master
  sau khi PR-A merge.

### 3.2 Môi trường

Worktree riêng `C:/dev 2/MediaOS-zod4` (WO đổi deps KHÔNG được `pnpm install` ở checkout chính — PROD chạy trên
`node_modules` của nó). Chép `.env` + `.secrets/local-kek.bin` bằng `cp` (không in nội dung). Lane DB riêng
(`scripts/lane-db-setup.sh zod4`). Int-spec MỚI dựng app qua `applyMainPipeline`.

### 3.3 Thứ tự commit

**C1 — ghim TRƯỚC khi nâng (chạy xanh trên zod 3):**
1. Int-spec phong bì lỗi (§4.1) — ghim `status`, `error.code`, `details[].field`, `details[].rule`; `message` chỉ ghim ở chỗ
   có thông điệp tiếng Việt tự đặt.
2. Ca id canonical (§4.2).
3. Ca hành vi partial/default: `updateShiftSchema.parse({ name: "x" })` KHÔNG sinh khoá nào ngoài `name` (+ các update schema
   khác phát hiện ở bước C2.4). Trên zod 3 xanh sẵn; trên zod 4 đỏ nếu chưa vá ⇒ đúng thứ cần ghim.
4. Ca `z.record` enum-key nhận map thiếu khoá (asset `byStatus`, payroll `inputs`).

**C2 — chuẩn bị TRUNG TÍNH trên zod 3 (codemod bằng script ở luồng chính, mỗi phép thay khớp đúng số lần dự kiến):**
1. `packages/contracts/src/common/id.ts`: `export const idSchema = z.string().uuid();` (v3: lỏng = hành vi hiện tại) + export
   từ `index.ts`. Codemod 1.122 chỗ `z.string().uuid()` → `idSchema` (+ chèn import). Chỗ có thông điệp
   (`leave-policy-form.ts:34`) sửa tay. Script kiểm: diff CHỈ gồm phép thay đó + dòng import.
2. `z.record(X)` → `z.record(z.string(), X)` (10 chỗ). `required_error`/`invalid_type_error` → `message` (2). `.errors` → `.issues` (1).
3. Ratchet: cấm `.uuid(` trong `src/` (ngoài `common/id.ts`), cấm `z.record(` một tham số.
4. Kiểm 33 chỗ `.partial()`: chỗ nào base có `.default()` ⇒ tách `xxxCoreSchema` (không default) → `createXxxSchema =
   core.extend({ f: core.shape.f.default(v) })`, `updateXxxSchema = core.partial()…`. Trên zod 3 hành vi không đổi.
5. Soi chuỗi `.transform(…)/z.preprocess(…)/.trim()… .default(v)` (mục 10a) — v4 không đưa default qua pipeline.
6. **Chạy `bash harness/check.sh --all --lane-db` trên zod 3** ⇒ xanh = C2 trung tính.

**C3 — nâng:**
1. `pnpm-workspace.yaml`: catalog `zod: 4.6.7`; 6 `package.json` dùng `"zod": "catalog:"`; `nestjs-zod: ^5`;
   `@hookform/resolvers: ^5.2`. `pnpm install` TRONG WORKTREE; kiểm lockfile chỉ còn MỘT `zod@4.6.x`, không còn `@nest-zod/z`.
2. `idSchema` → `z.guid()`; `leave-policy-form.ts:34` → `z.guid("masterData…")`.
3. Filter (`all-exceptions.filter.ts:77-88`): thu hẹp `getZodError()` + **bảng alias `rule` v3** (đề xuất giữ dây ổn định):
   `invalid_format→invalid_string` · `invalid_value→invalid_enum_value` (values ≥ 2) / `invalid_literal` (values = 1) ·
   `invalid_union` có `note`/`discriminator`→`invalid_union_discriminator`. Thiếu khớp ⇒ giữ mã v4 (không nuốt).
4. `swagger.ts`: `patchNestJsSwagger` → `cleanupOpenApiDoc`; xử lý `z.coerce.date()` (24b) cho `/docs-json` không ném.
5. Sửa TS: `leave.ts:396,795` generic · `.innerType()` → `.shape` (2) · `useForm` generic (resolvers v5) · `.default` sai kiểu
   output · `ZodIssue`/`ZodType` nếu đỏ · `validate` nếu v5 bỏ.
6. `z.record(<enum>)` → `z.partialRecord` (2) nếu C1.4 đỏ.
7. Census cấu trúc (contracts, chạy trên zod 4): duyệt mọi schema export, ĐỎ khi gặp `optional` bọc `default` trong schema
   update/patch.

**C4 — gỡ ngoại lệ:** xoá khối `auditConfig` ở `pnpm-workspace.yaml` + mục `EXPIRY` (thành `{}`); script expiry phải in
«✓ không có GHSA nào bị bỏ qua»; `pnpm audit --audit-level=high` = 0 HIGH. Cập nhật `harness/backlog.mjs`.

---

## §4 Chiến lược test

1. **Phong bì lỗi (int-spec, lane DB, `applyMainPipeline`)** — 1 route đại diện cho mỗi loại issue: thiếu field bắt buộc
   (`invalid_type`) · chuỗi/mảng ngắn/dài (`too_small`/`too_big`) · uuid/email/datetime sai (`invalid_string`) · enum sai
   (`invalid_enum_value`) · khoá lạ ở `.strict()` (`unrecognized_keys`, field = path object) · `superRefine`/`refine` có
   `path` (`custom` + thông điệp VN) · discriminated union sai nhánh · path lồng mảng `items.0.x`. Thêm 1 ca body là chuỗi thay
   object (`profile-change-request.controller.ts:94`). Thêm 1 ca `getZodError()` không có `issues` ⇒ 400 không chi tiết,
   KHÔNG 500.
2. **Id canonical:** unit contracts: `idSchema` nhận `00000000-0000-0000-0000-000000000010`, `…0011`, `…0001`, `…00a1`,
   `11111111-1111-1111-1111-111111111111`; từ chối chuỗi rác. Int-spec: 1 route nhận role id canonical (gán vai trò) ⇒ không
   400. Web-core: parse fixture response có id canonical.
3. **Partial/default:** ca hành vi C1.3 + census cấu trúc C3.7.
4. **Record enum-key:** C1.4.
5. **OpenAPI:** smoke dựng tài liệu (`/docs-json` + `gen:openapi`) không ném; cập nhật `openapi-components.spec.ts` có chủ đích.
6. **Env:** spec `env.schema` + `bootstrap-app` đọc cờ qua `.shape`.
7. **Toàn suite:** `bash harness/check.sh --all --lane-db` (tier strict, ~20 phút) — sau C2 (zod 3) và sau C3/C4 (zod 4),
   ≥ 2 lượt; build vite cả 3 app + `pnpm typecheck`; `node --test` cho script expiry; `pnpm audit --audit-level=high`.
8. **Mutant bằng script (rẻ):** (a) `idSchema` → `z.uuid()` ⇒ ca canonical PHẢI đỏ; (b) gỡ bảng alias ⇒ ca phong bì PHẢI
   đỏ; (c) bỏ tách core ở `updateShiftSchema` ⇒ ca partial PHẢI đỏ.
9. **FULL gate** (security-reviewer + silent-failure-hunter + typescript-reviewer, mỗi con có ngân sách lượt công cụ),
   CHẠY TRƯỚC khi mở PR; review hẹp trên diff bản vá.

---

## §5 Runbook deploy (owner, cửa sổ elevated, checkout chính `C:\dev 2\MediaOS`)

Bối cảnh: API PROD (NSSM `MediaOS-API`) resolve `node_modules` của CHECKOUT CHÍNH; `m prod-update api` KHÔNG cài deps;
`m prod-rollback <stamp>` KHÔNG lùi deps; dev-online dùng chung `node_modules`. FE (Pages) tự lên khi merge — dây không đổi
nên FE mới chạy được với API cũ.

1. Sau merge: **KHÔNG chạy bất kỳ `pnpm exec` / `pnpm run` / `pnpm --filter …` nào ở checkout chính** cho tới bước 4
   (pnpm 11 tự cài khi lockfile lệch).
2. Ghi lại `git rev-parse HEAD` (= OLD_SHA) + stamp release hiện tại.
3. `Stop-Service MediaOS-API` → `git pull --ff-only` → `pnpm install --frozen-lockfile`.
4. `m prod-update api` (build + snapshot + activate + restart; WO này không có migration).
5. Đo: `GET /api/v1/health` + `/health/db`; đăng nhập; 1 GET danh sách; 1 request body sai cố ý ⇒ 400 với `details[].rule`
   như ca ghim; `/docs` mở được (nếu bật).
6. **Lùi:** revert merge trên master (PR revert) → `Stop-Service MediaOS-API` → pull → `pnpm install --frozen-lockfile`
   (lockfile cũ) → `m prod-update api`. Chỉ `m prod-rollback` là KHÔNG đủ: release cũ (nestjs-zod 4, `patchNestJsSwagger`)
   chạy trên `node_modules` mới (nestjs-zod 5) ⇒ boot hỏng.
7. Hạn: xong trước **23/11/2026**. fbpost không đổi.

---

## §6 Ước giá THI CÔNG (không gồm L0)

| Hạng mục | USD |
| --- | --- |
| plan-review đối kháng (ngân sách lượt) | 20–40 |
| C1 ca ghim (int-spec lane DB + unit) | 40–70 |
| C2 codemod bằng script + tách core cho partial/default | 35–70 |
| C3 nâng deps + sửa TS 6 gói + filter/alias + swagger | 90–170 |
| OpenAPI (coerce.date, kỳ vọng tài liệu) | 15–40 |
| Toàn suite ×3 (1 trên zod 3, 2 trên zod 4) + build FE | 30–60 |
| FULL gate có ngân sách + review hẹp | 40–70 |
| Vòng vá sau review | 20–40 |
| **Tổng** | **≈ 290–560** |

Lý do: số đo đợt trước — WO đỏ BE có lane DB + FULL gate ≈ 250–450; WO có migration + 2 module + FE ≈ 400–550
(`S16-SOCIAL-DASH-1` ≈ 497). WO này không có migration nhưng chạm 6 gói và 1.122 chỗ id (rẻ nhờ codemod script, ~10× rẻ hơn
giao agent). Cổng toàn suite ≥ 2 lượt × ~20 phút.

**Ngưỡng dừng:** đã tiêu 400 USD mà suite trên zod 4 chưa xanh ⇒ dừng, hỏi owner. **Nếu dự báo > 600 (khoản owner duyệt cho
ZOD4, gồm cả L0):** (a) cắt C1+C2 thành PR-A (zod 3, trung tính, deploy thường), dừng; (b) gia hạn `EXPIRY` kèm lý do
(owner đã duyệt trước đường lùi này; `until` tối đa 45 ngày kể từ ngày sửa — sửa 26/10 thì muộn nhất 2026-12-10); (c) hoãn
phần không chặn: độ đẹp tài liệu OpenAPI (chỉ sửa chỗ ném), kiểu `useForm` theo khuôn cơ học.

---

## §7 SQL ĐẾM chỉ-đọc trên PROD (owner chạy)

Chạy bằng **superuser** (vd `psql -U postgres` trong container DB PROD). Bảng có RLS + FORCE: role thường mà không đặt
`app.current_company_id` sẽ thấy 0 hàng ⇒ số 0 GIẢ. Câu 0 chặn điều đó. Chỉ in số đếm, không in giá trị. Quét toàn bảng ⇒
chạy giờ thấp điểm.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '300s';

-- 0) Chặn số 0 giả: role phải vượt RLS
SELECT current_user,
       CASE WHEN r.rolsuper OR r.rolbypassrls THEN 'OK'
            ELSE 'DỪNG: role bị RLS lọc — mọi số đếm sẽ = 0 giả' END AS rls_guard
FROM pg_roles r WHERE r.rolname = current_user;

-- 1) Cột uuid / uuid[]: số giá trị KHÔNG đạt RFC (zod 4 .uuid() từ chối; z.guid() nhận), theo bảng.cột
WITH cols AS (
  SELECT c.table_schema::text AS table_schema, c.table_name::text AS table_name, c.column_name::text AS column_name, c.udt_name::text AS udt_name
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
    AND c.udt_name IN ('uuid', '_uuid')
), counts AS (
  SELECT table_schema, table_name, column_name, udt_name,
    (xpath('/row/n/text()', query_to_xml(format(
       CASE WHEN udt_name = 'uuid'
         THEN 'SELECT count(*) AS n FROM %1$I.%2$I WHERE %3$I IS NOT NULL AND %3$I::text !~ %4$L'
         ELSE 'SELECT count(*) AS n FROM %1$I.%2$I x, unnest(x.%3$I) AS u(v) WHERE v IS NOT NULL AND v::text !~ %4$L'
       END,
       table_schema, table_name, column_name,
       '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
     ), false, true, '')))[1]::text::bigint AS non_rfc
  FROM cols
)
SELECT table_schema, table_name, column_name, udt_name, non_rfc
FROM counts WHERE non_rfc > 0
UNION ALL
SELECT '(tổng)', count(*)::text || ' cột', '', '', coalesce(sum(non_rfc), 0)::bigint FROM counts WHERE non_rfc > 0
ORDER BY 5 DESC, 2, 3;

-- 2) Cột text/varchar tên *_id: giá trị dạng GUID nhưng không đạt RFC (id lưu dạng chữ, vd audit object_id)
WITH cols AS (
  SELECT c.table_schema::text AS table_schema, c.table_name::text AS table_name, c.column_name::text AS column_name
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
    AND c.data_type IN ('text', 'character varying')
    AND (c.column_name = 'id' OR c.column_name LIKE '%\_id' ESCAPE '\')
), counts AS (
  SELECT table_schema, table_name, column_name,
    (xpath('/row/n/text()', query_to_xml(format(
       'SELECT count(*) AS n FROM %1$I.%2$I WHERE lower(%3$I) ~ %4$L AND lower(%3$I) !~ %5$L',
       table_schema, table_name, column_name,
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
       '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
     ), false, true, '')))[1]::text::bigint AS guid_non_rfc
  FROM cols
)
SELECT table_schema, table_name, column_name, guid_non_rfc
FROM counts WHERE guid_non_rfc > 0 ORDER BY guid_non_rfc DESC, table_name;

-- 3) Cột text tên *email*: giá trị không rỗng KHÔNG khớp regex email của zod 4
WITH cols AS (
  SELECT c.table_schema::text AS table_schema, c.table_name::text AS table_name, c.column_name::text AS column_name
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
    AND c.data_type IN ('text', 'character varying', 'USER-DEFINED')
    AND c.column_name LIKE '%email%'
), counts AS (
  SELECT table_schema, table_name, column_name,
    (xpath('/row/n/text()', query_to_xml(format(
       'SELECT count(*) AS n FROM %1$I.%2$I WHERE %3$I IS NOT NULL AND %3$I::text <> '''' AND %3$I::text !~ %4$L',
       table_schema, table_name, column_name,
       '^([A-Za-z0-9_''+-]+\.)*[A-Za-z0-9_''+-]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$'
     ), false, true, '')))[1]::text::bigint AS email_non_v4
  FROM cols
)
SELECT table_schema, table_name, column_name, email_non_v4
FROM counts WHERE email_non_v4 > 0 ORDER BY email_non_v4 DESC, table_name;

ROLLBACK;
```

Đọc kết quả: câu 1 > 0 ở bảng id vai trò/gói/PM là ĐÃ BIẾT (id canonical) ⇒ xác nhận `idSchema = z.guid()` là bắt buộc.
Câu 3 > 0 ⇒ form/endpoint có `.email()` sẽ từ chối dữ liệu cũ khi gửi lại ⇒ quyết định giữ regex v3 cho trường đó.

---

## §8 Rủi ro

| Mức | Rủi ro | Chặn bằng |
| --- | --- | --- |
| **CRITICAL (im lặng)** | `.partial()` trên object có `.default()` ⇒ zod 4 ÁP default cho field vắng ⇒ PATCH ghi đè (đã xác nhận `updateShiftSchema`, 8 field); typecheck KHÔNG bắt | C2.4 tách core + ca hành vi C1.3 + census C3.7 + mutant (c) |
| HIGH | `.uuid()` chặt RFC từ chối id canonical (role `…0010/0011`, PM `…0001/0002/0008/0009`, payroll `…0015`, gói `…00a1-a3`) ⇒ 400 ở input + **FE parse response vỡ** (web-core) | `idSchema = z.guid()` + ratchet cấm `.uuid(` + ca canonical + §7 câu 1 |
| HIGH | Mã `rule` + thông điệp mặc định trên dây đổi (`invalid_string→invalid_format` …) | bảng alias + int-spec phong bì + mutant (b) |
| MEDIUM | nestjs-zod 5 `getZodError(): unknown` — thu hẹp sai ⇒ lỗi validate thành 500 | thu hẹp theo hình dạng + ca không-có-issues |
| MEDIUM | `z.record(<enum>)` vét cạn: asset `byStatus` (response) / payroll `inputs` (body) | `z.partialRecord` + ca C1.4 |
| MEDIUM | OpenAPI qua `z.toJSONSchema`: 27 `z.coerce.date()` unrepresentable ⇒ `/docs-json`/`gen:openapi` có thể ném; kỳ vọng tài liệu đổi | smoke OpenAPI + cập nhật có chủ đích |
| MEDIUM | `.default()` short-circuit — default sau transform/trim không đi qua pipeline; TS chỉ bắt khi lệch kiểu | soi C2.5 |
| MEDIUM | resolvers v5 đổi kiểu `useForm` (30 chỗ) | generic `z.input/z.output` |
| MEDIUM | Hai bản zod cùng sống (nestjs-zod 4 kéo zod 3 + `@nest-zod/z`) ⇒ audit đỏ + kiểu lệch | catalog 1 phiên bản + kiểm lockfile |
| MEDIUM | Deploy: PROD chạy trên `node_modules` checkout chính; `prod-rollback` không lùi deps; pnpm 11 tự cài | runbook §5 |
| LOW–MED | `moduleResolution: node` (api + contracts CJS): `.d.ts` của nestjs-zod 5 có thể import `zod/v4/core` (thư mục vật lý có sẵn trong gói zod 4.6.7) | typecheck sớm ở C3.1 |
| LOW | `envSchema.innerType()` ở test helper ⇒ đổi `.shape`; env boot sai = ồn ào (không im lặng) | spec env |
| LOW | `.email()` regex v4 hơi khác v3 | §7 câu 3 |
| LỊCH | Quá 23/11 ⇒ job audit đỏ trên MỌI PR | ngưỡng dừng §6 + gia hạn EXPIRY |

---

## §9 Plan v2 — sửa theo plan-review (26/10, PASS_WITH_FIXES) + đo lại 06/11/2026

> v2 GHI ĐÈ v1 ở mọi chỗ mâu thuẫn. Base thi công: master `ca9259c5`. Worktree `C:/dev 2/MediaOS-zod4`, lane `mediaos_zod4`.

### 9.1 Phiên bản đích (đo `npm view` 06/11)

| Gói | Từ | Đến | Ghi chú |
| --- | --- | --- | --- |
| `zod` | 3.25.76 | **`4.6.7`** (ghim thẳng ở 6 `package.json`, KHÔNG dùng `catalog:`) | 4.6.7 phát hành 12/10 · bỏ catalog để khỏi phụ thuộc pnpm của CI/Pages |
| `nestjs-zod` | 4.3.1 | **`^5.5.0`** | 25/07 · peer `zod ^3.25 \|\| ^4` · dep runtime chỉ `deepmerge` · bỏ `@nest-zod/z` |
| `@hookform/resolvers` | 3.10.0 | **`^5.2.2`** (resolve 5.9.x) | KHÔNG lấy 6.x/7.x (major mới, phát hành 19/10–05/11) |
| `@anthropic-ai/sdk` | — | không đổi | peer optional zod ⇒ lockfile phải re-key `(zod@4.6.7)` |

Kiểm sau install: lockfile chỉ còn MỘT `zod@4.6.7`, không còn `zod@3`, không còn `@nest-zod/z`.

### 9.2 Quyết định theo từng finding

1. **HIGH — `.uuid()` trên đường crown-jewel.** Codemod C2.1 phủ cả `apps/api/src/db/db.service.ts:16` (`companyIdSchema`, cổng duy nhất
   trước `set_config('app.current_company_id')`) và `apps/api/src/auth/auth.service.ts:85` (`uuidSchema`, dùng cho session id + company id).
   C1 thêm ca DƯƠNG: `withTenant('00000000-0000-0000-0000-000000000001', fn)` không ném (giữ nguyên các ca rác ⇒ `InvalidCompanyIdError`);
   ca tương tự cho hai lối dùng `uuidSchema` của auth. Mutant (a) `idSchema → z.uuid()` phải làm đỏ CẢ ca withTenant.
   **FULL gate = security-reviewer + database-reviewer + silent-failure-hunter + typescript-reviewer.** CẤM «vá nhanh» bằng `z.string()` trơn.
2. **HIGH — runbook.** §5 bước 3 sửa: liệt kê và dừng MỌI tiến trình nạp `C:\dev 2\MediaOS\node_modules` (MediaOS-API, API/FE dev-online
   watch, dashboard, tác vụ lịch) — lọc theo ĐƯỜNG DẪN dòng lệnh, KHÔNG diệt theo tên ảnh; kiểm còn 0 tiến trình rồi mới install. Đường lùi:
   `pnpm install --frozen-lockfile --offline`. Cổng C3 thêm ca BOOT app theo đường `setupSwagger` (NODE_ENV≠production ⇒ `buildOpenApiDocument`
   chạy lúc boot). Bước 5 thêm: boot dev-online + health của nó.
3. **MEDIUM — alias `rule`.** CHỌN (b) giữ dây ổn định: bảng alias v4→v3 trong filter gồm `invalid_format→invalid_string` ·
   `invalid_value→invalid_enum_value` (≥2 giá trị) / `invalid_literal` (1 giá trị) · `invalid_union` có `discriminator`/`note`
   →`invalid_union_discriminator` VÀ nối khoá discriminator vào path (field như v3) · `invalid_type` cho Date sai →`invalid_date`.
   Không khớp ⇒ giữ mã v4 (không nuốt). C1.1 ghim ca discriminator sai CẢ `field` lẫn `rule`. Thông điệp mặc định tiếng Anh
   (`Required` → `Invalid input: …`) được phép đổi, TRỪ khi grep thấy FE hiển thị `details[].message` thô — khi đó dùng `z.config({ customError })`.
4. **MEDIUM — census default.** C3.7 duyệt MỌI schema export (contracts + schema cục bộ web-core/app), ĐỎ với mọi `optional(default|prefault)`
   (allowlist kèm lý do) và với `ZodDefault` bọc `ZodObject` có field default (phải dùng `.prefault`). C2.4 ghi bảng kết quả soát từng chỗ
   trong 33 `.partial()` (an toàn / đã tách) vào §10 của tệp này.
5. **MEDIUM — response web-core.** `.email()` dùng chung `emailSchema` ở `packages/contracts/src/common/` với regex Y HỆT zod 3 ⇒ hành vi
   trung tính, khỏi phụ thuộc số đếm PROD (§7 câu 3 thành tham khảo). `z.record(<enum>)` response → `z.partialRecord`. C1 thêm ca web-core
   parse fixture response có id canonical + record thiếu khoá.
6. **MEDIUM — ngân sách.** Trần owner 650 (gồm L0 ≈ 25). Điểm quyết định sau C2: đã tiêu > 250 ⇒ cắt C1+C2 thành PR-A. Ngưỡng dừng cứng
   ≈ 350 mà suite zod 4 chưa xanh ⇒ dừng hỏi owner (đường lùi đã duyệt: gia hạn EXPIRY kèm lý do, `until` ≤ 45 ngày).
7. **LOW — deps phụ.** Xem 9.1 (không catalog; resolvers dòng 5; anthropic re-key). Nếu minimumReleaseAge chặn ⇒ thêm vào exclude kèm lý do.
8. **LOW — ratchet `.uuid(`.** Viết bằng AST TypeScript (chỉ CallExpression có property `uuid`), không regex thô (khỏi khớp chú thích). Các
   chỗ `.uuid(` không đúng dạng `z.string().uuid()` liệt kê ở §10 kèm cách xử lý.
9. **LOW — phạm vi R2.** Không liên quan WO này (đã trả lời owner riêng 26/10).

### 9.3 Thứ tự (giữ §3.3, thêm)

- C1: + ca withTenant/auth dương (9.2-1) · ca discriminator ghim field (9.2-3) · ca web-core response (9.2-5).
- C2: + `emailSchema` (9.2-5) · bảng soát `.partial()` (9.2-4) · ratchet AST (9.2-8). Kết thúc C2: `bash harness/check.sh --all --lane-db=zod4` XANH trên zod 3.
- C3: + ca boot `setupSwagger` (9.2-2) · census mở rộng (9.2-4).
- Cổng trước PR: FULL gate 4 reviewer (9.2-1) có ngân sách lượt → vá → review hẹp → `check.sh --all --lane-db=zod4` → PR (body ghi runbook §5 + 9.2-2).
