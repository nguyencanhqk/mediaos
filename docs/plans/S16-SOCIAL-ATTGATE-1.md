# S16-SOCIAL-ATTGATE-1 — CỔNG CẶP QUYỀN trên ĐƯỜNG GẮN TỆP

> Zone **red** (crown-jewel: permission) · không migration · không cặp quyền mới · 0 route mới.
> Nguồn: FULL gate `S16-SOCIAL-BE-1C` 24/09/2026, finding HIGH. Owner đã ký cho phép siết (backlog `notes`).
> Plan lập theo CLAUDE.md §6 (crown-jewel ⇒ micro-plan → `plan-reviewer` → mới code).
> Lập 24/09/2026 (planner Opus) · người gọi đã xác minh lại M7 và M13 (xem §0).

---

## §0 — PHÉP ĐO HIỆN TRẠNG (đo lại 24/09/2026, đọc mã — KHÔNG chạy DB)

| # | Câu hỏi | Kết quả đo | Bằng chứng (dòng) |
| --- | --- | --- | --- |
| M1 | `assertLinkableFilesTx` ép những vế nào? | Vế 2 (sở hữu) · 3 (`Uploaded`) · 4 (scan) · 5 (chưa-từng-link) · trần SOC-DEC-008. **KHÔNG hỏi cặp quyền nào** — vế 6a/6b của `canLinkFile` vắng mặt hoàn toàn. | `social-attachments.service.ts:69-128` (vế 2 `:100`, vế 5 `:112-118`, trần `:121-125`) |
| M2 | `canLinkFile` có nằm trên đường gắn không? | **KHÔNG.** Nó là `FileOwnerPermissionResolver.canLinkFile`, chỉ được `FilePolicyService` hỏi trên `POST /foundation/files/:id/links` (gate `link:foundation-file`) — cặp nhân viên thường không có ⇒ nhánh CHẾT với người dùng thường. | `social-file.resolver.ts:93-95` → `canAttach :129-160`; vế 6a `:133-141` |
| M3 | Ai gọi `assertLinkableFilesTx`? | **ĐÚNG MỘT** call-site: `syncLinksTx:183`. Không có đường vòng nào khác. | grep toàn kho: chỉ `social-attachments.service.ts:183` |
| M4 | 4 call-site của `syncLinksTx` | `social-posts.service.ts:289` (TẠO, 002) · `:377` (SỬA, 004) · `social-comments.service.ts:178` (TẠO, 015) · `:262` (SỬA, **016**) | như cột trái |
| M5 | Cặp tầng-1 của 4 route | `postCreate: create:feed-post` (`:135`, `tier1IsFloor:true`) · `postUpdate: view:feed` (`:137`) · `commentCreate: create:feed-comment` (`:150`) · `commentUpdate: view:feed` (`:151`) | `social-route-pairs.const.ts` |
| M6 | ⇒ Khoảng hở nằm ở đâu? | **Hai đường SỬA.** Hai đường TẠO đã bị tầng-1 ép ĐÚNG cặp `create:feed-*`. Đường SỬA chỉ có sàn `view:feed` (cấp cho cả 4 vai canonical, seed 0578) + `assertCanMutateContent` (tác giả ∨ `manage:feed-post`). | `social-posts.service.ts:333-337` · `social-comments.service.ts:213-217` |
| M7 | 🔴 **ĐÍNH CHÍNH SỐ ROUTE** ✅ *người gọi đã xác minh độc lập 24/09* | Backlog · STATUS · và cả 4 docblock ĐÍNH CHÍNH của BE-1C đều viết «`017 PATCH /social/comments/{id}`». **SAI.** API-19 (nguồn sự thật) chốt: **`016` = PATCH comments**, **`017` = DELETE comments**. `remove()` KHÔNG gọi `syncLinksTx`. Khoảng hở là **004 + 016**. | `docs/API Design/API-19_SOCIAL_API_Design.md:80-81` · `social-comments.service.ts:207` («016 — sửa») vs `:286` («017 — xoá mềm») |
| M8 | 🔴 `withTenant` có TÁI NHẬP được không? | **KHÔNG.** `withTenant` gọi `db.transaction(...)` trên đối tượng `db` mức module — không AsyncLocalStorage, không cờ tái nhập, không truyền tx hiện hành. Mỗi lần gọi = **một client MỚI** lấy từ pool. | `db.service.ts:74-92` (đặc biệt `:83 return db.transaction(...)`) |
| M9 | `assertFileTarget` có mở `withTenant` không? | **CÓ, gián tiếp.** `assertFileTarget` → `dataScope.resolveManyOrNull` → `permission.resolveStrongestScopes` → `repo.getCompanyRoleGrantsWithScope` → **`this.db.withTenant(companyId, …)`**. Đường này **KHÔNG cache** ⇒ MỖI lời gọi là một round-trip DB THẬT. | `social-access.service.ts:241-247` · `data-scope.service.ts:127-133` · `permission.service.ts:835-866` (`:843`) · `permission.repository.ts:66-70` |
| M10 | Hệ quả định lượng của tx lồng | Pool app `max: 20`. Gọi cổng TRONG tx nghiệp vụ ⇒ **2 client/request**. ≥20 request ghi-có-đính-kèm đồng thời ⇒ 20 client giữ tx ngoài, tất cả chờ client thứ hai **không bao giờ có** ⇒ **treo IM LẶNG, không lỗi, không log**. PgBouncer transaction-mode còn tệ hơn. | `db/index.ts:17-19` · cảnh báo đã có sẵn ở `social-attachments.service.ts:34-43` và `social-access.service.ts:530-537` |
| M11 | Ngữ nghĩa `if (dto.attachmentIds)` ở đường SỬA | Mảng **RỖNG là truthy** ⇒ `[]` = «bỏ hết đính kèm». Có comment giải thích và **có ca test đang canh**. Không được phá. | `social-comments.service.ts:258-261` · `social-posts.service.ts:376` · `social-be1-attachments.int-spec.ts:426-434` |
| M12 | `SOCIAL_FILE_TARGET_PAIRS` đã đúng cặp chưa? | Đúng: `post → create:feed-post` · `comment → create:feed-comment`; song ánh với `SOCIAL_FILE_TARGET_DENIED`. | `social-route-pairs.const.ts:405-411` · `social.errors.ts:468-471` |
| M13 | 🔴 **FE hôm nay gửi gì?** ✅ *người gọi đã xác minh độc lập: 0 kết quả* | `apps/app` **KHÔNG có MỘT tham chiếu `attachmentIds` nào** và **không call-site `updatePost`/`updateComment` nào**. `packages/web-core/src/lib/social-api.ts:167-172, 271-276` CÓ phơi hai hàm, nhưng không ai gọi. ⇒ **Hôm nay 004/016 không có người dùng FE; rủi ro hồi quy FE = 0.** | grep `apps/app/src` |
| M14 | Vai canonical có bị ảnh hưởng? | **Không.** Seed `0578` cấp cả `create:feed-post` lẫn `create:feed-comment` cho cả 4 vai canonical. Chỉ **vai TUỲ BIẾN lệch cặp** mới chạm nhánh mới. | plan `S16-SOCIAL-BE-1C.md` §0 M6 |
| M15 | Ném lỗi TRONG tx có rollback sạch không? | **Có, đã có ca test canh**: `syncLinksTx` ném giữa tx sau khi `feed_kudos` + outbox đã ghi ⇒ cả hai = 0. | `social-be2b2-kudos.int-spec.ts:889-914` (N-033b) |
| M16 | Census mã lỗi: thêm hằng mới có phải bump không? | Dùng **LẠI** `FILE_TARGET_POST_DENIED`/`FILE_TARGET_COMMENT_DENIED` ⇒ **0 thay đổi census** (cả hai đã ở `STRONG_EVIDENCE`). Hằng MỚI thì phải được ném ở `src/social/**` (tầng B) **và** nên vào `STRONG_EVIDENCE`. | `social-error-code-census.spec.ts:55-73, 148-165, 169-186` |
| M17 | Census route/OpenAPI | **0 route mới** ⇒ `MIN_COVERED_COUNT` **không đổi**; `ROUTE_TO_KEY` **không đổi**; `SERVICE_SITE_TO_KEYS` **không đổi**. | `social-two-layer-guard-census.unit-spec.ts:59-133` |
| M18 | 🔴 Census **D17** có đỏ không? | **CÓ — nếu đặt cờ `tier1IsFloor`.** Ca `:345-380` assert `toEqual` giữa tập `tier1IsFloor===true` và tập «route có bảng cặp-theo-payload» tính từ nguồn ĐỘC LẬP. Đặt cờ mà không mở rộng nguồn độc lập ⇒ **ĐỎ**. | như cột trái |
| M19 | `packages/contracts` có trong `paths` của WO? | **KHÔNG.** `paths` = `apps/api/src/social/**` · `apps/api/test/**` · `docs/API Design/**` · `docs/plans/**` · `harness/backlog.mjs`. Nhưng `done_when` #5 **bắt** gỡ khối ĐÍNH CHÍNH ở `packages/contracts/src/social-api.ts` ⇒ **`paths` tự mâu thuẫn với `done_when`**. | `harness/backlog.mjs:17092-17098` vs `:17111` |
| M20 | Script coverage | `test:cov:social` liệt kê TỪNG file int-spec bằng tay ⇒ file int-spec MỚI **phải** được thêm, nếu không nó không chạy trong cổng coverage của module. | `apps/api/package.json:16` |

