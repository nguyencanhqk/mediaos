# DECISIONS-11 — Tín hiệu VẮNG MẶT của tư cách thành viên role: 404 có điều kiện, không phải 204 mù (KI-074)

| | |
| --- | --- |
| **Trạng thái** | 🟢 **ĐÃ CHỐT 2026-08-24** (owner ký) — thi hành trong WO `S10-SEC-ROLEMEMBERDEL-1` |
| **Ngày** | 2026-08-24 (ký) · 2026-08-25 (thi công) |
| **Bối cảnh** | KI-074 — `DELETE /permissions/users/:userId/roles/:roleId` phân biệt **404** với **204** ⇒ câu trả lời ÂM ("x KHÔNG phải thành viên của role r") **miễn phí**: 0 hàng forensic, 0 thiệt hại |
| **Vùng** | 🔴 ĐỎ — đổi HỢP ĐỒNG API của một route leo thang đặc quyền |
| **Phạm vi** | Đúng một nhánh của `PermissionAdminService.revokeRole` + test + chú thích caller. **KHÔNG** migration, **KHÔNG** đổi catalog quyền, **KHÔNG** đụng `assignRole` |

---

## 1. Vấn đề — kênh im lặng CUỐI CÙNG của tab "Thành viên role"

Ba WO trước đã bịt lần lượt:

| WO | KI | bịt gì |
| --- | --- | --- |
| `S10-SEC-ROLEMEMBERROW-1` | KI-071 | **TẬP HÀNG** của `GET /auth/roles/:id/members` đi theo `data_scope` của `view:user` |
| `S10-SEC-ROLEMEMBERFE-1` | KI-073 | **thân 201** của `POST …/roles` thu về đúng 4 khoá echo request ⇒ nhánh no-op hết phân biệt được với nhánh fresh |
| — | — | còn lại: **`DELETE`** |

`revokeRole` ném `NotFoundException("User does not have this role")` **TRƯỚC mọi ghi**. Vì thế:

| nhánh | HTTP | vết để lại |
| --- | --- | --- |
| ÂM ("không phải thành viên") | **404** | **0** |
| DƯƠNG (là thành viên) | 204 | 4 (soft-delete + `RoleRevoked` + `ROLE_REMOVED` + outbox) — **và gỡ vai THẬT** |

Một actor giữ `assign-role:user` nhưng `view:user` **hẹp** (không được xem danh bạ toàn công ty) có
thể dựng lại **toàn bộ tập thành viên** mà KI-071 vừa giấu, bằng cách hỏi từng người và **chỉ đọc mã
404**. Chiều dương thì đắt và ồn — nhưng cùng actor **vá lại được ngay bằng POST**, khiến cặp
`RoleRevoked`→`RoleAssigned` sát nhau lẫn vào nhiễu cấp phát bình thường.

---

## 2. Ba hướng đã cân nhắc

### (a) 204 đồng nhất cho mọi actor — **LOẠI**

Đóng oracle triệt để, nhưng **lấy mất một tín hiệu vận hành ĐÚNG**. Chú thích
`packages/web-core/src/lib/auth-users-api.ts:136` khai rõ 404 là quyết định **CÓ CHỦ Ý**:

> _"Server trả 404 nếu user KHÔNG đang giữ role này — caller xử lý như lỗi rõ ràng (KHÔNG no-op ngầm)."_

Ba màn hình dựa vào nó để nói "gỡ không thành công" thay vì báo thành công giả:
`RoleMembersTab.tsx:107` · `UserRolesPage.tsx:98` · `console/revoke-role-dialog.tsx:40`.
Biến tất cả thành 204-mù là hạ chất lượng vận hành để mua một tính chất bảo mật mà (b) mua được **mà
không phải trả giá đó**.

### (c) Chấp nhận rủi ro — **LOẠI**

KI-074 sinh ra chính vì "nợ nằm dạng văn xuôi trong một hàng ĐÃ GẠCH thì vô hình với bug-scrub trước
RC" (học phí đã trả ở KI-049 và KI-065). Ghi nhận rồi bỏ đó là tái lập đúng lỗ đó.

### (b) 404 **có điều kiện** — **CHỌN**

> **GIỮ 404** cho actor có `view:user` ở scope `Company`/`System`. **204** cho phần còn lại.

Thắng vì hai lẽ:

1. **Không mất tín hiệu vận hành.** Người trực ca luôn ở `Company` (đo PROD 24/08: **0 vai** giữ
   `view:user` hẹp hơn `Company`) ⇒ 0 dòng FE phải sửa, 0 hồi quy.
