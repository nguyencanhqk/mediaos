# S6-SEC-PERMVERB-1 — chốt một động từ cho quyền đọc danh bạ tài khoản

> **Nợ N-2** của `S6-SEC-ORG-1` (hậu FULL gate). **Zone:** 🔴 red (permission).
> **ADR:** [DECISIONS-06 D-41](<../DECISIONS/DECISIONS-06_Permission_Verb_Canonical.md>) — quyết định + số đo đầy đủ nằm ở đó, file này là nhật ký thi công.
> **Ngày:** 29/07/2026 · **Migration:** KHÔNG CÓ (xem §2).

---

## 1. Vấn đề

Cùng một hành vi "đọc danh sách tài khoản" mang **hai** cặp quyền: `read:user` (legacy, `0005:205`) và `view:user` (canonical, `0444:87-90`). `GET /org/employees` là chỗ **DUY NHẤT** còn gate động từ legacy; `/auth/users`, role-admin, dashboard `USER_SUMMARY` đều đã ở `view:user`.

Vì `data_scope` là **PER-(permission, role)**, hai endpoint cùng lớp dữ liệu mang hai cặp khác nhau ⇒ **siết scope một bên KHÔNG siết bên kia**. Đây là lớp lỗi `read-path-gate-pair-must-match-download-pair`.

---

## 2. Quyết định thi công — KHÔNG migration (khác dự kiến của WO seed)

WO seed dự trù *"backfill PER-PAIR bằng migration"* cho `hr` · `manager` · `hr-manager`. **Số đo bác bỏ dự trù đó.**

Đo PROD `mediaos` 29/07/2026 (1 tenant `funtime`, 46 user), truy vấn `role_permissions ⋈ permissions ⋈ roles ⋈ companies`, đếm user sống:

| Cặp | Role | scope | User sống |
| --- | --- | --- | --- |
| `read:user` | `SA` · `company-admin` · `project-manager` | Company | 6 · 1 · **0** |
| `view:user` | `SA` · `company-admin` · `hr` | Company | 6 · 1 · **0** |

**Cả 7 user sống giữ cặp danh bạ đều giữ ĐỒNG THỜI hai động từ** ⇒ đổi gate là **no-op** với 100% người dùng thật. Hai role lệch đều **0 user**:

- `project-manager` **mất** quyền — media-era, ngoài §13, de-media-fy ⇒ **cố ý không backfill**.
- `hr` **được** quyền — §13 đặc tả HR = Company và nó **đã có sẵn** `view:user` từ `0444`; chỉ chưa dùng được vì gate lệch động từ. ⇒ **0 grant mới**.

Vế "3 role lệch" của WO seed sai ở hai điểm: `manager` **đúng thiết kế** (§13 ghi Manager `-` cho `AUTH.USER.VIEW` ⇒ backfill = mở rộng quyền ngoài đặc tả) và `hr-manager` là media-era ngoài §13.

**Expand–contract không kích hoạt:** pha EXPAND đã xảy ra từ `0444`; release này **không revoke gì** (row `read:user` + grant của `project-manager` vẫn nguyên), chỉ thôi *đọc* động từ cũ. Pha CONTRACT hoãn có chủ đích — xem ADR §5.1.

---

## 3. RED → GREEN (chạy thật, `LANE_DB=mediaos_permverb`)

**RED** — trước khi đổi hằng số, `test/integration/org-directory-permission.int-spec.ts` đỏ **4/12**:

```
× S6-SEC-PERMVERB-1: `read:user` (LEGACY) KHÔNG còn mở được danh bạ   ← user chỉ có read:user nhận 200 + TRỌN danh bạ
× có `view:user` → 200 /org/employees; có `read:team` → 200 hai route team
× có cả hai cặp (company-admin/SA) → 200 cả 3 route
× tenant B (có ĐỦ grant) vẫn không thấy user/team của tenant A
```

**GREEN** — sau khi đổi `ORG_EMPLOYEE_DIRECTORY.action` `"read"` → `"view"`: 3 file pin **75/75 xanh**.

Ca deny mới (`read:user` LEGACY → 403 + không rò byte email nào) là chốt hồi quy thay cho việc dọn catalog: nếu hồi quy đưa gate về động từ cũ, `project-manager` lặng lẽ lấy lại trọn danh bạ.

