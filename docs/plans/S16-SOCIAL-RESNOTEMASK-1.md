# S16-SOCIAL-RESNOTEMASK-1 — `SOCIAL-API-028` che `resolutionNote` bằng `null` theo ĐÚNG vị từ đang che `reporter` (D13-a / SOC-DEC-011)

> Trạng thái: **plan v2 (17/10/2026)** — v1 `33ad41c1` + vá plan-review PASS_WITH_FIXES (11 finding F1–F11, xử lý ở §9.3).
> Đo tĩnh trên `b5340079` (worktree `MediaOS-qa1`, nhánh `fix/s16-social-resnotemask-1`).
> Zone ĐỎ · FULL gate · KHÔNG migration · KHÔNG dependency · KHÔNG đổi repository/SQL · KHÔNG đổi HÌNH DẠNG DTO (chỉ đổi ngữ nghĩa
> một trường vốn đã nullable) ⇒ **MỘT PR** (§5).
> Nguồn: mục WO `S16-SOCIAL-RESNOTEMASK-1` (`harness/backlog.mjs:19038`) · finding SEC-01 của gate security PR-A
> `S16-SOCIAL-FE-3` (`docs/plans/S16-SOCIAL-FE-3.md:693, :716-721`) · SOC-DEC-011 (`docs/SPEC/SPEC-16 SOCIAL.md:618`).
> Thẩm quyền: owner chọn «Làm tới khi mở PR (Recommended)» qua AskUserQuestion ~09:18 ngày 17/10 (đã đối chiếu lại bằng lệnh chỉ-đọc
> trên transcript phiên chính lúc lập plan), trong khung ngân sách 16/10 (WO đỏ ≤ 400 USD; ước WO này 150–280 USD).
> Hook ECC in «COST CRITICAL» với tổng ảnh chụp luỹ kế — không phải chi phí thật; owner đã thấy con số đó khi chọn.
> **Kho PUBLIC:** plan/commit/PR mô tả bất biến + cách che + phép đo, KHÔNG nêu dữ liệu PROD, KHÔNG viết công thức khai thác.
> Merge = công bố ⇒ owner deploy API **trong ngày merge** (§8 O3).

Viết tắt: `S/` = `apps/api/src/social/` · `T/` = `apps/api/test/` · `C/` = `packages/contracts/src/` · `M/` =
`apps/app/src/routes/social/moderation/components/` · «vị từ» = `SocialAccessService.isCompany(actor.routeScope)` ·
«028» = `GET /social/reports` · «029» = `PATCH /social/reports/:id`.

## 1. Bối cảnh + phép đo

- [ĐO] `S/social-reports.service.ts:144` (028) và `:309` (029) tính `revealReporter = SocialAccessService.isCompany(actor.routeScope)`;
  `S/social-access.service.ts:427-429`: `isCompany(scope) = scope === "Company" || scope === "System"`. Đây là **nguồn luật DUY NHẤT**
  của D13-a (docblock `S/social-reports.service.ts:592-596` cấm thay bằng `scope !== null`).
- [ĐO] Cả hai route đi qua MỘT hàm `toReportDto(r, revealReporter, avatars)` (`:597`, gọi ở `:157` và `:320`). Bên trong: `reporter`
  che theo cờ (`:620-622`), nhưng `note: r.note` (`:624`) và `resolutionNote: r.resolutionNote` (`:631`) trả nguyên văn ở MỌI scope.
- [ĐO] 028 là route `companyFloor:false`, `dataScope:"Department"` (`S/social-route-pairs.const.ts:207`
  `pair("view","feed-report", false, false)`); 029 sàn Company — chữ ký `pair(action, resourceType, tier1IsFloor = false,
companyFloor = true)` ở `:132-137`, `:227` `pair("manage","feed-report", true)` ⇒ `tier1IsFloor = true`, `companyFloor` mặc định
  `true` (service tự nhắc ở `:306-309`) ⇒ chỉ 028 với manager `view:feed-report@Department` là người đọc bị che.
- [ĐO] Manager Department chỉ thấy báo cáo của bài có `org_unit_id` trong tầm với: repository `:173-176`
  `inArray(rPost.orgUnitId, orgUnitIds)`; bài `audience:'company'` (`org_unit_id` NULL) bị loại (be1b N-D6-a `:369-372`).
- [ĐO] `resolutionNote` chỉ có ở: schema `apps/api/src/db/schema/social.ts`, `S/social-reports.repository.ts:78/:113` (select) ·
  `:355-364` (ghi) · `:452` (đặt `null`), service `:245` (ghi) + `:631` (đọc ra DTO). Không có trong payload NOTI
  (`S/social-noti.payload.ts` — docblock `:158-160` còn ra lệnh: đường đọc mới phải gác bằng CÙNG vị từ), không có ở thống kê 052/053,
  không có trong metadata audit (grep service chỉ ra `:245`, `:631`).
