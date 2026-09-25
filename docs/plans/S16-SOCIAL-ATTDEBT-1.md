# S16-SOCIAL-ATTDEBT-1 — TRẢ 3 KHOẢN NỢ FULL GATE CỦA ATTGATE-1 (F1 · F4 · C-5)

> Zone **red** (crown-jewel: permission + append-only + migration) · **2 migration** · 0 cặp quyền mới · 0 route mới.
> Nguồn: FULL gate `S16-SOCIAL-ATTGATE-1` 24/09/2026 (PR #539 đã merge) — `docs/plans/S16-SOCIAL-ATTGATE-1.md` §8.
> Lập 24/09/2026 (planner) theo CLAUDE.md §6 (crown-jewel ⇒ micro-plan → `plan-reviewer` → mới code).
> Kế thừa chữ ký owner **S-7 của ATTGATE-1**: KHÔNG refactor `assertFileTarget`, KHÔNG đụng `054`/`055`.
> Nợ C-2/F-8 (ngữ nghĩa vế 5 · gỡ đính kèm một chiều) **CỐ Ý ngoài phạm vi** — cần chữ ký owner riêng.

---

## §0 — PHÉP ĐO HIỆN TRẠNG

### 0.1 — Đã đo bởi người gọi, KHÔNG đo lại

| # | Kết quả | Ghi chú của planner |
| --- | --- | --- |
| P1 | `getCompanyRoleGrantsWithScope` **KHÔNG cache** — đi thẳng `db.withTenant` | Khớp docblock `data-scope.service.ts:115-116` («`permission.cache.ts:95` là passthrough CÓ CHỦ Ý») ⇒ mỗi lời gọi = 1 transaction THẬT |
| P2 | `pairIsSensitiveFor` → `catalog.isPairSensitive` — **khác đường**, không sinh tx thứ 2 | Xác nhận đọc mã: `permission.service.ts:444-446`; trong batch nó chạy `Promise.all` trên ảnh chụp lạnh (`:846-848`) ⇒ phần tử thứ 5 chỉ thêm **1 tra ảnh chụp + 1 `decideStrongestScope` thuần CPU**, KHÔNG thêm round-trip |
| P3 | **EXPLAIN (ANALYZE) F4** (bench mô phỏng đúng index set, N=1 công ty, ~20% xoá mềm): 200k hàng index hiện có ⇒ **Parallel Seq Scan 9.84ms / 3572 buffers**; + index `(company_id, file_id)` KHÔNG-partial ⇒ **Index Only Scan 0.215ms / 9 buffers, Heap Fetches 0**; 10k hàng ⇒ Seq Scan 0.92ms; index mới 9.7MB/200k | ⇒ **F4 XÁC NHẬN.** Planner PG chọn seq scan ở MỌI cỡ bảng ⇒ không có ngưỡng nào để «đợi tới khi đau». Xem D-4 |
| P4 | `file_links` ở DB dev hôm nay có **7 hàng** | Thắng lợi **DỰ PHÓNG**, không phải đau đớn đang xảy ra. Plan nói thẳng điều đó ở D-4 và ở §6 S-2 |
| P5 | Phép đo «2 → 1 transaction» của backlog **SAI nếu hiểu là TỔNG transaction/PATCH** | `resolveActor` mở **hai** tx (grant snapshot + `resolveContext`→`getRequesterScopeContext`, `data-scope.service.ts:140-149`), `resolveAttachNewGate` mở tx thứ 3, tx nghiệp vụ là thứ 4. Đại lượng đúng: xem **D-9** |
| P6 | Kho **KHÔNG có** helper đếm query/transaction (`queryCount`/`countQueries`/`pg_stat_statements` = 0 kết quả). Tiền lệ spy gần nhất: `apps/api/test/integration/auth-s18-changepwtoctou-1.int-spec.ts:159, 217` | Spy đó dạy 2 luật: lấy **ĐÚNG instance** mà đường chạy đang giữ, và **CALL-THROUGH** chứ không thay thế. D-9 theo đúng hai luật này |

### 0.2 — Planner đo lại bằng ĐỌC MÃ (24/09/2026), có dòng dẫn chứng

| # | Câu hỏi | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| M1 | Batch của `resolveActor` gồm mấy cặp, đọc thế nào? | **4 cặp**, đọc **THEO CHỈ SỐ** `[0..3]`: `[0]` cặp route · `[1]` `manage:feed-post` · `[2]` `manage:feed-news` · `[3]` `manage:feed-group` | `social-access.service.ts:94-106` |
| M2 | Cặp nào trùng nhau nếu thêm `create:feed-*`? | **Không cặp nào.** `postUpdate`/`commentUpdate` có `[0] = view:feed` ⇒ phần tử thứ 5 (`create:feed-post`/`create:feed-comment`) KHÔNG đụng bẫy «hai vai đè nhau» của docblock `:85-90` | `social-route-pairs.const.ts` (postUpdate `:137`, commentUpdate `:151`) |
| M3 | Thêm phần tử thứ 5 có dịch chỉ số của 48 route còn lại? | **Không**, nếu **APPEND ở CUỐI** và chỉ khi `routeKey ∈ {postUpdate, commentUpdate}` ⇒ 48 route gửi mảng **y hệt byte** như hôm nay | thiết kế D-1 |
| M4 | `resolveStrongestScopes` có đảm bảo độ dài mảng trả = độ dài `requests`? | **Có**, kể cả nhánh lỗi hạ tầng (`requests.map(() => null)`, fail-closed TOÀN LƯỢT, KHÔNG partial) | `permission.service.ts:849-865` |
| M5 | Có bao nhiêu chỗ dựng object-literal `SocialActor` (sẽ TS-đỏ khi thêm field bắt buộc)? | **2**: `resolveActor` (`social-access.service.ts:128-147`) và **một** spec `apps/api/src/social/social-group-audience.int.spec.ts` | grep `routeKey:` toàn `apps/api` |
| M6 | `SecurityAlertService` nối DI thế nào? | `AuthModule` **providers `:71` + exports `:88`**. `SocialModule.imports = [PermissionModule, FilesModule, RealtimeEmitterModule, StorageModule, SeedModule]` — **không có AuthModule** | `auth.module.ts` · `social.module.ts:80` |
| M7 | `AuthModule` nặng cỡ nào? | imports `DatabaseModule`, `forwardRef(PermissionModule)`, `CryptoModule`, `forwardRef(SecurityPolicyModule)`, `ModuleCatalogModule`, `RealtimeEmitterModule` + 2 controller + 17 provider | `auth.module.ts:37-54`. ⇒ D-7 |
| M8 | `SecurityAlertService` phụ thuộc gì? | **CHỈ** `DatabaseService` + `AuditService` (`AuditService` từ `EventsModule` `@Global`) | `security-alert.service.ts:36-39` ⇒ module LÁ khả thi |
| M9 | 🔴 `sanitizeDetail` cắt khoá nào? | Mọi khoá khớp `/(password\|secret\|token\|code\|otp\|dek\|cipher\|hash\|key)/i` — **`moduleCode`, `errorCode`, `reasonCode`, `pairKey`, `fileKey` đều BỊ CẮT IM LẶNG** | `security-alert.service.ts:84` ⇒ D-6 + ca U4 |
| M10 | `emit()` (standalone) có nuốt lỗi? | **CÓ** — log `error` rồi trả `false`. Deny vẫn là deny, nhưng **alert mất mà caller không biết** | `security-alert.service.ts:64-76` ⇒ R4 |
| M11 | `emitTx` ghi mấy thứ? | `security_alerts` **+** `audit_logs` action `security.alert.<type>`, objectType `security_alert` (đã có trong CHECK union từ mig 0121) | `security-alert.service.ts:42-58` · `db/schema/audit.ts:213` ⇒ **0 migration audit** |
| M12 | CHECK `alert_type` | **3 giá trị** (`repeated_reauth_failure` · `repeated_cross_scope_deny` · `anomalous_login`), mirror ở `SECURITY_ALERT_TYPES` | `migrations/0122_g16_security_alerts.sql:26-28` · `db/schema/security-alerts.ts:7-12` |
| M13 | `security_alerts` grant/RLS | RLS ENABLE + **FORCE**, policy tenant-iso USING+WITH CHECK, `GRANT SELECT, INSERT` (KHÔNG UPDATE/DELETE) | `0122:35-45` ⇒ nới CHECK **không** cần đụng RLS/grant |
| M14 | Index hiện có của `file_links` | `idx_file_links_entity` (partial) · `idx_file_links_file` (partial) · 2 unique partial · **`file_links_company_id_idx` (company_id, KHÔNG partial)** | `db/schema/files.ts:132-148` ⇒ xác nhận P3: câu vế 5 chỉ dùng được index company-only |
| M15 | Head migration lúc lập plan | **0586** — journal `idx 253`, `when 1717587375000` | `migrations/meta/_journal.json:1776-1782`. ⚠️ **đánh số lại theo head LÚC MERGE** |
| M16 | 3 lưới tĩnh ATTGATE-1 khoá vào cái gì? | `syncLinksGateArgShapes()` khoá **đối số index 6** của `syncLinksTx` · `attachGateCallSites()`+`ATTACH_GATE_SITE_TO_KEY` khoá **tên method gọi `resolveAttachNewGate`** · structure-spec (e) đếm **chuỗi hằng** `ATTACH_GATE_ENFORCED_BY_TIER1` | census `:241-275`, `:286-319`, `:501-521` · `social-file-target-pairs-structure.spec.ts:123-167` ⇒ §3 |
| M17 | int-spec ATTGATE-1 có sẵn khuôn vai/tệp? | **Có**: `AUTHOR_PAIRS :56` · `MOD_NOCREATE_PAIRS :68` · `MOD_FULL_PAIRS :76` · `POST_ONLY :86` · `COMMENT_ONLY :89` · `seedFile(owner) :115` · gate `hasDb && LANE_DB :50` · `LOGIN_PW` ghép chuỗi `:53` | `test/integration/social-attgate-1-update-attach.int-spec.ts` ⇒ tái dùng, KHÔNG dựng khuôn mới |
| M18 | `test:cov:social` liệt kê file bằng tay? | **Có** (`apps/api/package.json:16`) ⇒ file int-spec MỚI phải được thêm, nếu không cổng coverage **mù với chính WO này** | M20 của ATTGATE-1, lặp lại nguyên si |
| M19 | `paths` của WO đủ chưa? | `apps/api/src/social/**` · `src/foundation/**` · `migrations/**` · `src/db/schema/**` · `test/**` · `docs/plans/**` · `harness/backlog.mjs`. **THIẾU `apps/api/src/auth/**` (C-5 nối DI) và `apps/api/package.json` (M18)** | `harness/backlog.mjs:17139-17147` ⇒ **S-7** |
| M20 | `retention.service.ts` có đụng `security_alerts`? | Có, nằm trong danh sách bảng append-only (`retention.service.ts:47-55`) | Người thi công **phải đọc** xem đó là danh sách CHẶN xoá hay có chính sách lưu trữ **trước khi** biện hộ R5 |

### 0.3 — Cái KHÔNG xác minh được trong phiên lập plan

- **Không chạy DB, không chạy test.** Mọi khẳng định «trước 2 / sau 1» là **thiết kế phép đo**, chưa phải kết quả chạy — lượt thi công PHẢI chạy pha RED trước (§2 Phase A) để chứng minh con số «trước».
- **Chưa xác minh có throttler toàn cục trên route PATCH hay không** ⇒ R5 (khuếch đại ghi `security_alerts`) để MỞ, người thi công đo trước khi chốt D-6b.
- **Chưa xác minh drizzle có bọc lại ngoại lệ khi rollback không** (ảnh hưởng `instanceof` ở D-5). Không đánh cược: ca **H7** (assert HÀNG được ghi) là phép đo thật cho việc này; nếu H7 đỏ vì `instanceof` trượt thì sửa bằng cách bắt ở TRONG callback tx rồi ném lại (xem D-5 «lối dự phòng»).

---

## §1 — QUYẾT ĐỊNH

### D-1 (F1) — Gộp cặp thứ 5 vào batch `resolveActor`, **CÓ ĐIỀU KIỆN theo `routeKey`**

| Lối | Mô tả | Vì sao loại / chọn |
| --- | --- | --- |
| (a) | Thêm **cả hai** cặp `create:feed-post` + `create:feed-comment` vào batch **vô điều kiện** | **LOẠI.** 48 route trả giá 2 tra catalog + 2 `decideStrongestScope` mà không bao giờ hỏi; và nó biến mảng 4 phần tử (đang được đọc theo chỉ số cứng) thành 6 cho mọi route ⇒ bề mặt dịch-chỉ-số rộng gấp đôi mà 0 lợi ích |
| (b) | **CHỌN.** Bảng `ATTACH_GATE_ROUTE_TARGET: {postUpdate:'post', commentUpdate:'comment'}`; `resolveActor` **APPEND** phần tử thứ 5 CHỈ khi `routeKey` có trong bảng; cất kết quả vào `SocialActor.attachNewGate` dạng **union phân biệt** (D-2); `resolveAttachNewGate` giữ **nguyên chữ ký + call-site**, chỉ đổi ruột thành đọc ảnh chụp | 48 route gửi mảng **y hệt byte** (M3) · 0 round-trip mới · 1 đường tầng-2 duy nhất · **3 lưới tĩnh không phải sửa** (§3) · `done_when` #2 của WO chính là lối này |
| (c) | Memo ảnh chụp grant theo REQUEST (AsyncLocalStorage / request-scoped cache) | **LOẠI Ở WO NÀY** (ghi nợ). Đây là lối sửa ĐÚNG NHẤT về dài hạn — nó đóng luôn cả `assertCreatablePostType`, `assertKudosOfficial`, `assertFileTarget`, `canApproveIdeas` (mỗi hàm là +1 transaction y hệt). Nhưng: kho **không có ALS** (ATTGATE-1 M8), và `permission.cache.ts:95` là passthrough **CÓ CHỦ Ý** ⇒ đổi nó là quyết định cấp nền tảng (ADR), bán kính = mọi module, không phải 1 WO SOCIAL |
| (d) | Không đụng `resolveActor`; thêm `resolveActorForAttach(user, routeKey, target)` làm **một batch 5 phần tử riêng**, chỉ 2 route gọi | **LOẠI (nhưng là lối DỰ PHÒNG nếu reviewer bác (b)).** Ưu: `resolveActor` — đường nóng 50 route — **không đổi một byte**. Nhược: tầng-2 có **hai cửa** (hàm mới phải lặp lại 2 nhánh ném `:114-124` hoặc phải bóc chúng ra), phá luật «`resolveActor` gọi ĐÚNG MỘT LẦN đầu mỗi method» (`social-access.service.ts:49-50`), và làm lưới census «TẦNG 2 — mọi key được assert ở service» (`:426-430`, chỉ quét tên `resolveActor`) mờ đi: một route đi cửa mới vẫn XANH ở lưới đó |

**Hoà giải với 2 docblock đang nói NGƯỢC** (`assertKudosOfficial :199-201`, `assertFileTarget :227-229`: «KHÔNG nhét cặp lẻ vào batch — batch chạy cho cả 48/50 route»). Hai docblock đó **không sai**, chúng chỉ khai tiêu chí chưa đủ chiều. Tiêu chí **viết lại** (và phải ghi vào cả hai docblock, kèm lý do vì sao hai cặp KIA vẫn đứng ngoài):

> Một cặp được gộp vào batch `resolveActor` khi và chỉ khi **cả ba**:
> 1. **suy được từ `routeKey`** (không cần `dto`) — `resolveActor` không nhìn thấy body;
> 2. gộp **có điều kiện**, chỉ thêm phần tử cho ĐÚNG những route cần ⇒ route khác trả giá **0**;
> 3. lời gọi lẻ hiện tại đang mở **một transaction THỨ HAI trên đường GHI** (đo được, không phải cảm giác).
>
> · `isOfficial` (kudos): **trượt (1)** — cặp phụ thuộc cờ trong body của `002`; gộp = resolve cho mọi lượt `postCreate` kể cả không phải kudos. **Giữ nguyên.**
> · `054`/`055` (cửa tải tệp): **trượt (1)** — `target` là trường của REQUEST; gộp phải resolve CẢ HAI cặp cho cả hai route. **Giữ nguyên** (và S-7 của ATTGATE-1 cấm đụng).
> · `004`/`016` (đường gắn): **thoả cả ba** — `postUpdate↔post`, `commentUpdate↔comment` là song ánh với route; điều kiện theo `routeKey` ⇒ 48 route trả giá 0; và lời gọi lẻ mở tx thứ 2 **trên đường ghi có tx nghiệp vụ đang mở** (đúng cảnh mà `db.service.ts:83` + pool max 20 sợ nhất).

🔴 **Bài học ATTGATE-1 §6 lặp lại:** một câu khai sai trong docblock tự nhân bản ra 4 file. Sửa docblock là **hạng mục thi công bắt buộc** (F5/F6 ở §2), không phải việc làm thêm.

### D-2 (F1) — Hình dạng ảnh chụp: **union phân biệt, field BẮT BUỘC, mang theo `target`**

```ts
// social.types.ts (cạnh SocialActor)
export type AttachNewGateSnapshot =
  | { readonly resolved: false }                                               // route KHÔNG pre-resolve
  | { readonly resolved: true; readonly target: SocialTargetType; readonly scope: DataScope | null };
```
`SocialActor.attachNewGate: AttachNewGateSnapshot` — **BẮT BUỘC** (không `?`, không default) ⇒ mọi nơi dựng `SocialActor` phải CHỦ ĐỘNG khai (M5: đúng 2 nơi).

| Lối đã cân | Vì sao loại |
| --- | --- |
| `attachNewScope?: DataScope \| null` | **LOẠI.** Đúng cái bẫy mà chính file này ghi 3 lần (`social-access.service.ts:86-90`, `data-scope.service.ts:122-125`, `permission.service.ts:822-827`): `undefined` đọc y hệt «chưa hỏi» và «hỏi rồi, không có», và một lượt «dọn dẹp» viết `!= null` biến DENY thành ALLOW mà typecheck câm |
| `canAttachNew: boolean` | **LOẠI.** Mất hẳn phân biệt «chưa resolve cho route này» vs «resolve ra null» — brief đòi phân biệt được; và `false` mặc định của một field quên khai đọc y hệt một quyết định |
| `Map<SocialTargetType, DataScope\|null>` | **LOẠI.** `Map.get()` trượt ⇒ `undefined` ⇒ quay lại bẫy trên |
| **union + `target`** | **CHỌN.** `resolved:false` là nhánh phải **chủ động thoát ra**; `target` cho phép cổng bắt được ca «hỏi cặp comment bằng ảnh chụp của post» (xem D-3) |

**Cách đọc trong `resolveActor` — chống dịch chỉ số:**
```ts
const attachTarget = ATTACH_GATE_ROUTE_TARGET[routeKey] ?? null;
const base = [ /* [0..3] y hệt hôm nay */ ];
const requests = attachTarget === null ? base : [...base, pairOf(SOCIAL_FILE_TARGET_PAIRS[attachTarget])];
const scopes = await this.dataScope.resolveManyOrNull(user.id, user.companyId, requests);
const [routeScopeOrNull, managePostsScope, manageNewsScope, manageGroupsScope] = scopes;
const ATTACH_IDX = 4; // hằng có TÊN: chỉ số, KHÔNG phải khoá (luật của chính file)
```
- `pairOf(...)` **bóc tay 3 field** `{action, resourceType, isSensitive}` — luật đã ghi ở `canApproveIdeas :297-302` (object rộng hơn bị spread nguyên vật vào `decideStrongestScope` và đổi quyết định trong im lặng).
- `scopes[ATTACH_IDX]` có thể `undefined` **chỉ khi** hợp đồng độ dài của `resolveStrongestScopes` (M4) vỡ ⇒ quy về `null` (fail-closed) và **có ca unit ghim** hợp đồng đó, không đặt kiểm tra runtime trên đường nóng.

### D-3 (F1) — `resolveAttachNewGate`: **giữ chữ ký + call-site**, đổi ruột

```ts
async resolveAttachNewGate(actor: SocialActor, target: SocialTargetType): Promise<AttachNewGate> {
  const snap = actor.attachNewGate;
  if (!snap.resolved || snap.target !== target) {           // ⬅ hai ca LỖI NỐI DÂY, không phải quyết định quyền
    this.logger.error(`attach-gate KHÔNG pre-resolve cho route=${actor.routeKey} target=${target}`);
    return { allow: false, reason: SOCIAL_FILE_TARGET_DENIED[target] };
  }
  if (SocialAccessService.isCompany(snap.scope)) return { allow: true };
  return { allow: false, reason: SOCIAL_FILE_TARGET_DENIED[target] };
}
```
- **Vì sao giữ call-site** (`await this.access.resolveAttachNewGate(actor, "post")` nguyên văn): nó là **nguồn ĐỘC LẬP duy nhất** chứng minh `004`/`016` là route «cặp-theo-payload» trong đẳng thức census D17 (`census :467-485`). Bỏ lời gọi = mất nguồn ⇒ phải đẻ nguồn mới (xem §3).
- **Vì sao giữ `async`** dù không còn `await`: đổi sang đồng bộ làm 2 call-site `await` một giá trị thường (hợp lệ, im lặng) và mở đường cho ai đó bỏ `await` ⇒ `attach.gate` thành `Promise` ⇒ `!gate.allow` là `!undefined` ⇒ **luôn ném** (fail-closed, nhưng route chết). Giữ `Promise` là giữ hợp đồng cũ. (`eslint require-await` có thể kêu ⇒ dùng `return Promise.resolve(...)` hoặc giữ chữ `async` kèm comment; **không** tắt rule).
- **Vì sao vẫn nhận `target`** dù suy được từ `actor.routeKey`: hai lời khai độc lập (call-site khai ý định · ảnh chụp khai thứ đã resolve) phải **khớp nhau**, lệch ⇒ DENY ồn ào. Lối bỏ tham số (suy từ `routeKey`) gọn hơn nhưng **tự nó không thể mâu thuẫn với chính nó** ⇒ mất một lưới runtime; đã cân và loại.
- 🔴 **Log `error` (không `warn`)** ở nhánh `!resolved`: đó là lỗi NỐI DÂY của lập trình viên, không phải một quyết định quyền bình thường; trộn chung mức log là chôn nó vào tiếng ồn của deny thường.

### D-4 (F4) — **THÊM migration index NGAY**, không ghi nợ

Index: `CREATE INDEX file_links_company_file_idx ON file_links (company_id, file_id);` — **KHÔNG partial**, khai cả ở `db/schema/files.ts` (nếu không, lượt `drizzle-kit generate` sau sẽ sinh migration XOÁ nó vì drift).

**Lý lẽ HAI CHIỀU (owner ký S-2):**

| Chiều | Lập luận |
| --- | --- |
| **Làm ngay** | (i) 🔴 **Cửa sổ rẻ nhất là BÂY GIỜ**: bảng có **7 hàng** (P4) ⇒ `CREATE INDEX` khoá bảng ~0ms. Migration drizzle chạy **TRONG một transaction** ⇒ `CREATE INDEX CONCURRENTLY` **không dùng được**; để tới lúc bảng 200k+ hàng thì lượt build index sẽ khoá ghi `file_links` của **mọi module** (avatar/HR/CHAT/SOCIAL) và phải đẻ một quy trình migration ngoài-drizzle. (ii) P3 cho thấy **không có ngưỡng nào để chờ** — seq scan ở mọi cỡ bảng, chi phí tuyến tính, và nó nằm **trên đường GHI BÊN TRONG tx nghiệp vụ** ⇒ tx mở lâu hơn ⇒ đúng áp lực pool (max 20) mà module này đã sợ. (iii) WO này **đã** mang một migration cho C-5 ⇒ chi phí biên của migration thứ hai ≈ 0 (cùng PR, cùng lượt review DB). |
| **Ghi nợ** | (i) 7 hàng — đây là index **dự phóng**, không phải chữa đau; YAGNI. (ii) Mỗi index thêm chi phí ghi cho MỌI insert/soft-delete `file_links` (đường avatar/CHAT/HR cũng trả). (iii) `done_when` #1 **cho phép** đóng F4 bằng số đo. |
| **Phán quyết** | **LÀM NGAY.** Lý lẽ quyết định là (i) của chiều trên — chi phí *khoá* của việc làm sau là không tuyến tính và migrator không hỗ trợ `CONCURRENTLY`; ba lý lẽ chiều dưới đều là chi phí *nhỏ và tuyến tính*. Plan ghi thẳng: **đây là thắng lợi DỰ PHÓNG**, số 9.84ms→0.215ms là bench mô phỏng ở 200k hàng, **không phải** đo trên dữ liệu thật hôm nay. |

Ghi chú trung thực kèm theo (phải vào docblock migration):
- **Heap Fetches 0** của Index Only Scan chỉ đạt được khi visibility map đã cập nhật (sau autovacuum). Bảng vừa ghi nhiều ⇒ IOS vẫn fetch heap một thời gian. Vẫn hơn seq scan, nhưng đừng hứa 0.215ms trong mọi cảnh.
- `file_links_company_id_idx` (`files.ts:147`) trở thành **tiền tố dư** của index mới. **KHÔNG drop ở WO này** (bán kính = mọi plan của mọi module đang dùng `file_links`); ghi nợ + nêu ở **S-6** để owner/`database-reviewer` chốt.
- **Không backfill, không đổi cột, không đụng RLS** ⇒ luật «RLS policy + FORCE TRƯỚC backfill» (CLAUDE.md §3) **không áp dụng ở đây**, và plan nói rõ điều đó thay vì im lặng bỏ qua.

### D-5 (C-5) — Vết bền ghi **SAU KHI tx đã cuộn**, mang ngữ cảnh ra bằng **lớp ngoại lệ riêng**

| Lối | Vì sao loại / chọn |
| --- | --- |
| (a) `audit.record(tx, …)` tại chỗ ném | **LOẠI.** Cú ném roll back cả tx ⇒ hàng audit biến mất cùng lượt sửa (ca G15 của ATTGATE-1 assert đúng điều đó) |
| (b) `SecurityAlertService.emitTx(tx, …)` tại chỗ ném | **LOẠI.** Cùng lý do (a) — alert atomic với chính lượt bị cuộn ⇒ 0 hàng |
| (c) `SecurityAlertService.emit(…)` tại chỗ ném | **LOẠI — NGUY HIỂM.** `emit` tự mở `withTenant` (`:66`) trong khi đang Ở TRONG tx ⇒ `withTenant` lồng `withTenant` ⇒ **TREO IM LẶNG** (pool max 20, `db.service.ts:83` không tái nhập). Đây là cái bẫy trung tâm của WO |
| (d) Bắt ngoài tx, phân biệt bằng **thông điệp** | **LOẠI.** Giòn: cùng tx còn ném `ForbiddenException` từ `assertCanMutateContent` (SOCIAL-ERR-003) và có thể từ nhánh khác; so chuỗi là hợp đồng ngầm, một lượt đổi câu chữ (đã có nợ D-4 của ATTGATE-1 muốn đổi!) giết lưới trong im lặng |
| (e) Truyền «collector» có thể ghi vào `syncLinksTx` | **LOẠI.** Đối số thứ 8 ⇒ **vỡ lưới `syncLinksGateArgShapes()`** (khoá index 6, đọc `arguments[6]`) và vi phạm luật bất biến (mutable out-param) |
| (f) Không ném trong tx, trả kết quả rồi ném SAU commit | **LOẠI — thảm hoạ.** Lượt sửa đã COMMIT rồi mới 403 ⇒ phá D-7 của ATTGATE-1 («403 phải để lại ZERO dấu vết») |
| **(g)** | **CHỌN.** `export class SocialAttachGateDeniedException extends ForbiddenException` mang `readonly signal: {targetType, targetId, actorUserId, newFileCount, pair}`. `syncLinksTx` ném **nó** (thay `ForbiddenException(gate.reason)`), `super(gate.reason)` ⇒ **hợp đồng HTTP không đổi** (403 + đúng hằng). `update()` bọc `withTenant` bằng `try/catch`, `instanceof` ⇒ `await this.attachments.reportAttachGateDeny(err, actor.companyId)` ⇒ **rethrow nguyên `err`** |

**Chi tiết bắt buộc:**
- **Giữ NGUYÊN `this.logger.warn(...)` hiện có** (`social-attachments.service.ts:253-255`). Nó sống sót cả khi ghi alert thất bại (M10 — `emit` nuốt lỗi). Hai vết, hai đường hỏng khác nhau.
- Lớp ngoại lệ đặt **cùng file** `social-attachments.service.ts` (cạnh `AttachNewGate`): hai service kia **đã** import giá trị từ file này ⇒ **0 cạnh phụ thuộc mới**, và **không** làm tăng số đếm của structure-spec (e) vì nó đếm chuỗi `ATTACH_GATE_ENFORCED_BY_TIER1`, không đếm import nói chung.
- `reportAttachGateDeny(err, companyId)`: **no-op** nếu không phải lớp đó; gọi `securityAlerts.emit(...)` (standalone — lúc này đã NGOÀI tx, hợp lệ). `emit` best-effort ⇒ deny vẫn là deny.
- ⚠️ **Rủi ro no-op im lặng**: nếu ai đổi lớp ngoại lệ mà quên reporter, alert biến mất **không ai biết**. Hai lưới đóng lại: ca **H7** (assert hàng) + lưới AST **G-ALERT** (§3) buộc tập method gọi `reportAttachGateDeny` **BẰNG** tập method gọi `resolveAttachNewGate`.
- **Lối dự phòng nếu `instanceof` trượt** (drizzle bọc lỗi — 0.3): bắt **bên trong** callback `withTenant`, ghi `signal` vào một biến `let denied: Signal | null` của scope hàm `update()`, ném lại, rồi ngoài `catch` kiểm `denied !== null`. Vẫn KHÔNG dùng thông điệp; vẫn ghi sau rollback. (Kém hơn vì `denied` là trạng thái đọc-được-cả-khi-không-ném ⇒ chỉ dùng khi (g) đo ra không chạy.)

### D-6 (C-5) — Loại alert: **thêm giá trị MỚI** vào CHECK (migration), không mượn `repeated_cross_scope_deny`

| Lối | Vì sao loại / chọn |
| --- | --- |
| Mượn `repeated_cross_scope_deny` | **LOẠI.** Chữ «repeated» hàm ý **ngưỡng**; ta phát **mỗi lần deny**. Mượn = ghi một lời khai sai vào bảng **append-only** (sửa không được, đó là cả điểm của bảng), và làm nhiễu mọi câu đếm/cảnh báo đang dựa vào loại đó. 0 migration là món hời rẻ tiền đổi lấy dữ liệu điều tra sai |
| **Giá trị mới `attach_gate_deny`** | **CHỌN.** Hẹp, đọc là hiểu, `detail` mang `route`/`target`/`pair`. Giá: 1 migration nới CHECK + 1 dòng `SECURITY_ALERT_TYPES` |
| Giá trị chung `capability_gate_deny` | Cân nhắc: tái dùng được cho WO sau mà khỏi nới CHECK, nhưng làm mờ câu truy vấn («cổng nào?» phải bới `detail`). **Đưa vào S-3** để owner chọn |

**Ràng buộc thi công:**
- Migration nới CHECK phải viết **UNION đầy đủ** (CLAUDE.md §9.3 hot-file: CHECK = UNION, append chứ không rewrite): `DROP CONSTRAINT security_alerts_type_check` → `ADD CONSTRAINT ... CHECK (alert_type IN ('repeated_reauth_failure','repeated_cross_scope_deny','anomalous_login','attach_gate_deny'))`.
- **HAI nơi phải đổi cùng lượt**: DDL **và** hằng TS `SECURITY_ALERT_TYPES` (`db/schema/security-alerts.ts:7-12`). Quên hằng ⇒ TS đỏ (tốt). Quên DDL/journal ⇒ **CHECK vỡ lúc chạy → 500 vô danh → `emit` NUỐT → alert mất im lặng** (M10 + memory «drizzle giấu mã PG trong cause»).
- `severity`: **`low`**. Một lượt deny lẻ không phải sự cố; ba loại đang có đều mô tả **mẫu lặp**. Nếu owner muốn đồng bộ với default thì `medium` — **S-3**.
- 🔴 `detail` — **đặt tên khoá tránh bộ lọc** (M9): dùng `route`, `target`, `newFiles`, `pair`, `module`. **TUYỆT ĐỐI KHÔNG** `moduleCode`, `reasonCode`, `errorCode`, `pairKey` — `sanitizeDetail` cắt chúng **im lặng**. Có ca **U4** ghim điều này.
- Nội dung `detail` giữ đúng kỷ luật đã có ở logger: **chỉ SỐ LƯỢNG tệp**, không id/tên tệp. `targetId` (id bài/bình luận) đã được logger hiện tại ghi ⇒ nhất quán, không nới thêm.
- `subjectUserId` = actor. `subject` = `null` (không có định danh trừu tượng nào cần thêm).
- **0 migration cho audit**: `emitTx` ghi audit objectType `security_alert`, đã nằm trong CHECK union từ mig 0121 (M11).

### D-7 (C-5) — Nối DI: tách **module LÁ `SecurityAlertModule`**

| Lối | Đánh giá rủi ro vòng phụ thuộc |
| --- | --- |
| `SocialModule imports AuthModule` | **LOẠI (nhưng khả thi).** Không tạo cycle MỚI (Social không nằm trong cụm `Auth ↔ Permission ↔ SecurityPolicy`), nhưng kéo **toàn bộ** đồ thị auth (M7: 6 import + 2 controller + 17 provider) vào injector của Social chỉ để lấy **một** service có **hai** phụ thuộc. Đúng lớp việc mà docblock `social.module.ts:56-59` cảnh báo (tiền lệ `RealtimeModule` làm Nest sập lúc bootstrap) |
| **`SecurityAlertModule` (LÁ)** | **CHỌN.** `imports:[DatabaseModule]`, `providers/exports:[SecurityAlertService]`. `AuthModule`: **gỡ** `SecurityAlertService` khỏi `providers` (`:71`), thêm `SecurityAlertModule` vào `imports`, và **re-export MODULE** trong `exports` thay cho service (`:88`) ⇒ mọi consumer cũ của `AuthModule` **không đổi một dòng**. `SocialModule.imports` += `SecurityAlertModule` (khối additive). Khuôn có sẵn nguyên si: `RealtimeEmitterModule` (module LÁ được cả `AuthModule:51` lẫn `SocialModule:80` import) |
| Đưa `SecurityAlertService` vào `EventsModule` (@Global) | **LOẠI.** Dời một service AUTH sang tầng events là đổi ranh giới module cho tiện; và `@Global` làm nó vô hình với mọi lưới «ai được phát alert» |
| SOCIAL tự `insert(securityAlerts)` qua `db.withTenant` | **LOẠI.** Đẻ bản thứ hai của cặp «sanitize + audit đi kèm» cho một tạo tác an ninh append-only — đúng chỗ để hai đường trôi khỏi nhau |

⚠️ **Rủi ro thi công (HIGH):** sửa `AuthModule` là phẫu thuật crown-jewel; nhầm ⇒ sập bootstrap ⇒ **đỏ dây chuyền mọi int-spec** (ồn ào, không im lặng — đó là mặt tốt). Bắt buộc chạy một cụm int-spec AUTH sau bước này (§2 Phase D).
⚠️ Nếu **để nguyên** `SecurityAlertService` trong `providers` của AuthModule **và** thêm module lá ⇒ **HAI instance** (Nest tạo provider theo module). Không sai chức năng nhưng là hai singleton của một service crown-jewel ⇒ **phải gỡ**, và có ca unit ghim «`app.get(SecurityAlertService)` từ AuthModule và từ SocialModule là **cùng một** object».

### D-8 (C-5) — Đặt `try/catch` ở đâu

`update()` của **cả hai** service bọc **đúng lời gọi `this.db.withTenant(...)`** (không bọc rộng hơn — bọc cả `decorate`/`emit*` sau đó sẽ nuốt nhầm ngữ cảnh). Thân catch **3 dòng**: `await this.attachments.reportAttachGateDeny(err, actor.companyId); throw err;`.
- Không bọc bằng HOF (`withAttachGateAlert(() => ...)`) vì nó làm lời gọi `withTenant` chìm vào một callback lồng ⇒ lưới tĩnh «mọi `await this.access.*` phải NGOÀI callback `withTenant`» (luật review của ATTGATE-1 R1) khó đọc hơn hẳn.
- **Không** đặt reporter trong `SocialAccessService` (nó không biết `SecurityAlertService` và không nên biết) — đặt trong `SocialAttachmentsService`, nơi **định nghĩa** cổng và **ném** ngoại lệ.

### D-9 (F1) — ĐỊNH NGHĨA PHÉP ĐO «trước 2 · sau 1»

🔴 Backlog viết «số transaction mỗi PATCH: trước 2 · sau 1». **Hiểu là TỔNG transaction thì SAI** (P5: một PATCH có ≥4 transaction). Đại lượng đúng, định nghĩa được và đo được:

> **Đ1 (chính) — SỐ LẦN NẠP ẢNH CHỤP GRANT mỗi PATCH có `attachmentIds`**
> = số lời gọi `PermissionRepository.getCompanyRoleGrantsWithScope(userId, companyId)` của **actor đang test**, trong một request.
> **Trước: 2** (`resolveActor` + `resolveAttachNewGate`) · **Sau: 1**.

Vì sao đại lượng này đúng: P1 chứng minh **1 lời gọi = 1 `db.withTenant` = 1 transaction THẬT**, không cache; và nó cô lập đúng thứ WO sửa, không lẫn `resolveContext`, tx nghiệp vụ, hay hai `withTenant` của `decorateMany`.

> **Đ2 (đối chứng) — ĐỘ LỆCH tổng `DatabaseService.withTenant` giữa hai request SÁT NHAU trên CÙNG một bài đã có sẵn 1 đính kèm:**
> (A) `PATCH` **body-only** (không gửi `attachmentIds`) · (B) `PATCH` gửi **đúng danh sách đính kèm hiện có** (0 tệp mới ⇒ 200).
> **Trước: delta = 1 · Sau: delta = 0.**

🔴 **Bẫy của Đ2 (phải viết vào spec):** nếu chọn bài **KHÔNG có** đính kèm thì `decorateMany` mở **1** `withTenant` ở ca A (return sớm khi `rows.length === 0`, `:318`) nhưng **2** ở ca B (thêm câu `linksByFile`, `:323`) ⇒ delta nhiễm 1 vì lý do **hoàn toàn khác** ⇒ phép đo nói dối. Bắt buộc: **cùng một bài, đã có sẵn ≥1 link sống**, để hai ca đi qua y hệt đường decorate.

**Cơ chế đếm** (khuôn `auth-s18-changepwtoctou-1.int-spec.ts:159, 217`):
```ts
const repo = app.get(PermissionRepository, { strict: false });
const spy = vi.spyOn(repo, "getCompanyRoleGrantsWithScope");   // CALL-THROUGH, KHÔNG mockImplementation
// ... login, dựng dữ liệu ...
spy.mockClear();
await request(server).patch(`/api/v1/social/posts/${postId}`)...;
const mine = spy.mock.calls.filter(([uid]) => uid === modUserId).length;   // lọc theo ACTOR
expect(mine, "số lần nạp ảnh chụp grant / PATCH có attachmentIds").toBe(1);
```
- **CALL-THROUGH bắt buộc**: thay thế implementation ⇒ grant giả ⇒ mọi cổng trả lời sai ⇒ bài xanh/đỏ vì lý do khác.
- **Lọc theo `userId`**: app dùng chung, job/scheduler có thể gọi cùng lúc và ăn mất suất đếm (đúng bài học của spec tiền lệ, ở đó lọc theo `companyId`).
- **NEO CHỐNG-XANH-RỖNG (bắt buộc, brief đòi):**
  1. `expect(spy).toHaveBeenCalled()` **trước** mọi `toBe(n)` — spy rơi khỏi instance thật đọc y hệt «đúng kỳ vọng» nếu kỳ vọng là 0;
  2. một ca **đối chứng DƯƠNG** trên route body-only đòi **đúng 1** (không phải «≤1»): nếu spy rơi ra thì ca này đỏ ngay, tách hẳn khỏi ca đo chính;
  3. **bằng chứng RED**: chạy chính spec này trên mã TRƯỚC khi sửa ⇒ phải đỏ với `expected 2 to be 1`. Không có dòng RED đó thì con số «trước 2» là lời hứa, không phải phép đo.

---

## §2 — THỨ TỰ THI CÔNG (RED trước · mỗi pha tự kiểm được)

> **Trước hết**: `bash scripts/lane-db-setup.sh attdebt --reset` → `export LANE_DB=mediaos_attdebt`. Không `--reset` ⇒ giữ DB cũ (memory `lane-db-setup-keeps-existing-db`).

### Phase A — RED thuần HÀNH VI (0 dòng mã sản phẩm)
| # | File | Việc |
| --- | --- | --- |
| A1 | `apps/api/test/integration/social-attdebt-1-cost-alert.int-spec.ts` **(MỚI)** | Ca **H1–H4** (Đ1/Đ2) + **H7/H8/H9** (C-5). Dùng **chỉ** HTTP + spy ⇒ **không phụ thuộc symbol mới** ⇒ RED là đỏ **hành vi**, không phải đỏ biên dịch (memory `mutant-red-must-match-expected-message`) |
| A2 | `apps/api/package.json:16` | Thêm file A1 vào `test:cov:social` (M18) — **ngoài `paths` ⇒ cần S-7** |
| A3 | chạy | Ghi lại nguyên văn dòng đỏ: `expected 2 to be 1` (Đ1) và `expected 0 to be 1` (H7 — chưa có hàng alert) |

### Phase B — F1 (đường nóng 50 route)
| # | File | Hình dạng |
| --- | --- | --- |
| B1 | `social-route-pairs.const.ts` | **+ khối additive** `ATTACH_GATE_ROUTE_TARGET` (`Partial<Record<SocialRouteKey, SocialTargetType>>` + `satisfies`). KHÔNG đụng `SOCIAL_ROUTE_PAIRS` |
| B2 | `social.types.ts` | `+ AttachNewGateSnapshot`; `SocialActor.attachNewGate` **bắt buộc** ⇒ TS đỏ ở **2** nơi (M5): `resolveActor` + `social-group-audience.int.spec.ts` |
| B3 | `social-access.service.ts` | `resolveActor`: append có điều kiện + dựng snapshot (D-2, hằng `ATTACH_IDX`). `resolveAttachNewGate`: đổi **ruột** (D-3), **giữ chữ ký/call-site**. **Sửa 2 docblock** (`assertKudosOfficial :199-201`, `assertFileTarget :227-229`) theo tiêu chí 3 điều kiện của D-1 |
| B4 | chạy | `pnpm --filter @mediaos/api typecheck` · unit `src/social` · **toàn bộ** `test/foundation` (census) · cụm int-spec SOCIAL. Đ1 phải **XANH**; ca **H4** (deny cặp route) phải xanh |

### Phase C — F4 (migration index)
| # | File | Hình dạng |
| --- | --- | --- |
| C1 | `apps/api/migrations/0587_s16socialattdebt1_file_links_company_file_idx.sql` | `CREATE INDEX file_links_company_file_idx ON file_links (company_id, file_id);` + docblock mang **nguyên văn số EXPLAIN P3** + ghi rõ «dự phóng, bảng 7 hàng hôm nay» + «không backfill ⇒ luật RLS-trước-backfill không áp dụng» |
| C2 | `migrations/meta/_journal.json` | **idx 254 · when 1717587376000** (nối tiếp M15) — ⚠️ **đánh lại theo head LÚC MERGE** |
| C3 | `apps/api/src/db/schema/files.ts` | Khai index trong mảng `(t) => [...]` (append) — thiếu ⇒ `drizzle-kit generate` sau này sinh lệnh DROP |
| C4 | chạy | `pnpm db:migrate` trên lane; ca **H11** (`pg_indexes`) xanh |

### Phase D — C-5 (alert bền)
| # | File | Hình dạng |
| --- | --- | --- |
| D1 | `apps/api/src/auth/security-alert.module.ts` **(MỚI)** | Module LÁ: `imports:[DatabaseModule]`, `providers/exports:[SecurityAlertService]` |
| D2 | `apps/api/src/auth/auth.module.ts` | **gỡ** `SecurityAlertService` khỏi `providers :71`; `imports` += `SecurityAlertModule`; `exports` thay service bằng **module** (re-export) ⇒ consumer cũ không đổi |
| D3 | `apps/api/migrations/0588_..._security_alerts_type_attach_gate_deny.sql` + journal **idx 255 · when 1717587377000** | DROP+ADD CHECK với **UNION 4 giá trị** |
| D4 | `apps/api/src/db/schema/security-alerts.ts` | `SECURITY_ALERT_TYPES` += `"attach_gate_deny"` (append) |
| D5 | `apps/api/src/social/social-attachments.service.ts` | `+ SocialAttachGateDeniedException` (mang `signal`); nhánh `!gate.allow` **giữ `logger.warn`** rồi ném lớp mới; `+ reportAttachGateDeny(err, companyId)`; inject `SecurityAlertService`. **KHÔNG thêm tham số cho `syncLinksTx`** |
| D6 | `apps/api/src/social/social.module.ts` | `imports` += `SecurityAlertModule` (khối additive kèm comment lý do) |
| D7 | `social-posts.service.ts` / `social-comments.service.ts` | `try/catch` quanh **đúng** `this.db.withTenant(...)` của `update()` (D-8) |
| D8 | chạy | int-spec AUTH (bootstrap + `security-alerts-tenant-isolation.int-spec.ts`) + A1 |

### Phase E — lưới tĩnh, docs, đóng WO
| # | File | Việc |
| --- | --- | --- |
| E1 | `apps/api/test/foundation/social-two-layer-guard-census.unit-spec.ts` | + 2 ca mới **G-TABLE**, **G-ALERT** (§3). **KHÔNG** đụng `ROUTE_TO_KEY`/`SERVICE_SITE_TO_KEYS`/đẳng thức D17 |
| E2 | `apps/api/src/social/social-access.service.spec.ts` (mở rộng hoặc MỚI) | U1/U2 (§4B) |
| E3 | `apps/api/src/social/social-attachments.service.spec.ts` | U3 (§4B) |
| E4 | `apps/api/src/auth/security-alert.service.spec.ts` (mở rộng) | U4 — khoá `detail` **sống sót** `sanitizeDetail` |
| E5 | `docs/API Design/API-19_SOCIAL_API_Design.md` | Một dòng ở mục `004`/`016`: deny cổng đính kèm **để lại `security_alerts`** (hợp đồng vận hành cho on-call) |
| E6 | `harness/backlog.mjs` | Đóng WO + ghi nợ mới (§5) |
| E7 | `bash harness/check.sh --lane-db=attdebt` (vùng đỏ ⇒ `--all` / `REQUIRE_LANE_DB=1`) | Trước khi mở PR. **FULL gate chạy TRƯỚC khi mở PR** (memory) |

**Kiểm trần file (CLAUDE.md §5):** `social-attachments.service.ts` **448** dòng → +~45 ≈ 493 · `social-access.service.ts` (~600) → +~35 · cả hai còn xa 800.

---

## §3 — LƯỚI TĨNH & MUTANT (rủi ro lớn nhất của WO)

> Luật chung: mutant phải đỏ vì **ĐÚNG thông điệp kỳ vọng**. Đỏ vì 500, vì lỗi biên dịch, vì TS không build ⇒ **KHÔNG tính là phép đo** (memory `mutant-red-must-match-expected-message`).

| # | Lưới | WO này có đụng? | Việc phải làm | Mutant đo lại + thông điệp đỏ kỳ vọng |
| --- | --- | --- | --- | --- |
| L1 | `syncLinksGateArgShapes()` ca **S-1** (census `:241-275, :501-521`) — khoá **đối số index 6** | **KHÔNG** — *với điều kiện* D-5(g): ngữ cảnh DENY đi bằng **ngoại lệ**, không bằng tham số thứ 8; và `AttachPlan` giữ nguyên ⇒ arg[6] vẫn là `attach.gate` | Không sửa. **Ghi vào docblock `syncLinksTx`**: «thêm tham số ở đây làm vỡ ca S-1 — ngữ cảnh DENY đi bằng `SocialAttachGateDeniedException`» | Thay `attach.gate` → `{ allow: true }` ⇒ đỏ `SocialPostsService#update phải truyền giá trị ĐÃ RESOLVE (attach.gate), không phải literal/hằng` |
| L2 | `attachGateCallSites()` + `ATTACH_GATE_SITE_TO_KEY` — **nguồn ĐỘC LẬP của đẳng thức D17** | **KHÔNG** — D-3 giữ nguyên call-site **chính vì lưới này** | Không sửa. Nếu lượt thi công vì lý do nào đó bỏ lời gọi ⇒ **phải** thay nguồn độc lập bằng `ATTACH_GATE_ROUTE_TARGET` (khoá bảng = tập route) **và** nói rõ trong PR rằng sổ pin census đã đổi nguồn | Gỡ lời gọi `resolveAttachNewGate` khỏi `SocialPostsService#update` ⇒ D17 đỏ `expected [ ... ] to deeply equal [ ... ]` thiếu `postUpdate`. Dời lời gọi sang method khác ⇒ đỏ `call-site cổng đính kèm lạ: <site>` |
| L3 | `social-file-target-pairs-structure.spec.ts` ca **(e)** — đếm hằng `ATTACH_GATE_ENFORCED_BY_TIER1` = 2 nơi tiêu thụ + allowlist 3 file | **KHÔNG** — không file mới nào nhắc hằng đó; lớp ngoại lệ ở **cùng file** đã khai hằng | Không sửa. ⚠️ Nếu người thi công tách lớp ngoại lệ sang file mới ⇒ `scanned` tăng (vẫn `>40`, OK) nhưng **cấm** file mới nhắc tới hằng | Dán hằng vào nhánh `undefined` của `update()` ⇒ đỏ `social-posts.service.ts: import + 1 call-site TẠO — expected 3 to be 2` |
| **L4** | **G-TABLE (MỚI)** — `Object.keys(ATTACH_GATE_ROUTE_TARGET)` **BẰNG** tập key suy từ `attachGateCallSites()` qua `ATTACH_GATE_SITE_TO_KEY` | **MỚI** — lưới của bất biến F1: «route nào pre-resolve» phải **bằng** «method nào tiêu thụ cổng» | Thêm ca vào census (cạnh D17). Neo chống-xanh-rỗng **hai vế**: cả hai tập `.length > 0` | (a) Xoá `commentUpdate` khỏi bảng ⇒ đỏ `route pre-resolve cổng đính kèm lệch với call-site: thiếu commentUpdate` (và **H6** đỏ ở runtime: 403 cho cả vai ĐỦ quyền). (b) Thêm `postModerate` vào bảng ⇒ đỏ vì **thừa** |
| **L5** | **G-ALERT (MỚI)** — tập `Class#method` gọi `reportAttachGateDeny` **BẰNG** tập gọi `resolveAttachNewGate` | **MỚI** — lưới của bất biến C-5 | Thêm ca vào census, tái dùng nguyên khuôn `attachGateCallSites()` (đổi tên hàm quét) | Xoá `try/catch` ở `SocialCommentsService#update` ⇒ đỏ `method có cổng đính kèm nhưng KHÔNG báo alert: SocialCommentsService#update` |
| **L6** | **G-INDEX (MỚI, cần DB)** — `SELECT 1 FROM pg_indexes WHERE indexname='file_links_company_file_idx'` | **MỚI** — lưới **chống migration-thiếu-journal bị BỎ QUA im lặng** (memory) | Ca **H11** trong A1 | Xoá dòng journal của 0587 ⇒ H11 đỏ `index file_links_company_file_idx KHÔNG tồn tại — migration 0587 có trong _journal.json chưa?` |
| L7 | Ca census `TẦNG 2 — mọi key được assert ở service` (`:426-430`) | **KHÔNG** (D-1 lối (b) giữ một cửa `resolveActor` duy nhất) | Không sửa. **Đây là lý do kỹ thuật để loại lối (d)** | — |

---

## §4 — MA TRẬN TEST

> Vai tái dùng **nguyên văn** khuôn `social-attgate-1-update-attach.int-spec.ts` (M17): `AUTHOR_PAIRS` · `MOD_NOCREATE_PAIRS` (`view:feed` + `manage:feed-post`, **KHÔNG** `create:*`) · `MOD_FULL_PAIRS`. Tệp gieo **thẳng** bằng `seedFile(owner)`, **KHÔNG** qua `054` (bài học F-3 của ATTGATE-1: đi qua 054 thì mutant ra **422** chứ không **200**/**403** ⇒ phép đo cổng vô hiệu). `LOGIN_PW` **ghép chuỗi** (gitleaks).
> Gate cứng: `describe.skipIf(!(hasDb && process.env.LANE_DB))`.

### 4A — int-spec `apps/api/test/integration/social-attdebt-1-cost-alert.int-spec.ts` (MỚI)

| Ca | Route | Vai | Hành động | Kỳ vọng | Phép ĐO (mutant ⇒ đỏ ở đâu, thông điệp gì) |
| --- | --- | --- | --- | --- | --- |
| **H1** | 004 | `R_BOTH` | PATCH gửi **đúng** danh sách đính kèm hiện có (bài đã có 1 link sống) | **200** · **Đ1 = 1** | Khôi phục ruột cũ của `resolveAttachNewGate` (hỏi DB) ⇒ đỏ `số lần nạp ảnh chụp grant / PATCH có attachmentIds: expected 2 to be 1` |
| **H2** | 004 | `R_BOTH` | PATCH **body-only**, **CÙNG bài** của H1 | **200** · **Đ1 = 1** · Đ2 delta so H1 = **0** | Neo đối chứng DƯƠNG: spy rơi khỏi instance ⇒ ca này đỏ (`expected 0 to be 1`) tách hẳn khỏi H1 |
| **H3** | route KHÔNG đính kèm (`001` GET feed **và** một route GHI, vd thả cảm xúc) | `R_BOTH` | gọi bình thường | **Đ1 = 1** · status/ngữ nghĩa **y hệt master** | 🔴 **Hồi quy 48 route.** Thêm cặp thứ 5 vô điều kiện (lối (a)) ⇒ không đỏ ở đây ⇒ vì thế còn **H4** |
| **H4** | 004 | vai **KHÔNG có `view:feed`** | PATCH bất kỳ | **403** + thông điệp **`AUTH-ERR-FORBIDDEN: out of permission scope`** | 🔴 **Lưới dịch chỉ số.** Chèn phần tử mới ở ĐẦU mảng (thay vì append) ⇒ `[0]` đọc nhầm cặp ⇒ ca này đỏ vì **thông điệp/scope**, không phải vì status |
| **H5** | 004 | `R_MOD_NOCREATE` | sửa bài NGƯỜI KHÁC, **THÊM** tệp `seedFile(mod)` | **403** `SOCIAL_ERR.FILE_TARGET_POST_DENIED` (assert **tham chiếu HẰNG**) | Hồi quy cổng ATTGATE-1 qua ruột MỚI. Mutant: bảng `ATTACH_GATE_ROUTE_TARGET` trả `'comment'` cho `postUpdate` ⇒ đỏ vì **sai hằng thông điệp** (comment≠post) |
| **H6** | 016 | `R_MOD_FULL` | sửa bình luận người khác, THÊM tệp | **200** | **ALLOW cạnh DENY** cho trục comment; và là ca chết nếu snapshot resolve **nhầm cặp** (post thay vì comment) ⇒ 403 oan |
| **H6b** | 016 | `R_MOD_NOCREATE` | sửa bình luận người khác, THÊM tệp | **403** `FILE_TARGET_COMMENT_DENIED` | Hằng **KHÁC** H5 ⇒ chứng minh ảnh chụp **theo từng target** |
| **H7** | 004 | `R_MOD_NOCREATE` | lặp H5 rồi **đọc DB** | (i) `security_alerts` **+1 hàng**: `alert_type='attach_gate_deny'`, `subject_user_id=mod`, `detail` có **đủ** khoá `route`/`target`/`newFiles`/`pair`; (ii) `feed_posts.body` **KHÔNG đổi**; (iii) `file_links` sống của tệp = **0**; (iv) `audit_logs` action `security.alert.attach_gate_deny` **+1** | 🔴 **Ca trung tâm C-5**: chứng minh vết **SỐNG SÓT** dù tx nghiệp vụ đã cuộn. Mutant (a): dời `emit` vào trong tx ⇒ đỏ `expected 0 to be 1` (hàng biến mất). Mutant (b): bỏ dòng journal của 0588 ⇒ CHECK vỡ → `emit` **nuốt** → vẫn đỏ ở vế (i) ⇒ đây là lưới duy nhất thấy được M10 |
| **H8** | 004 | `R_MOD_FULL` | cùng hành động, vai ĐỦ quyền | **200** · `security_alerts` **KHÔNG tăng** | **ALLOW cạnh DENY** (ca deny một mình = xanh-rỗng) |
| **H9** | 004 | vai `R_BOTH` **không phải tác giả, không `manage`** | sửa bài người khác (403 từ `assertCanMutateContent`, **cùng tx**) | **403** `SOCIAL-ERR-003` · `security_alerts` **KHÔNG tăng** | 🔴 Chứng minh phân biệt bằng **`instanceof`**, không bằng thông điệp. Mutant: đổi reporter sang so chuỗi `err.message.includes('...')` ⇒ tuỳ chuỗi mà ca này đỏ `expected 1 to be 0` |
| **H10** | 004 | `R_MOD_NOCREATE` | hai lượt deny liên tiếp | `security_alerts` **+2** | Ghim hành vi «mỗi deny một hàng» (đầu vào cho R5/S-5). Nếu owner chọn ngưỡng/khử trùng ⇒ ca này đổi kỳ vọng, có chủ đích |
| **H11** | — | — | `SELECT indexname FROM pg_indexes WHERE tablename='file_links'` | chứa `file_links_company_file_idx` | **L6** — lưới migration-journal |

> **Phải CÒN XANH nguyên vẹn sau WO** (lưới hồi quy, KHÔNG sửa): toàn bộ `social-attgate-1-update-attach.int-spec.ts` (17 ca) · `social-be1c-file-door.int-spec.ts` (17 ca) · `social-be1-attachments.int-spec.ts:409-457` · cụm int-spec AUTH (`security-alerts-tenant-isolation` + bootstrap) sau D2.

### 4B — spec colocated (KHÔNG cần DB)

| Ca | File | Nội dung |
| --- | --- | --- |
| **U1** | `social-access.service.spec.ts` | `resolveAttachNewGate` — ma trận fail-CLOSED: `{resolved:false}` ⇒ `allow:false` · `{resolved:true,target:'comment'}` hỏi `'post'` ⇒ `allow:false` · `scope:null` ⇒ deny · `'Department'` ⇒ deny · `'Company'`/`'System'` ⇒ allow. Mọi nhánh deny assert **đúng hằng theo target** |
| **U2** | như trên | `resolveActor` — với `routeKey='postUpdate'` gửi **5** request, phần tử `[4]` là `{action:'create',resourceType:'feed-post',isSensitive:false}` (bóc tay 3 field); với `routeKey='postCreate'` gửi **đúng 4** request **y hệt hôm nay** (ghim hồi quy 48 route ở mức đơn vị) · ghim `[0..3]` không đổi thứ tự |
| **U3** | `social-attachments.service.spec.ts` | `syncLinksTx` ném **`SocialAttachGateDeniedException`** (không phải `ForbiddenException` trần) mang `signal` đủ field, message = đúng hằng · `toAdd` rỗng + `gate.allow:false` ⇒ **KHÔNG** ném (giữ D-1 của ATTGATE-1) · `reportAttachGateDeny` với `new ForbiddenException('x')` ⇒ **0** lời gọi `emit` · với lớp đúng ⇒ **1** lời gọi, `signal` đi đúng vào `detail` · `emit` **ném** ⇒ reporter **không** làm hỏng luồng (deny vẫn là deny) |
| **U4** | `security-alert.service.spec.ts` | 🔴 `detail` của `attach_gate_deny` **sống sót** `sanitizeDetail`: assert hàng ghi ra có **đủ** khoá; và ca đối chứng chứng minh bộ lọc THẬT SỰ cắt (`{moduleCode:'SOCIAL'}` ⇒ bị cắt) — không có ca đối chứng thì ca trên là xanh-rỗng |
| **U5** | census (E1) | **G-TABLE** + **G-ALERT** (§3 L4/L5), mỗi ca có neo `.length > 0` cả hai vế |
| **U6** | `social-file-target-pairs-structure.spec.ts` · `social-error-code-census.spec.ts` | **KHÔNG sửa.** Chạy để chứng minh WO không làm trôi bảng cặp/mã lỗi |

### 4C — Cách chạy
```bash
bash scripts/lane-db-setup.sh attdebt --reset
export LANE_DB=mediaos_attdebt
pnpm --filter @mediaos/api test              # KHÔNG `pnpm test -- <path>` (chạy TOÀN BỘ suite)
pnpm --filter @mediaos/api test:cov:social   # sau khi đã thêm file ở A2
bash harness/check.sh --lane-db=attdebt      # vùng ĐỎ ⇒ --all / REQUIRE_LANE_DB=1
```

---

## §5 — RỦI RO & NỢ ĐỂ LẠI

| # | Rủi ro | Mức | Giảm thiểu |
| --- | --- | --- | --- |
| R1 | **Dịch chỉ số batch** ⇒ 50 route đọc nhầm cặp quyền trong im lặng | **CRITICAL** | APPEND ở CUỐI + hằng `ATTACH_IDX` + **H4** (thông điệp scope) + **U2** (ghim 4 request cho route thường) |
| R2 | `withTenant` **lồng** `withTenant` nếu ai «đơn giản hoá» reporter vào trong tx | **CRITICAL** | D-5 + docblock tại chỗ; reviewer bắt mọi `await this.*` mới nằm **trong** callback `withTenant` |
| R3 | Sửa `AuthModule` ⇒ **sập bootstrap** | HIGH | D-7 module LÁ (khuôn `RealtimeEmitterModule`); chạy int-spec AUTH ngay sau D2; ca «một instance duy nhất» |
| R4 | Migration nới CHECK **thiếu journal** ⇒ insert vỡ ⇒ `emit` **NUỐT** ⇒ alert mất im lặng | HIGH | **H7 vế (i)** + **H11** (mẫu lưới cho 0587); memory `migration-not-in-journal-is-silently-skipped` |
| R5 | **Khuếch đại ghi**: mỗi lượt deny = 1 hàng vào bảng **append-only**, không ngưỡng ⇒ vòng lặp dò làm phình bảng/ồn cảnh báo | MEDIUM | **Đo trước khi chốt**: có throttler toàn cục trên PATCH không (0.3)? `retention.service.ts:47-55` xử lý `security_alerts` thế nào (M20)? ⇒ **S-5** |
| R6 | drizzle **bọc lại** ngoại lệ ⇒ `instanceof` trượt ⇒ alert không bao giờ ghi | MEDIUM | **H7** phát hiện ngay ở runtime; lối dự phòng ghi sẵn ở D-5 |
| R7 | `file_links_company_id_idx` thành **tiền tố dư** ⇒ `database-reviewer` sẽ nêu | MEDIUM | Nêu TRƯỚC trong PR + **S-6** (giữ, ghi nợ) |
| R8 | Spy đếm nhầm lời gọi của job/scheduler ⇒ số đo nói dối | MEDIUM | Lọc theo `userId` + `mockClear()` sát request + neo `toHaveBeenCalled()` |
| R9 | `decorateMany` làm **Đ2 nhiễm** nếu chọn bài không có đính kèm | MEDIUM | Bẫy ghi thẳng vào D-9 + docblock spec: **cùng bài, đã có ≥1 link sống** |
| R10 | Thêm field bắt buộc vào `SocialActor` ⇒ fixture TS-đỏ | LOW | M5: đúng **1** spec; sửa trong Phase B |
| R11 | Alert mở **1 transaction** trên đường 403 (sau rollback, KHÔNG lồng) | LOW | Chấp nhận; đo qua Đ1/Đ2 để chắc nó **không** rơi vào trong tx |
| R12 | `turbo` trả log CŨ ⇒ xanh-giả · int-spec SKIP vì thiếu `LANE_DB` | LOW | `TURBO_FORCE=1` / `harness/check.sh --lane-db=attdebt` |
| R13 | Chuỗi giống-secret trong spec ⇒ gitleaks đỏ oan | LOW | `LOGIN_PW` **ghép chuỗi** (khuôn `social-attgate-1…:53`) |

**Nợ ĐỂ LẠI (ghi vào `harness/backlog.mjs`):**
1. **`resolveContext` là transaction thứ hai của `resolveActor`** (P5) — mọi route SOCIAL trả giá; gộp nó vào cùng ảnh chụp là việc của tầng `permission`, không phải WO SOCIAL.
2. **Memo ảnh chụp grant theo REQUEST** (D-1 lối (c)) — lối sửa đúng nhất, đóng luôn `assertCreatablePostType` · `assertKudosOfficial` · `assertFileTarget` · `canApproveIdeas`; cần ADR + đụng `permission.cache.ts` (passthrough có chủ ý).
3. **`file_links_company_id_idx` dư** sau D-4 (S-6).
4. **Ngưỡng/khử trùng cho `attach_gate_deny`** nếu R5 đo ra có thật.
5. **F2 của ATTGATE-1 tự trung hoà**: «cổng còn resolve cả khi `attachmentIds: []`» giờ **0 round-trip** (đọc ảnh chụp) ⇒ hết là vấn đề *chi phí*; ⚠️ giữ nguyên cảnh báo cũ: **đừng** «sửa» bằng cách cho `attach = null` với mảng rỗng (sẽ im lặng không gỡ link nào).
6. **C-2/F-8** (gỡ đính kèm một chiều) và **F5** (lỗi hạ tầng fail-closed thành 403) — nguyên trạng, ngoài phạm vi.
7. Câu chữ hai hằng `FILE_TARGET_*_DENIED` vẫn nói «tải tệp» (nợ D-4 của ATTGATE-1).

---

## §6 — CẦN CHỮ KÝ OWNER TRƯỚC KHI VIẾT DÒNG CODE ĐẦU TIÊN

| # | Mục | Vì sao cần chữ ký | Khuyến nghị của planner |
| --- | --- | --- | --- |
| **S-1** | **D-1(b)** — gộp cặp thứ 5 **có điều kiện** vào `resolveActor` (đường nóng 50 route) **và viết lại tiêu chí trong 2 docblock** `assertKudosOfficial`/`assertFileTarget` đang nói ngược | Sửa một «luật» đã ghi trong mã crown-jewel. `done_when` #2 của WO đã chọn lối này, nhưng việc **đổi lời khai trong docblock** là thứ đã tự nhân bản ra 4 file ở BE-1C ⇒ đáng một chữ ký. Lối dự phòng (d) nếu reviewer bác | **DUYỆT (b)** |
| **S-2** | **D-4** — thêm **migration index NGAY** hay đóng F4 bằng số đo | `done_when` #1 cho phép cả hai. Đây là thắng lợi **dự phóng** (bảng 7 hàng); lý lẽ quyết định là **cửa sổ khoá rẻ nhất là bây giờ** + migrator drizzle chạy trong tx nên **không** dùng được `CREATE INDEX CONCURRENTLY` về sau | **LÀM NGAY** |
| **S-3** | **D-6** — **tên + severity** của loại alert mới: `attach_gate_deny` (hẹp) vs `capability_gate_deny` (chung, tái dùng khỏi nới CHECK) · severity `low` (khuyến nghị) vs `medium` (default bảng) | Ghi vào bảng **append-only**: chọn sai thì **sửa không được**, chỉ ghi đè bằng loại mới | `attach_gate_deny` + `low` |
| **S-4** | **D-7** — tách **`SecurityAlertModule` (LÁ)** và **gỡ** `SecurityAlertService` khỏi `providers` của `AuthModule` | Phẫu thuật wiring crown-jewel AUTH cho một nhu cầu của SOCIAL; lối thay thế (SocialModule import AuthModule) rẻ hơn về diff nhưng nặng hơn về đồ thị | **DUYỆT module LÁ** |
| **S-5** | **R5** — chấp nhận **1 hàng alert / mỗi lượt deny, KHÔNG ngưỡng** (ca H10 ghim hành vi đó), hay đòi khử trùng theo cửa sổ | Quyết định vận hành: đánh đổi giữa «mỗi lần dò đều có vết» và «bảng append-only phình + nhiễu cảnh báo» | **Chấp nhận không ngưỡng ở v1**, kèm nợ #4 — *với điều kiện* phép đo throttler (0.3) không cho thấy route để ngỏ |
| **S-6** | **R7** — giữ `file_links_company_id_idx` (tiền tố dư) hay drop trong cùng migration | Drop một index dùng chung của **mọi** module là bán kính ngoài SOCIAL | **GIỮ**, ghi nợ |
| **S-7** | **Mở `paths` của WO** thêm **`apps/api/src/auth/**`** (D-7) và **`apps/api/package.json`** (A2) | `paths` hiện tại **không** phủ hai file bắt buộc ⇒ hook `guard-scope` sẽ cảnh báo, và F-11 của ATTGATE-1 lặp lại y nguyên: quên `package.json` ⇒ **cổng coverage mù với chính WO này** | **MỞ** |
| **S-8** | Xác nhận **KHÔNG** đụng C-2/F-8, `054`/`055`, `assertFileTarget` (kế thừa S-7 của ATTGATE-1) | Nhắc lại ranh giới để lượt thi công không «tiện tay» | **Giữ nguyên ranh giới** |

---

## §7 — SỔ VÁ SAU `plan-reviewer`

*(để trống — điền sau lượt review đối kháng, theo khuôn §7 của `S16-SOCIAL-ATTGATE-1.md`)*

**LƯỢT 1 — `plan-reviewer` verdict: BLOCK** (24/09/2026). 5 BLOCKER + 1 HIGH được vá dưới đây.
Người thi công **tự xác minh lại 5 blocker bằng đọc mã** trước khi nhận (không tin lời reviewer suông) —
kết quả: **cả 5 ĐÚNG**. Dòng dẫn chứng ghi kèm từng mục.

### B1 (BLOCKER) — Đ1 «trước 2 · sau 1» KHÔNG ĐẠT ĐƯỢC ⇒ đổi sang ĐẠI LƯỢNG DELTA

**Xác minh:** `social-file.resolver.ts:111` `canReadOwner` → `resolveManyOrNull` (nạp grant #3) ·
`:181` `ownerContent` → `access.resolveViewerContext` → `social-access.service.ts:326`
`resolveManyOrNull` (nạp #4). Hai lời gọi này chạy trong `decorate()` ở CUỐI `update()`
(`social-posts.service.ts:419` → `:679` → `decorateMany:353` → `signOne:381` → `policy.decideForLinkedFile`).
Vì H1 **bắt buộc** dùng bài đã có ≥1 link sống (mitigation R9), `decorateMany` KHÔNG return sớm ⇒ số
tuyệt đối là **4 trước / 3 sau**, không phải 2/1.

**Vá — Đ1 định nghĩa lại (THAY THẾ D-9):**
> **Đ1 = DELTA số lời gọi `PermissionRepository.getCompanyRoleGrantsWithScope` (lọc theo `userId` actor)
> giữa hai request trên CÙNG một bài, CÙNG tập link sống:**
> `PATCH có attachmentIds` − `PATCH body-only`. **Trước = 1 · Sau = 0.**

Đường `decorate` chạy y hệt ở cả hai vế ⇒ **tự triệt tiêu**. Đây là đại lượng DUY NHẤT cô lập đúng thứ
WO sửa. H1/H2 hợp nhất thành **một cặp đo delta**; **bỏ** mọi assert số TUYỆT ĐỐI (`toBe(1)`) ở H1/H3.
Docblock của spec PHẢI liệt kê đủ **4 nguồn** nạp grant (`resolveActor` · `resolveAttachNewGate` ·
`SocialFileResolver.canReadOwner` · `resolveViewerContext`) để lượt sau đổi đường decorate thì ca đỏ
**đọc được lý do**.

**Kéo theo:** `done_when` #2 của `harness/backlog.mjs` («trước: 2 · sau: 1») phải sửa cùng lượt — nếu
không WO đóng với một tiêu chí **không ai đạt được**.
**Nợ mới (§5 #8):** đường `decorate`/presign nạp ảnh chụp grant **2 lần mỗi lượt đọc có đính kèm** —
khoản chi LỚN HƠN cả F1, WO này KHÔNG đụng.

### B2 (BLOCKER) — H4 là LƯỚI CHẾT ⇒ bỏ, giao vai trò lưới R1 cho H9

**Xác minh:** cặp tầng-1 của `004` là `view:feed` (`social-route-pairs.const.ts:147`). Vai KHÔNG có
`view:feed` bị `PermissionGuard` chặn **trước khi `resolveActor` chạy** ⇒ mutant «chèn phần tử thứ 5 ở
ĐẦU mảng» vẫn cho 403 ⇒ **H4 XANH dưới mutant**. Thêm nữa chuỗi `AUTH-ERR-FORBIDDEN: out of permission
scope` xuất hiện ở ≥6 nơi ⇒ assert theo thông điệp không phân biệt được tầng-1 với tầng-2.

**Hậu quả THẬT của mutant prepend** (nghiêm trọng hơn plan tưởng): destructuring ở
`social-access.service.ts:94` gán `managePostsScope = scope(view:feed)` ⇒ **mọi vai có `view:feed` đều
`canManagePosts = true`** ⇒ đọc bài `hidden` toàn công ty + sửa/xoá nội dung BẤT KỲ ai. Leo thang quyền
cho 100% nhân viên.

**Vá:** **BỎ H4**. Lưới của R1 là **H9** (vai có `view:feed` + `create:feed-post`, KHÔNG `manage`, PATCH
bài NGƯỜI KHÁC ⇒ 403 `SOCIAL-ERR-003`): dưới mutant prepend ca này trả **200** ⇒ đỏ đúng thông điệp.
Khai H9 là lưới chính của R1 trong §5. Giữ **U2** (pin `[0..3]` + «postCreate gửi đúng 4 request»).

### B3 (BLOCKER) — «field bắt buộc ⇒ TS đỏ» là LỜI KHAI SAI; `undefined` cho 500 chứ không DENY

**Xác minh (grep `as SocialActor` toàn `apps/api`):** **3 site**, không phải 2 —
`resolveActor` (literal, shorthand `routeKey,`) · `social-group-audience.int.spec.ts:117` (`as`) ·
**`social-news-noti-cap.spec.ts:52` (`as`) — M5 BỎ SÓT**. TypeScript **KHÔNG** đòi đủ thuộc tính trong
một `as` assertion ⇒ thêm field bắt buộc **không sinh lỗi biên dịch** ở 2/3 site.

**Vá:**
1. M5 sửa thành **3 site, 2/3 là `as` cast ⇒ typecheck KHÔNG bảo vệ**.
2. D-3 narrow **tường minh**, không tin kiểu:
   `if (snap === undefined || snap.resolved !== true || snap.target !== target) { logger.error(...); return { allow: false, reason: SOCIAL_FILE_TARGET_DENIED[target] }; }`
3. **U1 thêm ca**: actor dựng bằng `as` cast KHÔNG có field ⇒ assert `allow:false` + **đúng hằng**
   (KHÔNG assert «ném TypeError» — DENY mới là hợp đồng).
4. R10 **nâng LOW → MEDIUM**: lưới duy nhất là ca U1 ở (3), không phải typecheck.

### B4 (BLOCKER) — ánh xạ `signal` → `detail` CHƯA TỒN TẠI (payload append-only)

**Xác minh:** `syncLinksTx(tx, companyId, userId, targetType, targetId, fileIds, gate)`
(`social-attachments.service.ts:187-195`) **không nhận `actor`, không nhận `routeKey`** ⇒ `signal`
không có đường nào mang `route`. 3/5 khoá còn đổi tên giữa D-5 và D-6.

**Vá — chốt bảng ánh xạ TRONG plan, trước khi code:**

| khoá `detail` | kiểu | nguồn |
| --- | --- | --- |
| `route` | `string` | **nghịch đảo `ATTACH_GATE_ROUTE_TARGET`** (`post` to `postUpdate`, `comment` to `commentUpdate`), dẫn xuất trong `reportAttachGateDeny` — **0 tham số mới** cho `syncLinksTx` |
| `target` | `post` hoặc `comment` | `signal.targetType` |
| `targetId` | `uuid` | `signal.targetId` |
| `newFiles` | `number` | `signal.newFileCount` (CHỈ số lượng — không id/tên tệp) |
| `pair` | `string` | `create:feed-post` / `create:feed-comment` theo `targetType` |

`signal` = `{ targetType, targetId, actorUserId, newFileCount }` (**bỏ `pair`** — dẫn xuất ở reporter).
**Bỏ khoá `module`** (không có nguồn). H7 assert **đúng bảng này**, không phải danh sách viết tay.
Bảng này làm `ATTACH_GATE_ROUTE_TARGET` thành load-bearing **lần thứ hai**.
🔴 5 khoá trên đều **sống sót** `sanitizeDetail` (regex chặn password/secret/token/code/otp/dek/cipher/hash/key).

### B5 (BLOCKER) — L1 khai SAI «thêm tham số thứ 8 làm vỡ ca S-1»

**Xác minh:** census `:257` đọc **`node.arguments[6]`**, `:505` assert `shapes.length === 4`. Một đối số ở
**index 7 KHÔNG đổi `arguments[6]`** và không đổi số call-site ⇒ **ca S-1 vẫn XANH**. Plan định ghi câu
sai này vào docblock crown-jewel — đúng cơ chế đã trả giá ở BE-1C
(`canlinkfile-not-on-attachment-write-path`).

**Vá:**
(a) Lý do loại lối (e) sửa thành «**out-param mutable** + ngữ cảnh DENY phải **sống sót rollback**».
(b) Docblock `syncLinksTx` ghi **sự thật đo được**: «ca S-1 khoá **đối số index 6**; thêm đối số ở
    index ≥7 **KHÔNG lưới nào bắt** ⇒ phải mở rộng `syncLinksGateArgShapes()` cùng lượt».
(c) **Thêm `expect(node.arguments.length).toBe(7)` vào ca S-1** — 1 dòng, biến lời khai thành ĐÚNG.

### HIGH-1 — G-ALERT (L5) khoá SAI CHỖ ⇒ nâng thành lưới mã hoá được R2

Tập-method-bằng-tập-method vẫn XANH khi: catch gọi reporter nhưng **quên `throw err`** (403 thành 200!) ·
catch bọc **nhầm** `withTenant` · reporter nhận `new Error('x')`. **Bổ sung vào G-ALERT:**
(i) đối số 1 của reporter phải là **chính binding của `catch`** (identifier);
(ii) khối catch phải chứa **`throw` cùng identifier đó**;
(iii) **AST ancestor check**: lời gọi reporter **KHÔNG** được nằm trong callback của `this.db.withTenant`
     — đây là lưới tĩnh **DUY NHẤT** mã hoá được bất biến R2, plan cũ chỉ giao cho «reviewer sẽ bắt».
**Mutant:** xoá riêng dòng `throw err;` ⇒ **H5 phải đỏ đúng hằng** `FILE_TARGET_POST_DENIED`.

### Các mục MEDIUM/LOW đã nhận và vá

- **Mutant (a) của H7 khai sai:** «dời `emit` vào trong tx» ⇒ **TREO/timeout** (withTenant lồng), KHÔNG
  phải «hàng biến mất». Mutant hợp lệ của H7 là **`emitTx` trong tx** (cho `expected 0 to be 1`); ca
  «`emit` trong tx» khai riêng là **bằng chứng R2**, không phải phép đo C-5.
- **Bẫy Đ2 tự mâu thuẫn:** với bài trống, ca B cũng gửi mảng rỗng và cũng return sớm ⇒ delta vẫn 0. **Giữ
  ràng buộc** «cùng bài, ≥1 link sống», **bỏ lý do sai** kèm theo.
- **S-7 thiếu `docs/API Design/`** (Phase E5 sửa API-19) ⇒ thêm vào cùng `apps/api/src/auth/` +
  `apps/api/package.json`.
- **Rollback 2 migration:** 0588 dùng `DROP CONSTRAINT IF EXISTS` (chống môi trường lệch); ghi rõ
  `ADD CONSTRAINT ... CHECK` **revalidate toàn bảng + khoá ACCESS EXCLUSIVE** (bảng nhỏ nên OK hôm nay —
  nói ra để lần sau không copy mù).
- **E4 khai sai:** `security-alert.service.spec.ts` **KHÔNG tồn tại** ⇒ là file **MỚI**, không phải «mở rộng».
- **`makeService()` của `social-attachments.service.spec.ts:69-114`** sẽ TS-đỏ khi service nhận thêm
  `SecurityAlertService` — đỏ **ồn ào** (tốt), liệt kê ở D5 để không tưởng là hồi quy.
- **`require-await`:** chốt lối — **bỏ `async`**, trả `Promise.resolve(...)`, giữ kiểu
  `Promise<AttachNewGate>`. **KHÔNG** `eslint-disable` (anti-bandaid-guard).
- **Coverage per-file** `social-access.service.ts` gate 90/85 ⇒ chạy `test:cov:social` **ngay sau B3**,
  không để tới E7.

---

## §8 — CHỮ KÝ OWNER (24/09/2026)

| # | Quyết định | Owner ký |
| --- | --- | --- |
| **S-1** | F1 — **lối (b)**: gộp cặp thứ 5 **CÓ ĐIỀU KIỆN** vào `resolveActor`, giữ chữ ký + call-site `resolveAttachNewGate` | ✍️ **DUYỆT** |
| **S-2** | F4 — **thêm migration index NGAY** (lý lẽ quyết định: migrator drizzle chạy TRONG tx ⇒ `CREATE INDEX CONCURRENTLY` không dùng được về sau; bảng 7 hàng ⇒ cửa sổ khoá rẻ nhất là bây giờ) | ✍️ **DUYỆT** |
| **S-3** | C-5 — loại alert **`attach_gate_deny`**, severity **`low`** | ✍️ **DUYỆT** |
| **S-4** | D-7 — tách **`SecurityAlertModule` (LÁ)**, gỡ service khỏi `providers` của `AuthModule`, re-export MODULE | Mặc định khuyến nghị — **NHẬN** |
| **S-5** | R5 — 🔴 **PHÉP ĐO ĐỔI KẾT LUẬN**: `APP_GUARD` (`app.module.ts:143-145`) chỉ có `JwtAuthGuard`/`CompanyGuard`/`TwoFactorEnforcementGuard` — **KHÔNG có `ThrottlerGuard`** ở bất kỳ đâu trong `src`; và `security_alerts` nằm trong `PROTECTED_TABLES` của `retention.service.ts` ⇒ **không có đường dọn**, app role chỉ `SELECT, INSERT`. «Không ngưỡng» = vector phình **vô hạn, không xoá được**, và làm `attach_gate_deny` thành loại **DUY NHẤT** không-ngưỡng trong bảng mà 3 loại kia đều `repeated_*`/`anomalous`. ⇒ **THÊM cửa sổ khử trùng TRONG-TIẾN-TRÌNH** ở `reportAttachGateDeny` (key `company:actor:target:targetId`, TTL 60s) — KHÔNG đụng `SecurityAlertService`, 0 chi phí DB | **ĐỔI so với plan gốc** |
| **S-6** | R7 — **GIỮ** `file_links_company_id_idx` (tiền tố dư), ghi nợ | Mặc định khuyến nghị — **NHẬN** |
| **S-7** | Mở `paths`: `apps/api/src/auth/` · `apps/api/package.json` · **`docs/API Design/`** | **MỞ** |
| **S-8** | KHÔNG đụng C-2/F-8, `054`/`055`, `assertFileTarget` (kế thừa S-7 của ATTGATE-1) | **Giữ ranh giới** |

> **Lượt plan-review thứ 2: BỎ** (owner chốt vì chi phí). Bù lại: người thi công **tự xác minh từng
> blocker bằng đọc mã** (dòng dẫn chứng ở §7) thay vì nhận suông, và **H10 đổi kỳ vọng** theo S-5.

---

## §9 — BẰNG CHỨNG ĐO THẬT (thi công 24/09/2026, lane `mediaos_attdebt`)

> Mọi con số dưới đây là **kết quả chạy**, không phải thiết kế phép đo. Lane: `bash scripts/lane-db-setup.sh attdebt --reset`.

### 9.1 — F1: phép đo DELTA, đo bằng MUTANT

| Ca | body-only | có `attachmentIds` | delta |
| --- | --- | --- | --- |
| **Mutant** (khôi phục lời gọi DB trong `resolveAttachNewGate`) | 3 | 4 | **1** ⇒ ĐỎ `expected 1 to be +0` |
| **Sau WO** | 3 | 3 | **0** ⇒ XANH |

🔴 Con số tuyệt đối là **3/4**, KHÔNG phải «2» như backlog ghi — đúng như §7 B1 dự đoán: hai lần nạp
còn lại đến từ đường `decorate` (`SocialFileResolver.canReadOwner` + `resolveViewerContext`), và
chúng **tự triệt tiêu** trong phép đo delta. Đây là lý do delta là đại lượng đúng.

### 9.2 — Mutant đã chạy (tất cả ĐỎ đúng thông điệp kỳ vọng, không phải đỏ vì 500/biên dịch)

| # | Mutant | Lưới bắt | Thông điệp đỏ THẬT |
| --- | --- | --- | --- |
| M1 | Xoá `throw err;` khỏi `SocialCommentsService#update` | census **G-ALERT** | `SocialCommentsService#update: khối catch phải ném LẠI đúng binding đó — thiếu ⇒ 403 hoá 200` |
| M2 | Bỏ `commentUpdate` khỏi `ATTACH_GATE_ROUTE_TARGET` | census **G-TABLE** | `expected [ 'commentUpdate', 'postUpdate' ] to deeply equal [ 'postUpdate' ]` |
| M3 | Thêm đối số thứ 8 cho `syncLinksTx` | census **S-1** (vế `argCount` MỚI) | ``syncLinksTx` phải nhận ĐÚNG 7 đối số…` — 🔴 **trước WO này mutant đó KHÔNG lưới nào bắt** (§7 B5) |
| M4 | Khôi phục lời gọi DB trong `resolveAttachNewGate` | int **H1** | `nạp grant: body-only=3 · attachmentIds=4 — delta phải là 0: expected 1 to be +0` |
| M5 | Xoá lời gọi `reportAttachGateDeny` khỏi `SocialPostsService#update` | int **H7** | `phải có ĐÚNG 1 hàng security_alerts mới: expected +0 to be 1` |

### 9.3 — Lưới hồi quy CÒN XANH (không sửa một dòng nào)

`social-attgate-1-update-attach.int-spec.ts` (17) · `social-be1-attachments.int-spec.ts` (19) ·
`social-be1c-file-door.int-spec.ts` (17) = **53/53 PASS** trên lane DB.
Toàn bộ `src/social` + `test/foundation`: **644 pass** · lint 0 error · `tsc --noEmit` sạch.

### 9.4 — DDL đã áp thật trên lane

```
file_links_company_file_idx
CHECK ((alert_type = ANY (ARRAY['repeated_reauth_failure','repeated_cross_scope_deny','anomalous_login','attach_gate_deny'])))
```

### 9.5 — MỘT LỖI TỰ TÌM RA LÚC VIẾT TEST (không do reviewer nêu)

Bản đầu của `reportAttachGateDeny` `await` thẳng `securityAlerts.emit(...)` mà KHÔNG bọc `try/catch`.
Vì caller của nó là khối `catch` của `update()` và khối đó **ném LẠI lỗi 403 ngay sau**, một ngoại lệ
thoát ra từ reporter sẽ **THAY THẾ 403 bằng 500** — tức để một sự cố hạ tầng ghi đè lên một quyết
định an ninh. `emit()` thật có nuốt lỗi, nên ca này không xảy ra hôm nay; nhưng lớp phòng thủ không
được phụ thuộc vào nội tâm của thứ nó gọi. Đã bọc `try/catch` + log, và ca U3 cuối cùng ghim nó.

### 9.6 — ĐÍNH CHÍNH §7 B3 (reviewer đúng phần KẾT LUẬN, sai phần CƠ CHẾ)

Reviewer khai «TypeScript KHÔNG đòi đủ thuộc tính trong một `as` assertion» cho CẢ HAI site. Đo thật:
- `social-group-audience.int.spec.ts:117` (8 thuộc tính) ⇒ **TS2352 ĐỎ** («neither type sufficiently overlaps»).
- `social-news-noti-cap.spec.ts:52` (2 thuộc tính) ⇒ **XANH, lọt** — `SocialActor` assignable ngược về
  kiểu literal nhỏ nên assertion được chấp nhận.

⇒ **Kết luận của B3 vẫn ĐÚNG và cần thiết**: có một site thật sự cho `attachNewGate === undefined` lúc
chạy, nên `snap === undefined` là nhánh LOAD-BEARING, không phải phòng thủ thừa. Nhưng cơ chế là
«assertion lọt khi kiểu nguồn ĐỦ NHỎ», không phải «assertion luôn lọt». Ghi lại cho chính xác vì
docblock của `SocialActor.attachNewGate` viện dẫn đúng sự thật này.

---

## §10 — FULL GATE (24/09/2026) — 3/3 PASS, và 5 khoản đã vá ngay sau đó

> Gate chạy trên `git diff master...HEAD` tại commit `c3fe153e`, ba reviewer ĐỘC LẬP, read-only,
> theo CLAUDE.md §6 (diff chạm permission · audit append-only · migration ⇒ FULL gate).

| Reviewer | Verdict | CRITICAL | HIGH |
| --- | --- | --- | --- |
| `security-reviewer` | **PASS** | 0 | 0 |
| `database-reviewer` | **PASS** | 0 | 0 |
| `silent-failure-hunter` | **PASS** | 0 | 0 |

Không reviewer nào tìm được đường biến DENY thành ALLOW, làm mất `throw`, hay mở tx-lồng-tx.
Cả ba hội tụ vào CÙNG một bẫy từ ba phía: **`SecurityAlertService.emit()` nuốt lỗi** — phía DDL
(CHECK dựng từ literal ⇒ 23514 bị nuốt) và phía app (cửa sổ khử trùng đóng trước khi ghi thành công).

### 10.1 — Năm khoản đã VÁ trong lượt này

| # | Nguồn | Vá | Bằng chứng ĐO |
| --- | --- | --- | --- |
| **V1** | SFH M-1 | `ATTACH_IDX = 4` (hằng gõ tay) → `attachIdx = baseRequests.length` | typecheck sạch · 246 unit pass. Lý do: WO sau append một cặp base thứ 5 — **đúng việc file này ĐÃ làm một lần ở `[3]` (BE-2A)** — thì ảnh chụp cổng đọc scope của cặp base MỚI ⇒ vai giữ cặp đó @Company nhưng thiếu `create:feed-post` lọt `isCompany` ⇒ gắn tệp mới qua PATCH không cần cặp `create` = mở lại đúng lỗ ATTGATE-1. Typecheck câm, `G-TABLE`/`D17` chỉ so tập ROUTE, `U2` sẽ được sửa máy móc rồi xanh lại |
| **V2** | SFH M-2 + SEC M4 | `emit()` trả `false` ⇒ `alertSeenAt.delete(key)` + log mang `company/actor/target/route`; nhánh `catch` cũng trả khoá và log kèm `stack` | **Mutant**: gỡ cả 2 lời gọi `delete(key)` ⇒ đúng **2 ca mới ĐỎ bằng `AssertionError` đúng thông điệp** (`expected "spy" to be called 2 times, but got 1`), 11 ca kia vẫn xanh |
| **V3** | DB MEDIUM-1 | `0588` bỏ «DROP + ADD với 4 giá trị gõ tay», thay bằng **DO-block đọc `pg_get_constraintdef` THẬT rồi cộng dồn** (clone nguyên khối `0583`: NEO 2 tầng · fail-closed · NO-LOSS + NO-GAIN + SỐ HỌC) | Chạy trên 3 DB thử (§10.2) |
| **V4** | DB MEDIUM-2 | `0587` thêm `SET LOCAL lock_timeout = '5s'` + trả `DEFAULT` sau (khuôn `0535:693` / `0547:342`) | Chain `0000→latest` áp sạch trên lane `mediaos_attdebt` ⇒ `--> statement-breakpoint` chạy được qua migrator drizzle |
| **V5** | SEC M1 | Đính chính 3 docblock khai NGƯỢC còn sót: `social-posts.service.ts:342` · `social-comments.service.ts:221` · `social-attachments.service.ts:38` | Từng câu được xác minh bằng mã TRƯỚC khi sửa, không nhận lời khai của reviewer |

🔴 **V5 là lớp lỗi của chính WO này.** Plan §1 D-1 đã đặt việc sửa docblock là *hạng mục thi công bắt
buộc* vì «một câu khai sai tự nhân bản ra 4 file» — rồi lượt thi công chỉ sửa 1 trong 4. Cùng lớp với
[[canlinkfile-not-on-attachment-write-path]]. Sắc thái: `social-attachments.service.ts:32-37` KHÔNG
sai thẳng (câu «hỏi quyền TẠI ĐÂY sẽ là tx lồng tx» vẫn đúng như một giả định) — nó chỉ **misleading**
vì kết luận trỏ sang `resolveAttachNewGate`, hàm nay không còn chạm DB. Đã ghi đúng sắc thái đó.

### 10.2 — V3 đo trên Postgres thật (3 DB dùng-một-lần)

| Ca | Bản literal CŨ | Bản DO-block MỚI |
| --- | --- | --- |
| CHECK gốc 0122 (viết `IN (…)`, pg render **`= ANY (ARRAY[…])`** = tầng 2) | — | parse tầng-2 ✅ · `3 → 4 giá trị` · giá trị mới INSERT được ✅ |
| Chạy LẦN HAI trên kết quả của chính nó (pg render `'{…}'` = tầng 1) | — | parse tầng-1 ✅ · **idempotent skip** ✅ ⇒ **cả hai tầng parse đều được thực thi**, không tầng nào là mã chết |
| CHECK có giá trị ngoài luồng `ngoai_luong_canary`, **chưa** có hàng | 🔴 **NUỐT MẤT canary trong im lặng** — 0 lỗi, 0 notice | canary SỐNG SÓT · `4 → 5 giá trị` ✅ |
| CHECK có giá trị ngoài luồng, **đã có hàng** mang giá trị đó | 🔴 `ERROR: check constraint "security_alerts_type_check" … is violated by some row` ⇒ migrator drizzle chạy MỌI migration pending trong MỘT tx ⇒ **cuộn cả band, `db:migrate` đỏ vĩnh viễn** | canary sống sót, không lỗi ✅ |

⇒ Hai kịch bản mà `database-reviewer` nêu là **số liệu**, không phải suy đoán. Và kịch bản 3 là
kịch bản IM LẶNG: `emit()` của loại bị nuốt sẽ ăn 23514 rồi **bị nuốt tiếp** ⇒ tín hiệu an ninh biến
mất, chỉ còn một dòng `logger.error` không mang actor/target.

### 10.3 — Cổng tiền-PR (CLAUDE.md §9.5, vùng đỏ)

`bash harness/check.sh --all --lane-db=attdebt` ⇒ **XANH ✅** (KHÔNG phải «XANH KHÔNG ĐỦ BẰNG CHỨNG»):
`secret-literals` · `lint` · `typecheck` · `migration-no-drop` · `tooling-tests` ·
`test (LANE_DB=mediaos_attdebt) [chunked]` · `build` · `prod-tenant-check` · `db-readiness`.
Tổng **1728 pass / 16 skipped**; `tenant-isolation.int-spec` chạy đủ **1314 ca** ⇒ int-spec thực thi
thật, không phải skip. `db-readiness`: 12/12 index · 0 bảng thiếu FORCE RLS · 0 grant UPDATE/DELETE
trên 9 bảng ledger.

DDL xác nhận trên lane sau migrate:
```
CHECK ((alert_type = ANY ('{anomalous_login,attach_gate_deny,repeated_cross_scope_deny,repeated_reauth_failure}'::text[])))
file_links_company_file_idx   -- có mặt trong 8 index của file_links
```

### 10.4 — Nợ để lại (KHÔNG vá ở lượt này, owner chốt phạm vi)

| Nguồn | Khoản | Vì sao hoãn |
| --- | --- | --- |
| SFH M-3 | Lưới census `G-ALERT` vế (iii) đúng **nhờ hiệu ứng phụ**: `nextInTenant` không bao giờ được gán `true`, mọi node trong callback `withTenant` bị duyệt HAI lần. Một lượt «dọn dẹp» xoá nhánh đệ quy trông-thừa ⇒ bất biến R2 **mất lưới mà ca vẫn XANH**. Lưới cũng mù với call-graph (dời reporter vào helper ⇒ vẫn xanh) | Sửa AST walker, cần đo bằng mutant riêng |
| SFH M-5 | `route` suy bằng **nghịch đảo** `ATTACH_GATE_ROUTE_TARGET` — bảng KHÔNG được ép song ánh. Thêm route thứ ba cùng `target:"post"` ⇒ mọi alert của route mới ghi `route:"postUpdate"` = **lời khai sai ghim vĩnh viễn vào bảng append-only** | 1 dòng assert trong census |
| SEC M2 | `try` của `reportAttachGateDeny` chỉ bọc `emit`; 4 dòng trước nằm ngoài ⇒ vẫn còn đường 500 đè 403 (khó kích hoạt hôm nay, nhưng docblock đang tuyên bố bất biến MẠNH HƠN mã) | |
| SEC M3 | `logger.warn` — vết DUY NHẤT của deny thứ 2..n trong cửa sổ 60s — **không lưới nào canh** | Cần spy `Logger.prototype.warn` |
| SEC M4b · SFH M-4 · L-1 | Map khử trùng: không có trần kích thước · quét O(n) mỗi deny · `Date.now()` (bước NTP LÙI ⇒ khoá bị khử tới khi đồng hồ đuổi kịp) · cửa sổ giới hạn TỐC ĐỘ chứ không giới hạn TỔNG | Trần theo actor cần quyết định của owner |
| DB LOW-1 | Câu «đã TỪNG link chưa» kéo về N hàng chỉ để hỏi tồn-tại — thiếu `.limit(1)` | |
| SEC L2 · L3 · SFH L-3 · L-4 | `as keyof typeof` che `undefined` ở tầng kiểu · `docs/API Design` đã mở `paths` nhưng chưa viết dòng hợp đồng vận hành · câu «thiếu `throw` ⇒ 403 hoá 200» thực ra là TypeError ⇒ 500 · `logger.warn` thiếu `companyId` | |
| DB LOW-2 | ⚠️ Gài cho `S16-SOCIAL-IDXDEDUP-1`: **CHỈ** được drop `file_links_company_id_idx`. `idx_file_links_file` (partial, cột dẫn đầu `file_id`) **KHÔNG** bị index mới bao — PG 16/17 không có index skip-scan | |
