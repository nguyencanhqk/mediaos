# Kế hoạch thi công wave S7-CHAT

> **Loại:** kế hoạch cấp WAVE (không phải plan của một WO). Plan chi tiết từng WO nằm ở `docs/plans/S7-CHAT-<WO>.md`, viết ngay trước khi thi công WO đó.
> **Nguồn sự thật nghiệp vụ:** [SPEC-15 CHAT](<../SPEC/SPEC-15 CHAT.md>) · [DB-12](<../DB/DB-12 CHAT Database Design.md>) · [API-13](<../API Design/API-13_CHAT_API_Design.md>) · [ma trận phân quyền §9c](<../permission-matrix-spec.md>)
> **Ngày lập:** 02/08/2026 · **Trạng thái:** chờ thực thi Bước 0

---

## 1. Điểm xuất phát (đo thật, không theo trí nhớ)

| Sự việc | Bằng chứng |
| --- | --- |
| Bộ docs CHAT **đã trên master** | PR #319 squash tại `984dfa24` — SPEC-15 (606 dòng) · DB-12 (361) · API-13 (207) + seed 16 WO |
| 3 bảng chat **đã tồn tại thật** trong DB | mig `0010` (tạo) + `0050` (mở rộng): RLS+FORCE, `chat_messages` append-only, `seq` identity, `direct_key`, composite tenant FK ở `0535` |
| `audit_logs.object_type` đã có `chat_room` + `chat_message` | mig `0050` — **chỉ verify fail-loud, KHÔNG UNION-ADD lại** |
| Gateway `/ws` + Valkey adapter còn sống, **0 `@SubscribeMessage`** | cụm chat bị gỡ ở `CLEAN-DECOUPLE-1`; v1 giữ nguyên WS một chiều |
| Code chat cũ `apps/api/src/chat/` đã `git rm` | `2591db13` — chỉ kiểm membership, **không** permission guard/audit, trả 403 chỗ đáng lẽ 404 ⇒ **tham chiếu, cấm khôi phục** |
| Migration head hiện tại | idx 204 — `0537_s6leavecarryover1_carry_forward` (205 migration). Số `0536+` viết trong DB-12 là **dự kiến, đã trôi** |

**Còn treo ở `S7-CHAT-DOC-1`:** owner chốt §22 → flip §1 Draft→Approved → plan-reviewer PASS. Chưa xong ba việc đó thì không WO code nào được mở.

---

## 2. Quyết định owner — chốt 02/08/2026

| Mã | Quyết định | Kết quả |
| --- | --- | --- |
| **Khởi công** | Thi công trên nhánh wave, **KHÔNG merge `master`** cho tới khi go-live đóng | ✅ chốt |
| **CHAT-DEC-004** | **Super Admin đọc được mọi phòng, có audit** | ⚠️ **NGƯỢC đề xuất spec** — xem §3 |
| **CHAT-DEC-008** | Thành viên mới đọc **toàn bộ** lịch sử phòng | ✅ theo đề xuất |
| 001·002·003·005·006·007·009·010·011·012 | Chốt theo đề xuất SPEC-15 §22 | ✅ theo đề xuất |

Cụ thể nhóm chốt-theo-đề-xuất: 4 loại phòng bỏ `channel` · membership là ranh giới dữ liệu · phòng ban/dự án thành viên dẫn xuất · WS một chiều (client ghi qua REST) · không sửa tin ở v1 · cửa sổ thu hồi **15 phút** · **KHÔNG** chat theo từng task · noti chỉ mention + DM gộp lô · payload noti **không** chứa nội dung tin · tìm kiếm bằng `unaccent` + `tsvector('simple')` trong Postgres.

---

## 3. Bước 0 — `S7-CHAT-DOC-2`: hoà DEC-004 vào bộ docs ✅ **XONG 02/08/2026**

SPEC-15 được viết quanh mệnh đề "**không ai** đọc được phòng mình không thuộc, kể cả Super Admin". Owner chốt ngược lại. Đây **không phải sửa một dòng bảng §22** — nó là tiền đề của §3.3, §4.1, §11, §18, §21 và của cả `ChatAccessService`. Sửa docs trước, code sau; nếu để lệch thì mọi WO code sau đây thi công theo một spec đã sai.