- [ĐO] Contracts `C/social-api-b.ts:365-394` (docblock) + `:404` `resolutionNote: z.string().nullable()` — khoá LUÔN có mặt, tập khoá
  ĐÓNG (ca H5-keys). `C/social.ts:220` là schema lõi bảng (`feedReportCoreSchema`), không phải DTO đọc — không đổi.
- [ĐO] FE: `M/ReportRow.tsx:131` vẽ khối ghi chú chỉ khi `resolutionNote !== null`; `:194-195` vẽ «Ẩn theo phạm vi xem của bạn» khi
  `reporter === null`. `M/ResolveReportDialog.tsx:279-288` luôn có `warning` ở ô ghi chú; chữ ở
  `apps/app/src/i18n/locales/vi/social-admin.ts:237-238` khẳng định ghi chú «hiện nguyên văn … kể cả người không được thấy tên người
  báo cáo» — sẽ SAI sau bản vá. Spec FE ghim chữ này: `M/ResolveReportDialog.spec.tsx:51`, chú thích `:150-151`.
- [ĐO] Int-spec có sẵn: `T/integration/social-be1b-reports.int-spec.ts` (817 dòng — đã vượt 800, KHÔNG thêm vào; có khuôn đơn vị X/Y +
  manager Department `:97-190`, ca D13-a `:433-490`) · `social-be3a-report-actions.int-spec.ts` (khuôn `applyMainPipeline` `:30, :212`) ·
  `s16-social-qa1-input-ctrl.int-spec.ts:177-184` (trần độ dài `resolutionNote`, không đổi). Không ca nào assert manager thấy
  `resolutionNote` ⇒ bản vá không làm đỏ ca cũ [SUY RA từ grep `resolutionNote` trên `T/`].

## 2. Quyết định owner đã có

- **SOC-DEC-011 / D13-a** (owner ký 22/09/2026): danh tính người tố giác chỉ lộ ở scope Company; khoá `reporter` có mặt, che bằng `null`.
  Văn bản quyết định ghi rõ **phạm vi là `reporter`, KHÔNG phải `note`** — chữ do chính người tố giác viết vẫn trả cho mọi người đọc
  hàng đợi; nợ FE = cảnh báo lúc soạn báo cáo (đã có ở `ReportDialog`).
- WO này (seed 05/10 từ gate FE-3, owner duyệt seed) mở rộng việc che sang `resolutionNote`: chữ do NGƯỜI THỨ BA (HR) viết về báo cáo,
  người tố giác không kiểm soát được ⇒ khác bản chất với `note`.
- Owner 17/10: làm tới khi mở PR.
- Luồng chính chốt sau plan-review (17/10): **O1 = KHÔNG che `note`** (SOC-DEC-011 đã ký, SPEC-16:618 loại `note` khỏi phạm vi che;
  ca A-4 ghim) — ghi trong PR để owner đổi nếu muốn. **O2 = KHÔNG sửa SPEC-16** (ngoài `paths`); API-19 + contracts mang luật.

## 3. Bất biến phải giữ

1. **Một vị từ:** `resolutionNote` lộ ⇔ `reporter` lộ ⇔ `isCompany(actor.routeScope)`. Không biểu thức thứ hai, không đọc `scope` ở chỗ khác.
2. **Tập khoá đóng:** khoá `resolutionNote` LUÔN có mặt (che = `null`, không xoá khoá, không `.optional()`).
3. **HR / company-admin (Company) thấy đủ** ở 028 và 029 — trách nhiệm giải trình giữ nguyên.
4. **Dữ liệu không đổi:** cột `resolution_note` vẫn được ghi đủ; không migration; RLS/`company_id` không đụng.
5. **Không lộ sự tồn tại:** người bị che không phân biệt được «không có ghi chú» với «bị che» (không cờ, không độ dài).
6. `note` giữ nguyên hành vi theo SOC-DEC-011 (đã chốt O1 = không che; owner có thể đổi sau — §8 O1).

## 4. Thiết kế

**4.1 Vị trí che.** MỘT dòng trong `toReportDto` (`S/social-reports.service.ts:631`):
`resolutionNote: revealReporter ? r.resolutionNote : null`. Dùng LẠI đúng tham số `revealReporter` mà `reporter` dùng — tham số này đã
được tính từ vị từ ở `:144`/`:309` và cố ý không có giá trị mặc định (`:592-596`). Bất biến «một vị từ» được ghim thêm bằng structure spec S-1 (§6, ★6):
một biểu thức `isCompany(…)` thứ hai cho cùng hành vi HTTP nên không ca int-spec nào bắt được. Cập nhật docblock `:585-596`: tham số này gác MỌI
trường danh tính-hoặc-có-thể-lộ-danh-tính (`reporter`, avatar người tố giác, `resolutionNote`). Đổi tên tham số (vd `revealReporterIdentity`)
là tuỳ chọn, KHÔNG làm ở WO này (diff tối thiểu cho gate).

Không che ở repository (vẫn SELECT cột): khớp cách `reporter` đang che ở tầng DTO; đổi SQL kéo thêm `database-reviewer` mà không thêm
an toàn (DTO là cửa ra duy nhất — §1 đã đo không có đường đọc khác).

