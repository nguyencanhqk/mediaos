# S18-FE-DEPTQUERYKEY-1 — hai đường đọc khác endpoint/khác cổng quyền không được dùng chung `queryKey`

> **WO**: `S18-FE-DEPTQUERYKEY-1` · module FRONTEND · layer FE · zone 🟡 **yellow** · **gate LIGHT**
> `depends_on`: — · Plan viết SAU census (WO yellow ⇒ không có bước planner bắt buộc, CLAUDE.md §6).

---

## §1 — Khiếm khuyết

Mỗi họ danh mục HR có **ĐÚNG HAI** đường đọc, khác endpoint **và khác cổng quyền**:

| họ | màn quản trị (`hrMasterDataApi`) | cổng | picker (`hrApi`) | cổng |
| --- | --- | --- | --- | --- |
| department | `GET /hr/departments` | `read:department` | `GET /hr/lookups/departments` | mở |
| position | `GET /org/positions` | `read:position` | `GET /hr/lookups/positions` | mở |
| job-level | `GET /hr/master-data/job-levels` | `manage:master-data` | `GET /hr/lookups/job-levels` | mở |
| contract-type | `GET /hr/master-data/contract-types` | `manage:master-data` | `GET /hr/lookups/contract-types` | mở |

Cả hai phía dùng chung `hrKeys.<họ>.list()` ⇒ **màn nào mount trước đầu độc cache của màn kia.**

DTO master-data là **superset** (`companyId` · `status` · `createdAt` · `updatedAt`…); DTO lookup **hẹp**
(`id` · `name` · `code` (+ `parentId` / `rankOrder` / `requiresEndDate`)). Hai chiều hỏng khác nhau:

- **master-data trước** ⇒ picker ăn hàng rộng. Structurally superset nên **không Zod-đỏ**, không nổ —
  picker chỉ lặng lẽ hiển thị cả bản ghi `inactive` mà endpoint lookup đã lọc bỏ.
- **picker trước** ⇒ màn quản trị đọc `.status` / `.createdAt` = `undefined`. Cột "Trạng thái" render
  nhầm, cũng **im lặng** (memory `server-masking-needs-optional-fe-schema`).

`staleTime` của picker là **5 phút** ⇒ cache bẩn được coi là TƯƠI, **không refetch**. Đó là lý do cổng
đo phải là "hàm lookup CÓ được gọi không", không phải "chờ một lát rồi dữ liệu có đúng không".

---

## §2 — Đã đo (đừng đo lại)

### 2a. WO seed ĐO THIẾU — ba chỗ

`src` của WO viết "1 call-site master-data + 15 call-site lookup, chỉ họ `departments`". Census thật:

1. **`PositionsPage.tsx:34` cũng dùng `hrMasterDataApi.listDepartments()`** — WO xếp nhầm nó vào nhóm
   lookup. Thực tế họ `departments` là **2 master-data + 13 lookup**, không phải 1 + 15.
2. **Khiếm khuyết là một HỌ BỐN KHOÁ**, không phải một. `positions` · `jobLevels` · `contractTypes`
   có đúng cùng hình dạng (bảng §1). Owner chốt 08/09: **làm cả 4 trong một PR** — cùng một vá, cùng
   một file, để lại 3 lỗ sinh đôi là đúng bài học `uniqueness-gate-covered-one-of-fifteen-families`.
3. `src` liệt kê 14 tên cho con số "15" — bản thân danh sách đã lệch với chính nó.

### 2b. Census cuối — 20 call-site lookup / 6 call-site master-data

Lookup (đổi sang `.lookup()`): 13 `departments` · 2 `positions` · 2 `jobLevels` · 3 `contractTypes`.

Master-data (giữ `.list()`): `DepartmentsPage:41` `:99` · `PositionsPage:34` `:96` · `JobLevelsPage:82`
· `ContractTypesPage:85`.

⚠️ `PositionsPage` là điểm va chạm **hai chiều**: nó giữ `listQueryKey: positions.list()` (master-data)
**và** đọc phòng ban qua `departments.list()` (cũng master-data). Cả hai đúng — giữ nguyên.

### 2c. `hrKeys.<họ>.all` là tiền tố CHUNG

