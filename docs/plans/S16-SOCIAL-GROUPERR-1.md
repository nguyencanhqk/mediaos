# S16-SOCIAL-GROUPERR-1 — cấp `owner` qua `manage:feed-group` bất kể vai · mã lỗi SOCIAL lên `error.code`

> 🔴 Vùng đỏ (đổi cổng cấp vai nhóm + hợp đồng lỗi toàn module). Nhánh `feat/s16-social-grouperr-1`,
> base master `a01494e9`. Nguồn: plan `S16-SOCIAL-FE-2B` §1.b M1/M10 + §7 N1/N2.
> Owner ký 29/09/2026: **O1** mã sentinel có tên (KHÔNG đánh số mới, KHÔNG sửa SPEC-16 §12) ·
> **O2** toàn module SOCIAL · **O3** gate FULL 3 (security + silent-failure + typescript) + react ·
> **O4** FE đọc `code`, giữ fallback tiền tố message MỘT bản (deploy lệch) · **O5** tự-phong owner qua
> `manage` giữ như hôm nay.

## 0. Khảo sát — đo được (workflow đọc 5 lane, 29/09/2026)

**Phần (1) — cấp owner.**
- Gốc: `assertGroupRoleTx` (`social-group-access.service.ts:121-127`) trả `viaManage:false` NGAY khi vai
  hàng khớp `allowedRoles`, không nhìn `canManageGroups`. `viaManage` nghĩa là «vai hàng TRƯỢT nhưng
  manage cứu», KHÔNG phải «actor có manage». `decideMember` (`social-groups.service.ts:404-407`) lại dùng
  nó làm cổng cấp owner ⇒ đúng 1/10 hồ sơ actor hỏng: **admin active + manage ⇒ 403 ERR-014**. Cùng
  người đó xoá được nhóm qua `034` (ở đó `allowedRoles=['owner']` ⇒ `viaManage:true`) ⇒ 403 là lệch,
  không phải hàng rào.
- Luật (SPEC-16 §12 ERR-014 `:324` · plan BE-2A D12 `:111`/T4 `:434`): chỉ `owner` hiện tại **hoặc
  `manage:feed-group`** được cấp owner. Người bị ảnh hưởng thật: vai canonical `hr` + `company-admin`
  (duy nhất giữ `manage:feed-group`, `0578:96-97`) khi được người khác phong admin nhóm.
- 5 caller của `assertGroupRoleTx` (033/034/037/038/039). **`033` rẽ nhánh audit theo `viaManage`** (chỉ
  ghi khi đi qua manage — ca G8) ⇒ KHÔNG đổi ngữ nghĩa hàm dùng chung; vá cục bộ ở `decideMember`.
- Không ca HTTP nào phủ «manage cấp owner» (ca manage `:507-517` chỉ duyệt). Không fixture nào vừa
  có vai hàng vừa có manage.

**Phần (2) — mã lỗi.**
- `SOCIAL_ERR` = **53 khoá**: 28 có số (22 mã 001–022) + 25 không số (`"SOCIAL-ERR: …"`). **53 thông
  điệp đôi một KHÁC nhau**, không cái nào là tiền tố của cái khác (đo bằng tsx).
- Ném: **91** chỗ dạng thẳng `new XException(SOCIAL_ERR.K)` (35 NotFound · 24 Conflict · 20
  Unprocessable · 12 Forbidden) + **7 đường gián tiếp**: `SOCIAL_POST_TYPE_DENIED[type]`
  (`social-access.service.ts:257`) · `SOCIAL_FILE_TARGET_DENIED[target]` (`:333`, và qua
  `AttachNewGate.reason` → `SocialAttachGateDeniedException` `social-attachments.service.ts:75-86,415`) ·
  `SocialPair.denyMessage` (`social-access.service.ts:181,188`) · factory `unavailable()`
  (`social-reports.service.ts:315`).
