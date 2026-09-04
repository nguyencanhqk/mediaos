# S14-RECRUIT-FILEGRANT-1 — Đóng gap tệp CV cho `recruiter`/`hr`

> 🔴 zone=red · crown-jewel (quyền mới trên đường đọc/ghi tệp PII) · FULL gate (security-reviewer +
> database-reviewer + silent-failure-hunter).
> Nguồn: `harness/backlog.mjs` · SPEC-12 §11/§13.6/§15/§18 · `docs/permission-matrix-spec.md` §9f ·
> mig `0435` `0477` `0560`.
>
> **v3** — qua **2 vòng** plan-review đối kháng: vòng 1 BLOCK (5 điểm + 10 cảnh báo), vòng 2 BLOCK
> (3 điểm + 6 cảnh báo, đều là hệ quả của bản vá vòng 1). Mọi điểm đã vá; §11 ghi đối chiếu cả hai
> vòng. **KHÔNG có vòng 3** — phần còn lại để FULL gate sau implement bắt.

---

## 0. Quyết định hướng (owner chốt 2026-09-04)

WO seed viết theo hướng **cấp cặp `foundation-file` cho recruiter/hr**. Census trước-khi-cấp (§1) cho
thấy hướng đó nới quyền vượt xa luồng CV. Owner chốt **hướng wrapper RECRUIT** (khuôn
`ChatFilesService` S7-CHAT-BE-8 / `MeAvatarService` S5-ME-BE-4 / `EmployeeFileController`
S2-HR-EMPFILE-1) + **`hr` được đủ 4 thao tác CV như `recruiter`**.

Điều chỉnh của người thực hiện (nêu tường minh, owner có thể bác): **KHÔNG** cấp `update:candidate`
cho `hr`. SPEC-12 §11 dòng 276 chốt *"người giữ cặp này thấy email/phone KHÔNG che"* — cấp nó chỉ để
đính CV sẽ bỏ mask PII cho toàn role `hr`, hệ quả owner không yêu cầu. Thay bằng **một cặp ghi-tệp
riêng**, đúng tiền lệ `file-*:employee` (mig 0477).

**Hệ quả với `done_when` WO seed:** ①②③ giữ nguyên. ④ vẫn áp dụng (CÓ migration — 1 cặp catalog + 3
grant, KHÔNG phải grant `foundation-file`). `layer` `DB` → `DB+BE+FE`; `paths` mở rộng (§10).

---

## 1. ĐO TRƯỚC KHI CẤP (done_when ①) — DB thật `mediaos`, head 0568 / 236 migration

Câu đo **bốn hình dạng** (`permission-grant-census-must-cover-four-wildcard-shapes`), quét **MỌI**
role, loại `super-admin` **theo TÊN** (`permission-census-scope-filter-blind-spot`), đếm holder
**sống**:

```sql
WHERE p.action IN ('upload','view','download','delete','link','unlink','*')
  AND p.resource_type IN ('foundation-file','*')
  AND r.name <> 'super-admin' AND r.deleted_at IS NULL
```

| Đo | Kết quả |
| --- | --- |
| Catalog `foundation-file` | 6 cặp, **tất cả `is_sensitive=false`** — `0435:348-353` |
| Grant khớp (18 hàng) | **3 role**: `company-admin` (hệ thống, 2 holder) · `SA` (tuỳ biến tenant, 2) · `QUẢN LÝ CẤP CAO` (tuỳ biến tenant, 3) — mỗi role đủ 6 cặp `@Company` |
| `('*','*')` · `('view','*')` · `('*','foundation-file')` | **0 grant** ngoài `super-admin` |
| `object_permissions` chạm `foundation-file`/`*` | **0 hàng** |
| `recruiter` / `hr` | **0 cặp `foundation-file`** → gap có thật |
| Nguồn cấp duy nhất | `0435:374-378` bulk `WHERE is_sensitive=false AND resource_type LIKE 'foundation-%'` cho **role 0001** — 0 migration khác chạm |

> Đo bằng `role_permissions` trên DB đang chạy, **không** trích từ migration
> (`grant-in-old-migration-is-not-current-state`).

**Vì sao KHÔNG cấp `foundation-file` (đo được):**

1. `view:foundation-file` là **cổng màn quản trị `System > Files`** —
   `sidebar-registry.ts:692` + `routes/system/files/FilesPage.tsx:111`.
2. `GET /foundation/files` **không gác per-file**: `file.repository.ts:308 listTx` bỏ qua
   `moduleCode/entityType/entityId`. (Kéo theo: tab CV hiện tại đang liệt kê MỌI tệp tenant — §9 KI-a.)
3. `download:foundation-file` mở fallback `FOUNDATION.FILE.*` cho tệp **chưa từng link**
   (`file-policy.service.ts:222-230`).

Grant hiện có của 2 role đích: `recruiter` = 7 cặp `candidate` @Company + `access:recruit@Own`;
`hr` = `view`/`convert`:`candidate` @Company + `access:recruit@Own` (**không** `create`/`update`).

---

## 2. Luồng CV hôm nay

| Bước | Route | Gate controller | Gate chính sách |
| --- | --- | --- | --- |
| liệt kê | `GET /foundation/files?…` | `view:foundation-file` | *(không có)* |
| đăng ký | `POST /foundation/files/upload` | `upload:foundation-file` | — |
| xác nhận | `POST /foundation/files/:id/confirm` | `upload:foundation-file` | — |
| gắn | `POST /foundation/files/:id/links` | `link:foundation-file` | `canLinkFile` ⇒ `create\|update:candidate` |
| metadata | `GET /foundation/files/:id` | `view:foundation-file` | `canViewFile` ⇒ `view:candidate` |
| tải | `GET /foundation/files/:id/download-url` | `download:foundation-file` | `canDownloadFile` ⇒ `view:candidate` |

FE (`candidate-file-api.ts`) gate 3 cặp, **thiếu `link`** ⇒ dù có grant, nút Tải lên vẫn 403 ở bước
cuối.

---

## 3. Thiết kế

### 3.1 Nguyên tắc

- **KHÔNG cặp `foundation-file` nào được cấp.** Sau WO, census §1 phải cho **cùng tập role** như
  trước, và `recruiter`/`hr` vẫn **∉** tập đó.
- **Cặp gác MÀN = cặp gác ĐƯỜNG TẢI** (done_when ②): đường đọc CV gác bằng `('view','candidate')` ở
  **cả ba** tầng — decorator route · tầng 2 `RecruitAccessService` · `canDownloadFile` của resolver.
  FE gate **cùng** cặp đó bằng `useCanExact`.
- **Đường GHI** gác bằng **một** cặp mới (§3.2) + **năm vế** ở resolver (§3.5).
- Least privilege: KHÔNG thêm cặp đọc-tệp riêng (đường đọc đã có `view:candidate`); KHÔNG thêm cặp
  xoá (§9 KI-c).

### 3.2 Cặp quyền mới — đúng 1

| Cặp | `is_sensitive` | Cấp cho | scope |
| --- | --- | --- | --- |
| **`('upload','candidate-file')`** | **true** | `recruiter` · `hr` · `company-admin` | `Company` |