2. **Đối xứng với cờ `complete`** của KI-073 (`role-admin.service.ts:251`). Cùng một ý:
   _bit CÓ THẨM QUYỀN về scope `view:user` của CHÍNH actor lái hình dạng câu trả lời._ Một cơ chế,
   hai bề mặt — không phải hai phát minh rời.

Nói cách khác: **ai đã được phép nhìn thấy toàn bộ danh bạ thì không học được gì mới từ mã 404**; ai
chưa được phép thì không nhận câu trả lời ÂM nào cả.

---

## 3. Ba ranh giới của (b) — ghi TRƯỚC khi thi công, mỗi cái là một chỗ trượt

### R1 — `resolveStrongestScope` trả `null` ⇒ **204**, KHÔNG phải 404

`null` nghĩa *"KHÔNG có thẩm quyền"*, không phải `Company`. Ba nguồn sinh `null`
(`permission.service.ts:572-634`): 0 grant khớp · một grant `DENY` khớp (deny-overrides) ·
`data_scope` không chuẩn hoá được **hoặc lỗi hạ tầng** (`catch` → `null`, fail-closed).

⚠️ Ở đây fail-closed **= im lặng (204)**, ngược chiều với `listMembersInner` (fail-closed = **403**).
Không mâu thuẫn: ở đó `null` nghĩa "không được đọc route" nên **chặn**; ở đây `null` nghĩa "không đủ
thẩm quyền để nhận câu trả lời ÂM" nên **nói ít hơn**. Cả hai đều là *nghi ngờ ⇒ lộ ít hơn*.

**Hệ quả vận hành phải nói ra:** một sự cố hạ tầng ở câu scope biến 404 thành 204 cho cả actor
`Company`. Đó là **mất tín hiệu tạm thời, KHÔNG phải mất quyền** — revoke thật vẫn chạy đúng. Đường
lần là dòng log `resolveStrongestScope() infrastructure error` của chính hàm đó, cùng request.

### R2 — chỉ nhánh **TRONG-tenant** đổi sang 204; role thuộc tenant khác **GIỮ 404**

Trước WO này `revokeRole` **không tách** hai nhánh: role lạ / đã xoá / operator-audience / thuộc
tenant khác đều rơi vào cùng câu 404 vì `findUserRole` lọc theo `(company_id, user_id, role_id)` chứ
không validate role. (b) buộc phải tách — nếu không, role của tenant khác cũng tụt xuống 204 và
**BẤT BIẾN #1 (cô lập tenant) mất khả năng quan sát ở tầng HTTP**.

Tách bằng `repo.findAssignableRole(tx, roleId)` — **đúng hàm `assignRole` đang dùng** — dưới RLS
`roles_tenant_isolation` (mig `0005_permissions.sql:37-44`). Predicate **đầy đủ, cả hai vế**:

```sql
USING ( company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        OR company_id IS NULL )        -- vế thứ hai: SYSTEM role thấy được ở MỌI tenant
```

⇒ **ba lớp role, ba kết cục — ký cả ba, không chỉ vế đầu:**

| lớp role | thấy dưới tenant actor? | actor `Company`/`System` | actor HẸP |
| --- | --- | --- | --- |
| company-scoped của **tenant KHÁC** | ❌ RLS chặn | 404 | **404** — đây là ranh R2 |
| **system** (`company_id IS NULL` — 4 vai chính tắc, mig `0444`) | ✅ (vế `OR`) | 404 | **204** |
| operator-audience (`OPERATOR_ROLE_IDS`) | ✅ nhưng `notOperatorRole()` loại | 404 | **404** |

Hàng giữa là **hành vi được ký ở đây**: system role không thuộc tenant nào, nên 204 KHÔNG phá cô lập
tenant và nhất quán với (b). Hệ quả cho người viết test: ca cross-tenant **phải dùng role
company-scoped của tenant B**, không được dùng system role — dùng nhầm là pin nhầm mệnh đề.
Hàng cuối là **cạnh DUY NHẤT** phân biệt `findAssignableRole` với một `SELECT … WHERE id =` trần: ai
"đơn giản hoá" hàm này sẽ mở đường gán role operator ⇒ phải có ca riêng.

Cô lập ở hàng đầu do **DB ép** (RLS + FORCE), không do kỷ luật code.

**Thông điệp giữ nguyên `"User does not have this role"`** ở cả hai nhánh 404 — KHÔNG thêm
`"Role not found"`. Đổi chuỗi là thêm một bit mới vào response và bắt 3 caller đọc lại.