**4.2 `null` hay cờ đã-che — CHỌN `null`.**

| Tiêu chí                                    | `null` (chọn)                                                                                                            | Cờ `resolutionNoteMasked`                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Hình dạng DTO                               | Không đổi (khoá có sẵn, đã nullable)                                                                                     | Thêm khoá vào tập khoá ĐÓNG ⇒ đổi contracts + ca H5-keys                              |
| Cửa sổ FE (Pages tự lên) ↔ API (deploy tay) | Tương thích hai chiều: FE cũ/mới đều đã ẩn khối khi `null` (`:131`)                                                      | Theo luật kho phải tách BE → deploy → FE (≥ 2 PR) hoặc dùng `.optional()` (trái §3.2) |
| Lộ sự tồn tại ghi chú                       | Không (§3.5)                                                                                                             | Lộ nếu cờ chỉ bật khi có ghi chú                                                      |
| FE «vẽ đúng trạng thái đã-che»              | Đã đúng: không vẽ khối rỗng; trạng thái che đọc từ `reporter === null` (cùng vị từ, đã vẽ «Ẩn theo phạm vi xem của bạn») | Cần thêm nhánh vẽ                                                                     |

Hệ quả cho contracts: chỉ docblock (`C/social-api-b.ts:370-372` + một gạch đầu dòng mới): «`resolutionNote` là `null` khi
`reporter === null` (cùng vị từ D13-a), bất kể hàng có ghi chú hay không». Không đổi schema Zod.

**4.3 `note` (lời người báo cáo).** [ĐO] cũng trả nguyên văn khi `reporter` bị che — nhưng đó là **quyết định đã ký** (SOC-DEC-011),
không phải lỗ. **Đã chốt (O1): KHÔNG che**; thêm ca ghim (A-4) để mutant «che quá tay» bị giết. Body PR ghi rõ lựa chọn này để owner
đổi nếu muốn — khi đó (WO tiếp/vòng sau): cùng tham số `revealReporter`, A-4 đổi thành ca DENY, sửa câu tương ứng trong SOC-DEC-011
(cần thêm `docs/SPEC/**` vào `paths`).

**4.4 FE (cùng PR, chỉ chữ + spec).** Không đổi logic vẽ. (a) Chữ cảnh báo `social-admin.ts:237-238` đổi thành câu ĐÚNG ở cả trước lẫn
sau deploy API: «Ghi chú này được lưu lại và có thể hiện cho người khác xem hàng đợi báo cáo. Đừng nêu tên hay chi tiết giúp nhận ra
người báo cáo.» — GIỮ dòng cảnh báo (done_when). (a') Viết lại chú thích mã `social-admin.ts:235-236` (đang khẳng định hành vi cũ «vẽ
nguyên văn cho MỌI người đọc hàng đợi»): ghi chú xử lý che theo CÙNG vị từ với `reporter`; vẫn giữ cảnh báo vì người ở scope Company
khác (company-admin, HR khác) vẫn đọc được và vì cửa sổ FE lên trước API. (b) Sửa chú thích `ResolveReportDialog.tsx:279-280` +
`ResolveReportDialog.spec.tsx:51, :150-151` theo chữ mới. (c) Ca ghim F-1 ở `M/ReportRow.spec.tsx` (§6).

## 5. Triển khai — MỘT PR

Tệp đổi: `S/social-reports.service.ts` (1 dòng + docblock) · `T/integration/s16-social-resnotemask-1.int-spec.ts` (MỚI) ·
`S/social-reports-mask-structure.spec.ts` (MỚI, ★6 — F10) · `C/social-api-b.ts` (docblock) ·
`docs/API Design/API-19_SOCIAL_API_Design.md` (hàng 028 `:96`; ghi chú phản hồi 029 quanh `:266`) ·
`apps/app/src/i18n/locales/vi/social-admin.ts` · `M/ResolveReportDialog.tsx` (chú thích) · `M/ResolveReportDialog.spec.tsx` ·
`M/ReportRow.spec.tsx` (+ unit spec `toReportDto` nếu §7 F5 đo thiếu).

`paths` của WO ở v1 KHÔNG phủ tệp i18n (`apps/app/src/i18n/locales/vi/social-admin.ts` ngoài mọi glob) ⇒ **L0** (§7) thêm ĐÚNG một path
đó vào mục WO trong `harness/backlog.mjs` (commit `chore(docs)` riêng, chỉ tệp backlog) TRƯỚC L1. Không thêm glob rộng (tránh hai WO
chung glob ⇒ ledger start-on-touch đóng dấu nhầm). Sau L0, mọi tệp trên nằm trong `paths`.

Thứ tự lên PROD: merge → FE lên Pages tự động (chỉ đổi chữ, tương thích) → owner `m prod-update api` **cùng ngày** (§8). Trong cửa
sổ giữa merge và deploy API, hành vi PROD = hiện trạng (không xấu hơn), chữ cảnh báo mới vẫn đúng.