### Cái KHÔNG xác minh được trong phiên lập plan

- **M8/M9/M10 là suy luận từ ĐỌC MÃ, chưa chạy.** Không có Postgres/PgBouncer trong phiên lập plan ⇒ **chưa ĐO thật** cú treo. Bằng chứng gián tiếp mạnh (không ALS; `db.transaction` mức module; pool `max:20`; ba docblock trong chính kho khẳng định cùng kết luận, một trong số đó là lý do `SocialGroupAccessService` được thiết kế nhận `tx`). **Nếu lượt thi công muốn chắc:** một ca int-spec `timeout(5s)` gọi cổng bên trong tx với `pool.max=1` — đỏ = treo, xanh = tái nhập được. Khuyến nghị **KHÔNG** đánh cược: thiết kế dưới đây không cần câu trả lời đó.
- Plan **không chạy** `pnpm test` / `check.sh`. Mọi con số coverage/census là đọc mã, không phải kết quả chạy.

---

## §1 — QUYẾT ĐỊNH

### D-1 — ĐIỀU KIỆN KÍCH HOẠT CỔNG: «có tệp MỚI được thêm», quyết định TRONG tx, dữ liệu quyền resolve NGOÀI tx

**Bốn lối đã cân:**

| Lối | Mô tả | Vì sao loại / chọn |
| --- | --- | --- |
| (a) | Gọi `assertFileTarget` NGOÀI tx khi `dto.attachmentIds?.length > 0` (gợi ý backlog, đã sửa vị trí ra ngoài tx) | **LOẠI.** Phá kiểm duyệt: vai `manage:feed-post` gỡ MỘT ảnh xấu trong 3 ảnh ⇒ FE gửi lại 2 ảnh còn lại ⇒ danh sách non-empty ⇒ **403**. Người kiểm duyệt mất khả năng gỡ đính kèm vi phạm — hồi quy CHỨC NĂNG. |
| (b) | Đọc trước link hiện có NGOÀI tx để tính `toAdd`, chỉ gác khi `toAdd` non-empty | **LOẠI (nhưng an toàn).** Đúng ngữ nghĩa, nhưng đẻ **bản thứ hai** của luật tính `toAdd` (bản gốc `syncLinksTx:159-178`). Thêm 1 round-trip. |
| (c) | Ép cổng BÊN TRONG `assertLinkableFilesTx` bằng cách gọi thẳng `dataScope` ở đó | **LOẠI — NGUY HIỂM.** Đó chính là `withTenant` lồng `withTenant` (M8/M9/M10): treo im lặng. Đây là cái bẫy của gợi ý «~1 dòng/call-site» trong backlog. |
| (d) | Đổi cặp tầng-1 của 004/016 thành `create:feed-*` | **LOẠI.** Phá kiểm duyệt TOÀN PHẦN: `manage:feed-post` 403 ngay ở guard kể cả khi chỉ sửa CHỮ. Mâu thuẫn API-19:67/80 ⇒ phải sửa SPEC. |
| **(f)** | **CHỌN.** Resolve scope NGOÀI tx (chỉ khi `dto.attachmentIds !== undefined`) → truyền **cổng đã quyết** xuống `syncLinksTx` → `syncLinksTx` ném 403 **chỉ khi `toAdd.length > 0`** (biến đã tính, `:178`) | Đúng ngữ nghĩa · **0 round-trip thừa** · **0 bản luật thứ hai** · không tx lồng · giữ ngữ nghĩa mảng rỗng (M11) · **kiểm duyệt vẫn gỡ được đính kèm**. |

**Hệ quả hành vi (owner phải biết):** vai `manage:feed-post` **không** có `create:feed-post` sau WO này:

- ✅ vẫn sửa CHỮ bài/bình luận người khác;
- ✅ vẫn **GỠ** đính kèm (`attachmentIds: []` hoặc danh sách ngắn hơn);
- ✅ vẫn gửi lại y nguyên danh sách hiện có (không thêm gì) → 200;
- ❌ **không** THÊM tệp mới vào nội dung người khác → **403**.

**§1-TOCTOU — ca ĐUA, phân tích tường minh.** Scope quyền đọc ở T0 (ngoài tx), áp ở T1 (trong tx):

1. *Quyền bị THU HỒI giữa T0–T1* ⇒ cho qua một lượt gắn lẽ ra chặn. Cửa sổ ≈ vài ms, **không rộng hơn** cửa sổ đã tồn tại của `resolveActor` (cũng resolve ngoài tx, `social-posts.service.ts:333` đứng trước `:335`) ⇒ **không thêm bề mặt mới**.
2. *Quyền được CẤP giữa T0–T1* ⇒ 403 oan một lượt; bấm lại là xong.
3. *`toAdd` đổi giữa T0–T1*: **không tồn tại** ở lối (f) — `toAdd` tính TRONG tx (`:178`), cùng snapshot với `current` (`:147`). Đây là ưu thế của (f) so với (b).
4. *(Cho lối (b) nếu reviewer muốn lật lại):* ngay cả ở (b), cửa TOCTOU **không thể LỎNG** — vế 5 (`:112-118`, cố ý **không** lọc `deleted_at`) thấy hàng link đã xoá mềm và ném **422**. Không đường nào cho ra một link KHÔNG qua cổng.

### D-2 — HÌNH DẠNG THAM SỐ: **union phân biệt fail-CLOSED** (vá F-2 · chữ ký **S-6**)

Lý do: `canAttachNew = true` hard-code ở 2 call-site TẠO đọc y hệt một **fail-OPEN literal**, và người dọn dẹp sau sẽ biến nó thành optional-default-true.

> 🔴 **VÁ SAU PLAN-REVIEW (F-2):** bản plan đầu chốt `{ denyMessage: string | null }` + `if (gate.denyMessage) throw`. **Đó VẪN là hình dạng fail-OPEN, chỉ đổi tên**: `undefined`, chuỗi rỗng `""`, hay object dựng thiếu field qua một `Partial`/cast ⇒ **im lặng cho qua**, TS không bắt (`string | null` không loại được `""`). Thêm: tên `denyMessage` **đụng** một field đã có nghĩa KHÁC là `SocialPair.denyMessage` (`social-route-pairs.const.ts:114` — thông điệp 403 của `resolveActor`).

**Chốt hình dạng** (khai ở `social-attachments.service.ts`, export):

```ts
/**
 * Cổng «được GẮN tệp MỚI vào đích này» — quyết định ĐÃ resolve NGOÀI tx (D-1/D-2).
 * Union phân biệt: DENY là nhánh phải CHỦ ĐỘNG thoát ra, không phải giá trị vắng mặt.
 */
export type AttachNewGate =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

/** Đường TẠO (002/015): cặp `create:feed-*` ĐÃ bị ép ở CẢ HAI tầng — xem D-3. */
export const ATTACH_GATE_ENFORCED_BY_TIER1: AttachNewGate = { allow: true };
```

F1 viết `if (!gate.allow) throw new ForbiddenException(gate.reason);` — object dựng thiếu `allow` ⇒ `!undefined` ⇒ **ném**, không lọt. Ca U bổ sung: `reason.trim().length > 0`.