- **4 chuỗi NẰM NGOÀI bảng** (không cơ chế nào tự phủ): `SOCIAL_POST_TYPE_PAIR_DESYNC` (403,
  `social.errors.ts:498`) · `SOCIAL_CURSOR_INVALID` + `SOCIAL_CURSOR_FILTER_MISMATCH` (**400** nhưng tiền
  tố `SOCIAL-ERR-001` = mã 404 của SPEC, `social-feed-cursor.ts:44-47`) · literal pin
  `"SOCIAL-ERR-010: chỉ ghim được bài tin tức"` (**422** nhưng `010` là 403 quyền,
  `social-posts-moderation.service.ts:144`; KHÔNG ca test nào chạm).
- Giữ nguyên mã chung (không phải lỗi SOCIAL): fallback `resolveActor` `"AUTH-ERR-FORBIDDEN: …"`/
  `"AUTH-ERR-SCOPE-DENIED: …"` (`:181,188`) · `"RESOURCE-ERR-NOT-FOUND: file not found"`
  (`social-files.service.ts:148`) · tầng-1 `PermissionGuard` · Zod/ParseUUID 400 · idempotency 409 ·
  FileService · `new Error` bất biến → 500.
- NestJS **11.1.24**: `new XException({code, message})` ⇒ `createBody` trả CHÍNH object,
  `initMessage` lấy `response.message` ⇒ `exception.message` byte-y-hệt chuỗi cũ; `AllExceptionsFilter`
  (`:95-104`) phát `error.code = payload.code`. Không ai trong Nest/kho sửa object response.
- **Test (quyết định cơ chế):** biến hằng thành object (Option C) làm ~130 assert đổi hành vi — 73 chỉ đỏ
  khi có `LANE_DB`, và **4 ca `.not.toContain(SOCIAL_ERR.X)` thành XANH-RỖNG im lặng** (chuỗi không bao
  giờ chứa `"[object Object]"`). Giữ chuỗi + bọc ở chỗ ném (Option W) ⇒ **0 assert cũ đổi**.
- Không test nào assert `body.error.code` trên route SOCIAL; không suite chung nào (route census,
  filter spec, ma trận quyền) ghim mã chung cho route SOCIAL ⇒ không gì lật. Mặt trái: **chưa có bằng
  chứng nào** mã SOCIAL tới được envelope.
- FE: `ApiError.kind` suy từ status (+ 3 mã đặc biệt không trùng SOCIAL) ⇒ 403/404/409/422/400 cho ra
  CÙNG `kind` trước/sau. Nơi DUY NHẤT đọc mã SOCIAL: `groups/lib/group-errors.ts`. `canGrantOwner`
  (`group-capabilities.ts:71`) CỐ Ý soi gương bug BE ⇒ phải nới cùng PR.
- Docs: API-19 §6.5 (`:545-555`) chỉ «Theo API-01» + liệt kê mã, **không nói mã nằm ở đâu trên dây**
  (`error.code` xuất hiện 0 lần) — trong khi API-01 §12/§13 hứa `error.code` mang mã module. Khuôn chữ:
  API-14 §7.4 (`:229-240`) · API-15 §7.4 (`:206-227`).

## 1. Quyết định