**Bit "role có assignable không" có phải bit MỚI với actor hẹp?** KHÔNG — và mạnh hơn "đã lộ qua
POST": `assignRole` cho bit đó **MIỄN PHÍ**. Với `roleId` rác + `targetUserId` rác, POST trả **hai
thông điệp KHÁC NHAU** — `"Role not found"` vs `"User not found"` — và **0 ghi ở CẢ HAI nhánh** (ném
trước mọi `insertUserRole`/`audit`). Cùng quyền `assign-role:user`, cùng giá bằng không.

⚠️ Chỗ dựa này là **giả định về code KHÁC**. Ai vá `assignRole` sau này thì R2 mất nền và phải mở
lại — vì vậy nó được pin bằng một ca test riêng, không chỉ ghi trong văn xuôi.

### R3 — nhánh 204-ÂM là **0 ghi**

**Cấm** ghi audit/security-event giả "cho giống nhánh dương". Đó là biến một oracle **ĐỌC** thành
**GHI giả** — tombstone rác, `permission.changed` đập cache toàn hệ, timeline bảo mật nói dối. Cùng
luật no-op mà KI-073 (ca O4) đã chốt cho `assignRole`.

---

## 4. Kênh KHÔNG đóng theo — ghi nhận, không hứa

**Kênh THỜI GIAN.** Nhánh ÂM làm 0 ghi (+1 câu đọc `findAssignableRole`); nhánh DƯƠNG làm 4 ghi. Độ
trễ vì thế **vẫn phân biệt được** hai nhánh — cùng lớp với `attribution-patch-creates-timing-oracle`.
Đóng nó đòi ghi giả ⇒ **mâu thuẫn R3**. Vì vậy: ghi nhận ở đây, **không** hứa đóng, **không** mở WO
theo đuôi.

**Kênh anh em của `POST`** (ghi nhận, không số hiệu riêng): chênh lệch thời gian giữa nhánh no-op
(0 ghi) và nhánh fresh (insert + audit + event + outbox) của chính `assignRole`. Cùng lớp, cùng lý do
không đóng.

**Chiều DƯƠNG vẫn có giá.** (b) không làm cho việc gỡ vai trở nên miễn phí: mỗi câu hỏi trúng vẫn
**gỡ vai THẬT của nạn nhân** và để lại 4 vết. Tính chất đạt được sau WO này là:
_"không enumerate thành viên IM LẶNG theo CẢ HAI chiều"_ — chiều có-dấu-vết vẫn mở, **có chủ ý**.

---

## 5. Số đo PROD

**Câu đo ĐÚNG là HAI cặp, không phải một:** lấy tập actor giữ **`assign-role:user`** (4 hình dạng
wildcard) — vì chỉ họ gọi được route — rồi đo `resolveStrongestScope(view, user)` **trên tập đó**
(lại 4 hình dạng). Đo scope của `assign-role:user` là đo nhầm cặp: nó không lái hình dạng câu trả lời.

| ngày | đo gì | kết quả |
| --- | --- | --- |
| 2026-08-24 | vai giữ `view:user` hẹp hơn `Company` (4 hình dạng wildcard × 2 cặp) | **0** |
| **2026-08-25** | **đo lại khi thi công** — `scripts/measure-ki074-role-member-del.sql` trên DB PROD | **0 / 6 actor rơi vào nhánh 204 mới** |

**Số đo 25/08 (đầy đủ, để lần sau đối chiếu chứ không phải đo lại từ đầu):**

- **6 người** giữ `assign-role:user`; **cả 6** có `view:user` scope mạnh nhất = `Company`
  ⇒ **cả 6 GIỮ 404**. `actors_falling_into_new_204_branch = 0`.
- Bốn grant chạm `assign-role:user`, qua **HAI hình dạng khác nhau** — đây là lý do câu đo phải phủ
  đủ 4 hình dạng wildcard, không chỉ cặp exact:

  | vai | cách chạm `assign-role:user` | `view:user` |
  | --- | --- | --- |
  | `QUẢN LÝ CẤP CAO` | **`*:*@Company`** (wildcard) | exact `view:user@Company` |
  | `SA` | `*:*@Company` **và** exact `assign-role:user@Company` | exact `view:user@Company` |
  | `company-admin` (system role) | exact `assign-role:user@Company` | exact `view:user@Company` |
  | `hr` (system role) | — (không gọi được route) | exact `view:user@Company` |