**Vá F-1 — đường SỬA KHÔNG được dán hằng `ATTACH_GATE_ENFORCED_BY_TIER1`.** Bản đầu cho nhánh `dto.attachmentIds === undefined` truyền hằng đó; hai cái sai cùng lúc: (1) U3 assert «hằng chỉ ở **2** call-site» sẽ ĐỎ vì sau F3+F4 nó ở **4** chỗ, và cách «sửa cho xanh» duy nhất là bỏ U3 = mất đúng lưới mà D-2 sinh ra; (2) tầng-1 của `004`/`016` là `view:feed`, **KHÔNG** phải `create:feed-*` ⇒ dán một hằng tên «ENFORCED_BY_TIER1» lên đường SỬA là **ghim một lời khai SAI vào mã** — đúng lớp lỗi mà §6 của plan này đang đi dọn.

**Hình dạng đúng ở đường SỬA:** gộp id + cổng thành một giá trị, để nhánh `undefined` **không tồn tại** thay vì phải khai một cổng giả:

```ts
type AttachPlan = { readonly ids: readonly string[]; readonly gate: AttachNewGate };
// NGOÀI tx:
const attach: AttachPlan | null =
  dto.attachmentIds === undefined
    ? null
    : { ids: dto.attachmentIds, gate: await this.access.resolveAttachNewGate(actor, "post") };
// TRONG tx (giữ nguyên ngữ nghĩa M11: mảng rỗng vẫn vào nhánh này):
if (attach) await this.attachments.syncLinksTx(tx, …, "post", postId, attach.ids, attach.gate);
```

⇒ hằng `ATTACH_GATE_ENFORCED_BY_TIER1` xuất hiện **đúng 2 lần**, cả hai ở đường TẠO ⇒ U3 thoả được.

- Tham số **BẮT BUỘC** (không optional, không default) ⇒ TS đỏ ở cả 4 call-site nếu ai thêm call-site thứ 5 mà quên khai.
- Đường SỬA lấy cổng từ **một** hàm mới trên `SocialAccessService`, dùng CHUNG bảng cặp + bảng thông điệp với `assertFileTarget` (không đẻ nguồn sự thật thứ hai):

```ts
/** Cặp `create` theo ĐÍCH — câu HỎI (không ném). `assertFileTarget` nay gọi lại nó. */
async canAttachTo(actor: SocialActor, target: SocialTargetType): Promise<boolean>
async resolveAttachNewGate(actor: SocialActor, target: SocialTargetType): Promise<AttachNewGate>
```

và `assertFileTarget` (`social-access.service.ts:241-247`) refactor thành wrapper mỏng của `canAttachTo` ⇒ cửa 054/055 và cửa 004/016 **không thể trôi khỏi nhau**.

### D-3 — ĐƯỜNG TẠO (002/015): giữ nguyên, truyền `ATTACH_GATE_ENFORCED_BY_TIER1`

Không gọi thêm cổng: cặp `create:feed-post`/`create:feed-comment` **chính là** cặp mà `SOCIAL_FILE_TARGET_PAIRS` khai, và service truyền `targetType` cứng (`"post"`/`"comment"`, không lấy từ client) ⇒ hỏi lại là round-trip quyền thừa trên đường nóng nhất của module.

> 🔴 **VÁ SAU PLAN-REVIEW (F-4) — lý do MẠNH HƠN bản đầu.** Bản đầu viết «tầng-1 ép». Đo lại: cặp của route bị ép ở **HAI** tầng — decorator (`social.controllers.ts:90` cho 002, `:258` cho 015) **và** `resolveActor` ép LẠI cặp của route ở tầng-2 cho **mọi** route (`social-access.service.ts:105-121`: ném `:112` khi không có grant, `:118` khi scope hẹp hơn `companyFloor`). Gỡ decorator của `002` thì service **vẫn** 403. Đó là lập luận mạnh hơn cho D-3, nhưng nó **phá phép đo của G2/G4**: một assert «403» trần KHÔNG phân biệt tầng nào ném ⇒ ca xanh trong cả hai thế giới.
>
> *(Nghi vấn «`tier1IsFloor:true` hạ cặp `create:feed-post` của 002 thành SÀN nên tầng-1 hết ép» đã được kiểm và **SAI**: `social-route-pairs.const.ts:24-27` ghi rõ sàn LÀ THẬT và nó CHẶN; decorator `social.controllers.ts:90` vẫn khai đúng cặp create.)*

**Giá phải trả — trả bằng test:** G2/G4 phải assert **THÔNG ĐIỆP** để tách tầng, không chỉ status: guard → `Permission denied:` · tầng-2 `resolveActor` → `AUTH-ERR-FORBIDDEN: out of permission scope`. Không assert thông điệp thì «tầng-1 đã ép» vẫn là lời hứa, không phải phép đo.

### D-4 — MÃ LỖI: dùng lại `FILE_TARGET_POST_DENIED` / `FILE_TARGET_COMMENT_DENIED` (403)

- Cùng CÂU HỎI (cặp `create` theo đích) ⇒ cùng câu TRẢ LỜI. Hai mã cho một luật là chỗ để trôi.
- **0 bump census** (M16).
- **Không số hoá** (giữ tiền tố `"SOCIAL-ERR: "`): SPEC-16 §12 đóng ở `001..022` và đã dùng hết; `docs/spec/**` ngoài `paths`. Tiền lệ D1b của BE-1C.
- ⚠️ *Lấn cấn đã biết, chấp nhận:* câu chữ hiện tại nói «…để **tải** tệp đính kèm…» (viết cho cửa upload 054/055), hơi lệch với cửa GẮN. **KHÔNG đổi chuỗi ở WO này** — mọi spec BE-1C assert bằng **tham chiếu hằng** nên đổi chuỗi không đỏ ở đâu cả, tức không có lưới nào canh việc đổi. Nếu đổi: làm cùng lúc với việc số hoá ở một WO có chạm `docs/spec/**`.

### D-5 — CỜ `tier1IsFloor` cho `postUpdate`/`commentUpdate`: ĐẶT, kèm mở rộng nguồn ĐỘC LẬP của census

Theo định nghĩa HẸP đang ghi ở `social-route-pairs.const.ts:44-59`: sau WO này, một request **hợp lệ về cú pháp** trên 004 bị 403 vì cặp mà decorator **không hề nhắc tới**, và điều kiện phụ thuộc **NỘI DUNG REQUEST** ⇒ đúng định nghĩa cờ. Docblock hiện tại còn viết «`004`/`016` … phần thêm là vị từ HÀNG (sở hữu)» — câu đó **hết đúng** sau WO này và phải sửa.

**Không đặt cờ** thì người đọc decorator kết luận «004 gate đủ rồi» — đúng cái mà cờ sinh ra để chặn.

**Đặt cờ ⇒ D17 đỏ (M18) ⇒ phải mở rộng nguồn độc lập.** Hai cách:

- ~~(i) quét AST theo khuôn `classesReferencingManageNews()`~~ — **LOẠI sau plan-review (F-5)**: khuôn đó có độ phân giải **LỚP, không phải PHƯƠNG THỨC** (`social-two-layer-guard-census.unit-spec.ts:229-249`). `SocialPostsService` phục vụ CẢ `postCreate` lẫn `postUpdate` ⇒ bước «lớp có gọi `resolveAttachNewGate` ⇒ `postUpdate`» là **một sổ pin chép tay mới**, và ai dời lời gọi từ `update()` sang `create()` thì census **vẫn XANH** trong khi cổng đã biến mất khỏi 004.
- **(i′) KHUYẾN NGHỊ (vá F-5) — quét AST ở mức `Class#method`**, tái dùng khuôn **`serviceResolveActorCalls()`** (`social-two-layer-guard-census.unit-spec.ts:201-226`) vì nó đã trích sẵn `Class#method`. Pin `SocialPostsService#update → postUpdate` · `SocialCommentsService#update → commentUpdate`. Giữ neo `calls.length > 0` (khuôn `:311-312`) để AST hỏng không biến thành xanh-rỗng.
- (ii) Rẻ hơn: mở rộng nhánh `SOCIAL_FILE_TARGET_PAIRS` hiện có (`:367-373`) đẩy thêm 2 key. Độc lập với cờ nhưng KHÔNG phân biệt được 4 route — yếu hơn.

> 🔴 Đây là **sửa SỔ PIN census** (tiền lệ `S15-PAYROLL-DASH-1`: merge đòi vá 2 sổ pin). Phải làm CÓ CHỦ ĐÍCH và giải trình trong PR, không «sửa cho xanh».

