# S5-HR-WORKINFO-1 — Hoàn thiện khối "Thông tin công việc" (chi tiết NV + hồ sơ của tôi)

> Zone: **yellow** (chạm tầng masking DTO đọc HR). Gate: **LIGHT** (react-reviewer + typescript-reviewer +
> quality-gate) **+ security-reviewer soi diff DTO đọc (vùng masking)**. No migration, no new permission
> pair. **Additive-only** — CHỈ THÊM field, KHÔNG đổi/bỏ field cũ, KHÔNG nới gate sensitive hiện có.
> Nguồn: IMP02-STORY-124 (IMPLEMENTATION-02 §8.4).

## 1. Phạm vi

Bổ sung khối Thông tin công việc cho **màn chi tiết nhân viên** (`GET /hr/employees/:id`) và **hồ sơ của tôi**
(`GET /hr/me/profile`) — cùng DTO `HrEmployeeDetail`, cùng `toDetail()`, cùng masking layer. **KHÔNG** đụng
list (`GET /hr/employees`) — FE list không render các field mới, thêm join vào list = tăng bề mặt masking vô
ích (WO cho phép "list nếu rẻ" → bỏ, giữ scope hẹp + review nhẹ).

`id/contract_type_id/direct_manager_id ĐÃ có schema` (employee_profiles) — chỉ thiếu **tên** join ra DTO.

## 2. Field thêm vào `HrEmployeeDetail` (đều NULLABLE, additive)

| Field | Nguồn join | Lớp masking |
| --- | --- | --- |
| `jobLevelName` | `job_levels.name` theo `job_level_id` | **directory-class** (không gate) — như jobLevelName ở org-chart |
| `contractTypeName` | `contract_types.name` theo `contract_type_id` | **PII — view-sensitive** (đi CÙNG gate `contractType` legacy, WO chốt) |
| `directManagerName` | `users.fullName` theo `direct_manager_id` (alias) | directory-class |
| `directManagerEmployeeId` | `employee_profiles.id` (alias) theo `user_id = direct_manager_id` | directory-class (FE link `/hr/employees/{id}`) |
| `indirectManagerName` | `users.fullName` của quản-lý-của-quản-lý (alias, 1 cấp) | directory-class |
| `resignationReason` | `employee_status_histories.reason` (hàng gần nhất new_status ∈ resigned/terminated) | **PII — view-sensitive** (fail-closed; text lý do nghỉ nhạy cảm) |

**Vì sao contractTypeName + resignationReason gate view-sensitive:** WO nói tường minh contractTypeName đi CÙNG
gate view-sensitive như `contractType` legacy (muốn nới directory-class phải có quyết định owner riêng).
resignationReason là free-text HR ⇒ fail-closed dưới view-sensitive (mirror `notes`). jobLevelName + manager
name/id = directory-class (khớp org-chart directory node — không lộ PII/salary).

## 3. Join — additive, KHÔNG N+1

`findByIdTx` / `findByUserIdTx` (đều dùng `DETAIL_COLUMNS`) thêm LEFT JOIN (idiom `alias` như
`tasks/projects.repository.ts`):

```
LEFT JOIN job_levels        ON emp.job_level_id     = job_levels.id
LEFT JOIN contract_types    ON emp.contract_type_id = contract_types.id
LEFT JOIN users  dm_user    ON emp.direct_manager_id = dm_user.id            -- directManagerName
LEFT JOIN employee_profiles dm_prof
       ON dm_prof.user_id = emp.direct_manager_id
      AND dm_prof.company_id = emp.company_id
      AND dm_prof.deleted_at IS NULL                                          -- directManagerEmployeeId (unique active/user ⇒ ≤1)
LEFT JOIN users  im_user    ON dm_prof.direct_manager_id = im_user.id         -- indirectManagerName (1 cấp, KHÔNG N+1)
```