**Vì sao resource `candidate-file` chứ KHÔNG phải `('file-upload','candidate')`** (vá plan-review B3
— đã tự kiểm chứng, không tin review):

- `0560:336-347` (b1) `RAISE` nếu tổng grant của 5 role hệ thống trên
  `resource_type IN ('recruit','job-opening','candidate','interview','offer')` **≠ 42**;
- `0560:431-444` (b4) `RAISE` nếu `company-admin`/`recruiter` **≠ 14** cặp @Company trên đúng 5
  resource đó;
- `s12-recruit-db1-invariants.int-spec.ts:982-1016` (**I1**) **đọc `0560_*.sql` từ đĩa và chạy lại**
  để kiểm idempotency.

⇒ Cặp mới đặt trên resource `candidate` sẽ làm **migration đã ship nổ khi replay**, và exception ném
**từ trong SQL** nên không "cập nhật kỳ vọng ở test" được. `IN (...)` là so bằng chính xác nên
`'candidate-file'` **không** khớp `'candidate'` ⇒ 0560 (b1)/(b4) và E4 đứng yên. Đây là lý do kỹ
thuật, không phải sở thích đặt tên; ai đổi tên cặp sau này phải đọc đoạn này trước.

`is_sensitive=true` (khác `file-*:employee` của 0477 vốn `false`): CV là PII ứng viên, REC-DEC-003
chốt họ `candidate` sensitive. Hệ quả bắt buộc (`sensitive-capability-allowlist-is-backend`): APPEND
`"upload:candidate-file"` vào **CẢ HAI** mảng `permission.service.ts` **cùng commit với seed**; FE
gate bằng `useCanExact`.

### 3.3 Bề mặt route mới (wrapper, module-owned) — `RECRUIT-API-033..037`

`@Controller("candidates/:id/files")`.

| Mã | Route | Gate decorator | Key `RECRUIT_ROUTE_PAIRS` |
| --- | --- | --- | --- |
| API-033 | `GET /candidates/:id/files` | `view:candidate` | `candidateFileList` |
| API-034 | `GET /candidates/:id/files/:fileId/download-url` | `view:candidate` | `candidateFileDownload` |
| API-035 | `POST /candidates/:id/files/upload-url` (200) | `upload:candidate-file` | `candidateFileUploadUrl` |
| API-036 | `POST /candidates/:id/files/:fileId/confirm` (200) | `upload:candidate-file` | `candidateFileConfirm` |
| API-037 | `POST /candidates/:id/files/:fileId/link` (201) | `upload:candidate-file` | `candidateFileLink` |

- 5 key khai **tường minh** `isSensitive: true, companyFloor: true` — `pair()` mặc định
  `isSensitive=false` (`recruit-route-pairs.const.ts:28-33`). Quên gõ **KHÔNG** trôi âm thầm:
  `ALL_PAIRS` của `s12-recruit-qa1-permission-matrix.int-spec.ts:72-76` derive từ bảng này rồi `:274`
  gọi `seedPermissionCatalog(..., p.isSensitive)`, và `test/helpers/seed.ts:192-212` **ném LOUD** khi
  cờ fixture lệch catalog ⇒ có cổng thật. *(sửa phát biểu sai của plan v2 — R2 xác minh)*
- **`ParseUUIDPipe` cho `:id` và `:fileId`** — thiếu ⇒ param rác → `22P02` → **500** (lớp KI-068, W5).
- `GET .../files` trả **mảng trần**, KHÔNG `paginated(...)` — client dùng `apiFetch` + array schema
  (`apifetch-drops-pagination-bare-array`, W9c).
- **Thứ tự route: đã kiểm, KHÔNG va chạm.** `CandidatesController` `@Get(":id")` là 2 segment;
  `check-duplicate`/`summary`/`export` là literal khai TRƯỚC `:id`. Controller mới sâu ≥3 segment.
  Thứ tự trong `controllers[]` không ảnh hưởng.

### 3.4 Vì sao wrapper hợp lệ

`upload:foundation-file` được ép ở **`FilesController`**, **`FileService` KHÔNG gate** — đã qua FULL
gate ba lần (`MeAvatarService` · `ChatFilesService` · `CompanyBrandingService`). Controller có gate
RIÊNG gọi thẳng `FileService` là hợp lệ.

⚠️ Câu "wrapper chỉ thu hẹp, không nới" **đúng cho `upload`/`confirm`, SAI cho `link`** — xem §3.5.

### 3.5 Resolver `RecruitCandidateFileResolver` — `canLinkFile` phải có NĂM vế

**Lỗ đã tìm ra ở plan-review vòng 1, tự kiểm chứng lại tại `files.service.ts:530-600`:**
`FileService.link` chỉ kiểm *tenant* + `scan_status !== 'Infected'`. **Không** kiểm `owner_user_id`,
**không** kiểm tệp đã từng link. Quyết định quyền duy nhất là `policy.canLink` → **pipeline ĐƠN**
(`decide`), dispatch theo `(moduleCode, entityType)` **client khai** — cơ chế AND-across-links của
`decideForLinkedFile` chỉ bảo vệ đường ĐỌC, **không** áp cho đường GHI.

Kịch bản hỏng nếu giữ `canLinkFile` như cũ (`['create','update']` + tồn tại candidate):

1. Tệp bất kỳ trong tenant bị **gỡ link** (thu hồi) — hàng rào duy nhất là `deny-links-revoked`
   (`file-policy.service.ts:216-227`).
2. recruiter/hr gọi `POST /candidates/{c}/files/{fileId}/link` → **qua**, không vế nào cấm.
3. `GET /candidates/{c}/files/{fileId}/download-url` → `decideForLinkedFile` nay thấy
   `links=[(RECRUIT,candidate)]` ⇒ **không còn** rơi nhánh `links.length===0` ⇒ `canDownloadFile` =
   `view:candidate` ⇒ **ALLOW** ⇒ presigned URL. **Thu hồi bị vô hiệu hoá vĩnh viễn.**

Biến thể: tệp foundation-owned 0 link (admin upload qua `System > Files`) → link vào candidate → tải
được.

**Vá — `canLinkFile` = hợp của NĂM vế** (khuôn nguyên văn `ChatMessageFileResolver.canAttach:110` +
`MeAvatarFileResolver` + `CompanyBrandingFileResolver`):

1. `input.fileId` có mặt (vắng ⇒ deny, fail-closed);
2. `files.owner_user_id === input.userId` — **caller upload chính tệp đó**;
3. `files.upload_status === 'Uploaded'`;
4. `files.scan_status ∈ {Clean, NotRequired}`;
5. **tệp CHƯA từng có link nào** — `hasEverBeenLinkedTx === false`
   (`file-link.repository.ts:49-70`), đóng đường tái-link phục hồi tệp đã thu hồi;
6. cặp: `create` ∨ `update` ∨ `upload:candidate-file` (`upload` vế mới) + candidate sống trong tenant.

**Hai ràng buộc thi công đi kèm (thiếu là hỏng; không đọc được từ code nên ghi ở đây):**