- **`('view','user').is_sensitive = false`** — xác nhận lại trên PROD. Cổng ở ADR §6 còn nguyên.
- Catalog PROD **không có** hàng `('view','*')` hay `('*','user')`; chỉ có `('*','*')`,
  `('view','user')`, `('assign-role','user')`. Hai hình dạng kia được câu đo phủ và trả 0 hàng —
  *"đã đo, không có"*, khác với *"chưa đo"*.
- ⚠️ Điểm mong manh phải nói ra: `QUẢN LÝ CẤP CAO` và `SA` chạm cặp gate **qua `*:*`**. Hôm nay cả
  hai vẫn ở nhánh 404 vì có **thêm** grant exact `view:user@Company`. Gỡ grant exact đó (để lại mỗi
  `*:*`) thì họ **vẫn** ở 404 — `*:*@Company` khớp `view:user` và cho `Company`. Nhưng nếu ai cấp cho
  họ `view:user@Own`, **exact THẮNG wildcard** ⇒ tụt thẳng xuống nhánh 204. Đó là cấu hình cần canh.

⇒ Hôm nay (b) là **no-op trên thực địa**: không ai rơi vào nhánh 204. Đó là **điểm mạnh** (đóng một
lỗ tiềm tàng với 0 hồi quy) nhưng cũng là **bẫy nghiệm thu** — ca DENY phải **TỰ GIEO** vai
`view:user@Own`, không nghiệm thu được bằng dữ liệu PROD. Và **đừng test bằng super-admin**: SA qua
mọi cổng nên ca DENY thành tautology.

⚠️ Đo scope phải phủ **4 hình dạng wildcard** — `action IN ('view','*') AND resource_type IN ('user','*')`,
**hai vế ĐỘC LẬP**. Engine đã làm đúng (`permission.service.ts:584-586`); câu đo tay thì hay hụt.

⚠️ `view:user` là `is_sensitive = false` ⇒ **exact THẮNG wildcard** (`:606-607`) ⇒ một vai giữ
`*:*@Company` mà **được cấp thêm** `view:user@Own` sẽ **TỤT xuống nhánh 204**. Đó là **siết**, không
phải nới, và là hành vi đã ký.

---

## 6. Hệ quả cho vận hành

- **Workaround của KI-073 VẪN hiệu lực và phải giữ trong tài liệu vận hành:** không cấp `view:user`
  hẹp hơn `Company` cho vai đồng thời giữ `assign-role:user`. Sau (b) nó không còn là *phòng thủ duy
  nhất*, nhưng vẫn là cấu hình đúng.
- **Chữ ký của probe trong audit:** cặp `RoleRevoked` → `RoleAssigned` sát nhau trên cùng
  `(user, role)` bởi cùng actor.
- **Người trực ca không thấy gì đổi.** Ở `Company`, 404 vẫn là 404.
- **⚠️ Cờ `is_sensitive` của catalog nay là một CỔNG của route này.** `resolveStrongestScope` tính
  `effectivelySensitive = (opts?.isSensitive ?? false) || allowMatches.some(g => g.isSensitive)` —
  vế thứ hai đọc **catalog**. Lật `('view','user')` (hoặc hàng `('*','*')`) sang `is_sensitive = true`
  ở một migration sau sẽ ép nhánh exact-only ⇒ **mọi actor wildcard-only tụt `null` ⇒ 204** ⇒ mất
  tín hiệu 404 **trong im lặng**, đúng hồi quy mà hướng (a) bị loại vì gây ra. Có ca test canh cờ này;
  migration nào định lật nó phải đọc mục này trước.
- **Chi phí:** mỗi `DELETE` nay mở **2 transaction** (một cho `resolveStrongestScope`, một cho
  write-tx), kể cả nhánh dương. Chấp nhận được vì revoke là thao tác quản trị hiếm. Nó **không** làm
  phẳng kênh thời gian ở §4 — chỉ cộng một hằng số vào cả hai nhánh.

---

## 7. Liên quan

- `docs/plans/S10-SEC-ROLEMEMBERDEL-1.md` — plan thi công
- `docs/plans/S10-SEC-ROLEMEMBERFE-1.md` (KI-073) · `docs/plans/S10-SEC-ROLEMEMBERROW-1.md` (KI-071)
- `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` — hàng KI-071 · KI-073 · KI-074
- `docs/permission-matrix-spec.md` §13 — bản đồ cặp gate ≠ cặp bound
- Tiền lệ ADR đi kèm WO đỏ: `DECISIONS-09` (KI-065)