## 6. Ca test viết TRƯỚC (TỪ CHỐI đứng cạnh CHO PHÉP) + mutant ★

Int-spec MỚI `T/integration/s16-social-resnotemask-1.int-spec.ts`: dựng app bằng `applyMainPipeline(moduleRef.createNestApplication())`
(`T/helpers/bootstrap-app.ts:34`; ratchet `T/foundation/pipeline-parity-census.ts`), `await app.listen(0)` ngay sau `init()`
(`T/foundation/supertest-listen-census.ts`), gate `describe.skipIf(!(hasDb && LANE_DB))`. Khuôn seed: đơn vị X/Y + `makeMember(…, scope)`
từ be1b `:97-190`; khuôn 029 từ be3a. Chuỗi đánh dấu (`note` = N, `resolutionNote` = R) sinh lúc chạy từ `randomUUID()` — không literal
(luật gitleaks CLAUDE.md §5).

Fixture: tenant A — đơn vị X, Y; bài X `audience:'org_unit', orgUnitId: X`, bài Y `audience:'org_unit', orgUnitId: Y` (khuôn be1b
`:82-84`, `:199-200` — bài `audience:'company'` bị scopeCondition loại khỏi tầm manager, §1); người báo cáo E ở X (`view:feed`); `hr`
(Company: `view`+`manage:feed-report`, `manage:feed-post`); `company-admin` (Company `view:feed-report`); `mgrX`, `mgrY` =
`makeMember(A, …, MODERATOR, hash, unitX | unitY, "Department")` (chép từ be1b `:135-194`) với `view:feed-report@Department`.
Báo cáo về bài X (E gửi với `note` = N, HR xử lý qua 029 với `resolutionNote` = R) + báo cáo về bài Y (HR xử lý qua 029 với
`resolutionNote` = R_Y). Tenant B — `hrB` (Company) + một báo cáo của B (neo dương). N, R, R_Y sinh từ `randomUUID()`.

| Ca     | Người đọc / route                         | Kỳ vọng                                                                                                                                                                                                     | Mã cũ         |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D-1 ★  | `mgrX` 028 (cả `?status=resolved`)        | Thấy hàng X (neo dương) · `reporter === null` · `resolutionNote === null` · khoá có mặt · body không chứa R                                                                                                 | **ĐỎ**        |
| D-1b ★ | `mgrX` 028, MỌI hàng                      | Neo trên CHÍNH phản hồi: phản hồi có ≥ 1 hàng `status === 'resolved'` và với id hàng đó `direct` đo `resolution_note IS NOT NULL`; SAU ĐÓ mới assert mọi hàng `reporter === null ⇒ resolutionNote === null` | **ĐỎ**        |
| D-2 ★  | `mgrY` 028 (ngoài đơn vị X)               | Thấy hàng Y (neo dương) · `reporter === null` · `resolutionNote === null` · body không chứa R_Y; VÀ không có id hàng X, body không chứa R                                                                   | **ĐỎ**        |
| D-3    | `hrB` 028 (cross-tenant)                  | Hàng đợi B không rỗng (neo dương: thấy hàng của B); không id hàng X; body không chứa R                                                                                                                      | xanh          |
| A-1    | `hr` 028                                  | `resolutionNote === R` · `reporter` khác `null`                                                                                                                                                             | xanh          |
| A-2    | `company-admin` 028                       | `resolutionNote === R`                                                                                                                                                                                      | xanh          |
| A-3    | `hr` 029 (phản hồi PATCH)                 | `resolutionNote === R` (029 dùng tham số tính ở `:309`)                                                                                                                                                     | xanh          |
| A-4    | `mgrX` 028 — ghim SOC-DEC-011             | `note === N` (không che `note`; đổi thành DENY nếu O1 = che)                                                                                                                                                | xanh          |
| F-1    | `M/ReportRow.spec.tsx`                    | `reporter:null` + `resolved` + `resolvedBy` + `resolutionNote:null` ⇒ có «Ẩn theo phạm vi…», có người xử lý, KHÔNG `report-resolution-note`                                                                 | xanh          |
| F-2    | `M/ResolveReportDialog.spec.tsx`          | Cảnh báo vẫn là mô tả trợ năng đầu tiên, chữ mới                                                                                                                                                            | đỏ → sửa hằng |
| S-1 ★6 | `S/social-reports-mask-structure.spec.ts` | Đọc nguồn `toReportDto` (khuôn `S/social-avatar-sign-structure.spec.ts`): thân hàm KHÔNG gọi `isCompany`; dòng `resolutionNote:` tham chiếu `revealReporter`                                                | xanh (ghim)   |

D-1/D-1b/D-2 ĐỎ thật trên mã cũ — phủ hai vế «manager Department trong đơn vị» và «ngoài đơn vị» của done_when. Vế **cross-tenant (D-3)
KHÔNG THỂ RED**: RLS + `company_id` đã chặn hàng của A với `hrB` từ trước bản vá, nên ca đo phạm vi hàng chứ không đo việc che. Vế này
được thoả bằng lưới đứng cạnh có neo dương (`hrB` thấy hàng của B) — ghi rõ trong PR, không giả RED. A-\* là ca CHO PHÉP đứng cạnh.
Unit spec service: KHÔNG thêm mặc định (`toReportDto` module-private, service nhiều phụ thuộc; int-spec là bằng chứng quyết định) —
TRỪ KHI phép đo coverage ở §7 (F5) cho thấy nhánh mới không phủ ⇒ thêm unit spec rẻ phủ cả hai nhánh.