- **KHÔNG bọc `files.link(...)` trong `withTenant` của wrapper.** Resolver không nhận `TenantTx` —
  nó tự mở `db.withTenant` (`recruit-candidate-file.resolver.ts:76-78`). Hôm nay an toàn vì
  `FileService.link` gọi `policy.canLink` **NGOÀI** mọi tx (`files.service.ts:549` trước `:574`).
  Bọc lại ⇒ tx lồng tx — vấn đề thật dưới PgBouncer transaction-mode. Khuôn phải chép:
  `EmployeeFileService.link:107-130` gọi thẳng, không bọc. *(R2-W2)*
- **Link lần hai trả 403, KHÔNG phải 409.** Vế 5 chạy TRƯỚC insert nên retry chỉ-bước-`link` cho
  cùng `(candidate, file)` là `deny-resolver` 403 chứ không phải `DUP_LINK` 409 như hôm nay.
  **Chốt: chấp nhận 403** — FE luôn retry cả chuỗi (tệp mới) nên luồng không gãy, và thêm nhánh 409
  ở wrapper là dựng bản sao thứ hai của luật link. Ghi vào docblock để không ai *sửa cho đúng mã
  lỗi* rồi vô tình bỏ vế 5. *(R2-W3)*

Các vế còn lại **KHÔNG ĐỔI**:

- `canViewFile` / `canDownloadFile` = `['view']` — recruiter và hr đều đã có.
- `canDeleteFile` / `canUnlinkFile` = `['create','update']` — cố ý **bất đối xứng**: hr gắn được
  nhưng không gỡ được (hẹp hơn, không phải lỗ). Ghi vào docblock.

Nới `canLinkFile` **không** mở thêm gì trên `POST /foundation/files/:id/links` generic: route đó vẫn
đòi `link:foundation-file` mà recruiter/hr không có. Với **company-admin** (đang giữ
`link:foundation-file`) thì 5 vế trên **siết lại** so với hôm nay — ca W2 ở §7 ghim điều đó.

### 3.6 Chống IDOR trên đường tải

`getDownloadUrl(user, candidateId, fileId)` phải **chứng minh `fileId` đang link SỐNG vào ĐÚNG
`candidateId`** (`module='RECRUIT'`, `entity='candidate'`) trước khi gọi `FileService.getDownloadUrl`
— lệch ⇒ **404** (không 403, tránh oracle). Khuôn `EmployeeFileService.loadLinkedFileOr404`.

### 3.7 `confirm` — owner-check TRƯỚC

`confirmOwnUpload` kiểm `file.ownerUserId === actor.id` **trước** `FileService.confirmUpload`
(nguyên văn `ChatFilesService.confirmOwnUpload:84-93`). `!file` ⇒ 404 trước owner-check.

### 3.8 Tham số truyền cho `FileService`

- `upload`: truyền `(moduleCode='RECRUIT', entityType='candidate', entityId=candidateId)` —
  `files.service.ts:167-169` dùng chúng cho `audit_logs` + `file_access_logs`, nên dấu vết gắn đúng
  ứng viên **ngay từ bước register** (khác `ChatFilesService`, nơi tin nhắn chưa tồn tại). `visibility`
  SERVER-SET `'Private'`, không nhận từ client.
- `moduleCode`/`entityType`: **import hằng `RECRUIT_MODULE` / `CANDIDATE_ENTITY`** đã export sẵn ở
  `recruit-candidate-file.resolver.ts:8-9` — KHÔNG gõ literal. Lệch chính tả ⇒ `canonicalOwnerKey`
  (`file-policy.service.ts:136-148`) trả 400, hoặc tệ hơn là link *ma*. *(R2-W4)*
- `link`: `linkType='Document'`, `accessScope='Company'` (§13.6 candidate CHỈ Company),
  **`isPrimary=false`** (`true` sẽ ăn 409 `uq_file_links_primary_per_entity_type`), `purpose='CV'`.

### 3.9 Quyết định tường minh — masking & audit

- **`originalName` KHÔNG mask.** §18 buộc che email/phone ở **DTO có cấu trúc**; nhưng
  `canDownloadFile = view:candidate` nghĩa là người giữ `view:candidate` **đọc được toàn văn CV** —
  che tên tệp trong khi phục vụ chính tệp đó là hình thức. Ghi quyết định vào SPEC-12 §18 (§8) để
  reviewer sau không mở lại. *(Cảnh báo W3 của plan-review — chốt theo hướng chấp nhận, có lý do.)*
- **Tải CV ghi `file_access_logs`, KHÔNG ghi `audit_logs`** — đúng SPEC-12:527, do `FileService`
  đảm nhiệm. Ghi tường minh để không bị đọc là thiếu sót. *(W4)*

---

## 4. Migration `0569_s14recruitfilegrant1_candidate_file_perm.sql`

Đánh số tiếp head **thật lúc chạy** (hiện `0568`, journal idx 235 / `when` 1717587357000 ⇒ idx 236 /
1717587358000 — **đo lại trước khi ghi**). Journal `meta/_journal.json` **bắt buộc** — thiếu là
migration bị BỎ QUA im lặng (`migration-not-in-journal-is-silently-skipped`).

1. **Catalog** — INSERT `('upload','candidate-file', true)` `ON CONFLICT (action,resource_type) DO
   NOTHING`. ⚠️ Kèm guard `RAISE EXCEPTION` nếu cặp **đã tồn tại với `is_sensitive <> true`** —
   `DO NOTHING` nuốt ca đó trong im lặng (`empty-success-is-the-fail-open-shape`).
2. **Grant per-(role,pair)** DO-block khuôn `0560` bước (4): 3 hàng
   `recruiter|hr|company-admin × upload:candidate-file × Company`; `DELETE` bộ sai scope trước
   (UNIQUE `(role_id,permission_id,effect)` KHÔNG gồm `data_scope`), rồi INSERT `ON CONFLICT DO
   NOTHING`; `RAISE EXCEPTION` nếu role/permission không tồn tại.
3. **Verify NEGATIVE — MỌI role hệ thống ngoài 3 role đích** giữ cặp này ⇒ `RAISE`. Không neo danh
   sách `manager/employee/hr-manager`: repo còn ≥12 role `company_id IS NULL` khác — đúng bài học
   MED-2 ghi ở `s12-recruit-db1-invariants.int-spec.ts:687-691`. *(W10)*
3b. **Verify DƯƠNG** (khuôn `0477` khối C — thiếu ở plan v2): (i) đúng **3 hàng `ALLOW` × `Company`**
   tồn tại sau seed; (ii) **0 hàng `effect='DENY'`** cho cặp này. Lý do (ii): UNIQUE là
   `(role_id, permission_id, effect)` nên `DELETE … data_scope <> 'Company'` + `INSERT ON CONFLICT
   DO NOTHING` **không dọn** một hàng `DENY` có sẵn ⇒ grant chết mà migration vẫn báo thành công
   (`empty-success-is-the-fail-open-shape`). *(R2-B3)*