### D-6 — THỨ TỰ CỔNG trong 004/016

`resolveActor` (tầng 2 cặp route) → **[resolve gate NGOÀI tx]** → `withTenant` → `assertPostVisible`/`assertCommentVisible` (**404**) → `assertCanMutateContent` (**403 ERR-003**) → … → `syncLinksTx` (**403 FILE_TARGET_\*** khi có tệp mới) → commit.

*Đã cân nhắc và BÁC BỎ nghi ngờ rò 403-trước-404:* 403 của cổng phát ra **độc lập hoàn toàn với bài** (chỉ là câu trả lời về năng lực của actor, giống hệt cho bài tồn tại và không tồn tại) ⇒ **không** là oracle. Nhưng (f) vẫn đặt cú ném SAU cửa 404, tức bảo thủ hơn và khỏi phải lập luận lại ở mỗi lượt review.

### D-7 — Ném TRONG tx ⇒ rollback toàn bộ lượt sửa

Có chủ đích: một lượt PATCH bị từ chối phải để lại ZERO dấu vết — kể cả `body` mới, `edited_at`, `updated_by`, hàng audit `social.post.update` của nhánh `asManager` (`social-posts.service.ts:350-363`). Tiền lệ đã có test canh: N-033b (`social-be2b2-kudos.int-spec.ts:889`).

### D-8 — ĐÍNH CHÍNH SỐ ROUTE `017 → 016` (M7)

Owner ký cho «siết 004/017». Route `017` là **DELETE**, không đi qua `syncLinksTx`, **không đổi một dòng nào**. Thứ thật sự bị siết là **004 + 016**. Phải sửa: backlog (`title`, 2 dòng `done_when`, `src`), `docs/STATUS.md` (tự sinh — theo backlog), và 3 docblock ĐÍNH CHÍNH đang chép sai số (§6).

### Bảng chữ ký OWNER cần có TRƯỚC khi code

*(Bảng đã cập nhật sau plan-review lượt 1: S-1 mở rộng · S-3 viết lại · S-4 gộp rộng · thêm S-6, S-7.)*

> ## ✍️ OWNER ĐÃ KÝ **7/7** — 24/09/2026 (sau plan-review lượt 1)
>
> - **S-1 ✅ DUYỆT** — cổng chặn **CHỈ khi THÊM tệp mới** (lối (f)). Owner đã đọc hệ quả F-8: gỡ đính kèm là **một chiều, không phục hồi**, tắt cả đường tải của TÁC GIẢ — năng lực đó có sẵn từ trước, **WO này KHÔNG đóng nó** (ghi nợ §5).
> - **S-2 ✅ DUYỆT** — siết **004 + 016** (không phải 017). Chữ ký 24/09 ghi `017` là do số route sai lan từ FULL gate BE-1C.
> - **S-3 ✅ DUYỆT** — đặt `tier1IsFloor` + sửa sổ pin census D17 ở độ phân giải **`Class#method`** (D-5(i′)).
> - **S-4 ✅ DUYỆT** — mở `paths` thêm **cả** `packages/contracts/**` **và** `apps/api/package.json`.
> - **S-5 ✅ DUYỆT** — dùng lại 2 hằng `FILE_TARGET_*_DENIED`, không đẻ mã mới.
> - **S-6 ✅ DUYỆT** — hình dạng cổng là **union phân biệt fail-CLOSED**.
> - **S-7 ❌ KHÔNG LÀM (owner chọn TỐI THIỂU)** — **KHÔNG** refactor `assertFileTarget` thành wrapper, **KHÔNG** đụng cửa `054`/`055` đã ship. F2 chỉ thêm `resolveAttachNewGate` đọc CÙNG `SOCIAL_FILE_TARGET_PAIRS` + `SOCIAL_FILE_TARGET_DENIED`; chống trôi giữa hai cửa giao cho `social-file-target-pairs-structure.spec.ts` (ca (d) `:83-94`) thay vì gộp mã.

| # | Mục | Vì sao cần chữ ký |
| --- | --- | --- |
| **S-1** | D-1: cổng kích hoạt theo «tệp MỚI», KHÔNG theo «danh sách non-empty». **Kèm hệ quả F-8:** vai `manage:feed-post` không chỉ «gỡ được» đính kèm của người khác — **gỡ là MỘT CHIỀU, không phục hồi**: link xoá mềm ⇒ 0 live link ⇒ `signOne` trả `null` (`social-attachments.service.ts:302`) **kể cả với TÁC GIẢ**, và vế 5 («đã TỪNG link», `:110-118`) làm tệp đó **không bao giờ gắn lại được** (422 vĩnh viễn) | Hẹp hơn thứ owner có thể đã hình dung; và năng lực PHÁ HUỶ một chiều này tồn tại mà không cần cặp `create:*` nào |
| **S-2** | D-8: chữ ký 24/09 ghi `017`, thực tế là `016` | Chữ ký đang trỏ vào route KHÁC (DELETE). Đã xác minh độc lập 2 lượt |
| **S-3** | D-5: đặt `tier1IsFloor` + sửa sổ pin census D17 **ở độ phân giải `Class#method`** (D-5(i′)) | Đổi một đẳng thức census đã chốt; pin ở mức LỚP cho phép dời cổng khỏi `update()` mà census vẫn xanh |
| **S-4** | Mở `paths` của WO thêm **`packages/contracts/**` VÀ `apps/api/package.json`** — hoặc chấp nhận để lại làm nợ | `paths` hiện mâu thuẫn với `done_when` #5 (M19) **và** với F11 (M20/F-11): bỏ F11 ⇒ cổng coverage mù với chính WO này |
| **S-5** | D-4: dùng lại 2 hằng lỗi KHÔNG-SỐ-HOÁ cho một cửa MỚI | Mở rộng phạm vi của hằng đã ship mà không thêm dòng SPEC-16 §12 |
| **S-6** | D-2: hình dạng cổng là **union phân biệt fail-CLOSED**, không phải `{denyMessage: string \| null}` | Quyết định crown-jewel: nó định đoạt hành vi khi object cổng dựng THIẾU field — fail-OPEN hay fail-CLOSED |
| **S-7** | Có giữ refactor `assertFileTarget` → wrapper của `canAttachTo` (F2) hay không | Phần plan làm **NHIỀU HƠN** `done_when` của WO: chạm cửa `054`/`055` **đã ship**. Bỏ nó vẫn đóng đủ WO (xem F-9) |

---

## §2 — THAY ĐỔI THEO FILE (diff-shape, không code đầy đủ)