### 3.1 Thiết kế đã chốt cho quyền đọc-vượt-membership

> **Tên cặp chốt cuối = `('view','chat-oversight')`** (bản nháp mục này ghi `('read_all','chat-room')`). Lý do đổi: `read_all` **không** nằm trong tập động từ canonical đang seed (`view` 140 lần · `update` 114 · `read` 100 · `create` 87 · `delete` 76 · `manage` 69 · … — không có `read_all`, không có `moderate`, không có `oversee`). Giữ động từ canonical `view` và phân biệt bằng **resource riêng** `chat-oversight` cũng làm gate dễ grep hơn: ai tìm mọi cổng đọc phòng bằng `chat-room` sẽ không vô tình quét trúng đường đọc-vượt.

| Điểm | Chốt | Vì sao |
| --- | --- | --- |
| **Cặp quyền RIÊNG**, không nới `view:chat-room` | cặp thứ 10: `('view','chat-oversight')` | Nới scope của `view:chat-room` buộc **mọi** route thường phải tự phân biệt member/SA ⇒ đúng lỗ `read-path-gate-pair-must-match-download-pair`. Cặp riêng giữ đường đọc thường **fail-closed nguyên vẹn**, chỉ một nhánh mới phải chứng minh |
| Chỉ Super Admin giữ cặp — nhưng **KHÔNG grant trong migration** | catalog `permissions` có cặp; `role_permissions` **0 hàng** cho mọi role canonical. SA nhận qua `SuperAdminBootstrapService` lúc boot | ⚠️ **`super-admin` KHÔNG phải role canonical** (4 canonical = `roles.company_id IS NULL`, SA không có hàng ở đó — `dashboard-widget-catalog.const.ts:33`, mirror `0481:35`). Viết `WHERE code='super-admin'` trong migration khớp **0 hàng** ⇒ verify "SA có cặp" **luôn đỏ** ⇒ người thi công dễ grant nhầm sang `company-admin`, đúng role SPEC-15 §11 cấm. Verify trong migration chỉ một vế: **0 role canonical giữ cặp**; khẳng định SA có cặp là **int-spec sau boot** |
| `is_sensitive = **true**` cho riêng cặp này | 9 cặp kia giữ `false` | Phải khai vào `SENSITIVE_CAPABILITY_ALLOWLIST` — **backend** `apps/api/src/permission/permission.service.ts` (KHÔNG phải file FE; `getCapabilities()` lọc bỏ mọi cặp sensitive khỏi `/auth/me` trừ khi có trong allowlist), pin bởi `auth-me-capabilities.int.spec.ts`. Thiếu ⇒ màn quản trị **ẩn dù DB có quyền** (KI-058). FE gate bằng **`useCanExact`** — `useCan` rơi xuống `*:*` nên sẽ hiện lối vào cho mọi người giữ wildcard trong khi BE vẫn 403 |
| **Audit BẮT BUỘC mỗi lần dùng** | **thành công**: `resultStatus:'Success'` trong **cùng** tx với truy vấn đọc, ghi trước khi trả · **từ chối**: `resultStatus:'Denied'` trong tx **RIÊNG đã commit** rồi mới ném 403. `action='chat.oversight.read'`, `object_type='chat_room'` (có sẵn từ 0050) | Hai bẫy đều PASS review rồi hỏng lặng lẽ: `AuditService.record(tx,…)` chỉ ghi trong tx nên ném 403 cùng tx sẽ **rollback mất** dòng audit từ chối; và `PermissionGuard` **class-level** làm thân controller không chạy ⇒ **không dòng audit nào**. Vì vậy đường oversight **tự kiểm quyền trong service** |
| **KHÔNG cấp quyền tải tệp** | `ChatMessageFileResolver` cấm đọc cặp `chat-oversight`; DTO oversight trả metadata tệp **không kèm URL ký** | Thêm cặp vào resolver đẻ đường tải qua route FOUNDATION Files — **không dòng audit CHAT nào**. Tái dùng nguyên DTO tin nhắn thường (kèm URL ký) làm chính payload oversight phát ra khoá đọc tệp không cần membership |
| **Tìm kiếm KHÔNG mở theo** — vẫn bó theo membership | `S7-CHAT-BE-4` giữ nguyên vị từ membership | Đây là đường đọc rộng nhất module. Mở tìm-kiếm-toàn-cục biến một ô search thành cửa xuất toàn bộ nội dung công ty, và audit sẽ ghi theo *câu truy vấn* chứ không theo *phòng* ⇒ mất dấu vết. SA muốn đọc thì mở đích danh một phòng, có dấu vết từng phòng |
| **Lối vào tường minh trên UI**, không trộn vào danh sách phòng thường | màn quản trị riêng + xác nhận "xem với tư cách quản trị" | Không bao giờ xảy ra do vô ý; và làm audit có nghĩa |
| DM cũng nằm trong phạm vi đọc-vượt | ghi rõ ở RELEASE-11 Admin Guide | "Mọi phòng" bao gồm tin nhắn riêng — phần nhạy cảm nhất, phải nói thẳng trong tài liệu quản trị chứ không chôn trong code |