4. **Verify KHÔNG NỚI `foundation-file`** — **KHÔNG đếm tổng**. Con số 18 của §1 gồm 2 role **tuỳ
   biến tenant** (`SA`, `QUẢN LÝ CẤP CAO`) chỉ tồn tại trên DB có dump PROD.
   **Đã đo, không suy đoán** — lane DB sạch `mediaos_filegrant1` (236 migration, cùng head):

   | DB | Role có grant `foundation-file` | Số hàng |
   | --- | --- | --- |
   | `mediaos` (có dump PROD) | `company-admin` · `SA` · `QUẢN LÝ CẤP CAO` | **18** |
   | `mediaos_filegrant1` (sạch, dựng từ migration) | `company-admin` | **6** |

   ⇒ `RAISE` theo số 18 sẽ làm `db:migrate` **fail trên mọi DB sạch** (lane + CI), kéo theo toàn bộ
   int-spec đỏ (vá plan-review B2). Thay bằng bất biến đúng-ở-mọi-DB:
   - `RAISE` nếu `recruiter` hoặc `hr` có **bất kỳ** grant nào khớp 4 hình dạng trên `foundation-file`;
   - `RAISE` nếu tồn tại grant `('*','*')` / `('*','foundation-file')` / `(act,'*')` cho role hệ thống.

   ⚠️ **CẢ HAI vế PHẢI neo `r.company_id IS NULL AND r.deleted_at IS NULL`** (khuôn `0560:161`,
   `0477:76`) — thiếu là migration nổ, và nổ **chỉ trên DB thật**:
   - `SuperAdminBootstrapRepository` grant **TOÀN BỘ catalog, không lọc**
     (`super-admin-bootstrap.repository.ts:127-128`) cho role `super-admin` **COMPANY-SCOPED**
     (`:44` — `company_id = companyId`, KHÔNG NULL). Catalog CÓ cặp `('*','*')` (§1 bảng A) ⇒ trên
     mọi DB đã bootstrap, vế wildcard không neo sẽ `RAISE`. *(Đã tự đo: `mediaos` hiện CHƯA bootstrap
     — grant wildcard = 0 hàng — nên bẫy này KHÔNG lộ ở DB dev, chỉ nổ ở nơi đã có super-admin.)*
   - `roles_system_name_active_uq` chỉ ép duy nhất cho role **hệ thống**; một tenant hoàn toàn có thể
     có role company-scoped tên `hr` (đúng cách `SA`/`QUẢN LÝ CẤP CAO` tồn tại — §1). Role đó giữ
     `foundation-file` là chuyện của tenant, không phải seed của ta ⇒ **không được** `RAISE`.

   *(R2-B3 — kết luận của review ĐÚNG, nhưng bằng chứng phải đo lại như trên: `('*','*')` ở §1 nằm
   trong CATALOG chứ không phải trong GRANT.)*
5. Không DDL; không đụng CHECK `audit_logs.object_type` (tệp CV ghi qua `FileService`, object_type
   `file`/`file_link` đã có).
6. **Khối Down thủ công** ở cuối file (khuôn `0560`/`0477`): DELETE 3 grant + DELETE cặp catalog.
   Lưu ý đường lùi: `modules.is_active` **không phải cổng** (`module-is-active-is-not-a-gate`) ⇒ 5
   route sống ngay khi merge, không có feature-flag.

---

## 5. Sửa/thêm file — Backend

| File | Việc |
| --- | --- |
| `apps/api/migrations/0569_*.sql` + `meta/_journal.json` | mới (§4) |
| `apps/api/src/recruit/recruit-route-pairs.const.ts` | +5 key (§3.3), sửa comment `:35` "đủ 32 route" → 37 |
| `apps/api/src/recruit/recruit-candidate-file.controller.ts` | **mới** — 5 route, class-level `@UseGuards(PermissionGuard)` |
| `apps/api/src/recruit/recruit-candidate-file.service.ts` | **mới** — `resolveActor` → candidate sống trong tenant (404) → `FileService` |
| `apps/api/src/recruit/recruit-candidate-file.repository.ts` | **mới** — `listByCandidateTx` · `findLinkedFileTx` (khuôn `EmployeeFileRepository:61-84`) |
| `apps/api/src/recruit/recruit-candidate-file.resolver.ts` | `canLinkFile` → 5 vế (§3.5) |
| `apps/api/src/recruit/recruit.module.ts` | đăng ký controller + service + repository (khối additive) |
| `apps/api/src/permission/permission.service.ts` | APPEND `"upload:candidate-file"` vào **CẢ HAI**: `SENSITIVE_CAPABILITY_ALLOWLIST` (Set — để `/auth/me` trả key) **và** `SENSITIVE_SCREEN_GATE_PAIRS` (mảng — 7 cặp `candidate` đã ở đó; spec `sensitive-screen-gate-allowlist.spec.ts:20` ép `SCREEN_GATE_PAIRS ⊆ ALLOWLIST`, thêm 1 mảng là ĐỎ) |
| `packages/contracts/src/recruit*.ts` | `recruitCandidateFileUploadUrlInputSchema` + `recruitCandidateFileSchema` |

## 6. Sửa/thêm file — Frontend

| File | Việc |
| --- | --- |
| `apps/app/src/routes/recruit/candidate-file-api.ts` | trỏ sang 5 route mới; **xoá** docblock "NỢ SEED" |
| `apps/app/src/routes/recruit/components/CandidateCvTab.tsx` | `useCan(*,'foundation-file')` → `useCanExact('view','candidate')` (xem/tải) + `useCanExact('upload','candidate-file')` (tải lên); **gỡ `cv.gapNote`** (`:113`) |
| `apps/app/src/i18n/locales/vi/recruit.ts` | gỡ khoá `cv.gapNote` |
| `apps/app/src/routes/recruit/components/CandidateCvTab.spec.tsx` | **MỚI** (chưa tồn tại) — §7.4 |

---

## 7. Test — RED TRƯỚC (done_when ③)

### 7.1 RED có sẵn (chạy TRƯỚC khi viết code — phải ĐỎ)

| Spec | Vì sao đỏ | Ratchet |
| --- | --- | --- |
| `recruit-two-layer-guard-census.unit-spec.ts:193` | `>= 32` key resolveActor | → 37 |
| cùng file `:233-237` | "đúng 7 cặp sensitive, mọi cặp `resourceType==='candidate'`" | → 8 cặp, `resourceType ∈ {candidate, candidate-file}` |
| `s12-recruit-db1-invariants.int-spec.ts` **E1** | set-equality 42 bộ | mở rộng `IN` list += `'candidate-file'`, 42 → **45** |
| `route-guard-coverage.e2e-spec.ts:274-284` | 5 route mới chưa có trong artifact | regen `ROUTE_CENSUS_WRITE=1` |
| `route-http-coverage.e2e-spec.ts:391-407` | `MAX_UNCOVERED_TOTAL` = **cổng cứng**: mọi route mới phải có test HTTP thật | §7.2 phủ đủ 5, dùng **đúng literal path** |
| `s12-recruit-qa1-permission-matrix.int-spec.ts:497` | `Object.keys(RECRUIT_ROUTE_PAIRS).length === 32` | → 37 |
| cùng file `:502-510` | `ROUTES` = 28 · `EXEMPT_KEYS` = 4 · set-equality `ROUTES ∪ EXEMPT = allKeys` | → 33 / 4 |