---

## 4. Phạm vi — 1 dòng code + 3 pin

| Loại | Tệp |
| --- | --- |
| **Code** | `src/org/org.permissions.ts` — `action: "read"` → `"view"` (**duy nhất 1 dòng hiệu dụng**) |
| Pin 1 | `src/org/org.permissions.spec.ts` (census literal) |
| Pin 2 | `test/integration/org-directory-scope.int-spec.ts` (`DIRECTORY_PAIR`) |
| Pin 3 | `test/integration/org-directory-permission.int-spec.ts` (`DIRECTORY_PAIR` + ca deny legacy MỚI) |
| Artifact | `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` — regen bằng `ROUTE_CENSUS_WRITE=1`, diff đúng **1 dòng** |
| Docstring | `org.controller.ts` · `data-scope.service.ts` · `route-verdicts.ts` |
| Docs | ADR DECISIONS-06 (mới) · `permission-matrix-spec.md` · plan `S6-SEC-ORG-1.md` (đóng N-2) |

> ⚠️ **WO seed đếm thiếu pin.** Seed ghi *"còn 2 pin LITERAL độc lập"*; thực tế có **BA** — `org-directory-permission.int-spec.ts` cũng seed cặp bằng literal (~9 vị trí). Bài học `wo-seed-hand-measurements-can-be-incomplete`: quét lại thay vì tin số đếm tay trong WO.

---

## 5. Verify

| Bước | Kết quả |
| --- | --- |
| `lint` | ✅ 0 error (43 warning pre-existing) |
| `typecheck` | ✅ |
| `build` | ✅ 7/7 |
| Test suite `@mediaos/api` | ✅ **450/450 file spec xanh** |
| `route-guard-coverage` census | ✅ sau regen (diff đúng 1 dòng `read:user`→`view:user`) |

**Hai lần đỏ trên đường đi, cả hai KHÔNG phải lỗi code:**

1. `route-guard-coverage.e2e-spec.ts` — *"route đổi thuộc tính gate: OrgController#listEmployees"*. Đúng cổng, đúng lúc (memory `route-census-runtime-gate`): đổi gate **phải** regen artifact + ký phán quyết. Đã regen.
2. `chunk 8/12 crash hạ tầng` (`ERR_IPC_CHANNEL_CLOSED`, tinypool@1.1.1 — memory `vitest-worker-crash-chunked-runs`) ⇒ 40/450 file **không chạy**, và `task-actions.int-spec.ts` đỏ trong lượt chạy song song. Chạy lại nhỏ hơn: **40/40 file xanh (960 test)**, `task-actions` **31/31 xanh** cô lập. Đỏ hạ tầng, không phải hồi quy.

> Ghi rõ theo tiền lệ `S6-SEC-1 §7c`: **FULL gate agent (`security-reviewer`, `database-reviewer`) KHÔNG chạy** trong phiên này — phiên bị cấu hình cấm gọi sub-agent. Thay bằng: đo DB thật (không suy từ migration), RED-proof chạy thật hai chiều, quét lại toàn repo tìm consumer sót, suite 450/450 + census regen. **Cần người chốt trước merge** (zone đỏ).

---

## 6. Nợ để lại

- **N-1b (chưa đóng, cố ý):** hai bản cài đặt của cùng vị từ scope hình-`users` — `DataScopeService.buildUserScopeCondition` (nhánh `Own` **có** `company_id`) và `AuthUsersService.buildUserScopeCondition` (**không** có). Sau WO này hai endpoint dùng chung cặp quyền ⇒ đây là lúc đúng để hợp nhất, **về phía `DataScopeService`**. Kèm: bỏ tính phi đơn điệu (`Own`+`Team` resolve ra `Team` ⇒ 0 hàng — thêm role làm MẤT quyền), phải áp cho **cả hai** endpoint cùng lúc. Tách khỏi WO này vì đó là đổi **hành vi**, cần bộ test riêng.
- **Pha CONTRACT:** revoke grant `read:user` của `project-manager` + cân nhắc gỡ row catalog — WO riêng, sau khi `view:user` chạy ổn định một nhịp.
- **Gốc rễ chưa đụng:** `PermissionGuard` vẫn không đọc `data_scope` (0 hit). Xem `S6-SEC-ORGTEAMSCOPE-1` (N-1c).