Mutant (L4, script cấy-chạy-khôi phục, neo khớp đúng 1 lần, cây sạch sau mỗi lượt):

| #   | Cấy                                                                                                  | Phải bị giết bởi                       |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| ★1  | Bỏ che: `resolutionNote: r.resolutionNote`                                                           | D-1, D-1b, D-2                         |
| ★2  | Vị từ sai ở `:144`: `actor.routeScope !== null`                                                      | D-1, D-2 (+ ca D13-a be1b `:433`)      |
| ★3  | Che quá tay: `note: revealReporter ? r.note : null`                                                  | A-4                                    |
| ★4  | Đảo nhánh: `revealReporter ? null : r.resolutionNote`                                                | A-1, A-2, A-3                          |
| ★5  | Che bằng bỏ khoá (spread có điều kiện)                                                               | typecheck (`FeedReportDto`) / D-1 khoá |
| ★6  | Chép điều kiện: dòng `resolutionNote` dùng biểu thức `isCompany(…)` thứ hai thay vì `revealReporter` | S-1 (structure spec)                   |

Tương đương không đo được qua HTTP (ghi nhận): `System` ≡ `Company` (không có fixture System); hạ sàn 029 (do `social-route-pairs`
gác, ngoài diff).

## 7. Lát thi công · verify · gate

- **L0 paths** — thêm ĐÚNG `apps/app/src/i18n/locales/vi/social-admin.ts` vào `paths` của mục WO trong `harness/backlog.mjs`; prettier;
  test id-uniqueness của harness xanh. Commit `chore(docs): …` CHỈ tệp backlog (F4).
- **L1 RED** — int-spec mới + F-1 + S-1 + sửa hằng F-2 theo chữ mới (chưa đổi chữ i18n ⇒ F-2 đỏ). Lane `mediaos_resmask` đã dựng sạch
  (chỉ `lane-db-setup --reset` nếu lane hỏng, ghi lý do). Chạy đúng tệp:
  `LANE_DB=mediaos_resmask pnpm --filter @mediaos/api exec vitest run <đường dẫn tương đối apps/api>` (KHÔNG `pnpm test -- <path>` —
  chạy cả suite; KHÔNG chạy int-spec thiếu `LANE_DB`). Ghi số đỏ đúng lý do (D-1/D-1b: `resolutionNote` = R; D-2: = R_Y).
  Commit `test(social): …`.
- **L2 GREEN BE** — dòng `:631` + docblock `:585-596`. D-1/D-1b/D-2 xanh, S-1 xanh, ca be1b/be3a/qa1 liên quan xanh.
  **Coverage (F5):** `social/` đo bằng script `test:cov:social` (`apps/api/package.json`) — script chỉ ĐO, không gate; cổng ngưỡng
  thật duy nhất của module là khoá `src/social/social-access.service.ts` trong `vitest.config.ts` (90/90/85/90), ratchet
  `T/foundation/coverage-thresholds-ratchet.unit-spec.ts` chỉ kiểm khoá trỏ tệp có thật. Script CÓ tính int-spec (cần `LANE_DB`) và đã
  gồm be1b-reports + be3a-report-actions; int-spec mới nằm ở `T/integration/` nên KHÔNG vào script (sửa `package.json` ngoài `paths`) —
  nhánh `: null` mới được be1b D13-a (`:433`, manager Department đọc 028 có hàng) phủ. Đo đích, TRƯỚC (trên commit L1) và SAU (L2):

  ```bash
  LANE_DB=mediaos_resmask pnpm --filter @mediaos/api exec vitest run \
    test/integration/social-be1b-reports.int-spec.ts \
    test/integration/social-be3a-report-actions.int-spec.ts \
    test/integration/s16-social-resnotemask-1.int-spec.ts \
    --coverage --coverage.include='src/social/social-reports.service.ts' --coverage.reporter=text
  ```

  ⇒ ghi % lines/branches của `social-reports.service.ts` vào sổ vết. Ở Verify chạy thêm `test:cov:social` đủ (lane) để xác nhận cổng `social-access.service.ts`
  không đỏ; nếu KI-014 (`ERR_IPC_CHANNEL_CLOSED`) giết lượt một-lần thì ghi lại, dựa trên phép đo đích. Nhánh `: null` không phủ
  hoặc branches giảm ⇒ thêm unit spec rẻ cho `toReportDto` phủ cả hai nhánh. Commit `fix(social): …`.

- **L3 contracts + docs + FE chữ** — docblock `C/social-api-b.ts`; API-19 hàng 028 thêm «`resolutionNote` = `null` cùng vị từ với
  `reporter`»; i18n `:235-238` (cả chú thích mã — F8) + chú thích FE. Typecheck contracts/api/app + spec moderation xanh.