> ⚠️ **E4 và `0560` (b1)/(b4) CỐ Ý không đỏ** — đó là lý do chọn resource `candidate-file` (§3.2).
> Nếu chúng đỏ nghĩa là ai đó đã đổi cặp về `('file-upload','candidate')`: đọc lại §3.2 trước khi
> "sửa cho xanh". **Vai ghim `is_sensitive` mà E4 đang giữ cho 7 cặp `candidate` được Z4 (§7.4) gánh
> cho cặp mới** — KHÔNG phải cặp mới không cần ghim.

### 7.2 Spec mới `apps/api/test/integration/s14-recruit-filegrant1-cv.int-spec.ts`

Mỗi ca DENY có **ca ALLOW đối chứng** (`deny-cases-vacuous-without-allow-case`); ca ALLOW assert mã
2xx **cụ thể**, KHÔNG `.not.toBe(403)` (`allow-counter-case-not-403-lets-500-through`).

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| A1 | `employee` (0 cặp candidate) → cả 5 route | 403 × 5 |
| A2 | ALLOW đối chứng: `recruiter` → cả 5 route **theo trình tự** upload-url → confirm → link → list → download-url | 200/200/201/200/200 — `download-url` chỉ 200 khi ĐÃ có link sống; sai thứ tự là đỏ giả *(R2-W6)* |
| B1 | `hr` (view + upload:candidate-file, **không** create/update) → đủ 5 route | 5 xanh — chứng minh owner "hr = đủ như recruiter" |
| **L1** | **recruiter link tệp KHÔNG do mình upload** (§3.5 vế 2) | **403** |
| **L2** | **link tệp đã-từng-link-rồi-gỡ** (§3.5 vế 5 — chống bypass thu hồi) | **403** |
| **L3** | **link tệp `upload_status='Pending'`** (vế 3) | **403** |
| **L4** | ALLOW đối chứng L1-L3: link tệp vừa upload+confirm qua chính wrapper | **201** |
| **W2** | **company-admin** (giữ `link:foundation-file`) link tệp NGƯỜI KHÁC vào candidate qua route generic | **403** — WO này SIẾT company-admin; không có ca này là đóng đinh lỗ ở trạng thái MỞ (`tests-can-pin-a-hole-open`) |
| C1 | **Không nới**: `recruiter`+`hr` → 4 route `/foundation/files*` | 403 × 4 × 2 |
| C2 | ALLOW đối chứng C1: `company-admin` → 4 route đó | 2xx |
| **N1** | **Candidate KHÔNG tồn tại, CÙNG tenant** → `GET .../files` và `.../download-url` | **404 cả hai** — ghim vế *service kiểm candidate*; thiếu nó list trả `[]` 200 còn download 404 (hai route lệch nhau) *(R2-W5)* |
| D1 | Cross-tenant: candidate công ty B, actor công ty A | 404 |
| D2 | ALLOW đối chứng D1 | 200 |
| E1 | IDOR: file link vào candidate X, tải qua `/candidates/{Y}/files/{fileId}/download-url` | 404 |
| E2 | ALLOW đối chứng E1 | 200 |
| F1 | `confirm` tệp của người khác (§3.7) | 403 |
| F2 | ALLOW đối chứng F1 | 200 |
| G1 | Sàn scope: role thử có `upload:candidate-file@Own` → upload-url | 403 `AUTH-ERR-SCOPE-DENIED` |
| G2 | ALLOW đối chứng G1 (`@Company`) | 200 |
| H1 | `file_access_logs` sau E2 | **delta = +1**, `access_granted=true` (đếm trước/sau, KHÔNG tuyệt đối — W8) |

**Bỏ ca "hr → DELETE /foundation/files/:id/links/:linkId ⇒ 403"** của plan v1: nó bị chặn bởi
decorator `unlink:foundation-file` chứ không bởi bất đối xứng resolver mà nó tuyên bố chứng minh
(`overdetermined-gate-makes-deny-spec-vacuous`, W1). Bất đối xứng `canUnlinkFile` đo ở **unit-spec
resolver** (§7.3) thay vì qua HTTP.

### 7.3 Unit-spec `recruit-candidate-file.resolver.spec.ts` (mới)

Đột biến **TỪNG VẾ** của 5 vế `canLinkFile` (`overdetermined-gate-makes-deny-spec-vacuous`: gỡ cả
cụm thì không biết vế nào đang chặn) + ca `canUnlinkFile`/`canDeleteFile` từ chối `upload:candidate-file`.

### 7.4 Census bất biến (mục Z của §7.2)

- **Z1** — bốn hình dạng, mọi role, loại `super-admin` theo TÊN: tập role có grant `foundation-file`
  **KHÔNG chứa** `recruiter`/`hr`, và **⊆ {company-admin} ∪ {role company-scoped}**. Phát biểu theo
  **tập**, không theo số 18 (đúng ở mọi DB — vá B2).
- **Z2** — `object_permissions` chạm `foundation-file`/`*`: **0 hàng**.
- **Z3** — tự kiểm `checked === 5` (chống vòng lặp rỗng đội lốt xanh).
- **Z4** *(R2-B2 — BẮT BUỘC)* — catalog: `('upload','candidate-file').is_sensitive = true`, **kèm đối
  chứng** một cặp non-sensitive bất kỳ vẫn `false` (chống ca *assert mọi thứ đều true*).
  **Vì sao phải có:** sau khi đổi sang resource `candidate-file` (§3.2), E4 neo
  `resource_type='candidate'` nên **mù** với cặp mới; `global-catalog-fence` chỉ so trước/sau *trong
  một lượt chạy*; `sensitive-screen-gate-allowlist.spec.ts` chỉ so hai mảng trong code, không đọc DB;
  guard §4 bước 1 chỉ chạy lúc migrate. ⇒ Không có Z4 thì một `UPDATE permissions SET is_sensitive =
  false` ở WO sau làm **0 test đỏ**, `permission-catalog-snapshot` trả `false`, cổng sensitive tắt,
  và `('*','*')` mở được đường GHI tệp CV — đúng lớp lỗ `S14-SEC-DASHGATE-WILDCARD-1` vừa vá.

### 7.5 Cổng toàn cục phải cập nhật (vá plan-review B4)

1. `recruit-two-layer-guard-census.unit-spec.ts:68-74` — **`RECRUIT_CONTROLLERS` là Set TÊN CLASS**;
   quên thêm `RecruitCandidateFileController` thì `recruitRoutes` vẫn = 32 và census 2 tầng **mù hoàn
   toàn** với 5 route mới, ca `:163` vẫn XANH (`module-closed-by-second-assert-not-scope`).
2. Cùng file: `ROUTE_TO_KEY` += 5 hàng; `:193` `>= 32` → 37; `:233` 7 → 8.
3. `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` — regen (`ROUTE_CENSUS_WRITE=1`).
4. `route-http-coverage.e2e-spec.ts` — 5 route phải có bằng chứng HTTP thật với **literal path** khớp
   scanner; siết `MAX_UNCOVERED_*` xuống nếu tụt, **KHÔNG nới lên**.