detail = 1 hàng ⇒ mọi join là scalar, không N+1. Tất cả chạy trong `withTenant` (RLS+FORCE) — join
employee_profiles/users đã tự tenant-scoped; vẫn AND company_id + deleted_at cho dm_prof (belt-and-suspenders).

**resignationReason**: KHÔNG thêm cột vào DETAIL_COLUMNS. Service gọi 1 lookup phụ **CHỈ khi**
`status ∈ {resigned, terminated}` **và** `revealPii` — `repo.findLatestResignationReasonTx(tx, cid, empId)`
(SELECT reason ORDER BY changed_at DESC LIMIT 1, new_status ∈ resigned/terminated). append-only table → chỉ
SELECT. detail 1 hàng ⇒ tối đa 1 query phụ, không N+1. Không thêm API mới (reuse endpoint detail).

## 4. Service masking (toDetail)

- `jobLevelName`, `directManagerName`, `directManagerEmployeeId`, `indirectManagerName` ← row (directory, không mask).
- `contractTypeName` ← `revealPii ? row.contractTypeName : null` (CÙNG gate `contractType`).
- `resignationReason` ← đã fail-closed ở service (chỉ set khi revealPii + đúng status), mặc định null.
- KHÔNG đổi 1 dòng nào của salary/identity/PII cũ.

## 5. FE

- **WorkInfoSection** (`profile-sections.tsx`, dùng chung detail + split-view + MyProfile): thêm dòng Cấp bậc
  (`jobLevelName`), Loại hợp đồng (ưu tiên `contractTypeName` fallback `contractType` legacy, qua `pii()`),
  Quản lý trực tiếp (`directManagerName`; link `/hr/employees/{directManagerEmployeeId}` nếu có — server tự
  enforce quyền xem), Quản lý gián tiếp (`indirectManagerName` nếu BE trả). Khối **"Thông tin nghỉ việc"** chỉ
  render khi `status ∈ {resigned, terminated}`: Ngày nghỉ (`endDate`) + Lý do (`resignationReason` qua `pii()`).
- **MyProfilePage**: thêm `<WorkInfoSection>` để đồng bộ các dòng mới (tái dùng section, DRY). Link quản lý
  điều hướng `/hr/employees/{id}` — MyProfile không có onNavigate riêng nên render tên + link `<a href>` chuẩn.
- i18n vi: `detail.fields.jobLevel`, `detail.fields.directManager`, `detail.fields.indirectManager`,
  `detail.groups.resignation`, `detail.fields.resignationDate`, `detail.fields.resignationReason`.
- KHÔNG thêm field ngoài scope MVP (mã chấm công · ngày học việc · nghỉ hưu · sổ QL · danh sách đen · khoảng cách).

## 6. Test

- **Service spec** (`hr-read.service.spec.ts`): makeDetailRow + các field mới; assert directory field luôn
  hiện; `contractTypeName` mask khi thiếu view-sensitive, hiện khi có; `resignationReason` chỉ query khi
  resigned/terminated + revealPii (mock `findLatestResignationReasonTx`); status active ⇒ KHÔNG gọi lookup.
- **Int-spec** (mới `hr-workinfo-read.int-spec.ts`, gate `hasDb && LANE_DB`): detail chứa jobLevelName +
  manager names đúng join; `contractTypeName` mask cho role thiếu view-sensitive (không lộ trong body JSON);
  resignationReason chỉ hiện cho resigned + có view-sensitive.
- **FE spec**: WorkInfoSection render dòng mới + khối nghỉ việc theo status; MyProfilePage mock thêm field mới.
- REBUILD `packages/contracts` + `packages/web-core` dist (đổi src). `check.sh` xanh.

## 7. Rủi ro / không làm

- KHÔNG migration, KHÔNG permission pair mới, KHÔNG đổi masking cũ.
- KHÔNG thêm join vào list/summary/export (giữ bề mặt masking hẹp).
- KHÔNG thêm endpoint status-history mới (reuse detail đủ; resignationReason là field additive của detail).