- **L4 mutant** — 6 mutant §6, kỳ vọng 6/6 bị giết đúng ca.
- **FULL gate** (song song, chỉ đọc, có trần lượt): `security-reviewer` (câu hỏi: còn đường đọc `resolution_note` nào ngoài DTO? vị từ
  có đúng một nguồn? 029 có thể nhận actor < Company không?) + `silent-failure-hunter` + `typescript-reviewer` (gộp góc React: FE chỉ
  đổi chữ/chú thích/spec, không đổi logic vẽ — nên không chạy `react-reviewer` riêng; ghi vào PR). `quality-gate` =
  `bash harness/check.sh --all --lane-db=resmask` + `pnpm exec prettier --check` trên tệp đổi. `database-reviewer`: **N/A — lệch có chủ ý**
  khỏi danh sách FULL gate của CLAUDE.md §6, vì diff không chạm repository/SQL/migration; ghi vào PR.
- **santa-method — MẶC ĐỊNH CHẠY** một vòng có trần lượt (F2): service tự gắn nhãn CROWN-JEWEL (`S/social-reports.service.ts:58`),
  CLAUDE.md §6 đòi santa cho logic crown-jewel. Hai reviewer độc lập hội tụ trên đúng ba mệnh đề: «một vị từ» · «không đường đọc thứ hai
  của `resolution_note`» · «029 không nhận actor < Company». Owner chỉ được bỏ bằng miễn trừ ghi rõ (O4), chép vào body PR.
- **Vá** finding CRITICAL/HIGH; MEDIUM sửa nếu rẻ, còn lại thành nợ có WO.
- **Verify** — `bash harness/check.sh --all --lane-db=resmask` (Windows tự dùng chunk runner KI-014; `--all` exit 1 nếu int-spec bị skip
  quá ngưỡng). Nếu luồng khác đang chạy lệnh nặng: giữ khoá chung kiểu `heavy.lock` (memory two-chain-build-with-heavy-lock). gitleaks:
  bước `secret-literals` của check.sh + quét net diff nhánh so với `origin/master`.
- **PR** — tiêu đề trung tính «fix(social): S16-SOCIAL-RESNOTEMASK-1 — ghi chú xử lý báo cáo theo cùng phạm vi che người báo cáo (028)»;
  body: bất biến + phép đo + bảng ca, không mô tả cách khai thác; mục [OWNER] deploy ở đầu. KHÔNG tự merge.

## 8. Bảng [OWNER]

| #   | Việc / câu hỏi                                                                                                                                  | Mặc định nếu không trả lời                                                                                  | Chặn?              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
| O1  | Che cả `note` (đổi SOC-DEC-011)?                                                                                                                | **Đã chốt 17/10: KHÔNG** — giữ quyết định đã ký (SPEC-16:618); A-4 ghim; ghi trong PR để owner đổi nếu muốn | Không              |
| O2  | Nối một câu vào SOC-DEC-011 (SPEC-16, ngoài `paths`) ghi việc che `resolutionNote`?                                                             | **Đã chốt 17/10: KHÔNG sửa SPEC-16**; API-19 + contracts mang luật                                          | Không              |
| O3  | Merge PR rồi deploy API **ngay trong ngày**: pull checkout chính → `m prod-update api` (lệnh này không pull, không cài deps; WO không đổi deps) | Bắt buộc — merge mà chưa deploy = công bố khi PROD còn hở                                                   | **Có** (sau merge) |
| O4  | Bỏ `santa-method`?                                                                                                                              | KHÔNG bỏ — santa CHẠY một vòng có trần (§7); bỏ chỉ khi owner miễn trừ ghi rõ, chép vào PR                  | Không              |

**Bằng chứng deploy (đo, không tin lời «đã deploy» — memory owner-says-deployed-measure-first).** WO không có migration ⇒
`migrationHead` của `/health` KHÔNG đổi giữa trước/sau deploy, nên `/health` chỉ dùng để kiểm SỐNG.

- **S2 — bằng chứng CHÍNH** (trên máy PROD, checkout chính — PROD chạy từ dist của checkout chính): (a) `git rev-parse HEAD` của checkout
  chính = SHA merge; (b) grep tệp dist `apps/api/dist/social/social-reports.service.js` (đường dẫn tương đối checkout chính, đã đo tồn tại
  17/10) thấy biểu thức che `resolutionNote: revealReporter ? r.resolutionNote : null` và KHÔNG còn `resolutionNote: r.resolutionNote`
  (hiện trạng đo 17/10: chuỗi cũ có mặt đúng 1 lần); (c) phụ: trường `commit` của `apps/api/dist/build-info.json` = SHA merge.