5. `sensitive-screen-gate-allowlist.spec.ts` + `auth-me-capabilities.int.spec.ts` — pin cặp mới.
6. **`s12-recruit-qa1-permission-matrix.int-spec.ts` — KHÔNG phải ratchet một dòng** *(R2-B1)*.
   Ngoài `:497` 32→37 và `:503` 28→33, phải thêm **5 `RouteSpec` THẬT** vào `ROUTES` (method + url +
   body). Body của 3 route POST phải **qua được Zod**: docblock `:96-103` ghi số đo 31/08/2026 —
   *“body thiếu field bắt buộc sẽ dừng ở 400 validation TRƯỚC KHI service kịp assert sàn, làm mục A
   xanh-giả”*. Đây là bản đo `companyFloor` cho **cả 5** route; G1/G2 ở §7.2 chỉ phủ 1.

### 7.6 FE

`CandidateCvTab.spec.tsx` (mới): ẩn/hiện nút theo `useCanExact` đúng cặp; ca **"có `*:*` nhưng KHÔNG
có cặp exact ⇒ nút ẨN"** (chứng minh dùng `useCanExact` chứ không `useCan`).

---

## 8. Doc phải cập nhật (vá plan-review B5 — SPEC là chuẩn, CLAUDE.md §1)

| Doc | Việc |
| --- | --- |
| `docs/spec/SPEC-12 RECRUIT.md` §15 | Ghi chú sau API-032 chốt *"Tệp CV **không có route riêng trong RECRUIT** … Thêm endpoint sau phải cấp mã `RECRUIT-API-033+` và đo lại dải bằng grep"* + *"32 mã = 32 route"* → viết lại; thêm **API-033..037**; tổng 37 |
| `docs/spec/SPEC-12` §11 | +cặp thứ 17 `('upload','candidate-file')` vào bảng cặp + ma trận role |
| `docs/spec/SPEC-12` §18 | ghi quyết định §3.9 (originalName không mask; đường GHI tệp gate bằng cặp mới, KHÔNG còn chỉ `create`/`update`) |
| `docs/permission-matrix-spec.md` §9f | +1 cặp, +3 grant (file **CÓ** trong `paths` WO nhưng plan v1 quên liệt kê) |
| `docs/API Design/API-17` | +5 route |
| `docs/erd-current.md` | không đổi (không DDL) |

---

## 9. Ghi nhận tường minh — KHÔNG sửa trong WO này

| # | Việc | Vì sao để lại |
| --- | --- | --- |
| KI-a | `GET /foundation/files` bỏ qua `moduleCode/entityType/entityId` (`file.repository.ts:308`) ⇒ `System > Files` và mọi caller lọc-theo-entity nhận **toàn bộ tệp tenant** | Bề mặt DÙNG CHUNG của `company-admin`/`SA`/`QUẢN LÝ CẤP CAO`; sửa = đổi màn quản trị đang chạy. WO này **né** (wrapper tự query `file_links`). → WO riêng |
| KI-b | `employee`/`manager` giữ `file-upload:task@Own`, `hr` giữ `file-upload:employee@Company`, nhưng **cả hai vẫn upload qua `/foundation/files/upload`** ⇒ cùng lớp gap chưa đóng cho TASK và HR | Ngoài phạm vi RECRUIT. → WO riêng, dùng lại khuôn wrapper này |
| KI-c | Không có cặp xoá ⇒ recruiter/hr **không gỡ được CV đính nhầm**; chỉ `company-admin` gỡ. Kèm hệ quả CỐ Ý của vế 5 (§3.5): **gỡ nhầm rồi muốn đính lại thì phải RE-UPLOAD**, không tái-link được | Least privilege + chống bypass thu hồi. **Nợ VẬN HÀNH**: với PII ứng viên (quyền xoá theo yêu cầu chủ thể) phải nêu ai xử lý thủ công → RELEASE-02 *(R2-W3)* |
| KI-d | **Reachable NGAY HÔM NAY, không phải “WO sau”** *(R2-W1 — đã sửa mức)*: `EmployeeFileResolver.canLinkFile` (`employee-file.resolver.ts:57-59`) chỉ hỏi scope `file-upload:employee`, **KHÔNG có owner-check** (khác hẳn 5 vế WO này áp cho RECRUIT), mà `hr` giữ cặp đó @Company (mig 0477). ⇒ hr gọi `POST /hr/employees/:id/files` với `fileId` = CV ứng viên: (a) AND-verdict `decideForLinkedFile:238-261` làm **recruiter mất quyền tải chính CV đó** (403, lý do chỉ nằm trong `deniedByLink` của log); (b) CV — PII ứng viên, retention riêng — hiện trong danh sách tài liệu nhân viên | **Không phải escalation** (không ai đọc thêm được thứ trước đó không đọc được) ⇒ không chặn WO này. RECRUIT không tự chặn được vì owner-check nằm ở resolver RECRUIT, không phải HR. Cùng họ KI-b → WO riêng |

---

## 10. Cập nhật `harness/backlog.mjs`

- `layer`: `"DB"` → `"DB+BE+FE"`.
- `paths` += `apps/app/src/routes/recruit/**` · `apps/app/src/i18n/**` · `packages/contracts/**` ·
  `apps/api/src/permission/permission.service.ts` · `docs/spec/**` · `docs/_review/**` ·
  `docs/API Design/**`.
- `done_when` ④: migration = **1 cặp catalog + 3 grant**, KHÔNG phải grant `foundation-file`.

---

## 11. Đối chiếu plan-review vòng 1

| Điểm | Xử lý |
| --- | --- |
| **B1** link cho đính tệp bất kỳ / bypass thu hồi | §3.5 — `canLinkFile` 5 vế; ca L1-L4 + W2 (§7.2); unit-spec đột biến từng vế (§7.3). **Đã tự kiểm chứng `files.service.ts:530-600`** |
| **B2** migration đếm "=18" nổ trên DB sạch | §4 bước 4 — bỏ đếm tổng, đổi sang bất biến theo tập; Z1 (§7.4) cũng phát biểu theo tập |
| **B3** I1 replay `0560` nổ vì 42→45 | §3.2 — cặp mới đặt trên resource **`candidate-file`**, ngoài 5 resource mà 0560 (b1)/(b4) đếm. **Đã tự kiểm chứng `0560:336-347` + `:431-444`** |
| **B4** cổng toàn cục bị bỏ sót | §7.5 — 5 mục, gồm `RECRUIT_CONTROLLERS` Set tên class |
| **B5** SPEC/doc drift | §8 — 6 doc. **Đã tự kiểm chứng SPEC-12:452** |
| W1 ca B2 xanh rỗng | §7.2 — bỏ ca đó, chuyển sang unit-spec §7.3 |
| W2 C2 đóng đinh lỗ ở trạng thái mở | §7.2 ca **W2** |
| W3 `originalName` rò PII | §3.9 — chấp nhận có lý do, ghi vào SPEC-12 §18 |
| W4 audit tải CV | §3.9 — chốt tường minh |
| W5 `ParseUUIDPipe` | §3.3 |
| W6 `isSensitive` mặc định false | §3.3 |
| W7 nợ vận hành xoá CV | §9 KI-c |
| W8 H1 đếm tuyệt đối | §7.2 — đếm delta |
| W9 FE gapNote / spec mới / mảng trần | §6 + §3.3 |
| W10 verify negative quá hẹp | §4 bước 3 |
| Câu hỏi mở: tham số `link`, `upload` module/entity, rollback | §3.8 + §4 bước 6 |
| Thứ tự route Nest (review xác nhận KHÔNG va chạm) | §3.3 giữ nguyên |