`all = [hr, "<họ>"]`, `list()` và `lookup()` đều nối tiếp sau ⇒ `OrgChartPage.tsx:120`
(`invalidateQueries({queryKey: hrKeys.departments.all})`) **vẫn quét được cả hai đường** sau khi tách.
Không phải sửa.

### 2d. Ba spec tự dựng BẢN SAO NGẦM của `hrKeys`

`GoalListPage.spec.tsx` · `GoalFormPage.spec.tsx` · `AllLeaveRequestsPage.spec.tsx` mock
`@mediaos/web-core` bằng factory **không** `importOriginal` và gõ tay
`hrKeys: { departments: { list: … } }`. Đó là **hợp đồng khoá thứ hai**: nó trôi trong im lặng mỗi lần
`query-keys.ts` đổi. Ở WO này nó lộ ra bằng `hrKeys.departments.lookup is not a function`.

---

## §3 — Quyết định thiết kế

### D1 — Tách khoá, **KHÔNG** hợp nhất endpoint

`done_when` cấm "vá" bằng cách cho một bên gọi API bên kia. Lý do là **cổng quyền**: đổi picker sang
`/hr/departments` là ẩn picker với actor không có `read:department` (memory
`capability-allowlist-hides-admin-screens`); đổi màn quản trị sang `/hr/lookups/*` là mất `status` —
màn không còn dữ liệu để quản trị.

### D2 — `lookup()` nhận `params` y hệt `list()`

Giữ chữ ký `(params?: Record<string, unknown>)` cho đối xứng, dù mọi call-site hôm nay gọi không đối số.
Prefix invalidation (bỏ slot params) vì thế khớp mọi biến thể param'd về sau.

### D3 — Tách khoá đẻ ra nợ mới ⇒ phải nối invalidation NGAY trong cùng WO

Trước WO, CRUD trên màn quản trị làm tươi picker **nhờ tai nạn** (chung khoá). Tách xong mà không nối
dây thì đổi tên/ngừng dùng một phòng ban sẽ để picker giữ bản cũ tới **5 phút**. `hrMasterDataInvalidation`
vì thế trả **hai** prefix cho mỗi họ. Có ca đo riêng (§4 ca 6).

### D4 — Ba spec lấy `hrKeys` BẢN THẬT, không vá thêm `lookup` vào bản sao

Vá bản sao là giữ nguyên cái bẫy. Đổi factory sang `async (importOriginal)` rồi `hrKeys: actual.hrKeys`
— giữ nguyên mọi stub khác (rủi ro thấp nhất), nhưng xoá hẳn hợp đồng khoá thứ hai.

**KHÔNG đụng** 4 spec còn lại có bản sao `hrKeys` (`GoalDetailPage` · `HrAuditLogsPage` · `OrgChartPage`
· `EmployeeCodeConfigPage`) — chúng chỉ dựng `employees` / `auditLogs` / `orgChart` /
`employeeCodeConfig`, **không** chạm 4 họ của WO ⇒ ngoài phạm vi. Ghi thành nợ N2.

---

## §4 — Ca kiểm (RED trước) — `apps/app/src/routes/hr/master-data-lookup-cache.spec.tsx`

Mount màn master-data THẬT rồi mount picker THẬT (`useEmployeeLookups` — hook phủ cả 4 họ trong một
lần render) trong **CÙNG** `QueryClient`. Fixture mang **nhãn nguồn** (`MD-*` vs `LK-*`) để assert đọc
được *nguồn nào*, không phải *đọc được gì*.

| # | ca | đo |
| --- | --- | --- |
| 1–4 | `department` · `position` · `job-level` · `contract-type`: màn quản trị mount TRƯỚC | `hrApi.list*` **có** được gọi + dữ liệu picker là `LK-*` |
| 5 | chiều ngược: picker mount TRƯỚC | màn quản trị vẫn đọc `MD-DEPT`, và `LK-DEPT` **không** xuất hiện |
| 6 | `done_when` #2 | chạy đúng `invalidationKeys` như `MasterDataCrudScreen:150/:230` ⇒ **cả hai** hàm list refetch |
| 7 | neo cấu trúc | `lookup() ≠ list()` cho cả 4 họ, và `all` vẫn là tiền tố của cả hai |

---

## §5 — Bằng chứng (ĐÃ CHẠY 2026-09-08)

