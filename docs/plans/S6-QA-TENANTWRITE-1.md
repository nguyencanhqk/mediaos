# S6-QA-TENANTWRITE-1 — KI-037: bổ sung vế GHI vào lưới tenant-isolation

> **Zone:** đỏ (crown — RLS/policy) · **Module:** QA · **Migration:** chỉ khi phát hiện lỗ THẬT
> **KI:** RELEASE-02 KI-037 (S2) — *"là lớp lỗ hổng đã để lọt KI-032, không phải một bug lẻ"*

---

## 1. ĐO TRƯỚC (done_when #1 — số, không phải cảm giác)

### 1.1 Đính chính hai con số của WO

| | WO/KI ghi | Đo lại 2026-07-29 |
| --- | --- | --- |
| Số bảng trong `rls-registry.ts` | 156 | **155** |
| Số ca hiện có | 465 / 468 | **465 — KI ghi ĐÚNG** (155 × 3; `it.skipIf` VẪN được đếm) |

> **BA lần tôi đếm sai, ghi lại để không ai lặp:**
> 1. `grep -c "table:"` cho **156** — đếm cả khai báo `table: string;` của interface.
> 2. Regex `table:\s*"([a-z_]+)"` cho **154** — lớp ký tự thiếu chữ số, âm thầm bỏ sót `i18n_overrides`.
> 3. Tôi "đính chính" 465 → **446**, và đó là **thay một số ĐÚNG bằng một số SAI**, ngay trong doc
>    quản trị RC. FULL gate bắt được bằng hai phép kiểm chéo độc lập: dòng KI-042 đã merge ghi
>    *"tenant-isolation 454 passed / 11 skipped"* = **465**; và `465 + 155×4 + 4 = 1089` = đúng tổng
>    vitest in ra hôm nay. `it.skipIf` **vẫn được đăng ký và đếm** — đó là chỗ tôi trừ nhầm.
>
> Số đúng: **155 bảng · 465 ca trước · 1089 ca sau (+624)**. Thứ chốt được chúng không phải regex mà là
> **runtime**. Bài học: đếm bằng thứ đang chạy, đừng đếm bằng thứ đang đọc — và **đừng "đính chính"
> một con số nếu chưa kiểm chéo được nó ít nhất hai đường**.

### 1.2 Vế GHI đang phủ tới đâu

Quét **266** int-spec, cắt theo khối `it()`, phân loại khối vừa có câu GHI (`INSERT INTO` /
`UPDATE` / `DELETE FROM`) vừa có khẳng định DENY (`rejects` · `toThrow` · `toHaveLength(0)` ·
`.toBe(0)` · `violates row-level security` · `permission denied`), rồi tách theo việc khối đó có
nhắc tenant thứ hai hay không:

| Nhóm | Bảng |
| --- | --- |
| Có ca deny **GHI CHÉO TENANT** | **36 / 155** |
| Chỉ có deny GHI **trong tenant** (append-only…) | 31 |
| **Không có ca GHI-deny nào** | **88** |

⇒ **119 / 155 bảng (77%) chưa có lưới nào chạm vế `WITH CHECK`.** Đó là phạm vi thật của WO.

> ⚠️ **Đây là heuristic regex, không phải chứng minh.** Nó có thể đếm dư (khối `it()` dài ôm cả
> fixture lẫn assert của thứ khác) và đếm thiếu (spec đặt tên biến tenant khác `B`/`companyB`).
> Dùng nó để **khoanh phạm vi**, không dùng để tuyên bố "36 bảng đã an toàn".
> Tái lập: `node scripts/measure-tenant-write-coverage.mjs --list` (in đủ danh sách từng nhóm).

### 1.3 Vì sao lưới hiện tại mù vế GHI

`tenant-isolation.int-spec.ts` có **đúng 3 câu SQL**, cả 3 là `SELECT` (`visibleIds` · `idsNoContext`).
Ba `it` của mỗi bảng đều là vế ĐỌC. **Vế `WITH CHECK` của policy chưa từng bị chạm ở tầng registry** —
mà KI-032 (tenant admin ghi được lên role hệ thống toàn cục) chính là lỗ vế GHI.

---

## 2. Thiết kế — 3 ca GHI **generic**, không cần biết cột của từng bảng