| # | File | Hình dạng thay đổi | Rủi ro |
| --- | --- | --- | --- |
| F1 | `apps/api/src/social/social-attachments.service.ts` | + `type AttachNewGate` (union, D-2) + hằng `ATTACH_GATE_ENFORCED_BY_TIER1`. `syncLinksTx` (`:137`) **thêm tham số BẮT BUỘC** `gate: AttachNewGate` (đặt CUỐI). Ngay sau `:179` (`if (toAdd.length === 0) return;`): `if (!gate.allow) throw new ForbiddenException(gate.reason);` — **TRƯỚC** `assertLinkableFilesTx` (`:183`). Sửa docblock `:58-68`. | **Cao** — file crown-jewel của đường gắn. Giữ `assertLinkableFilesTx` NGUYÊN VẸN |
| F2 | `apps/api/src/social/social-access.service.ts` | + `resolveAttachNewGate(actor, target)` đọc CÙNG `SOCIAL_FILE_TARGET_PAIRS` + `SOCIAL_FILE_TARGET_DENIED`. **GỠ** khối ĐÍNH CHÍNH `:232-235` (§6). ⚠️ **Chỉ refactor `assertFileTarget` → wrapper của `canAttachTo` NẾU S-7 được ký** (F-9); nếu refactor: hàm mới **chỉ** truyền 3 field `{action,resourceType,isSensitive}` vào `resolveManyOrNull` — truyền object RỘNG HƠN sẽ đổi quyết định phân quyền trong im lặng (`resolveStrongestScopes` spread nguyên vật; cảnh báo đã ghi ở `canApproveIdeas :266-271`), + ca U ghim hình dạng | Trung bình — đụng cổng 054/055 đã ship ⇒ ca BE-1C phải còn xanh nguyên |
| F3 | `apps/api/src/social/social-posts.service.ts` | `create()` `:289` → truyền `ATTACH_GATE_ENFORCED_BY_TIER1`. `update()`: trước `withTenant` (`:335`) dựng `AttachPlan \| null` theo D-2 (vá F-1) → trong tx `if (attach) syncLinksTx(…, attach.ids, attach.gate)` thay cho `:376-385`. | Trung bình. ⚠️ Nhánh `undefined` **không** resolve quyền, **không** gắn gì, và **KHÔNG** khai hằng `…ENFORCED_BY_TIER1` (F-1) |
| F4 | `apps/api/src/social/social-comments.service.ts` | Y hệt F3 với `"comment"`: `:178` (tạo) · `:262` (sửa, resolve trước `:215`). **Giữ nguyên** ngữ nghĩa mảng rỗng (M11) và comment `:258-260`. | Trung bình |
| F5 | `apps/api/src/social/social-route-pairs.const.ts` | `postUpdate` (`:137`) và `commentUpdate` (`:151`) → `pair("view","feed", true)`. Sửa docblock `:49-54`. **GỠ** ĐÍNH CHÍNH `:399-403`. | **Cao** — kéo theo D17 (F8) |
| F6 | `apps/api/src/social/social-files.service.ts` | **GỠ** khối ĐÍNH CHÍNH `:43-59` + sửa câu tham chiếu ở `:37-40`. | Thấp (comment) |
| F7 | `apps/api/src/social/social-file-target-pairs-structure.spec.ts` | + ca: bảng cặp/thông điệp phủ **mọi** `SocialTargetType`; + ca `ATTACH_GATE_ENFORCED_BY_TIER1.denyMessage === null` **và** chỉ ĐÚNG 2 call-site dùng nó. | Thấp |
| F8 | `apps/api/test/foundation/social-two-layer-guard-census.unit-spec.ts` | Mở rộng nguồn độc lập D17 (`:345-380`) theo **D-5(i′)** — khuôn `serviceResolveActorCalls() :201-226`, pin mức `Class#method`. **KHÔNG** đụng `ROUTE_TO_KEY` (`:59-131`)/`SERVICE_SITE_TO_KEYS` (`:139-198`) (M17). Giữ hai neo chống-xanh-rỗng `:377-378`. | **Cao** — sổ pin |
| F9 | `apps/api/test/integration/social-attgate-1-update-attach.int-spec.ts` *(MỚI)* | Ma trận §3 | — |
| F10 | `apps/api/src/social/social-attachments.service.spec.ts` *(MỚI hoặc mở rộng)* | Ca đơn vị cho luật cổng (không cần DB) — §3B | Thấp |
| F11 | `apps/api/package.json:16` | Thêm int-spec mới vào `test:cov:social` (M20) | Thấp — **quên = cổng coverage mù với chính WO này** |
| F12 | `docs/API Design/API-19_SOCIAL_API_Design.md:67, 80` | Cột «Cặp quyền» của `004`/`016`: thêm «+ `create:feed-post`/`create:feed-comment` khi THÊM đính kèm mới — §5.1x»; thêm mục §5.1x (khuôn §5.1b/§5.1c) | Thấp |
| F13 | `harness/backlog.mjs` | Đóng WO + **sửa `017 → 016`** ở `title`/`done_when`/`src` (D-8); mở `paths` thêm `packages/contracts/**` nếu S-4 ký | Thấp |
| F14 | `packages/contracts/src/social-api.ts:620-624` *(chỉ khi S-4 ký)* | **GỠ** khối ĐÍNH CHÍNH; sửa D1a `:611-619` | Thấp (comment-only) nhưng **NGOÀI `paths` hiện tại** |

**Kiểm trần file (CLAUDE.md §5):** `social-attachments.service.ts` hiện **369** dòng → sau F1 ≈ 395, còn xa 800. Các file còn lại thêm < 40 dòng.

---

## §3 — MA TRẬN TEST (RED trước, DENY luôn có ALLOW đứng cạnh)

**Thứ tự thi công bắt buộc:** viết & chạy **G5 · G11** (ĐỎ) → mới code F1–F4 → xanh → phần còn lại.

**Vai TUỲ BIẾN** (khuôn `social-be1c-file-door.int-spec.ts:76-83`, `makeUser` `:110-134`; **tuyệt đối không sửa vai canonical** — đóng dấu lên lane DB dùng chung; **không dùng super-admin** — `*:*` làm mọi ca deny xanh-giả):

- `R_BOTH` = `view:feed` + `create:feed-post` + `create:feed-comment` — tác giả.
- `R_MOD_NOCREATE` = `view:feed` + `manage:feed-post` — **vai của ca RED chính**.
- `R_MOD_FULL` = `view:feed` + `manage:feed-post` + `create:feed-post` + `create:feed-comment` — ALLOW cạnh RED.
- `R_POST_ONLY` = `view:feed` + `create:feed-post`.
- `R_COMMENT_ONLY` = `view:feed` + `create:feed-comment`.

> ⚠️ **Thêm `create:feed-post` vào `R_MOD_NOCREATE` là tự tay xoá sạch WO này.** Ghi câu đó vào docblock spec (khuôn BE-1C `:69-75`).

> 🔴 **VÁ SAU PLAN-REVIEW (F-3) — NGUỒN TỆP của mỗi ca phải khai tường minh.** `R_MOD_NOCREATE` **KHÔNG LẤY ĐƯỢC TỆP CỦA CHÍNH MÌNH qua đường thật**: cửa `054` gác `assertFileTarget` → `create:feed-post` (`social-files.service.ts:114-115`) — chính plan này pin điều đó ở **G19 = 403**. Nếu người thi công «mượn tạm» tệp của người khác cho G5 thì **G5 trùng khít G18**, và mutant «gỡ gate» sẽ ra **422** (vế 2 sở hữu, `social-attachments.service.ts:100-101`) chứ không phải 200 ⇒ ca RED CHÍNH đỏ vì LÝ DO KHÁC (memory `mutant-red-must-match-expected-message`), tức **phép đo cổng vô hiệu**.
>
> **Bắt buộc:** tệp của `R_MOD_NOCREATE` gieo **TRỰC TIẾP** vào bảng `files` bằng khuôn `seedFile(owner)` của `social-be1-attachments.int-spec.ts:81-106` (hàng `Uploaded` + `Clean`, chỉ định `owner_user_id`) — **không** đi qua `054`. Mỗi ca ở §3A phải ghi rõ chủ tệp. Kỳ vọng mutant: **G5 → 200** (không phải 422) · **G18 → 422**.

### 3A — int-spec (CẦN `LANE_DB`; `describe.skipIf(!hasDb || !process.env.LANE_DB)`)