### Vòng 2 (BLOCK — 3 điểm, đều là hệ quả của bản vá vòng 1)

| Điểm | Xử lý |
| --- | --- |
| **R2-B1** cổng thứ 6 `s12-recruit-qa1-permission-matrix` ghim 32/28/4 | §7.1 bảng RED + §7.5 mục 6 — **đã tự kiểm chứng `:497-517`** |
| **R2-B2** đổi sang `candidate-file` ⇒ mất bất biến ghim `is_sensitive=true` | §7.4 **Z4** + sửa ghi chú §7.1 |
| **R2-B3** §4 bước 3/4 thiếu neo `company_id IS NULL` | §4 bước 3b + khối ⚠️ ở bước 4. **Bằng chứng của review sai** (`('*','*')` ở §1 là CATALOG, GRANT = 0 hàng); cơ chế thật đã tự đo: `super-admin-bootstrap.repository.ts:127` grant cả catalog cho role company-scoped |
| R2-W1 KI-d sai mức | §9 KI-d viết lại — reachable hôm nay qua HR-API-801 |
| R2-W2 nested tx | §3.5 |
| R2-W3 403 vs 409 + re-upload | §3.5 (chốt 403) + §9 KI-c |
| R2-W4 gõ literal module/entity | §3.8 |
| R2-W5 thiếu ca candidate-không-tồn-tại | §7.2 ca **N1** |
| R2-W6 A2 phụ thuộc thứ tự fixture | §7.2 ca A2 |
| W6 “drift âm thầm” phát biểu sai | §3.3 — có cổng thật (`seed.ts:192-212` ném LOUD) |

> **KHÔNG có vòng 3.** `red-zone-wo-cost-profile` (1 vòng plan-review là đủ) +
> `plan-review-rounds-inject-new-holes` (vòng 2 đã chứng minh: 3 điểm mới đều do bản vá vòng 1 đẻ ra).
> Phần còn lại để FULL gate sau implement bắt.

---

## 12. Nhật ký thi công (điền khi code — 2026-09-04)

Plan v3 được thi công gần như nguyên vẹn. Ghi lại **những chỗ thực tế khác plan** để phiên sau và
reviewer không phải đo lại.

### 12.1 Plan ĐẾM THIẾU cổng census: có BẢY, không phải sáu

§7.5 liệt kê 6 cổng toàn cục. Cổng thứ **7** là **`apps/app/src/routes/recruit/recruit-wiring.spec.ts`**
— nó đọc `recruit-route-pairs.const.ts` của BE bằng `fs`, ghim `beEntries.size === 32`, và có ca
*"không resource nào KHÁC `candidate` bị đánh sensitive"*. Cặp mới `('upload','candidate-file')`
`is_sensitive=true` làm ca đó ĐỎ.

Đã vá theo hướng **ghim TẬP, không ghim TÊN**: ca mới assert tập resource được phép sensitive đúng bằng
`{candidate, candidate-file}` + một ca riêng ghim 3 key ghi dùng đúng cặp `upload:candidate-file`. Nới
thêm một resource sau này vẫn phải là quyết định có chủ đích qua FULL gate.

### 12.2 `candidateFileLink` trong ma trận QA-1 cần tệp THẬT, không `ghost()`

Mục B của `s12-recruit-qa1-permission-matrix.int-spec.ts` assert `.not.toBe(403)` cho chủ thể Company.
Với `ghost()` ở `:fileId`, `FileService.link` hỏi resolver → không tìm thấy tệp → deny → **403** ⇒ mục B
đỏ vì lý do SAI (thiếu tệp, không phải thiếu sàn scope). Đã thêm `Fixture.linkableFileId`: một tệp do
chính `tCompany` upload+confirm ở `beforeAll` (leg PUT bytes thay bằng `UPDATE upload_status` qua direct
pool). Phụ phẩm: mục B nay chứng minh luôn đường GẮN chạy được ở scope Company.

Kéo theo: spec đó phải đặt `process.env.S3_*` (presign là HMAC offline, KHÔNG cần MinIO).

### 12.3 Ba nhóm ca THÊM ngoài §7.2

| Ca | Vì sao thêm |
| --- | --- |
| **A3 / A3b** | Chủ thể chỉ có `('*','*')` ⇒ **403 cả 5 route**; đối chứng A3b: cùng chủ thể mở được route RECRUIT non-sensitive ⇒ grant wildcard là THẬT. Decorator route KHÔNG khai `isSensitive` (đồng nhất 32 route cũ) nên vế chặn là TẦNG 2 — phải có ca đo. Đúng lớp lỗ `S14-SEC-DASHGATE-WILDCARD-1` vừa vá. |
| **K1 / K2** | `/auth/me` phải TRẢ `upload:candidate-file` cho recruiter/hr. **Đã đột biến để chứng minh không xanh-rỗng:** gỡ dòng allowlist ⇒ K1 đỏ (`expected undefined to be true`). Đây là lớp lỗi CAP-2 đã lặp 12+ lần và §7.5 mục 5 chỉ ghi "pin cặp mới" mà không nói pin Ở ĐÂU. |
| **Biên** | `ParseUUIDPipe` ⇒ 400 (không 500 `22P02`); body khai `visibility`/`entityId` ⇒ 400 (`.strict()`). |

### 12.4 Phát hiện của FULL gate đã vá trong WO

**silent-failure-hunter (MEDIUM, verdict PASS):** `CandidateCvTab.uploadMutation` thiếu `onError` ⇒ mọi
thất bại của chuỗi 4 chặng biến mất trong im lặng (nút hết "Đang tải lên…" rồi thôi). Lỗi **có từ trước**
WO (xác minh bằng `git show master:`), nhưng chính WO này biến 403-khi-gắn-lại thành nhánh **dự kiến**
(vế 5), nên nó nay bị bấm vào thường xuyên. Đã vá: `onError` + dùng chung ô alert với `downloadError`, kèm
2 ca ghim (thất bại ⇒ có alert · thành công ⇒ KHÔNG có alert).

### 12.5 Giới hạn ghi nhận tường minh (KHÔNG vá trong WO)

**036 `confirm` không kiểm "tệp được đăng ký cho ĐÚNG `:id` này".** Không kiểm được cho rẻ — `files`
không có cột entity, `entityId` của bước 035 chỉ nằm trong `audit_logs`/`file_access_logs`. Hệ quả tối
đa: caller (đã sở hữu tệp, đã có quyền @Company trên MỌI ứng viên) confirm qua URL ứng viên khác ⇒ hàng
audit bước register ghi A còn link cuối gắn vào B. **Không phải escalation** — cùng người đó chỉ cần đăng
ký tệp mới cho B. Khớp cả `ChatFilesService`/`MeAvatarService`. Vá thật đòi thêm cột entity vào `files`
= đổi hợp đồng dùng chung của 5 module ⇒ WO riêng. Ghi ở docblock `confirmOwnUpload`.