Ràng buộc: registry chỉ cho `table`, `idColumn`, và `seedRow()` trả về một id. Harness **không**
biết schema từng bảng ⇒ mọi ca mới phải viết được **chỉ bằng** `table` + `idColumn` + 2 id đã seed.

Đứng trong ngữ cảnh tenant **A**, dùng role `mediaos_app`:

| Ca | SQL | Kỳ vọng |
| --- | --- | --- |
| **W1** — UPDATE hàng của B | `UPDATE <t> SET <id> = <id> WHERE <id> = :idB` | **0 hàng** (RLS `USING` che) *hoặc* bị từ chối (bảng append-only: app role không có UPDATE) |
| **W2** — DELETE hàng của B | `DELETE FROM <t> WHERE <id> = :idB` | **0 hàng** *hoặc* bị từ chối |
| **W3** — đẩy hàng CỦA MÌNH sang tenant B | `UPDATE <t> SET company_id = :B WHERE <id> = :idA` | **BỊ TỪ CHỐI** (RLS `WITH CHECK`, hoặc trigger `enforce_company_id_immutable`, hoặc thiếu quyền UPDATE). **Tuyệt đối không được "1 hàng"** |

- **W1/W2** dùng `SET <id> = <id>` (gán chính nó) nên chạy được trên **mọi** bảng, kể cả bảng không
  có `company_id` và junction table dùng `idColumn` thay thế.
- **W3** là ca **CHÍNH** — nó đánh thẳng vào vế `WITH CHECK` mà §1.3 nói chưa ai chạm. Bảng nào
  **không có cột `company_id`** (vd `role_permissions`) thì W3 **không áp dụng** → skip **có ghi lý do
  tường minh**, không skip im lặng.