| Ca | Route | Vai | Hành động | Kỳ vọng | Phép ĐO CỔNG (đột biến ⇒ ca nào đỏ) |
| --- | --- | --- | --- | --- | --- |
| G1 | 002 | `R_BOTH` | tạo bài + 1 tệp của mình | **201**, 1 link sống | neo dương |
| G2 | 002 | `R_COMMENT_ONLY` | tạo bài | **403** + assert **THÔNG ĐIỆP** `Permission denied:` (guard), KHÔNG phải `AUTH-ERR-FORBIDDEN: out of permission scope` | vá F-4: status trần không tách được tầng vì `resolveActor` cũng ném 403 (`social-access.service.ts:112`) |
| G3 | 015 | `R_BOTH` | tạo bình luận + tệp | **201**, 1 link | neo dương |
| G4 | 015 | `R_POST_ONLY` | tạo bình luận | **403** + assert thông điệp guard | như G2, trục bình luận |
| **G5** | **004** | `R_MOD_NOCREATE` | sửa bài NGƯỜI KHÁC, **THÊM** tệp **`seedFile(R_MOD_NOCREATE)`** (gieo thẳng, KHÔNG qua 054 — F-3) | **403** `SOCIAL_ERR.FILE_TARGET_POST_DENIED` (assert **tham chiếu HẰNG**) | gỡ gate khỏi F3-update ⇒ **G5 đỏ «expected 200 to be 403»** (200, KHÔNG phải 422 — nếu ra 422 thì tệp đã gieo sai chủ) |
| G6 | 004 | `R_MOD_NOCREATE` | cùng bài, **chỉ chữ** (không gửi `attachmentIds`) | **200** | ALLOW cạnh G5 — chống deny-rỗng |
| **G7** | **004** | `R_MOD_NOCREATE` | gửi LẠI **đúng** danh sách đính kèm hiện có (0 tệp mới) | **200**, link không đổi | 🔴 **ca DUY NHẤT phân biệt (f) với (a)**: đổi điều kiện sang `fileIds.length>0` ⇒ **G7 đỏ** |
| G8 | 004 | `R_MOD_NOCREATE` | `attachmentIds: []` (GỠ HẾT) | **200**, link gỡ **mềm** (`countLinks=1`, `countLiveLinks=0`) | giữ M11 + chứng minh kiểm duyệt gỡ được ảnh xấu |
| G9 | 004 | `R_MOD_FULL` | cùng bài, THÊM tệp mới | **200**, link mới = 1 | ALLOW cạnh G5 — thứ ép là **cặp `create`**, không phải `manage` |
| G10 | 004 | `R_BOTH` | tác giả sửa bài **của mình**, thêm tệp mới | **200** | chống hồi quy đường thường |
| **G11** | **016** | `R_MOD_NOCREATE` | sửa bình luận NGƯỜI KHÁC, THÊM tệp | **403** `FILE_TARGET_COMMENT_DENIED` (**hằng KHÁC G5**) | đổi `SOCIAL_FILE_TARGET_PAIRS[target]` thành cặp post cố định ⇒ **G11 đỏ vì THÔNG ĐIỆP**, không phải vì status |
| G12 | 016 | `R_MOD_NOCREATE` | cùng bình luận, chỉ chữ | **200** | ALLOW cạnh G11 |
| G13 | 016 | `R_MOD_FULL` | cùng bình luận, THÊM tệp | **200** | ALLOW cạnh G11 |
| G14 | 016 | `R_BOTH` | tác giả sửa bình luận của mình + tệp mới | **200** | chống hồi quy |
| **G15** | 004 | `R_MOD_NOCREATE` | lặp G5 rồi **đếm trên DB** | `file_links` sống của tệp = **0** VÀ `feed_posts.body` **KHÔNG đổi** VÀ `audit_logs` action `social.post.update` **lọc `object_id = postId`, đếm TRƯỚC/SAU cùng lượt** không tăng (vá F-7: đếm tuyệt đối trên lane DB dùng chung là bẫy — ca khác cũng ghi action này) | D-7 rollback; đổi cú ném ra NGOÀI tx ⇒ G15 đỏ ở vế `body`. *(audit ghi TRONG tx: `social-posts.service.ts:351`, nhánh `asManager` `:350` — `R_MOD_NOCREATE` sửa bài người khác đúng vào nhánh đó)* |
| G16 | 017 | `R_MOD_NOCREATE` | DELETE bình luận người khác | **200** | 🔴 chống hồi quy **D-8**: 017 KHÔNG bị siết |
| G17 | 005 | `R_MOD_NOCREATE` | DELETE bài người khác | **200** | như G16 |
| G18 | 004 | `R_MOD_NOCREATE` | THÊM tệp **của NGƯỜI KHÁC** | **403** (cổng quyền chạy TRƯỚC vế 2) — **không** 422 | pin thứ tự F1; đảo thứ tự ⇒ G18 đỏ (422≠403) |
| G19 | 054 | `R_MOD_NOCREATE` | upload-url `target=post` | **403** | chống hồi quy BE-1C sau refactor F2 |
| G20 | 054/055 | `R_BOTH` | upload + confirm | **200** | ALLOW cạnh G19 |

> **Toàn bộ 17 ca của `social-be1c-file-door.int-spec.ts` phải CÒN XANH** sau F2 — lưới chống hồi quy của cửa `054`/`055`.
>
> 🔴 **VÁ SAU PLAN-REVIEW (F-6) — lưới hồi quy của chính `syncLinksTx` nằm ở file KHÁC.** File đo `syncLinksTx` trên cả 4 call-site là **`apps/api/test/integration/social-be1-attachments.int-spec.ts`**: `:409-424` (thay đính kèm) · `:426-434` (mảng rỗng) · `:436-443` (không gửi trường) · **`:445-457` (đường SỬA + tệp người khác ⇒ 422)**. File này **phải còn xanh** sau F1–F4. Nó không đỏ **vì một phép ĐO, không phải may mắn**: `OWNER_PAIRS` (`:46-53`) có **cả** `create:feed-post` lẫn `create:feed-comment` ⇒ cổng mới cho qua. **Ghi câu đo đó vào docblock spec** — ai thu hẹp `OWNER_PAIRS` sau này phải hiểu vì sao file đỏ.
>
> Ca `:445-457` chính là **ALLOW-đối-chứng của G18**: cùng hành động (gắn tệp người khác trên đường SỬA), khác vai ⇒ 422 (có cặp create, chặn bởi vế 2) vs 403 (không cặp create, chặn bởi cổng mới).

### 3B — spec colocated (KHÔNG cần DB)

| Ca | File | Nội dung |
| --- | --- | --- |
| U1 | `social-attachments.service.spec.ts` | `syncLinksTx` với `gate = {allow:false,…}` **và** `toAdd` rỗng ⇒ **KHÔNG ném**, không INSERT (tx giả) |
| U2 | như trên | `gate = {allow:false, reason}` **và** `toAdd` non-empty ⇒ ném `ForbiddenException` mang **đúng hằng THEO TARGET** (post vs comment — hai ca, vì census mã lỗi mù với việc gỡ một trong hai cửa, F-10); + ca `reason.trim().length > 0`; + ca object dựng **thiếu `allow`** (qua cast) ⇒ **VẪN ném** (fail-CLOSED, S-6) |
| U3 | `social-file-target-pairs-structure.spec.ts` | Bảng cặp ↔ bảng thông điệp song ánh, phủ mọi `SocialTargetType`; `ATTACH_GATE_ENFORCED_BY_TIER1.allow === true`; quét tĩnh: hằng đó chỉ xuất hiện ở **ĐÚNG 2** call-site TẠO — **phải `stripComments` trước khi đếm** (vá F-12: quét thô đếm cả docblock) + neo tự-kiểm chứng minh regex strip THẬT SỰ cắt, khuôn `social-error-code-census.spec.ts:90-92` và ca `:115-119` |
| U4 | `social-two-layer-guard-census.unit-spec.ts` | D17 mở rộng (D-5) — neo chống-xanh-rỗng ở CẢ HAI vế phải còn |
| U5 | `social-error-code-census.spec.ts` | **Không sửa**. Chạy để chứng minh 2 hằng dùng lại vẫn ở tầng A và vẫn có bằng chứng MẠNH |

### 3C — Cách chạy (CLAUDE.md §9.5)

```bash
bash scripts/lane-db-setup.sh attgate --reset      # memory: không --reset ⇒ giữ DB cũ
export LANE_DB=mediaos_attgate
pnpm --filter @mediaos/api test                     # KHÔNG dùng `pnpm test -- <path>` (chạy TOÀN BỘ suite)
pnpm --filter @mediaos/api test:cov:social          # sau khi đã thêm file ở F11
bash harness/check.sh --lane-db=attgate             # trước khi mở PR (vùng ĐỎ ⇒ --all / REQUIRE_LANE_DB=1)
```

---

## §4 — RỦI RO & HỒI QUY