- [x] **RED**: `7/7 failed` trước khi sửa, **đúng lý do**: 4 ca đầu `expected "spy" to be called at
      least once` (picker chưa từng gọi endpoint lookup — nó ăn cache màn quản trị) · ca 5
      `Unable to find an element with the text: MD-DEPT` (màn quản trị ăn cache picker) · ca 6
      `expected 0 to be greater than 0` · ca 7 `family.lookup is not a function`.
- [x] **GREEN**: `7/7 passed`.
- [x] **Cổng đột biến 2/2 — ca test CẮN thật:**
  - `M1` gỡ `hrDepartmentsLookupPrefix` khỏi `hrMasterDataInvalidation.departments()` ⇒ **đúng 1** ca
    đỏ (ca 6). Không có M1 thì ca 6 là xanh-RỖNG.
  - `M2` đảo `use-employee-lookups.ts:36` về `.list()` ⇒ **đúng 3** ca đỏ (1 · 5 · 6), ba họ kia **vẫn
    xanh** — chứng minh các ca cô lập theo họ, không dính chùm.
- [x] **Census sau khi vá, hai chiều, phải RỖNG cả hai**: `.list()` đi kèm `hrApi.list*` → 0 ·
      `.lookup()` đi kèm `hrMasterDataApi` → 0. 6 chỗ `.list()` còn lại toàn master-data.
- [x] 20/20 call-site đổi bằng script **ghép cặp `queryKey` ↔ dòng `queryFn` liền kề**, không sed mù
      một dòng; script in ra từng dòng đã đổi để đối chiếu với census §2b.
- [x] `pnpm --filter @mediaos/web-core test` → **739/739 pass** (45 file).
- [x] Ba spec ở §2d: **18/18 pass** sau D4.
- [ ] `bash harness/check.sh` — xem §6.

---

## §6 — Bẫy hạ tầng gặp phải (không phải lỗi diff)

`npx vitest run` toàn bộ `apps/app` **crash worker** hai lượt liên tiếp: lượt 1
`abort: Invalid bytecode` khi nạp `aria-query` (crash V8 lúc khởi động ⇒ **0 test chạy**), lượt 2
`ERR_IPC_CHANNEL_CLOSED` giữa chừng. Cùng cây code, lượt chạy TRƯỚC đó hoàn tất trọn 2484 test ⇒ là
flake hạ tầng, đúng họ `vitest-worker-crash-chunked-runs`. Verify chính thức vì thế đi qua
`bash harness/check.sh` (dùng `harness/chunk-test.mjs`).

---

## §7 — Nợ để lại (CÓ CHỦ Ý)

- **N1** — `PositionsPage` đọc phòng ban qua endpoint **gác `read:department`**. Actor quản trị chức vụ
  mà thiếu cặp đó sẽ nhận 403 ở picker phòng ban. Hành vi có TRƯỚC WO này và WO không được phép đổi
  (D1) ⇒ nếu muốn sửa thì là WO riêng, kèm quyết định cổng.
- **N2** — 4 spec vẫn còn bản sao ngầm `hrKeys` (`GoalDetailPage` · `HrAuditLogsPage` · `OrgChartPage`
  · `EmployeeCodeConfigPage`). Không chạm 4 họ của WO nên không đỏ hôm nay. Đáng gộp một WO dọn chung
  "spec không được tự dựng bản sao query-key".
  ⚠️ Đo thêm: `OrgChartPage.spec.tsx` stub `employees.all` nhưng `OrgChartPage.tsx:120` invalidate
  `hrKeys.departments.all` — stub **thiếu** nhánh đó; spec xanh chỉ vì đường invalidate không được ca
  nào chạy tới. Đó là một lỗ phủ, không phải bằng chứng an toàn.
- **N3** — WO không đo `apps/console` / `apps/auth`; census đã quét `apps` + `packages` toàn bộ và 0 kết
  quả ngoài `apps/app`, nên đây là ghi chú phạm vi chứ không phải nợ.

---

## §8 — Rollback

Revert commit là đủ: **0 migration · 0 contracts · 0 seed · 0 đổi API · 0 trạng thái ngoài trình duyệt**.
Khoá cache chỉ sống trong bộ nhớ tab; revert xong tab đang mở tự lành ở lần tải lại.