- **S1 — kiểm sống:** `GET /api/v1/health` 200 sau khi tiến trình API khởi động lại.
- **S3** (tuỳ chọn, tài khoản HR có sẵn): màn Kiểm duyệt vẫn hiện ghi chú xử lý ở hàng đã xử lý — không hồi quy chiều CHO PHÉP. Chiều
  TỪ CHỐI đã đo bằng D-1/D-1b/D-2 trên lane DB; không dựng tài khoản manager trên PROD để thử.

## 9. Ngoài phạm vi / nợ · rủi ro + đường lùi

- Ngoài phạm vi: đổi tên tham số `revealReporter`; che ở tầng SQL; huy hiệu/chỉ báo «ghi chú bị ẩn» trên FE (cố ý không có — §3.5);
  `S16-SOCIAL-FEMODSCOPE-1` (cổng FE kiểm sàn scope) và `S16-SOCIAL-FEMODINVAL-1` là WO riêng.
- Rủi ro: (a) manager mất ngữ cảnh xử lý — chấp nhận, cùng lý do che `reporter`; (b) ca D-3 cross-tenant phụ thuộc seed B có báo cáo — thiếu
  thì «rỗng xanh» ⇒ assert neo dương bắt buộc; (c) cửa sổ merge→deploy — O3.
- Đường lùi: revert một commit `fix(social)` (dữ liệu không đổi, DTO cùng hình dạng) ⇒ `m prod-update api`; FE chỉ đổi chữ, không cần lùi.
- Nợ từ FULL gate + santa (17/10, LOW — không chặn PR):
  - **SEC-L1** — SPEC-16 SOC-DEC-011 (nguồn sự thật) chưa ghi luật che `resolutionNote`; API-19 + contracts mang luật (O2: owner chốt
    không sửa SPEC-16 trong WO này). Đề xuất một WO docs-only nối một câu vào SOC-DEC-011: «`resolutionNote` (chữ người xử lý) che bằng
    `null` theo CÙNG vị từ với `reporter` (S16-SOCIAL-RESNOTEMASK-1); `note` không che.» — ghi trong thân PR cho owner. Chú thích
    «đường duy nhất» ở `social-noti.payload.ts` đã cập nhật trong WO. Đường đọc MỚI không qua `toReportDto` vẫn chỉ được gác bằng
    review — S-1d/S-1e chỉ ghim tệp service hiện có.
  - **F2 (typescript)** — `toReportDtoBody()` đếm ngoặc + bỏ comment bằng regex (khuôn `social-avatar-sign-structure.spec.ts`); chuỗi
    chứa `{`/`}` trong thân hàm ⇒ ĐỎ GIẢ (lộ ngay, không im lặng). Nâng lên parse AST (`ts.createSourceFile`) khi có lần vỡ thật.
  - **F3 (typescript)** — S-1c chỉ ghim tiền tố `field: revealReporter`, cố ý không ghim hình dạng ba ngôi; đảo nhánh / `||` bị A-1…A-3
    và D-1 bắt ở tầng hành vi.

### 9.3 Sổ vết