| # | Rủi ro | Mức | Giảm thiểu |
| --- | --- | --- | --- |
| R1 | **Treo im lặng do `withTenant` lồng** nếu ai «đơn giản hoá» về lối (c)/(backlog) | **CRITICAL** | D-1/D-2 tách hẳn RESOLVE (ngoài tx) khỏi QUYẾT ĐỊNH (trong tx). Ghi lý do vào docblock `syncLinksTx`. Reviewer: bắt mọi `await this.access.*`/`this.dataScope.*` nằm **trong** callback `withTenant` |
| R2 | **Hồi quy kiểm duyệt**: `manage:feed-post` mất khả năng gỡ/sửa đính kèm | **HIGH** | D-1 lối (f) + ca **G7/G8** là lưới. Lối (a) sẽ làm đúng hai ca đó đỏ |
| R3 | **Census D17 đỏ lúc merge** | HIGH | D-5 + F8 làm ngay trong cùng PR; chạy `pnpm --filter @mediaos/api test test/foundation` trước khi push |
| R4 | `packages/contracts` **ngoài `paths`** ⇒ hook `guard-scope` cảnh báo | MEDIUM | S-4: mở `paths` hoặc ghi nợ |
| R5 | **Số route sai (017 vs 016)** lan tiếp vào docblock/PR | MEDIUM | D-8 + F13; ca **G16** đóng đinh «017 không đổi» |
| R6 | Quên thêm int-spec vào `test:cov:social` ⇒ **coverage xanh-giả** | MEDIUM | F11; kiểm bằng cách xem tên file có in ra trong output `test:cov:social` |
| R7 | Ca DENY **xanh-rỗng** (403 vì lý do khác: thiếu `view:feed`, sai tenant, bài không thấy được) | MEDIUM | Mỗi DENY có ALLOW **CÙNG VAI** đứng cạnh (G6/G7 cho G5; G12 cho G11); assert **tham chiếu HẰNG**, không chuỗi mã |
| R8 | Mutant «đỏ vì 500/biên dịch» đọc y hệt «đỏ vì assert» | MEDIUM | Cột «Phép ĐO CỔNG» §3A ghi rõ **thông điệp kỳ vọng** của mỗi ca đỏ |
| R9 | Refactor `assertFileTarget` làm vỡ cửa 054/055 đã ship | MEDIUM | G19/G20 + toàn bộ 17 ca BE-1C phải còn xanh |
| R10 | Thêm 1 round-trip quyền trên 004/016 | LOW | Chỉ chạy khi `dto.attachmentIds !== undefined`; lượt sửa chỉ-chữ **0** round-trip thêm |
| R11 | FE tương lai (chưa tồn tại — M13) dựng form sửa gửi lại nguyên danh sách | LOW | (f) cho qua (G7). Ghi vào API-19 §5.1x để FE biết luật |
| R12 | `turbo` trả log CŨ từ cache ⇒ xanh-giả | LOW | `TURBO_FORCE=1` hoặc đi qua `harness/check.sh` |
| R13 | **Tưởng census mã lỗi là lưới của cổng mới** (F-10) | MEDIUM | `social-error-code-census.spec.ts:132` chỉ hỏi «chuỗi `SOCIAL_ERR.<KEY>` có xuất hiện đâu đó trong `src/social`» ⇒ gỡ cổng ở MỘT trong hai cửa (054/055 **hoặc** 004/016) thì tầng A **vẫn XANH** vì hằng còn được ném ở cửa kia. **Lưới DUY NHẤT của cổng mới là G5/G11 + U2** (U2 phải tách theo target) |
| R14 | M14 («vai canonical không bị ảnh hưởng») là khẳng định **load-bearing** nhưng trích plan khác, không trích migration `0578` (F-14) | MEDIUM | Đo lại trực tiếp trên `0578` **trước khi code**, hoặc thêm một ca ALLOW bằng vai canonical vào §3A |

---

## §5 — NỢ LIÊN QUAN, KHÔNG LÀM Ở WO NÀY

Ba nợ ghi ở `harness/backlog.mjs:17116-17118` (cùng nguồn FULL gate BE-1C) — **ngoài phạm vi**, giữ nguyên trong backlog:

1. **MEDIUM #1 — trần SOC-DEC-008 mù với PDF/docx.** `social-attachments.service.ts:121-125` chỉ đếm `kind==='image'` (≤10) và `'video'` (≤1); tệp `kind==='file'` **không rơi vào nhánh nào** ⇒ chỉ còn trần dung lượng/tệp và trần DTO `FEED_MAX_ATTACHMENTS = 11`. *Ngoài phạm vi:* đó là luật SỐ LƯỢNG (SPEC-16 §16), không phải cổng QUYỀN.
2. **MEDIUM #2 — `file_access_logs.permission_code` / audit nói SAI cặp quyền.** Nằm ở `FileService`, **ngoài `paths`**; tiền lệ CHAT/avatar y hệt ⇒ phải sửa cả ba cửa cùng lúc, WO riêng.
3. **LOW — bất nhất 404-vs-403 trong cùng module.** `social-files.service.ts:152-155` phân biệt 404 với 403, trong khi `assertLinkableFilesTx:96-98` cố ý **không** phân biệt. Thống nhất là quyết định SPEC về oracle, cần chữ ký riêng.

Hai nợ WO này **phát sinh nhưng không đóng**:

4. Câu chữ hai hằng `FILE_TARGET_*_DENIED` nói «tải tệp» trong khi nay phục vụ cả cửa GẮN (D-4).
5. `SPEC-16 §15` vẫn ghi «53 route» (nợ cũ của BE-1C §4) — `docs/spec/**` ngoài `paths`.

---

## §6 — DỌN SAU KHI ĐÓNG: gỡ 4 khối «ĐÍNH CHÍNH»

Sau WO này, khẳng định **D1a của BE-1C thành SỰ THẬT** — nhưng phải viết lại cho **đúng cơ chế mới**:

> ✅ Câu ĐÚNG để thay vào: *«Cặp `create` của ĐÍCH THẬT được hỏi trên **đường GHI**: tầng-1 ở `002`/`015`, tầng-2 (`resolveAttachNewGate` → `syncLinksTx`) ở `004`/`016` — **không** bởi `canLinkFile`.»*
> 🔴 **TUYỆT ĐỐI không** viết lại câu «`canLinkFile` hỏi lại lúc gắn» — nó vẫn SAI sau WO này (M2). Đây đúng lớp lỗi memory `check-is-null-branch-is-intent-not-guard` (một câu khai sai đã tự nhân bản ra 4 docblock, kể cả `packages/contracts`).

| # | File | Dòng | Việc |
| --- | --- | --- | --- |
| 1 | `apps/api/src/social/social-files.service.ts` | **`:43-59`** + **`:37-40`** | Gỡ khối; sửa câu tham chiếu «(bản trước ghi SAI — xem khối ⚠️ ngay dưới)» vì nó sẽ trỏ vào hư không |
| 2 | `apps/api/src/social/social-access.service.ts` | **`:232-235`** | Gỡ khối; thay bằng câu ĐÚNG ở trên; cập nhật `:228-230` cho phủ cả đường SỬA |
| 3 | `apps/api/src/social/social-route-pairs.const.ts` | **`:399-403`** | Gỡ khối; **và** sửa `:49-54` vì D-5 làm nó hết đúng với 004/016 |
| 4 | `packages/contracts/src/social-api.ts` | **`:620-624`** | Gỡ khối; sửa D1a `:611-619`. ⚠️ **Chỉ làm nếu S-4 được ký** (M19) |

Kèm: cập nhật docblock `assertLinkableFilesTx` (`social-attachments.service.ts:58-68`) — câu «Vế 2-5 trùng ĐÚNG với `canLinkFile`» nay phải nói rõ **vế 6a được ép Ở ĐÂU**.

---

## §7 — SỔ VÁ SAU `plan-reviewer` LƯỢT 1 (24/09/2026 — verdict BLOCK)

Reviewer đọc mã thật, xác minh M1–M20 và **cố ý tìm cách phá phần KIẾN TRÚC** (lối (f) · tách RESOLVE-ngoài-tx khỏi QUYẾT-ĐỊNH-trong-tx · ném sau cửa 404 · dùng lại 2 hằng lỗi · đính chính 017→016) — **không phá được**, giữ nguyên. Ba finding BLOCK đều là «lưới của chính plan tự mâu thuẫn hoặc đo sai vế».