### 3.2 File đã sửa ở Bước 0 (02/08/2026)

- ✅ `docs/SPEC/SPEC-15 CHAT.md` — §1 Draft→**Approved** · **§3.3 viết lại** (bảng 7 ràng buộc đóng khung) · §4.1 mục 5 · §6 dòng BOD/Admin · §9 thêm **CHAT-SCREEN-007/008** · §11 bảng 9→**10 cặp** + `is_sensitive` hỗn hợp · §12 thêm **CHAT-ERR-019/020** · §15 thêm **CHAT-API-018/019** · §18 · §20 ca 9/10/11 · §21 nhóm deny-path mới · §22 điền 12 kết quả + ghi chú lịch sử · §24 · §25
- ✅ `docs/permission-matrix-spec.md` §9c — bảng 9→10 cặp; viết lại dòng "Không có cặp nào cho phép đọc phòng mình không thuộc"; `is_sensitive` hỗn hợp
- ✅ `docs/DB/DB-12 CHAT Database Design.md` bước D — 10 cặp, verify fail-loud **cả hai vế**
- ✅ `docs/DB/DB-10_…` — dòng seed CHAT (bắt được khi rà chéo: vẫn ghi "9 cặp")
- ✅ `docs/API Design/API-13_CHAT_API_Design.md` — §3 · §4.2 · §5 khối endpoint · **§5.3 MỚI** (4 endpoint + 6 ràng buộc thi công)
- ✅ `harness/backlog.mjs` — `DB-1` (10 cặp) · `BE-1` (chủ thể deny-path **không được là SA**) · `BE-4` (**không** mở tìm kiếm) · `QA-1`; seed `S7-CHAT-DOC-2` · **`S7-CHAT-BE-7`** · **`S7-CHAT-FE-5`**

**Rà chéo — ĐÍNH CHÍNH.** Bản đầu của mục này ghi "0 chỗ còn khẳng định mệnh đề cũ". Sai: lệnh grep khi đó bị `head -20` **cắt cụt**, và `plan-reviewer` bắt được 4 chỗ còn sót — `SPEC-15:497` (bảng seed bắt buộc, chính là nguồn DB-1 đọc), `SPEC-15:615` (§23.3), `backlog.mjs:9440` (**title** của DB-1), `S7-CHAT-WAVE.md:49`. Tất cả đã vá ở vòng sau. Bài học ghi lại vì nó sẽ tái diễn: **đừng dùng grep có `head` làm bằng chứng phủ định** — số dòng bị cắt trông giống hệt số dòng không tồn tại.

### 3.3 Vòng `plan-reviewer` thứ nhất — verdict **BLOCK**, 8 mục chặn, đã vá hết

