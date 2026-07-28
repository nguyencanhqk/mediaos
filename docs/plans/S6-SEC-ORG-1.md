# S6-SEC-ORG-1 — KI-030: gate 3 route đọc `/org` đang lộ danh bạ toàn tenant

> Zone 🔴 · gate FULL (`security-reviewer` + `silent-failure-hunter`) · depends_on `S6-SEC-ROUTEMAP-1`
> (đã merge `6a614788`, PR #296) — WO này **đóng đúng 3 dòng `GAP`** mà sổ phán quyết đã ghi sẵn.

## 1. Vấn đề

`OrgController` khai ở docstring (`org.controller.ts:37`):

> *"READ (list/tree/members) GIỮ mở cho mọi user tenant — cơ cấu tổ chức không nhạy cảm"*

Câu đó đúng với **cơ cấu** (phòng ban, danh mục vai trò) nhưng sai với **người**. Ba route sau trả
dữ liệu về NGƯỜI mà không có `@UseGuards`/`@RequirePermission` nào:

| Route | Handler | Trả về |
| --- | --- | --- |
| `GET /org/employees` | `listEmployees` | `id · email · fullName · status` + team membership của **mọi user chưa xoá** trong tenant (`org.repository.ts:322`) |
| `GET /org/teams` | `listTeams` | toàn bộ team của tenant |
| `GET /org/teams/:id/members` | `listTeamMembers` | thành viên từng team |

Lệch rõ nhất khi đặt cạnh `/hr/employees` — **cùng lớp dữ liệu** nhưng đường HR ép `read:employee` +
`data_scope`, còn đường `/org` thì mọi user đăng nhập đều đọc được đủ danh bạ kèm email. Đây là
SEC-F04 / KI-030.

Vì sao lọt mọi cổng review: lưới `route-guard-coverage` bản cũ lọc `httpMethod !== "GET"` — nó **không
bao giờ nhìn route đọc**. `S6-SEC-ROUTEMAP-1` đã gỡ bộ lọc đó và ký sẵn 3 route này là `GAP` trỏ về WO
này (`route-verdicts.ts:283-287` `FROZEN_GAPS`).

## 2. Đo trước khi sửa — caller FE và ảnh hưởng PROD

### 2.1 Caller (grep 2026-07-27, toàn bộ `apps/*/src` + `packages/`)

| Route | `apps/console` | `apps/app` | Kết luận |
| --- | --- | --- | --- |
| `GET /org/employees` | `lib/org-api.ts:62` · `lib/rbac-api.ts:52` | — | **console-only** ⇒ siết được |
| `GET /org/teams` | `lib/org-api.ts:40` | — | **console-only** ⇒ siết được |
| `GET /org/teams/:id/members` | `lib/org-api.ts:52` | — | **console-only** ⇒ siết được |
| `GET /org/units/tree` | `lib/org-api.ts:37` | `routes/hr/org-chart/OrgChartPage.tsx` · `layouts/workspace/TaskSidebarTree.tsx` | **GIỮ MỞ** — siết là gãy UI mọi nhân viên |
| `GET /org/roles` | `lib/positions-api.ts:33` · `lib/rbac-api.ts:49` | — | **GIỮ MỞ** theo done_when #3 |

> **XÁC MINH LẠI ĐÍNH CHÍNH.** WO `src[]` nói báo cáo `S6-SEC-1` §7d ghi sai rằng `/org/teams` đang
> được `apps/app` dùng. Grep lại 2026-07-27 cho **0 caller** `/org/teams` trong `apps/app` ⇒ **đính
> chính ĐÚNG**, teams siết được. Hit duy nhất ngoài console là `packages/contracts/dist/**` (build
> artifact, không phải caller).

### 2.2 Cặp quyền — ĐỌC SEED, không phát minh

| Cặp | Có trong seed? | Nguồn |
| --- | --- | --- |
| `read:user` | ✅ | `0005_permissions.sql:205` |
| `read:team` | ✅ | `0005_permissions.sql:200`, tái khẳng định `0030_g5fix_org_team_perms.sql:28` |

Không cần migration seed cặp mới.

### 2.3 Ảnh hưởng PROD — đo trên DB thật (`mediaos`, company `funtime` = `257e5de2…`)

Grant hiện có (`role_permissions` ⋈ `permissions`, chỉ role còn sống):

| Cặp | Role có ALLOW | `data_scope` |
| --- | --- | --- |
| `read:user` | `company-admin` · `SA` · `project-manager` | `Company` |
| `read:team` | `company-admin` · `SA` · `hr-manager` | `Company` |
| `read:org_unit` | `company-admin` · `SA` · `hr-manager` | `Company` |

Ảnh hưởng trên 46 user của `funtime`:

| | Trước | Sau |
| --- | ---: | ---: |
| đọc được `/org/employees` | 46 | **6** |
| đọc được `/org/teams` + `/members` | 46 | **6** |

Phân bố role: `employee` ×45 · `SA` ×6 · `company-admin` ×1 (trùng người với SA). **40 user chỉ giữ
role `employee` sẽ mất quyền đọc 3 route này.** Cả 3 chỉ có caller ở `apps/console` (màn quản trị hệ
thống) ⇒ mất mát nằm đúng chỗ mong muốn.

### 2.4 Mạch lạc cặp quyền — role nào "ghi được mà đọc không được"?

Kiểm tra bắt buộc theo memory `read-path-gate-pair-must-match-download-pair`: gate đường ĐỌC bằng một
cặp khác cặp mà đường GHI đang dùng sẽ đẻ ra role làm được việc A nhưng không thấy dữ liệu để làm.
Quét toàn bộ role hệ thống:

| Role | `read:user` | `assign-role:user` | `read:team` | ghi team | Đánh giá |
| --- | :--: | :--: | :--: | :--: | --- |
| `company-admin` | ✅ | ✅ | ✅ | ✅ | mạch lạc |
| `SA` (tenant funtime) | ✅ | ✅ | ✅ | ✅ | mạch lạc |
| **`hr-manager`** | ❌ | ❌ | ✅ | ✅ | ⚠️ **LỆCH** |
| `project-manager` | ✅ | ❌ | ❌ | ❌ | mạch lạc (không quản team; `read:user` cấp cho việc giao task) |

**⚠️ Finding — `hr-manager` thiếu `read:user`.** Migration `0030_g5fix_org_team_perms.sql` §4 cố ý giao
`hr-manager` quyền quản trị `org_unit` + `team` ("HR quản trị cơ cấu tổ chức/đội nhóm — PRD ORG-002/003").
Sau khi gate, role này **quản trị team được nhưng không gọi được `GET /org/employees`** ⇒ ô chọn "trưởng
nhóm" và "thêm thành viên" ở console rỗng.

- **Ảnh hưởng sống: KHÔNG.** `hr-manager` hiện có **0 user** ở PROD (đo 2026-07-27).
- **Không vá trong WO này:** sửa đúng cách là backfill PER-PAIR (`read:user` → `hr-manager`,
  `data_scope = Company`) bằng migration, mà `migrations/**` **không nằm trong `paths`** của WO
  (memory `wo-paths-drive-gate-and-scheduler`: khai thiếu path ⇒ lọt gate + đụng số migration).
  Ghi lại thành việc kế tiếp thay vì lặng lẽ nới phạm vi.
- **Tuyệt đối không** đổi hướng sang gate `/org/employees` bằng `read:team` cho "khớp" — hai route trả
  hai lớp dữ liệu khác nhau; ghép cặp cho tiện chính là lỗi mà memory trên cảnh báo.

## 3. Quyết định thiết kế

**QĐ-1 — Gate bằng cặp CÓ THẬT trong seed, đặt THEO ROUTE.** `read:user` cho `/org/employees`;
`read:team` cho `/org/teams` + `/org/teams/:id/members`. `@UseGuards(PermissionGuard)` đặt **theo
route** (giống 100% các mutation đang có trong chính controller này) chứ không nâng lên cấp class —
nâng cấp class sẽ khiến `listOrgUnits` · `getOrgTree` · `listDepartmentsLegacy` · `listRoles` trả 403
vì `PermissionGuard` fail-closed khi route thiếu `@RequirePermission`.

**QĐ-2 — TUYỆT ĐỐI KHÔNG backfill grant.** `read:user`/`read:team` đã nằm ở đúng role quản trị với
`data_scope = Company`. Thêm grant cho `employee` là mở lại chính lỗ vừa vá. Ghi rõ ai mất quyền
(§2.3) thay vì im lặng nới. (memory `blanket-grant-migration-role-drift`: role sinh sau migration
`CROSS JOIN` bị hụt grant — ở đây **không có** vấn đề đó vì ta không thêm grant nào.)

**QĐ-3 — `/org/units/tree` + `/org/roles` giữ `TENANT_READ`, nhưng phải KÝ.** Cả hai ở lại sổ phán
quyết với lý do viết thành câu, và docstring controller phải nêu ranh giới **"cơ cấu ≠ người"** để lần
sau không ai suy diễn "read thì mở" thành luật chung.

**QĐ-4 — Docstring phải khớp code từng câu.** KI-034 là bài học "docstring nói một đằng code làm một
nẻo". Câu `org.controller.ts:37` và 2 comment `// Read stays open.` phải sửa cùng nhát với code.

**QĐ-5 — FE console không được vỡ thành lỗi trần.** Sau khi gate, `employee` mở `/system/org` sẽ nhận
403. Bọc phần đọc bằng `useCan("read","team")` / `useCan("read","user")` để hiện trạng thái "không có
quyền" — CLAUDE §5 (FE xử lý loading/error/empty, KHÔNG hard-code permission). Đây là hiển thị, **không
phải** biện pháp bảo mật: BE mới là chỗ chặn.

**QĐ-6 — Sổ phán quyết + artifact census phải đi cùng commit.** Gate xong ⇒ 3 route rời tập
`needVerdict` ⇒ 3 dòng `GAP` thành **stale** ⇒ test `route-guard-coverage` ĐỎ nếu không gỡ. Phải:
gỡ 3 dòng khỏi `ROUTE_VERDICTS`, làm rỗng `FROZEN_GAPS`, regen artifact bằng `ROUTE_CENSUS_WRITE=1`.
(memory `route-census-runtime-gate`.)

## 4. Thứ tự thi công (RED trước)

1. **RED** — `test/integration/org-directory-permission.int-spec.ts`: user role `employee` (0 grant)
   gọi cả 3 route → kỳ vọng 403; user có `read:user`/`read:team` → 200. Chạy trên code CHƯA sửa,
   **chụp log ĐỎ** (không tuyên bố suông — memory `reviewers-pass-real-bugs`).
2. **GREEN** — thêm guard + docstring (QĐ-1, QĐ-4).
3. Sổ phán quyết + regen artifact (QĐ-6).
4. FE console (QĐ-5).
5. Docs: `RELEASE-02` KI-030 đóng · Phụ lục A báo cáo `S6-SEC-1` · `permission-matrix-spec.md`.
6. Verify: `lint + typecheck + build`, test chạy chunk, CI xanh trên PR.

## 5. Rủi ro & cách chặn

| Rủi ro | Chặn |
| --- | --- |
| Nâng guard lên cấp class ⇒ 403 cho `units/tree` (apps/app dùng) | QĐ-1: guard THEO ROUTE; test giữ `getOrgTree` = 200 cho user không grant |
| Gate xong quên gỡ `GAP` ⇒ CI đỏ ở PR khác | QĐ-6 làm trong cùng commit; `FROZEN_GAPS` về `[]` |
| Cám dỗ backfill grant cho `employee` để "hết 403" | QĐ-2 — ghi thành quyết định, không phải thiếu sót |
| `read:user` gate nhưng repo vẫn trả toàn tenant (không ép `data_scope`) | Ngoài phạm vi WO (done_when #2 chỉ yêu cầu gate). Sau gate, tập người đọc được = 6 user đều `data_scope=Company` ⇒ không còn khoảng lệch **với tập grant hiện tại** — xem §7 |

## 6. Ngoài phạm vi

- Ép `data_scope` bên trong `OrgRepository.listEmployees` (xem §7 — nay đã ghim tiền đề bằng test).
- Gộp `/org/employees` vào `/hr/employees` (trùng dữ liệu) — là dọn nợ kiến trúc, cần WO riêng.
- Thêm/sửa bất kỳ migration nào — WO này **0 migration**.

## 7. Nợ tồn sau FULL gate (4 reviewer, 2026-07-27)

Gate chạy: `security-reviewer` · `rls-tenant-isolation-tester` (thay `database-reviewer`, không có
trong môi trường) · `general-purpose` với brief `silent-failure-hunter` (thay agent cùng tên, không
có) · `completion-evaluator`. **Cả 4 PASS, 0 CRITICAL, 0 HIGH.** Đã vá ngay trong WO: F1 (thiếu
`read:user` ⇒ ô chọn rỗng không lời giải thích), F2 (lỗi tải hiện cùng "chưa có nhóm nào"), siết 4
khẳng định test lỏng, ghim `data_scope`, sửa chữ ký `TENANT_READ` cho khớp payload.

Còn lại, **không chặn merge**, cần WO riêng:

| # | Nợ | Vì sao chưa vá ở đây |
| --- | --- | --- |
| ~~N-1~~ **ĐÓNG** (`S6-SEC-ORGSCOPE-1`) | **`listEmployees` không ép `data_scope`.** Role tenant tự đúc qua role-admin với scope `Own`/`Team`/`Department` (ceiling chỉ chặn `System`) sẽ qua guard rồi nhận TRỌN danh bạ kèm email — UI hứa hẹp, API giao rộng. | **Đã vá.** KHÔNG dùng `buildEmployeeScopeCondition` như dự đoán ban đầu (join `employee_profiles` sẽ làm tài khoản chưa có hồ sơ rụng khỏi màn RBAC console): thêm `DataScopeService.buildUserScopeCondition` hình-`users`. RED→GREEN ở `test/integration/org-directory-scope.int-spec.ts`; xem `docs/plans/S6-SEC-ORGSCOPE-1.md` §2 |
| N-2 | **Backfill cặp quyền cho `hr-manager` · `hr` · `manager`** + chốt một động từ giữa `read:user` (legacy) và `view:user` (canonical §13) | Cần migration ⇒ `migrations/**` ngoài `paths` của WO |
| N-3 | **`/auth/me` trả capabilities `{}` fail-safe khi hạ tầng lỗi** (`permission.service.ts:334-366`), HTTP vẫn 200 ⇒ màn hình mới nói "Bạn cần quyền read:team" với người **có đủ quyền**. Sự cố hạ tầng bị báo thành thiếu quyền | Là hành vi toàn hệ (mọi `PermissionGate` của console dựa vào map này), không phải thứ PR này nên đổi |
| N-4 | **`/system/permissions` là consumer thứ hai của `/org/employees`**, gate theo `assign-role:user \|\| grant-object-permission` chứ không `read:user`; nút "Thử lại" ở đó không bao giờ thắng 403 | Hôm nay 0 gap (2 quyền đó chỉ thuộc SA + company-admin, vốn có `read:user`), nhưng role tuỳ biến tạo qua chính màn RBAC đó mở lại được |
| N-5 | **Đường DENY không có tín hiệu vận hành**: `permission.guard.ts` không log deny thường, cặp non-sensitive không sinh audit. WO cắt 46→6 người đọc mà không có đồng hồ đo nào | Đề xuất log WARN đếm deny trên 3 handler này trong cửa sổ RC |
| N-6 | `mediaos_app` còn **DELETE** trên `teams`/`team_members` dù repo chỉ soft-delete | Thu hồi cần expand-contract (memory `migration-expand-contract-required`) |
| N-7 | `Dependency scan (pnpm audit)` đỏ pre-existing (override `brace-expansion`) | Cần `chore(deps)` riêng trước RC |
| N-8 | `apps/console/.../org-structure.tsx` ~780/800 dòng | Tách `TeamsTab` ra file riêng ở lần chạm kế tiếp |