| # | Mức | Vá ở đâu |
| --- | --- | --- |
| F-1 | BLOCK | D-2 (khối «Vá F-1» + `AttachPlan`) · F3/F4 ở §2 — nhánh `undefined` KHÔNG khai hằng `…ENFORCED_BY_TIER1` nữa ⇒ U3 «đúng 2 call-site» thoả được |
| F-2 | BLOCK | D-2 — union phân biệt fail-CLOSED thay `{denyMessage: string \| null}`; đổi tên tránh đụng `SocialPair.denyMessage`; chữ ký **S-6** |
| F-3 | BLOCK | §3 khối «Vá F-3» + ca G5 — tệp của `R_MOD_NOCREATE` phải `seedFile` thẳng, KHÔNG qua `054`; ghi kỳ vọng mutant (G5→200, G18→422) |
| F-4 | HIGH | D-3 + ca G2/G4 — cặp bị ép ở **HAI** tầng; assert THÔNG ĐIỆP để tách tầng |
| F-5 | HIGH | D-5(i′) + F8 — pin census ở mức `Class#method` (khuôn `serviceResolveActorCalls`), không phải mức LỚP; chữ ký **S-3** viết lại |
| F-6 | HIGH | §3A khối cuối — lưới hồi quy thật là `social-be1-attachments.int-spec.ts:409-457`; `:445-457` là ALLOW-đối-chứng của G18 |
| F-7 | MEDIUM | ca G15 — đếm audit lọc `object_id`, trước/sau cùng lượt |
| F-8 | MEDIUM | S-1 mở rộng — gỡ đính kèm là **một chiều, không phục hồi**, tắt cả đường tải của TÁC GIẢ |
| F-9 | MEDIUM | F2 ở §2 + chữ ký **S-7** — refactor `assertFileTarget` là scope creep, chỉ làm nếu owner ký; nếu làm thì chỉ truyền 3 field |
| F-10 | MEDIUM | R13 + U2 — census mã lỗi **không** là lưới của cổng mới |
| F-11 | MEDIUM | S-4 gộp rộng — `paths` còn thiếu `apps/api/package.json` (F11/M20) |
| F-12 | MEDIUM | U3 — `stripComments` + neo tự-kiểm |
| F-13 | LOW | số dòng: `ROUTE_TO_KEY` = `:59-131` (không phải `:59-133`) · vế 5 bắt đầu `:110` (không phải `:112`) |
| F-14 | LOW | R14 — M14 phải đo lại trên migration `0578` trước khi code |

**Reviewer xác nhận NGƯỢC với 3 nghi vấn của người gọi (plan ĐÚNG, giữ nguyên):**

1. **Link hồi sinh KHÔNG lách được cổng** — `current` lọc `isNull(deletedAt)` (`:156`) ⇒ link đã gỡ mềm không nằm trong `had` (`:159`) ⇒ tệp gắn lại **rơi vào `toAdd`** (`:178`) ⇒ cổng bắn. Khoá kép với vế 5 (422).
2. **G7 THOẢ ĐƯỢC** — `had ⊇ wanted` ⇒ `toAdd` rỗng ⇒ `return :179` trước cổng ⇒ 200. Đúng là ca DUY NHẤT phân biệt (f) với (a).
3. **G18 ra đúng 403** *nếu* F1 đặt cú ném giữa `:179` và `:183` như khai.

**Không tìm thấy vi phạm:** 3 bất biến CLAUDE.md §2 (`company_id` có ở mọi câu đụng `file_links`: `:151-157`, `:169`, `:185-195`; gỡ link vẫn XOÁ MỀM `:166`; không secret; không migration) · luật hot-file §9.3 · trần 800 dòng.

**Trạng thái:** plan đã vá 14/14 finding. Còn chờ **chữ ký owner S-1…S-7** trước khi viết dòng code đầu tiên.

---

## §8 — FULL GATE (sau thi công, 24/09/2026)

| Reviewer | Verdict | Finding |
| --- | --- | --- |
| `security-reviewer` | **PASS** | 0 CRITICAL · 0 HIGH · 3 MEDIUM · 4 LOW |
| `database-reviewer` | **PASS** | 0 CRITICAL · 0 HIGH · 3 MEDIUM · 3 LOW |
| `silent-failure-hunter` | *(xem cuối mục)* | |

### Đã VÁ trong lượt này

| # | Nguồn | Vá ở đâu |
| --- | --- | --- |
| C-3 | sec | `social-file-target-pairs-structure.spec.ts` — thêm neo `scanned > 40`: bộ quét `readdirSync` KHÔNG đệ quy, dời file vào thư mục con sẽ làm ca đỏ theo hướng khó đọc; neo nói thẳng nguyên nhân |
| C-6 | sec | `social-files.service.ts` — căn lại khung box-drawing sau khi gỡ khối ĐÍNH CHÍNH |
| C-7 | sec | int-spec — `LOGIN_PW` ghép chuỗi (CLAUDE.md §5, chống gitleaks `generic-api-key` đỏ oan) |
| F3 | db | `social-attachments.service.ts` — **ghi `deleted_by` khi gỡ mềm link** (cột đã có, 0 migration). WO này biến «kiểm duyệt gỡ đính kèm người khác không cần cặp `create`» thành hành vi CHÍNH THỨC ⇒ phải có vết «ai gỡ»; audit của `004` chỉ mang `{postId, authorUserId}` |
| F6 | db | int-spec ca G8 — thêm `countLinks` (TỔNG, không lọc `deleted_at`) + `deletedByOf`: `countLiveLinks === 0` một mình **không phân biệt** xoá mềm với hard-delete, tức bất biến §2 không được ca này đo |

### KHÔNG vá ở WO này — ghi NỢ có lý do

| # | Nguồn | Nợ | Vì sao hoãn |
| --- | --- | --- | --- |
| C-2 / F-8 | sec | Vai `manage:feed-post` GỠ đính kèm người khác = phá huỷ MỘT CHIỀU (vế 5 chặn gắn lại vĩnh viễn; `signOne` trả `null` kể cả với tác giả) | **Owner đã ký S-1 kèm đúng hệ quả này.** Có TRƯỚC WO này. Đóng nó = thêm cặp quyền cho nhánh `toUnlink` ⇒ đổi hành vi route lần thứ hai, cần chữ ký riêng |
| C-5 | sec | Nhánh DENY của cổng không sinh `security_alerts`/audit ⇒ dò cổng lặp lại không để lại vết | Đúng khuôn của 47 route SOCIAL còn lại (deny không audit). Đổi = quyết định cấp module |
| F1 | db | Cổng nạp LẠI ảnh chụp grant mà `resolveActor` vừa nạp ⇒ +1 transaction/PATCH có `attachmentIds` | Gộp cặp thứ 5 vào batch của `resolveActor` đụng đường nóng của **cả 50 route** (crown-jewel) kèm bẫy «đọc theo CHỈ SỐ, không theo khoá». Lợi ích là perf + thu hẹp TOCTOU, không phải đúng/sai ⇒ WO riêng có đo trước |
| F2 | db | Cổng còn resolve cả khi `attachmentIds: []` (gỡ hết — `toAdd` chắc chắn rỗng) | Vi tối ưu. ⚠️ Bẫy đã ghi: **đừng** "sửa" bằng cách cho `attach = null` với mảng rỗng — như thế `syncLinksTx` không chạy ⇒ im lặng không gỡ link nào |
| F4 | db | Câu «vế 5 — đã TỪNG link» không lọc `deleted_at`, mà **mọi index có `file_id` đều PARTIAL `WHERE deleted_at IS NULL`** ⇒ rơi về `file_links_company_id_idx`, quét toàn bộ link của công ty | CÓ TRƯỚC WO này; sửa = **migration** thêm index không-partial `(company_id, file_id)`, ngoài phạm vi (WO này 0 migration). Reviewer nói rõ đây là suy luận từ định nghĩa index, **chưa chạy `EXPLAIN ANALYZE`** |
| F5 | db | Lỗi hạ tầng khi resolve quyền ⇒ fail-closed thành **403**, không phải 5xx ⇒ blip DB trông như lỗi phân quyền | Nhất quán với `resolveActor` và luật nền tảng. Ghi để on-call không truy nhầm |

### Điều kiện chặn C-1 của `security-reviewer` — ĐÃ THOẢ

`security-reviewer` đặt điều kiện: phải có bằng chứng int-spec **chạy thật** với `LANE_DB` (nó không chạy được vì cần Docker + hook chi phí). Bằng chứng của lượt thi công này, trên `LANE_DB=mediaos_attgate`:

- **RED (trước khi có cổng):** `Tests 4 failed | 13 passed (17)` — đỏ ĐÚNG 4 ca cổng: **G5** (`expected 200 to be 403`), **G11**, **G15**, **G18** (`expected 422 to be 403`). G5 trả **200** chứ không phải 422 ⇒ tệp đã gieo đúng chủ, phép đo cổng hợp lệ (vá F-3 thực thi đúng).
- **GREEN (sau khi có cổng):** `Tests 17 passed (17)`.
- **Cụm SOCIAL đầy đủ** (gồm 17 ca cửa tệp BE-1C + spec đính kèm BE-1): `Test Files 24 passed | Tests 299 passed`.
- **Sổ pin census ĐO được:** bỏ cờ `tier1IsFloor` của `postUpdate` ⇒ D17 đỏ (`expected [Array(5)] to deeply equal [Array(6)]`), khôi phục ⇒ xanh.
- `pnpm typecheck` toàn workspace: **10/10 xanh**.