| # | Phát hiện | Vá |
| --- | --- | --- |
| B1 | Đường **tệp đính kèm** hở: không file nào nói oversight xử lý tệp thế nào ⇒ hoặc resolver nhận thêm cặp (đường tải **không audit CHAT**), hoặc DTO dùng chung phát ra **URL ký** không cần membership | Ràng buộc 7 ở API-13 §5.3 + hàng mới ở SPEC-15 §3.3: resolver **cấm** đọc cặp oversight, DTO trả metadata **không kèm URL ký** |
| B2 | **CHAT-ERR-019 và 020 đòi hai mô hình transaction ngược nhau** — ném 403 trong cùng tx làm **rollback mất** dòng audit từ chối; `PermissionGuard` class-level làm thân controller không chạy ⇒ **không audit nào** | Chốt tường minh: từ chối → tx **riêng đã commit** rồi mới ném; thành công → **cùng** tx. Service tự kiểm quyền, không dựa guard class-level |
| B3 | **`super-admin` KHÔNG phải role canonical** ⇒ verify "SA có cặp" trong migration **luôn đỏ**, lối thoát dễ nhất là grant nhầm sang `company-admin` | DB-12 bước **D′**: chỉ vào catalog, verify **0 role canonical giữ cặp**; SA nhận qua bootstrap, khẳng định bằng **int-spec sau boot** |
| B4 | Allowlist cặp nhạy cảm nằm ở **backend** `permission.service.ts`, không phải FE — và **không WO nào** có file đó trong `paths` ⇒ KI-058 tái diễn nguyên xi | Sửa 5 chỗ docs + thêm `permission.service.ts` và `auth-me-capabilities.int.spec.ts` vào `paths` của DB-1 |
| B5 | FE-5 chỉ định `useCan`, mà `useCan` rơi xuống `*:*` ⇒ lộ lối vào màn nguy hiểm nhất cho mọi người giữ wildcard | Đổi sang **`useCanExact`** + ca test "tài khoản chỉ có `*:*` → không thấy lối vào" |
| B6 | Ca test **đường thành công** dùng SA ⇒ **tautology**: xanh kể cả khi guard khai sai resource hoặc **quên guard** | Chủ thể = role dựng trong test được grant đúng cặp, kèm ca đối chứng bỏ cặp → 403 |
| B7 | Migration **đỏ trên DB có dữ liệu**: `sync_source` là cột mới DEFAULT `'manual'` nhưng CHECK ép `department→'department'` | Bước A: backfill + đếm fail-loud **trước** `ADD CONSTRAINT` (hoặc `NOT VALID` → `VALIDATE`) |
| B8 | `attachment_count`: "cùng transaction nên không cần GRANT" là **sai** — quyền Postgres không đến từ cùng tx ⇒ **mọi tin có tệp 500** | Đặt `attachment_count` **ngay trong câu INSERT**, cấm UPDATE sau |

Ngoài 8 mục trên còn vá: mâu thuẫn ở `permission-matrix:348` · 4 chỗ "9 cặp" · số mã lỗi 18→**20** + ánh xạ HTTP cho 019 (403) và 020 (**500**, cấm 200-rỗng) · số nhóm scenario 11→**12** · `visible_from_seq` chốt **NULL** (không phải `0`) · `CHAT-ERR-017` chốt **404** để không thành oracle · hình dạng dòng audit (`action`/`object_id`/`result_status`/`module_code`) · `CHAT-API-019` phải bó `action` + `module_code` · `CHAT-API-018a` phải có từ khoá ≥2 ký tự + trần trang · ràng buộc 8 (oversight **không** tái dùng truy vấn JOIN membership, nếu không trả **rỗng** — hỏng lặng lẽ chiều ngược lại).