| # | Quyết định | Lý do |
| --- | --- | --- |
| D1 | **Vá cục bộ `decideMember`**, KHÔNG đổi `assertGroupRoleTx`: cổng cấp owner đổi `!viaManage` → `!actor.canManageGroups`; audit `role_changed.viaManage = viaManage \|\| (dto.role==='owner' && !actorIsOwner)` | Đổi hàm dùng chung làm `033` ghi audit cho owner/admin+manage (G8 đỏ) và dán nhãn sai metadata `034/039`. Khi admin+manage cấp owner, quyền THẬT đến từ manage ⇒ sổ phải nói `viaManage:true` |
| D2 | Cổng re-check SAU khoá (`:366`) **giữ nguyên** | Ca đua «admin+manage bị hạ vai giữa chừng» hôm nay 403 = fail-CLOSED, không phải lỗ. Nới nó là thay đổi hành vi thứ hai cần harness đua riêng — ngoài `done_when` |
| D3 | `actor.canManageGroups` đọc từ `SocialActor` đã resolve TRƯỚC tx (sàn Company) | Không thêm vòng quyền, không `withTenant` lồng (luật #1 của `social-group-access.service.ts`) |
| D4 | O5: tự-phong owner qua manage **cho phép** (member/non-member + manage đã làm được hôm nay) | Không đẻ luật mới ngoài `done_when`; audit `viaManage:true` giữ truy vết |
| D5 | **Cơ chế mã = Option W có kiểu**: giữ `SOCIAL_ERR` là CHUỖI; mọi chỗ ném bọc `socialError(SOCIAL_ERR.K)` → `{code, message}` | 0 assert cũ đổi; census 2 tầng vẫn quét được `SOCIAL_ERR.K`; `message` byte-y-hệt |
| D6 | `socialError(message: SocialErrorMessage)` — tham số là **union literal** các giá trị `SOCIAL_ERR` ⇒ chuỗi lạ là LỖI BIÊN DỊCH. Tra mã qua Map dựng từ `Object.keys(SOCIAL_ERR)` (KHÔNG liệt kê `SOCIAL_ERR.X` tay — sẽ làm tầng B của census tha mọi hằng). Không thấy ⇒ ném `Error` (500 có log), KHÔNG rơi về mã chung im lặng | Fail-LOUD thay vì fail-quiet; nhánh chỉ tới được khi ai đó ép kiểu |
| D7 | Nguồn sự thật MÃ = **`packages/contracts/src/social-errors.ts`**: `SOCIAL_ERROR_CODES` khoá theo ĐÚNG tên khoá `SOCIAL_ERR` (khuôn `IDEMPOTENCY_ERROR_CODES`) + type `SocialErrorCode` + `isSocialErrorCode()`. BE import; FE so với hằng | FE không hard-code chuỗi mã; một chỗ đổi |
| D8 | Tập khoá `SOCIAL_ERR` ≡ tập khoá `SOCIAL_ERROR_CODES` — ép **2 chiều ở tầng kiểu** (type-assert bằng nhau) + unit test runtime | Thêm hằng lỗi mà quên mã ⇒ TS đỏ, không có đường ship thiếu |
| D9 | O1: khoá không số ⇒ mã sentinel `SOCIAL-ERR-<KHOÁ, '_'→'-'>` (vd `SOCIAL-ERR-GROUP-NAME-TAKEN`), MỖI khoá một mã riêng (KHÔNG một sentinel chung — FE cần phân biệt `nameTaken` vs `stateChanged`) | Khuôn `ASSET-ERR-NOT-FOUND`/`ROOM-ERR-NOT-FOUND`; API-01 §13.1 cho `MODULE-ERR-CODE` |
| D10 | Thông điệp GIỮ tiền tố hiện có (`SOCIAL-ERR-0xx: ` / `SOCIAL-ERR: `). Luật mới: khoá có số ⇒ tiền tố message = đúng `code`; khoá sentinel ⇒ tiền tố `SOCIAL-ERR: ` | Deploy lệch an toàn khi BE lên trước (FE cũ vẫn đọc tiền tố) + census giữ nguyên |
| D11 | 4 chuỗi ngoài bảng **dời VÀO `SOCIAL_ERR`**: `POST_TYPE_PAIR_DESYNC` (403) · `CURSOR_INVALID` + `CURSOR_FILTER_MISMATCH` (400) · `PIN_NEWS_ONLY` (422). Ba cái sau **đổi tiền tố message sang `SOCIAL-ERR: `** (tiền tố 001/010 cũ nói SAI mã: 400 đọc thành «không tìm thấy», 422 đọc thành «thiếu quyền»). Gỡ 3 hằng rời, spec import `SOCIAL_ERR.*` | Một nguồn; FE không bao giờ nhận `001` trên một 400 |
| D12 | `SocialPair.denyMessage` · `SOCIAL_POST_TYPE_DENIED` · `SOCIAL_FILE_TARGET_DENIED` · `AttachNewGate.reason` · ctor `SocialAttachGateDeniedException` đổi kiểu `string` → `SocialErrorMessage`; ctor tự bọc `super(socialError(reason))` | Siết kiểu = TS canh luôn các đường gián tiếp |
| D13 | Fallback `resolveActor` (`AUTH-ERR-*`) · `RESOURCE-ERR-NOT-FOUND` của `055` · lỗi module khác: **giữ mã chung**, khai trong allowlist của ratchet kèm lý do | Không phải lỗi SOCIAL. Lệch `AUTH-ERR-SCOPE-DENIED` (message) ↔ `AUTH-ERR-FORBIDDEN` (code) có sẵn ⇒ ghi nợ, KHÔNG sửa ở đây (đổi `kind` FE thành `SCOPE_DENIED`) |
| D14 | O4 FE: `socialErrorCode(err)` = `err.code` nếu `isSocialErrorCode`; NGƯỢC LẠI rơi về đọc tiền tố message (nhánh cũ, đánh dấu `LEGACY-PREFIX` + WO gỡ). `groupErrorReason`: đường mã chính xác (sentinel `GROUP_NAME_TAKEN` → `nameTaken`, `GROUP_MEMBER_NOT_FOUND` → `stateChanged`); heuristic status+action cũ CHỈ chạy khi mã không phải SOCIAL | API cũ (FE deploy trước) giữ nguyên hành vi hôm nay; API mới dùng mã |
| D15 | FE `canGrantOwner = isOwner \|\| canManage` — cùng PR với BE | Tách ra thì hoặc nút tắt cho việc server cho phép, hoặc nút bật chắc chắn 403 |

## 2. Việc (thứ tự = thứ tự commit)

1. **backlog**: `done_when` (2) sửa theo O1 («mang mã sentinel có tên — owner ký O1»); thêm `plan`,
   `apps/app/src/i18n/**` vào `paths` (chỉ sửa comment i18n); seed 3 nợ (§5).
2. **RED trước** (§3): int-spec phần (1) + int-spec mã trên dây + unit `social.errors.spec.ts` + FE spec
   — chạy thấy ĐỎ đúng lý do trên code cũ.
3. **contracts** `social-errors.ts` (D7/D9) + barrel `index.ts` (khối additive, comment theo khuôn).
4. **`social.errors.ts`**: thêm 4 khoá D11; `socialError()` (D6); ép tập khoá (D8); docblock mới «mã ở
   đâu trên dây». Gỡ `SOCIAL_POST_TYPE_PAIR_DESYNC` rời (D11); gỡ `SocialErrorMessage` cũ nếu thay
   bằng union literal cùng tên.
5. **Bọc 91 + 7 chỗ ném** ở `src/social/**` (máy móc, từng file); đổi kiểu D12; cursor + pin D11.
6. **Ratchet cấu trúc** (§3 C-S): chặn chỗ ném trần trong `src/social`.
7. **Phần (1)** `decideMember` (D1).
8. **FE**: `group-errors.ts` (D14) · `group-capabilities.ts` (D15) · test doubles · specs · comment i18n.
9. **Docs**: API-19 §6.5 viết lại theo khuôn API-14/15 §7.4 (mã ở `error.code`, bảng sentinel, luật
   tiền tố message) + dòng `038` thêm câu cấp owner; plan FE-2B §7 N1/N2 ghi «đã trả ở GROUPERR-1».
10. `check.sh --quick` → FULL gate (O3) → vá (mỗi vá có ca RED) → `check.sh --all --lane-db=grouperr1`
    → PR.

## 3. Test (RED trước) — assert theo HẰNG

**Phần (1)** — `apps/api/test/integration/social-be2a-group-members.int-spec.ts` (tái dùng
`makeUser`/`seedGroup`/`assertCount`, fixture `manager` = BASE + `manage:feed-group`):
- **R1 (RED)** admin+manage cấp owner cho member khác ⇒ 200, hàng đích `role='owner'`, audit
  `social.group_member.role_changed` actor = manager, metadata ⊇ `{targetUserId, from:'member',
  to:'owner', viaManage:true}`. Hôm nay 403.
- **R2 (DENY)** admin KHÔNG manage cấp owner cho NGƯỜI KHÁC ⇒ 403 `GROUP_ROLE_REQUIRED`, đích vẫn
  `member`, 0 dòng audit `role_changed` (G5b chỉ phủ tự-nâng).
- **R3 (ALLOW)** owner cấp owner ⇒ 200, audit `viaManage:false`.
- **R4/R5/R6 (ghim)** manage non-member · manage pending (nhóm private) · manage member active cấp owner
  ⇒ 200, `viaManage:true` — chặn bản vá thu hẹp hành vi đã ship.
- **R8 (ghim O5)** admin+manage tự phong CHÍNH MÌNH owner ⇒ 200, `viaManage:true`.
- Mutant: hoàn tác vá ⇒ R1 đỏ với thông điệp `expected 403 to be 200` (khớp THÔNG ĐIỆP, không chỉ đỏ).

**Phần (2)** — int-spec MỚI `apps/api/test/integration/social-grouperr1-wire-codes.int-spec.ts` (HTTP
thật qua pipeline y hệt `main.ts` — helper của `S16-TEST-PIPELINE-PARITY-1`), mỗi ca assert
`body.error.code === SOCIAL_ERROR_CODES.K` **và** `body.error.message === SOCIAL_ERR.K`:
- W1 404 `GROUP_NOT_FOUND` (`SOCIAL-ERR-012`) · W2 403 `GROUP_ROLE_REQUIRED` · W3 409 `GROUP_LAST_OWNER`
  · W4 409 `GROUP_MEMBERSHIP_EXISTS` · W5 409 sentinel `GROUP_NAME_TAKEN` · W6 404 sentinel
  `GROUP_MEMBER_NOT_FOUND` · W7 422 `REPLY_DEPTH` (hoặc 422 số khác rẻ hơn) · W8 404 `POST_NOT_FOUND`
  · W9 400 `CURSOR_INVALID` (mã sentinel, KHÔNG `001`) · W10 422 `PIN_NEWS_ONLY` (ca đầu tiên chạm
  nhánh này) · W11 403 đường GIÁN TIẾP `SOCIAL_POST_TYPE_DENIED` (vai tuỳ biến thiếu `create:feed-poll`,
  khuôn N1 BE-2B-1) · W12 403 `IDEA_APPROVE_REQUIRED` qua `denyMessage` (khuôn I-1/I-2 BE-2B-2).
- W13 (neo mã CHUNG giữ nguyên) tầng-1 `PermissionGuard` 403 ⇒ `AUTH-ERR-FORBIDDEN`; ParseUUID 400 ⇒
  `VALIDATION-ERR-001` — lỗi không phải SOCIAL KHÔNG bị dán mã SOCIAL.
- Mutant: gỡ bọc ở 1 chỗ ném (vd W1) ⇒ W1 đỏ đúng `expected 'RESOURCE-ERR-NOT-FOUND' to be 'SOCIAL-ERR-012'`.

**Unit** — `apps/api/src/social/social.errors.spec.ts` (mới):
- U1 tập khoá `SOCIAL_ERR` ≡ `SOCIAL_ERROR_CODES` (2 chiều). U2 53+4 thông điệp đôi một khác nhau. U3
  khoá có số: tiền tố message `^SOCIAL-ERR-\d{3}: ` == code. U4 khoá sentinel: message bắt đầu
  `SOCIAL-ERR: ` và code khớp `^SOCIAL-ERR-[A-Z]+(-[A-Z]+)+$`, KHÔNG khớp `\d{3}`. U5 mã có số ∈ tập
  SPEC-16 §12 (`001..022`). U6 `socialError` trả `{code,message}` đúng cho MỌI khoá; object mới mỗi
  lần (không chia sẻ tham chiếu). U7 `new NotFoundException(socialError(…))` ⇒ `getResponse().code`
  + `.message` đúng (neo khẳng định Nest 11.1.24).

**Ratchet cấu trúc (C-S)** — mở rộng `social-error-code-census.spec.ts` thêm tầng C: trong `src/social`
(non-spec, bỏ comment) mọi `new \w+Exception(` phải có đối số bắt đầu `socialError(`; ngoại lệ là
allowlist ĐÓNG (file + đoạn + lý do): 2 fallback `AUTH-ERR-*` của `resolveActor` · `RESOURCE-ERR-NOT-FOUND`
của `social-files.service.ts` · `super(` trong `SocialAttachGateDeniedException` (tự bọc). Neo dương:
đếm được ≥ 95 chỗ bọc; allowlist ≤ 4 và mỗi mục còn khớp đúng 1 chỗ (mục mồ côi ⇒ đỏ). Tầng A thêm
`PIN_NEWS_ONLY`, `CURSOR_INVALID`, `CURSOR_FILTER_MISMATCH`, `POST_TYPE_PAIR_DESYNC` (nếu có ca chạm;
DESYNC không dựng được qua HTTP ⇒ chỉ tầng B + unit), `GROUP_NAME_TAKEN`, `GROUP_MEMBER_NOT_FOUND`.

**FE** — `group-errors.spec.ts`: ca theo MÃ (API mới) cho 012/013(join vs khác)/015/sentinel nameTaken/
sentinel memberNotFound; ca LEGACY (mã chung + tiền tố) giữ nguyên hành vi cũ; ca «mã SOCIAL thắng tiền
tố» (code 013 nhưng message giả tiền tố 015 ⇒ theo code). `group-capabilities.spec.ts`: ca M10 lật
(admin+active+manage ⇒ true) + DENY admin không manage ⇒ false. `GroupAdminTabs.spec.tsx`: thêm ALLOW
`capsFor("admin", true)` bật option Chủ nhóm và gửi `{role:'owner'}`. Test doubles: đường mới dùng mã
SOCIAL; giữ 1 double dạng LEGACY cho ca fallback.

## 4. Rủi ro

| Rủi ro | Chặn bằng |
| --- | --- |
| Một chỗ ném mới quên bọc ⇒ mã chung im lặng (fail-quiet) | Ratchet C-S (tĩnh) + W-cases (runtime) |
| Bọc nhầm HẰNG khác lúc sửa máy móc 98 chỗ | Diff chỉ thêm `socialError(`…`)` — review cơ học: `git diff -U0 | grep '^-'` phải khớp 1-1 với `^+` sau khi gỡ wrapper; int-spec cũ assert message theo hằng |
| Đổi tiền tố message cursor/pin làm FE cũ hiểu khác | Chỉ group-errors đọc tiền tố, và chỉ 012/013/015 |
| Deploy lệch FE trước API | O4 fallback + BE giữ tiền tố (D10) |
| `socialError` trả object dùng chung bị ai đó sửa | Trả object MỚI mỗi lần (U6) |
| Coverage int-spec bị skip khi thiếu `LANE_DB` ⇒ xanh-giả | `check.sh --all --lane-db=grouperr1` trước PR |

## 5. Nợ ghi backlog (seed cùng PR)

- `S16-SOCIAL-GROUPERR-FEFALLBACK-1` — gỡ nhánh `LEGACY-PREFIX` của `group-errors.ts` SAU khi PROD API
  đã lên bản có mã (O4).
- `S16-SOCIAL-GROUPTOCTOU-1` — `039` không đọc lại vai ACTOR sau `lockGroupRowTx` (cùng lớp TOCTOU `038`
  đã vá); cân nhắc kèm ca đua «admin+manage bị hạ vai giữa chừng» của `038` (D2).
- `S16-SOCIAL-SCOPEDENIEDCODE-1` — `resolveActor` nhánh sàn Company: message `AUTH-ERR-SCOPE-DENIED` nhưng
  `error.code` `AUTH-ERR-FORBIDDEN`.

## 6. Vá plan-reviewer (lượt 1: BLOCK/REVISE) — ĐÈ lên §2/§3 ở những chỗ mâu thuẫn

| # | Phát hiện (đã xác minh bằng code) | Vá |
| --- | --- | --- |
| B1 | Thứ tự §2 cho RED sai lý do: W/U gọi `SOCIAL_ERROR_CODES`/`socialError` ⇒ trên code cũ là lỗi biên dịch, không phải assert đỏ | Thứ tự MỚI: contracts + khung `socialError` + 4 khoá D11 (CHƯA bọc chỗ ném nào) → viết W → chạy thấy đỏ `expected 'RESOURCE-ERR-…' to be 'SOCIAL-ERR-…'` → mới bọc. Phần (1): R1/R8 ĐÃ đo đỏ `expected 403 to be 200` trên code cũ TRƯỚC vá (commit `77c04512`) — ghi chú quy trình của reviewer về điểm này là không đúng |
| B2 | Ratchet C-S: regex `new \w+Exception(` không bao giờ khớp `super(` (mục allowlist mồ côi); lại khớp `new SocialAttachGateDeniedException(` (không có trong allowlist); `new ForbiddenException(p.denyMessage ?? "AUTH-ERR-…")` trộn nhánh SOCIAL với nhánh chung ⇒ allowlist theo đoạn làm gỡ wrapper nhánh `020` vẫn XANH | (1) Tách `resolveActor` ở CẢ HAI chỗ: `if (p.denyMessage) throw new ForbiddenException(socialError(p.denyMessage)); throw new ForbiddenException("AUTH-ERR-…")`. (2) Allowlist CHỈ 4 chỗ thuần-chung: `AUTH-ERR-FORBIDDEN` · `AUTH-ERR-SCOPE-DENIED` (`social-access.service.ts`) · `RESOURCE-ERR-NOT-FOUND` (`social-files.service.ts`) · lời gọi `new SocialAttachGateDeniedException(`. (3) Assert RIÊNG: thân class chứa `super(socialError(reason))` và tham số ctor kiểu `SocialErrorMessage`. (4) Regex chịu xuống dòng: `new\s+\w+Exception\(\s*socialError\(`. (5) Unit `social-access.service.spec.ts` (mock `dataScope`) cho CẢ HAI nhánh `resolveActor` — (a) `routeScopeOrNull == null` (khó tới qua HTTP) · (b) `companyFloor` — assert `getResponse().code === SOCIAL_ERROR_CODES.IDEA_APPROVE_REQUIRED` |
| B3 | W12 ghi «khuôn I-1/I-2» nhưng I-2 là cổng TẦNG 1 (`Permission denied`, `AUTH-ERR-FORBIDDEN`, assert `.not.toContain(IDEA_APPROVE_REQUIRED)`); đường HTTP DUY NHẤT phát `020` là **I-2b** (`approve:feed-idea` @Department ⇒ tầng 1 cho qua, sàn Company chặn) | W12 theo I-2b; W13 (neo mã chung) theo I-2 |
| H1 | D8 viết dạng `} as const satisfies …;` sẽ làm regex strip của census (lười) chạy tới `
} as const;` của `SOCIAL_CONSTRAINT`, nuốt hai bảng throw-site | D8 đã thi công đúng dạng TÁCH khối (type-assert đứng riêng, khối giữ `
} as const;`). Thêm tự-kiểm census: sau strip, `errorsFile` vẫn chứa `SOCIAL_POST_TYPE_DENIED` + `SOCIAL_FILE_TARGET_DENIED` |
| M1 | Người dùng các hằng D11 gỡ chưa liệt kê | `social-error-code-census.spec.ts:4,200-203` (ca DESYNC riêng — thay bằng tầng A/B) · `social-feed-cursor.spec.ts:7-8,67,93` · comment `social-route-pairs.const.ts:380` · `social-post-type-pairs-structure.spec.ts:22` |
| M2 | `done_when` (2) mâu thuẫn O2/O4, không chỉ O1 | Đã sửa cả ba trong commit `055f6b55` (toàn module · fallback O4 · sentinel O1) |
| M3 | Helper pipeline không có tên | `applyMainPipeline(app)` — `apps/api/test/helpers/bootstrap-app.ts:34`; spec mới tuân luật `listen(0)` (S18-QA-SUPERTESTLISTEN-1). KHÔNG chép pipeline tay của be2a (thiếu `ZodValidationPipe`) cho W9/W13 |
| L1 | Thiếu ghim audit D1 | + owner KIÊM manage cấp owner ⇒ `viaManage:false` · admin KIÊM manage đổi vai sang `admin` ⇒ `viaManage:false` (không dán nhãn thừa) |
| L3 | Thông điệp trùng sẽ ánh xạ SAI mã im lặng | Map dựng lúc nạp module + `throw` nếu `size !== số khoá` (fail-loud ngay khi boot/test), U2 giữ |
| L4 | dist contracts cũ ⇒ đỏ-giả | build contracts trước khi chạy test API (đã làm) |
| L5 | Docblock/comment ngoài API-19 | `group-errors.ts:4-15` · `group-capabilities.ts:30-33` (đã sửa) · i18n `vi/social.ts:429` · header `social.errors.ts:8-11` · API-19 §6.5 liệt kê cả mã cursor-400 + pin-422 |

Reviewer XÁC NHẬN: D1 không fail-open ở hồ sơ nào (thay đổi DUY NHẤT là {admin active + manage}); Nest 11.1.24 đúng như §0;
tham số union literal ép được qua `as const`; D14 không hồi quy cho cả API cũ lẫn mới; `PIN_NEWS_ONLY` chỉ tới qua `006`
(`029` chỉ truyền `{hidden}`/`{commentsLocked}` cho `moderateTx`); 101 chỗ ném = 91 thẳng + 10 khác.

## 7. FULL gate O3 (29/09/2026) — 4/4 PASS, 0 CRITICAL/HIGH

| Reviewer | Verdict | Đã vá (mỗi vá thay đổi hành vi có ca RED đo trước) |
| --- | --- | --- |
| security-reviewer | PASS (2 LOW) | LOW-2 cổng gắn tệp thiếu `reason` ⇒ `logger.error` (ca RED spec attachments) · LOW-1 dist contracts cũ làm API không boot ⇒ ghi PR: release PHẢI build contracts trước api |
| silent-failure-hunter | PASS (3 LOW) | LOW-1 heuristic LEGACY chỉ cho mã chung API cũ (ca RED group-errors) · LOW-2 tầng C quét thêm `recycle-bin-feed-posts.controller.ts` · LOW-3 tầng C chặn alias `XxxException as Y` + lớp con chưa ghim (mutant `SocialSneaky` đỏ đúng) |
| typescript-reviewer | PASS (3 LOW) | LOW-1 = security LOW-2 · LOW-2 prettier CHỈ trên file vốn sạch ở master (file master đã lệch giữ nguyên để diff không phình) · LOW-3 `SOCIAL_ERROR_CODES` `satisfies Record<string, \`SOCIAL-ERR-${string}\`>` |
| react (general-purpose) | PASS (1 MEDIUM, 4 LOW) | M1 FE bật «Chủ nhóm» cho admin+manage trước khi API lên ⇒ docblock + PR: **API deploy NGAY sau merge** · L1 double `GROUP_ERR_LEGACY` + ca component API cũ · L2 = silent LOW-1 · L3 số dòng BE · L4 docblock GroupMembersTab |

## 8. Changelog

- v1 29/09/2026 — soạn sau workflow đọc 5 lane + 5 chữ ký owner O1–O5.
- v2 29/09/2026 — vá plan-reviewer lượt 1 (B1–B3, H1, M1–M3, L1–L5) — §6.
- v3 29/09/2026 — FULL gate O3 4/4 PASS + vá gate — §7.