| Bước        | Ngày       | Kết quả                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan v1     | 17/10/2026 | `33ad41c1`, trên `b5340079`. Đối chiếu mã §1; chốt `null` + MỘT PR; `note` giữ theo SOC-DEC-011 (O1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Plan-review | 17/10/2026 | PASS_WITH_FIXES — 2 HIGH · 5 MEDIUM · 4 LOW, áp cả 11 theo đúng fix reviewer: **F1** D-2 thành RED thật (mgrY + R_Y qua 029; vẫn assert không id X / không R); D-3 cross-tenant ghi rõ không thể RED do RLS, thoả bằng lưới đứng cạnh + neo dương `hrB` (§6) · **F2** santa MẶC ĐỊNH CHẠY một vòng có trần, hội tụ trên ba mệnh đề (§7, O4) · **F3** neo D-1b trên chính phản hồi (§6) · **F4** L0 thêm đúng path i18n vào WO, commit `chore(docs)` riêng (§5, §7) · **F5** lệnh đo coverage `social/` + số trước/sau; thiếu ⇒ unit spec `toReportDto` (§7 L2) · **F6** bằng chứng deploy CHÍNH = grep dist + HEAD checkout chính; `/health` chỉ kiểm sống (§8) · **F7** fixture bài `audience:'org_unit'` + `makeMember(…, "Department")` (§1, §6) · **F8** chú thích i18n `:235-236` vào L3 (§4.4) · **F9** quality-gate = `check.sh --all` + prettier; React gộp vào typescript-reviewer; database-reviewer N/A = lệch có chủ ý (§7) · **F10** structure spec S-1 / mutant ★6 (§4.1, §6) · **F11** trích dẫn `pair(…)` `:132-137` + `:227` (§1). Luồng chính chốt O1 = không che `note`, O2 = không sửa SPEC-16 (§2). |
| L0          | 17/10/2026 | `ba177920` (`chore(docs)`, chỉ `harness/backlog.mjs`): thêm ĐÚNG path `apps/app/src/i18n/locales/vi/social-admin.ts` vào WO (F4); id-uniqueness 19/19                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| L1 RED      | 17/10/2026 | `0a584fec` trên lane `mediaos_resmask`, mã CŨ: int-spec mới + structure spec 5 đỏ · 8 xanh (13). Đỏ đúng lý do: D-1 ×2 (mặc định + `?status=resolved`) và D-1b «expected 'r-<uuid>' to be null» (neo dương trên phản hồi đạt trước) · D-2 «expected 'ry-<uuid>' to be null» (mgrY vẫn thấy hàng Y) · S-1c (dòng `resolutionNote` không tham chiếu `revealReporter`). Xanh như plan: D-3 (RLS — không thể đỏ, thoả bằng lưới đứng cạnh + neo hrB) · A-1…A-4 (A-4: `note` nguyên văn theo SOC-DEC-011) · S-1a/S-1b. Lệch bảng §6: S-1c đỏ thật trên mã cũ (đúng, vì dòng cũ không dùng tham số)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| L2 GREEN    | 17/10/2026 | `c9af6c5c`: một dòng `resolutionNote: revealReporter ? r.resolutionNote : null` trong `toReportDto` + docblock. Lane: be1b-reports + be3a-report-actions + int-spec mới 59/59 · qa1-input-ctrl + 2 structure spec 41/41 · typecheck api · eslint/prettier sạch. Coverage `social-reports.service.ts` (F5): trước Stmts 96.17 / Branch 89.13 → sau 96.18 / 89.36, cả hai nhánh ba ngôi được chạy ⇒ không cần unit spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| L3          | 17/10/2026 | `a776ed5d`: contracts docblock (schema Zod KHÔNG đổi) · API-19 hàng 028 + §5.1h · i18n `noteWarning` viết lại đúng cả trước lẫn sau deploy + chú thích :235-236 (F8) · ResolveReportDialog chú thích + hằng spec · ca ghim F-1 ở ReportRow.spec. Contracts build · `vitest run src/routes/social/moderation` 423/423 · typecheck app · eslint sạch. API-19 vốn đã lệch prettier từ trước (diff prettier 482 dòng ở cả HEAD lẫn sau sửa) — không định dạng lại cả tệp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| L4 mutant   | 17/10/2026 | Script `<kept>/s16-social-resnotemask-1/bin/mutants-api.mjs` trên lane (nạp mật khẩu DB qua `scripts/lib/db-secrets.sh`, không in). **6/6 bị giết, khớp plan**, cây sạch sau mỗi lượt: ★1 bỏ che ⇒ D-1 ×2 · D-1b · D-2 · S-1c · ★2 vị từ sai ở 028 ⇒ D-1 ×2 · D-2 (+ D13-a của be1b) · ★3 che quá tay `note` ⇒ A-4 · ★4 đảo nhánh ⇒ A-1…A-3 · D-1 ×2 · D-1b · D-2 · ★5 bỏ khoá ⇒ typecheck TS2322 + D-1 · ★6 biểu thức thứ hai ⇒ S-1a + S-1c                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Gate        | 17/10/2026 | Song song, chỉ đọc, có trần lượt: `security-reviewer` PASS_WITH_FINDINGS (1 LOW) · `silent-failure-hunter` (3 LOW) · `typescript-reviewer` + góc React (3 LOW) · **santa A** PASS_WITH_FINDINGS (2 LOW) · **santa B** PASS — cả hai không BLOCK ⇒ hội tụ vòng 1. `database-reviewer` N/A (lệch có chủ ý: diff không chạm repository/SQL/migration). 0 CRITICAL/HIGH/MEDIUM. Vá `396f9991` (chỉ test + chú thích): S-1d ghim call-site không spread/ghi đè DTO · S-1e ghim mọi phép gán `revealReporter` = đúng vị từ · D-1b thêm neo vế «nếu» không rỗng — RED đo từng cái (gỡ vá ⇒ đúng ca đó đỏ); đổi tên biến che `it`. Nợ §9 (`b7fccdf6`): SEC-L1 SPEC-16 chưa ghi luật (owner O2 không sửa SPEC) · structure spec dùng heuristic → AST. Từ chối: skipIf lane (khuôn kho, check.sh ép) · che = vắng phân biệt được (cố ý). Review hẹp trên bản vá: PASS_WITH_FINDINGS 2 LOW (thêm dạng viết lọt structure spec — gộp vào nợ AST)                                                                                                                                                                                     |
| Verify      | 17/10/2026 | Trên đỉnh `b7fccdf6`: `bash harness/check.sh --all --lane-db=resmask` **XANH 9/9** (10:07→10:22): secret-literals · lint · typecheck · migration-no-drop · tooling-tests · test `LANE_DB=mediaos_resmask` chia chunk — api 853/853 · app 398/398 · contracts 45/45 · web-core 50/50 · ui 24/24 · console 22/22 · auth 4/4 tệp (api 6 lần chạy lại vì crash hạ tầng KI-014, 0 ca đỏ) · build · prod-tenant-check · db-readiness. gitleaks v8.30.1 trên 8 commit: no leaks. Diff 12 tệp, tất cả trong paths WO (sau L0); không chuỗi nhạy cảm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| PR          |            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