**Chốt cửa Bước 0:** `plan-reviewer` chạy lại và PASS (đây cũng là `done_when` #5 của `S7-CHAT-DOC-1`).

### 3.4 Hai WO mới sinh ra từ DEC-004

| WO | Zone | Vì sao tách riêng |
| --- | --- | --- |
| `S7-CHAT-BE-7` — đường đọc-vượt `/chat/oversight/*` | 🔴 red | Controller + service **riêng**. Nhét nhánh `if (isOversight)` vào `BE-1`/`BE-2` sẽ phá vĩnh viễn tính chất "đường đọc thường gọi `assertMember` vô điều kiện" — tính chất khiến đọc code là **chứng minh được** |
| `S7-CHAT-FE-5` — CHAT-SCREEN-007/008 | 🟡 yellow | Lối vào tường minh + nhật ký đọc-vượt xem được trên UI. Audit không ai xem được thì không phải kiểm soát |

---

## 4. Chiến lược nhánh & fence go-live

Go-live **chưa đóng**: RELEASE-10 còn G1 · G7 · G8 · G10 ⬜, phán quyết **NO-GO** (5 ô chưa đạt). Nhưng ledger đã đóng dấu `S6-GOLIVE-1` **xong**, nên mắt xích `depends_on: ["S7-CHAT-DOC-1", "S6-GOLIVE-1"]` của `S7-CHAT-DB-1` **tự tính là đã mở**. Fence tự động không còn bảo vệ — phải thay bằng fence thủ công:

```text
nhánh wave:   wave/s7-chat          (mergeBase = master)
mỗi WO:       wo/s7-chat-<xx>  →  PR vào  wave/s7-chat     ❗KHÔNG vào master
autoMerge:    TẮT  (gh workflow disable "Auto-merge" khi base là nhánh wave)
merge master: MỘT LƯỢT, sau khi G1·G7·G8·G10 đạt và RELEASE-10 lật sang GO
```

Ba việc phải làm khi lập nhánh: rebase `wave/s7-chat` lên master **định kỳ** (master vẫn nhận fix go-live); `S7-CHAT-DB-1` **đọc `migrations/meta/_journal.json` thật** lấy head lúc thi công, không dùng số trong DB-12; mỗi WO chạy trên `LANE_DB` riêng, drop sau khi xong (pgdata đã từng phình vì 325 lane DB bỏ quên).

---

## 5. Chuỗi thi công

Đường găng (mỗi mũi tên = phụ thuộc cứng):

```text
DOC-1 ─→ DOC-2 ─→ DB-1 ─→ BE-1 ─→ BE-2 ─┬─→ BE-3 ─┬─→ BE-7 ─→ FE-5 ─┐
 (chốt)  (DEC-004)  🔴     🔴      🔴    │   🔴    │  🔴 đọc-vượt    │
                                        ├─→ BE-4  │                  │
                                        ├─→ RT-1  ├─→ FE-1 ─→ FE-2 ─→ FE-3 ─┤
                                        └─→ BE-6  │                          ├─→ QA-1 ─→ CLEAN-1
                     BE-5 (sau BE-1) ────────────┘         FE-4 (sau FE-2+BE-4)┘

BE-7 ← {BE-2, BE-3}: cạnh BE-3 là CÓ CHỦ Ý — BE-3 là WO gắn URL ký vào DTO tin nhắn; nếu BE-7
xong trước, BE-3 có thể mở lại lỗ tệp (B1) mà không ai review lại BE-7. Không tạo vòng lặp, và
KHÔNG kéo dài đường găng: FE-2 vốn đã phụ thuộc BE-3.
```

| # | WO | Zone | Gate + model | Ghi chú thi công |
| --- | --- | --- | --- | --- |
| 0 | `S7-CHAT-DOC-2` | green | LIGHT · Sonnet | Bước 0 §3. Docs-only ⇒ push thẳng nhánh wave được |
| 1 | `S7-CHAT-DB-1` | 🔴 red | **FULL** · Opus + micro-plan | **Lane nối tiếp duy nhất chạm schema.** RLS/FORCE đã có sẵn — việc mới là ALTER 3 bảng, column-GRANT (`recalled_at`,`recalled_by` — **tuyệt đối không** GRANT UPDATE cấp bảng, không DELETE), `f_unaccent` **IMMUTABLE** wrapper (dùng `unaccent()` gốc STABLE trong cột generated = migration ĐỎ), seed 10 cặp + `sequence_counters('chat_room')` cho **mọi** company, nới CHECK NOTI trên **CẢ HAI** bảng `notification_events` **và** `notifications` |
| 2 | `S7-CHAT-BE-1` | 🔴 red | FULL · Opus + micro-plan | `ChatAccessService` = **điểm khẳng định membership duy nhất**, fail-closed, **404 không phải 403**. Nhánh đọc-vượt **KHÔNG** nằm ở WO này — nó là controller+service riêng ở `S7-CHAT-BE-7`. `assertMember` **không** có tham số/cờ bỏ qua membership |
| 3 | `S7-CHAT-BE-2` | 🔴 red | FULL · Opus + micro-plan | Đọc theo con trỏ `seq` (**cấm offset**) · gửi idempotent theo `clientMessageId` · thu hồi 15 phút · ghim ≤20 · `last_read_seq` chỉ-tiến |
| 4a | `S7-CHAT-BE-3` | 🔴 red | FULL · Opus | Đính kèm qua FOUNDATION Files + **`ChatMessageFileResolver` BẮT BUỘC** — FilePolicy fail-closed, thiếu resolver là tính năng chết trong im lặng |
| 4b | `S7-CHAT-BE-4` | 🔴 red | FULL · Opus | **Đường đọc rộng nhất module.** Luôn bó theo phòng người tìm là thành viên — **không** nới theo DEC-004 (§3.1) |
| 4c | `S7-CHAT-RT-1` | 🔴 red | FULL · Opus | Join phòng **server-side lúc handshake** (không nhận danh sách phòng từ client) · emit **SAU commit** · membership đổi thì join/leave ngay |
| 4d | `S7-CHAT-BE-6` | 🟡 yellow | LIGHT · Sonnet | Qua `OutboxNotificationBridge`. `registerSource()` **chỉ** chạy sau khi DB-1 seed catalog — bridge fail-loud lúc boot nếu eventCode chưa `isEnabled=true` ⇒ **API sập lúc khởi động** |
| 4e | `S7-CHAT-BE-5` | 🔴 red | FULL · Opus | Phòng dẫn xuất theo phòng ban/dự án + job đối soát **định kỳ** idempotent (lưới an toàn; đường thu hồi chạy TRONG tx nguồn) |
| 5 | `S7-CHAT-FE-1` | 🟡 | LIGHT · Sonnet | **MỘT** kết nối WS duy nhất cho toàn app shell, dùng chung giữa trang full-screen và panel nổi |
| 6 | `S7-CHAT-FE-2` | 🟡 | LIGHT · Sonnet | Trang `/chat` 3 cột |
| 7 | `S7-CHAT-FE-3` | 🟡 | LIGHT · Sonnet | Panel nổi (≤3 hội thoại) + badge header; thay lối vào `/chat` tạm của LMS |
| 8 | `S7-CHAT-FE-4` | 🟢 | LIGHT · Sonnet | Màn tìm kiếm + tab tệp/ghim/thành viên |
| 4f | `S7-CHAT-BE-7` 🔒 | 🔴 red | **FULL** · Opus + micro-plan | Đọc-vượt `/chat/oversight/*` — controller/service **riêng**, chỉ đọc, audit cùng transaction, không WS, không search. Bề mặt rủi ro lớn nhất module |
| 8b | `S7-CHAT-FE-5` 🔒 | 🟡 | LIGHT · Sonnet | CHAT-SCREEN-007/008 — xác nhận "xem với tư cách quản trị" + nhật ký. Cặp nhạy cảm ⇒ **phải** vào `SENSITIVE_CAPABILITY_ALLOWLIST` (**backend**), gate bằng `useCanExact`, nghiệm thu bằng role **không phải SA** |
| 9 | `S7-CHAT-QA-1` | 🔴 red | FULL · Opus | 12 nhóm scenario §21 **trên LANE_DB** + E2E + coverage ≥80% (membership/tìm kiếm cao hơn) |
| 10 | `S7-CHAT-CLEAN-1` | 🔴 red | FULL · Opus | **Release SAU** (expand-contract): DROP `channel_id` · `file_url` · `file_name` — chỉ khi đã xác minh 0 hàng **và** 0 tham chiếu |

Đa số WO là **red zone**: quyền/membership/append-only/migration. Áp CLAUDE.md §6 — Opus + micro-plan qua `plan-reviewer` trước khi code, FULL gate (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) sau khi code.

---

## 6. Test RED-trước bắt buộc (viết trước khi có code)

| Ca | Kỳ vọng | Bắt được gì |
| --- | --- | --- |
| App role chạy `UPDATE chat_messages SET body=…` và `DELETE FROM chat_messages` | **lỗi quyền ở tầng DB** | Reviewer đọc code service **không** thấy được lỗ này |
| Người không phải thành viên gọi mọi endpoint có `roomId` | **404**, không phải 403 | 403 xác nhận phòng có tồn tại — rò siêu dữ liệu |
| Tìm kiếm bởi người không thuộc phòng | 0 kết quả từ phòng đó | Đường đọc rộng nhất |
| Tải tệp đính kèm bởi người không thuộc phòng | từ chối | Cặp gate tải tệp phải **trùng** cặp đường đọc |
| Role KHÔNG có `('view','chat-oversight')` gọi endpoint đọc-vượt | **403** *và vẫn +1 hàng audit `Denied`* | DEC-004 chỉ mở cho Super Admin. Chủ thể là role dựng trong test — **không** dùng SA (SA có `*:*` ⇒ lọt) |
| Super Admin dùng đọc-vượt | trả dữ liệu **VÀ** có đúng 1 hàng `audit_logs` | Audit im lặng = mất toàn bộ giá trị của "có audit" |
| Cross-tenant trên cả 3 bảng, cả đọc lẫn **ghi** | 0 hàng / từ chối | Lưới `S6-QA-TENANTWRITE-1` |

Chạy bằng `bash harness/check.sh --lane-db` — `pnpm test` không có `LANE_DB` **bỏ qua** phần lớn int-spec ⇒ xanh-giả.

---

## 7. Bẫy đã biết, đã neo sẵn

1. **CHECK NOTI nằm ở HAI bảng** — nới ở `notification_events` mà quên `notifications` ⇒ mọi thông báo CHAT vỡ lúc INSERT (đã ship thật với GOAL ở `0507`, vá ở `0529`).
2. **`f_unaccent` phải IMMUTABLE** — `unaccent()` gốc chỉ STABLE, không dùng được trong cột generated.
3. **`is_sensitive` chốt trước khi seed** — flip sau seed làm ĐỎ pin `auth-seed-canonical-roles`.
4. **Allowlist cặp nhạy cảm ở BACKEND** (`apps/api/src/permission/permission.service.ts`)** — quyền có trong DB mà thiếu allowlist thì màn **ẩn**; test bằng tài khoản SA **không tái hiện được** (SA lọt nhờ tai nạn `*:*`) ⇒ phải test bằng role thường.
5. **`sequence_counters('chat_room')` cho MỌI company** — thiếu là `SequenceNotFoundError` ngay phòng đầu tiên.
6. **`registerSource()` fail-loud lúc boot** — thứ tự DB-1 trước BE-6 là bắt buộc, không phải khuyến nghị.
7. **`contracts/chat.ts` bỏ `'channel'` CÙNG COMMIT với migration đổi CHECK** — tách ra là FE/BE lệch DB.
8. **Đếm 0 hàng `room_type='channel'` TRƯỚC** khi đổi CHECK; có hàng thì migrate sang `'group'`.
9. **`guard-immutability` quét cả comment** — nhắc tên bảng append-only kèm SQL trong comment cũng bị chặn.

---

## 8. Definition of Done của wave

- [ ] 12 quyết định §22 điền kết quả; SPEC-15 §1 = **Approved**; §3.3/§11 phản ánh đúng DEC-004 đã chốt
- [ ] `plan-reviewer` PASS trên SPEC-15 + DB-12
- [ ] 16 WO (+2 sinh thêm từ DEC-004) xanh trên `wave/s7-chat`, mỗi WO có FULL/LIGHT gate đúng zone
- [ ] `harness/check.sh --all` xanh **có `LANE_DB`** (không phải "xanh không đủ bằng chứng")
- [ ] Coverage ≥80%, vùng membership + tìm kiếm cao hơn
- [ ] **Không** commit nào của wave vào `master` trước khi RELEASE-10 lật sang **GO**
- [ ] `CLEAN-1` để lại release **sau**, không gộp

---

## 9. Việc kế tiếp

1. Thực thi **Bước 0** (`S7-CHAT-DOC-2`) — hoà DEC-004 vào 5 file docs + backlog.
2. `plan-reviewer` đối kháng trên SPEC-15 + DB-12 đã sửa.
3. Lập nhánh `wave/s7-chat`, tắt auto-merge, viết micro-plan `S7-CHAT-DB-1` (Sonnet 5 + effort `xhigh`), qua `plan-reviewer`, rồi mới code.