### 12.6 Số đo sau khi thi công

- `bash harness/check.sh --lane-db=filegrant1` → **XANH ✅ mọi cổng** (secret-literals · lint · typecheck ·
  migration-no-drop · tooling-tests · test chunked trên `LANE_DB=mediaos_filegrant1`); 657/657 file api ·
  259/259 file app. 6 lần chạy lại do crash hạ tầng `ERR_IPC_CHANNEL_CLOSED` (flake đã biết, 0 test đỏ).
- Test mới: **30 ca** int-spec `s14-recruit-filegrant1-cv` · **20 ca** unit-spec đột biến từng vế
  `canLinkFile` · **9 ca** FE `CandidateCvTab.spec.tsx`.
- **Replay `0569` lần 2 trên lane DB (đo, không tin lời khai):** `INSERT 0 0` · `0 INSERT moi, 0 re-scope`
  · `verify OK: 3 ALLOW@Company, 0 DENY` · `verify OK: 0 grant foundation-file cho recruiter/hr, 0
  wildcard cho role he thong`; số grant `candidate-file` không đổi 8 → 8. Trong 8 hàng đó có **5 role
  company-scoped của fixture test** — và verify NEGATIVE **không** trip, chứng minh vế neo
  `company_id IS NULL` hoạt động đúng trên dữ liệu thật.
- Index phục vụ repository: `idx_file_links_entity` trên `(company_id, module_code, entity_type,
  entity_id)` — khớp đúng `WHERE` của cả hai method, không seq-scan.
- `policy.canLink` chạy **NGOÀI** mọi tx (`files.service.ts:549` trước `:573`) ⇒ resolver tự mở
  `withTenant` KHÔNG lồng tx. Đã tự đọc, không tin plan.

---

## 13. FULL gate — kết quả (2026-09-04)

| Reviewer | Verdict | Ghi chú |
| --- | --- | --- |
| `security-reviewer` | **PASS** | 0 CRITICAL · 0 HIGH · 1 MEDIUM · 5 LOW. Dựng lại bảng chân trị `canLinkFile` ĐỘC LẬP, không tìm ra tổ hợp lọt sai; xác nhận đường vòng `POST /foundation/files/:id/links` của company-admin ĐÃ đóng (cùng resolver). |
| `silent-failure-hunter` | **PASS** | 1 MEDIUM (FE nuốt lỗi tải lên) — **đã vá trong WO**, xem §12.4. |
| `database-reviewer` | *dừng ở hook chi phí* | Chỉ ra quan sát sơ bộ, không có verdict. Các câu nó bỏ ngỏ đã được **tự đo** thay vì hỏi lại — xem §12.6 (replay 0569, index, tx). |

> Điều kiện PASS của security-reviewer (“`harness/check.sh --all` xanh với `LANE_DB` đặt”) **đã thoả**:
> `bash harness/check.sh --lane-db=filegrant1` → XANH ✅ mọi cổng (§12.6). Reviewer read-only nên không
> quan sát được lượt chạy đó.

### 13.1 Đã vá ngay trong WO

- **LOW** `recruit-candidate-file.repository.ts` — `innerJoin(files, …)` không AND `files.company_id`
  trong khi docblock khẳng định “mỗi WHERE vẫn AND `company_id`”. Cô lập vẫn đứng nhờ RLS+FORCE, nhưng
  lời khẳng định SAI về chính nó và lớp belt-and-suspenders chỉ còn MỘT vế. Đã thêm ở cả hai method.
- **LOW** quy kết audit — đã ghi vào **SPEC-12 §18**: người đọc audit tệp CV phải tin hàng `FileLinked`,
  KHÔNG tin hàng `FileUploaded` của bước 035 (lý do ở §12.5).
- **MEDIUM** (silent-failure) FE nuốt lỗi tải lên — §12.4.

> ⚠️ Ba bản vá trên là **commit sửa phát hiện của gate**, tức tự nó chưa qua cổng nào
> (`fix-commit-for-review-findings-is-itself-ungated`). Đã chạy lại 4 spec liên quan trên `LANE_DB`
> ngay sau khi vá: **150/150 xanh** (`s14-recruit-filegrant1-cv` 30 · `s12-recruit-qa1-permission-matrix`
> 76 · `s12-recruit-db1-invariants` 24 · `recruit-candidate-file.resolver.spec` 20).

### 13.2 Ghi nhận, KHÔNG vá trong WO này

| Mức | Việc | Vì sao để lại |
| --- | --- | --- |
| **MEDIUM** | **033 `list` không đi qua `FilePolicyService`** ⇒ bất biến AND-across-links chỉ áp cho đường TẢI, không áp cho đường LIỆT KÊ. Hệ quả: sau khi `hr` gắn CV vào một nhân viên qua HR-API-801 (KI-d), recruiter vẫn THẤY `originalName` ở tab CV nhưng bấm Tải ăn 403 — **lệch pha list↔download**, KHÔNG rò thêm dữ liệu (recruiter đã thấy tên tệp đó từ trước) | Reviewer tự khuyến nghị **không** vá ở đây: gọi policy per-row sẽ ẩn tệp khỏi chính người sở hữu luồng và nhân N call mỗi lần render — đúng lớp `reviewer-proposed-fix-can-open-holes`. Gộp vào WO đóng **KI-b/KI-d** |
| LOW | `confirm` trả 403 owner-mismatch **không để vết** (`file_access_logs`/`audit_logs`), trong khi link và download đều có `logDeny` | Chép nguyên văn `ChatFilesService.confirmOwnUpload:89-91` đã qua FULL gate ⇒ nhất quán, không phải hồi quy. Vá đúng = thêm `logDeny` (không mở lỗ mới) nhưng nên làm CÙNG hai wrapper kia, không lệch một mình |
| LOW | `s12-recruit-qa1-permission-matrix` mục B dùng `.not.toBe(403)` ⇒ **500 vẫn xanh** cho 3 route POST mới | Khẳng định yếu CÓ SẴN của spec đó, nay nhân thêm cho 5 route vùng đỏ. Đường phủ thật đã có: `s14-recruit-filegrant1-cv` A2/L4/F2/G2 assert **mã 2xx cụ thể**. Siết mục B là đổi bảng dùng chung cho cả 33 route ⇒ WO riêng |
| LOW | Khối (4b) của `0569` là **bất biến TOÀN CỤC mới** lúc migrate: WO sau cấp wildcard cho role hệ thống sẽ làm `db:migrate` chết TẠI 0569 và chặn mọi migration kế tiếp | Đã đo: `0565:463-482` đang ship một phiên bản **rộng hơn** ⇒ 0569 không thể đỏ ở nơi 0565 xanh, trừ ca role hệ thống tên đúng `super-admin` (hiện không dựng được — bootstrap tạo role company-scoped). Ghi để không ai ngạc nhiên |