- **Bảng append-only (BẤT BIẾN #2):** app role không có `UPDATE`/`DELETE` ⇒ cả 3 ca trả
  `permission denied`. Đó **vẫn là DENY** và là điều ta muốn — nhưng phải **phân biệt được**
  "denied vì thiếu quyền" với "0 hàng vì RLS", nếu không một bảng mất policy mà vẫn còn grant sẽ
  trông y hệt. Harness ghi lại **cơ chế** chặn của từng bảng.

### 2.1 Vì sao KHÔNG dựng file song song

done_when #2 nói rõ: mở rộng **chính** harness data-driven. File song song sẽ trôi khỏi registry —
đúng lớp lỗi mà `rls-registry.ts` sinh ra để chống.

---

## 3. RED-proof (done_when #3) — không có nó thì lưới chỉ là trang trí

Trên lane DB: `ALTER POLICY <p> ON <bảng> WITH CHECK (true)` cho **một** bảng → chạy lưới ⇒ **W3 của
đúng bảng đó phải ĐỎ và in đúng tên bảng**; khôi phục policy ⇒ xanh lại. Ghi log cả hai chiều vào
`docs/_review/`.

---

## 4. Các bước

0. **Baseline**: script đo (§1.2) commit vào `scripts/measure-tenant-write-coverage.mjs`; danh sách đầy
   đủ lấy bằng `--list` thay vì đóng băng một file markdown sẽ trôi ngay khi registry đổi.
1. Mở rộng `tenant-isolation.int-spec.ts`: thêm W1/W2/W3 cho mỗi bảng (đối xứng A↔B như vế đọc?
   — xem §5 ngân sách; mặc định chỉ chiều A→B để giữ thời gian chạy).
2. Ghi nhận **cơ chế chặn** từng bảng (RLS 0 hàng / WITH CHECK reject / permission denied / trigger)
   → bảng đối chiếu trong `docs/_review/`. Đây là thứ biến lưới thành **tài liệu sống** về vế GHI.
3. RED-proof (§3).
4. Lỗ THẬT phát hiện được → **vá NGAY trong WO này** (migration nối tiếp head lúc làm), KHÔNG tách WO
   mới để né FULL gate. Ngoài phạm vi ⇒ known-issue mới có S-level + owner.
5. Hai ca cụ thể từ FULL gate `S6-SEC-ORGSCOPE-1` (đã ghi trong `src[]` của WO) — xem §6.
6. Verify: `check.sh --lane-db`; thời gian chạy thêm ghi vào plan.

## 4bis. KẾT QUẢ

### Lưới sau khi mở rộng (lane `mediaos_tenantwrite`, chain `0000→0533`)

```text
465 ca  →  1089 ca      (+624)
thời gian chạy: 4.8s     ← không cần chia nhóm
Tests  1074 passed | 15 skipped
```

15 skip = **11** `skipNoContext` + **4** ca N/A (2 bảng không có `company_id` × 2 ca W0/W3),
skip **có in lý do**.

### Cơ chế chặn quan sát được — đây mới là phần có giá trị

| Ca | Kết quả |
| --- | --- |
| **W0** (INSERT mang `company_id` của B) | **RLS-WITH-CHECK × 146** · no-grant × 4 · `428C9` (generated column) × 3 |
| **W1** (UPDATE hàng của B) | rowCount=0 × 102 · no-grant × 53 |
| **W2** (DELETE hàng của B) | no-grant × 122 · rowCount=0 × 33 |
| **W3** (đẩy hàng của mình sang B) | RLS-WITH-CHECK × 93 · **no-grant × 52** · **trigger × 8** |

**`WITH CHECK` đã CHỨNG MINH chạy: 148/153 bảng.** Còn 5 chưa chứng minh được:
`dead_letter_events` · `dead_letter_alerts` · `system_job_runs` · `chat_messages` · `dashboard_widgets`.

> **Vì sao phải phân loại theo THÔNG ĐIỆP chứ không theo SQLSTATE:** Postgres trả **42501 cho CẢ HAI**
> `permission denied for table` (thiếu grant) lẫn `new row violates row-level security policy`
> (WITH CHECK làm việc). Bản đầu của tôi phân loại theo mã và cho ra bức tranh **sai theo hướng lạc
> quan**: 145 bảng "rejected(42501)" ở W3 trông như RLS đang bảo vệ, thực tế **52 trong số đó chỉ được
> che bởi việc app role KHÔNG có grant UPDATE**. Đó là phòng thủ nằm sai tầng — ngày một migration cấp
> UPDATE cho tính năng mới, `WITH CHECK` là thứ duy nhất còn lại.

### ⚠️ GIỚI HẠN của lưới — phải nói ra, không được để người đọc suy ra sai

FULL gate dựng đúng thí nghiệm này: tháo `WITH CHECK` của `team_members` rồi chạy W0 ⇒

```text
ERROR: duplicate key value violates unique constraint "team_members_team_user_active_uq"
```

`rejected = true` ⇒ **W0 VẪN XANH dù `WITH CHECK` đã bị vô hiệu hoàn toàn.** Nguyên nhân: W0 nhân bản
hàng của A và chỉ đổi `company_id` + `id`, nên **bất kỳ unique index nào KHÔNG chứa `company_id`** cũng
bị đụng trước khi RLS kịp phán. Đo catalog: **35/153** bảng có unique index kiểu đó; giao với nhóm W3
cũng mù (`no-grant` 52 + `trigger` 8) ⇒ **~19 bảng mà CẢ W0 lẫn W3 đều không phát hiện được** một
regression `WITH CHECK`.

Nghịch lý đáng ghi: **chính mig `0533` vừa thêm một tấm che mới** cho W0 của `team_members` (composite
FK bắn `23503` trước RLS) — may là W3 của bảng đó còn sống.

⇒ Đọc con số **148/153** cho đúng: *"148 bảng CHỨNG MINH ĐƯỢC `WITH CHECK` chạy **hôm nay**"*, **KHÔNG**
phải *"148 bảng sẽ ĐỎ nếu `WITH CHECK` hỏng"*. Việc thu hẹp khoảng này (probe bằng giá trị unique mới,
hoặc cho registry khai cột-bỏ-qua) ghi vào `S6-SEC-XTENANTFK-1`.

`classify()` nay tách thêm `unique-index` và `FK` thành nhãn riêng để tấm che hiện ra trong bảng tổng
kết thay vì ẩn dưới "rejected".

### RED-proof (done_when #3) — và một phát hiện về chính lưới này

`ALTER POLICY tenant_isolation ON goals WITH CHECK (true)` → chạy lưới:

```text
× goals > W0 · INSERT hàng mang company_id của B → PHẢI bị từ chối
  → INSERT ĐƯỢC 1 hàng … vế WITH CHECK KHÔNG chặn
Tests  1 failed | 1069 passed        ← đúng 1 ca, đúng tên bảng
```

Khôi phục policy ⇒ xanh lại.

**Nhưng W3 VẪN XANH trong lần đó** — và tôi không giải thích được ngay, nên đã lấy thông điệp gốc
(`GRID_DEBUG_TABLE=goals`) thay vì đoán:

```text
W0 → {"rejected":false,"rowCount":1}
W3 → {"rejected":true,"code":"42501",
      "message":"new row violates row-level security policy for table \"goals\""}
```

⇒ Nới `WITH CHECK` **chỉ mở đường INSERT**; đường UPDATE-sang-tenant-khác vẫn bị RLS chặn.
**Kết luận: W0 là ca CHỊU LỰC, W3 là defense-in-depth.** Giữ cả hai, nhưng **W3 xanh KHÔNG phải bằng
chứng** — lưới nay tự in ra danh sách bảng mà "W3 bị CHE bởi cơ chế khác" để không ai đọc nhầm màu xanh.

### Lỗ THẬT tìm được → vá NGAY trong WO (done_when #4)

Ca **(b)** của §6: `team_members` chèn được hàng `company_id = A` trỏ `team_id` của **B**
(`INSERT 0 1`) — kiểm tra FK của Postgres **bỏ qua RLS theo thiết kế**.

**Chứng minh A/B** (cùng code, khác trạng thái DB):

| Lane DB | Migration | Ca (b) |
| --- | --- | --- |
| `mediaos_orgscope` | `0000→0532` | **ĐỎ** — "Chèn được 1 hàng team_members của tenant A trỏ tới team của tenant B" |
| `mediaos_tenantwrite` | `0000→0533` | **XANH** |

Vá: migration **`0533`** — UNIQUE `teams(company_id, id)` + `users(company_id, id)`, và composite FK
cho **CẢ HAI CHÂN**: `team_members(company_id, team_id) → teams` **và**
`team_members(company_id, user_id) → users`, cùng `ON DELETE CASCADE`.

### ⚠️ Nó là CẢ MỘT LỚP, không phải bug lẻ — KI-045 (mới)

Đo trên catalog: **460 khoá ngoại một-cột** nối hai bảng đều có `company_id`. Composite đã có **2**
TRƯỚC migration này — `tasks_parent_same_company_fk` là **tiền lệ có sẵn trong repo** (bản đầu của tôi
ghi "chỉ 1, vừa thêm ở 0533" — sai) ⇒ số dư đúng là **458**, không phải 459. Không gộp vào WO này: mỗi cặp cần unique
constraint mới trên bảng đích + rà `ON DELETE` từng cái ⇒ thay đổi schema diện rộng, phải có gate
riêng. Đã mở **RELEASE-02 KI-045** + WO `S6-SEC-XTENANTFK-1`.

## 5. Ngân sách thời gian chạy

Đo thật: **+641 ca, +~0.4s**. Không cần chia nhóm (done_when #5 cấm giảm số bảng — không phải giảm).

## 6. Hai ca đến từ FULL gate `S6-SEC-ORGSCOPE-1` (2026-07-28, đo được chứ không phỏng đoán)

- **(a) Sàn tenant của `users` treo vào một cờ role.** Policy `users_all_tenant_read ON users FOR
  SELECT TO mediaos_readonly USING (true)` (mig `0346:66`) là read toàn tenant sống thật — đo:
  `SET LOCAL ROLE mediaos_readonly` thấy 4/4 user của **cả hai** tenant. `mediaos_app` là member
  nhưng `WITH INHERIT FALSE` (`0346:47`). Ai đó `GRANT mediaos_readonly TO mediaos_app` thiếu
  `INHERIT FALSE` ⇒ đọc chéo tenant **im lặng**.
  **Ca:** assert `pg_has_role('mediaos_app','mediaos_readonly','USAGE') = false`.
- **(b) Thiếu composite FK `team_members(company_id, team_id) → teams(company_id, id)`.** Đo:
  `mediaos_app` trong ngữ cảnh A **INSERT được** hàng trỏ `team_id` của B (`INSERT 0 1` — FK bỏ qua
  RLS theo thiết kế PG). Đường ĐỌC an toàn nhờ `innerJoin`, còn lại oracle đoán-UUID + `ON DELETE
  CASCADE` chéo tenant. Đúng dạng lỗ vế GHI mà KI-037 nói lưới hiện tại không chạm.
