# S7-CHAT-QA-1 🔒 — Bộ test trọn vẹn CHAT: nghiệm thu 12 nhóm §21 + bằng chứng RED-trước-GREEN

> Nguồn: SPEC-15 §20 (12 tiêu chí nghiệm thu) · §21 (12 nhóm scenario) · §12 (20 mã lỗi) · §19 (NFR).
> Zone **đỏ** (đường đọc-vượt membership + ranh giới tìm kiếm = bề mặt rủi ro lớn nhất module). Gate **FULL**.

---

## 0. Đo hiện trạng (05/08/2026, trên master `32ccd2a4`, lane `mediaos_s7qa1` migrate `0000→0541`)

WO này **không phải viết bộ test từ đầu**. 9 WO trước (DB-1 · BE-1…BE-9 · RT-0/1 · FE-1…FE-5) đã để lại
**13 file int-spec / 273 ca, xanh 100%** trên lane DB. Đo trước khi viết — nếu không, WO này chỉ đẻ ra
bản sao thứ hai của thứ đã có (memory `wo-plans-built-on-code-comments`).

| File | Ca | Kết quả trên `mediaos_s7qa1` |
| --- | --- | --- |
| `chat-be1-access.int-spec.ts` | 19 | ✅ |
| `chat-be1-rooms.int-spec.ts` | 14 | ✅ |
| `chat-be2-messages.int-spec.ts` | 29 | ✅ |
| `chat-be3-attachments.int-spec.ts` | 19 | ✅ |
| `chat-be4-search.int-spec.ts` | 22 | ✅ |
| `s7-chat-db1-invariants.int-spec.ts` | 38 | ✅ |
| `chat-be5-derived-rooms.int-spec.ts` | 26 | ✅ |
| `chat-be7-oversight.int-spec.ts` | 39 | ✅ |
| `chat-be8-file-upload.int-spec.ts` | 11 | ✅ |
| `chat-noti-e2e.int-spec.ts` | 24 | ✅ |
| `chat-rt0-ws-adapter.int-spec.ts` | 8 | ✅ |
| `chat-rt1-realtime.int-spec.ts` | 14 | ✅ |
| `chat-be-gate2-visible-from-seq.int-spec.ts` | 7 | ✅ |
| **Tổng** | **273** | **273 passed / 0 failed** |

### 0.1 Đối chiếu 12 nhóm §21 → tồn tại thật

| # | Nhóm §21 | Ca đang phủ | Trạng thái |
| --- | --- | --- | --- |
| 1 | Deny-path (RED trước) | `be1-access` ca 1–8 · 14 · `be2` ca 1–2 · `be4` ca 3/6/7/20 · `be3` ca 8 · `rt1` (WS ngoài phòng · thiếu cặp · bớt thành viên) | ✅ ĐỦ |
| 2 | Đọc-vượt membership §3.3 | `be7-oversight` ca 16–29 (39 ca) + `console/lib/nav.spec.ts` | ✅ ĐỦ |
| 3 | Ranh giới tìm kiếm | `be4-search` ca 1–6 · 19 · 20 · 23 | ✅ ĐỦ |
| 4 | **Validate — 20 mã lỗi §12, mỗi mã ≥1 ca** | 19/20 mã có ca | ❌ **LỖ: CHAT-ERR-002 = 0 ca** |
| 5 | Idempotent | `be2` ca 5 · `be1-rooms` ca 9/9b · `be3` ca 6 | ✅ ĐỦ |
| 6 | Thứ tự & phân trang | `be2` ca 3/4 · con trỏ · `be4` ca 13/21 | ✅ ĐỦ |
| 7 | Đã đọc | `be2` ca 17/18/18b/19/23 | ✅ ĐỦ |
| 8 | Đồng bộ phòng dẫn xuất | `be5-derived-rooms` A–E (26 ca) | ✅ ĐỦ |
| 9 | Append-only | `db1-invariants` A · B · H | ✅ ĐỦ |
| 10 | Tệp | `be3-attachments` (19) · `be8-file-upload` (11) | ✅ ĐỦ |
| 11 | Realtime | `rt0` (8) · `rt1` (14) | ✅ ĐỦ |
| 12 | **Hiệu năng** | N+1 CÓ (`be1-rooms` ca 11 · `be2` ca 20); **ngưỡng §19 ở quy mô KHÔNG có** | ⚠️ **NỬA LỖ** |

### 0.2 CHAT-ERR-002 — luật được ép ở HAI tầng, nhưng KHÔNG ca nào chạm tới

```text
grep CHAT-ERR-002 apps/api/test/  →  0 ca      ← lỗ THẬT, đây là mã duy nhất thiếu trong 20 mã §12
```

Đường thi hành thì đủ, và đủ ở **hai** tầng — ca test phải phân biệt được chúng:

| Tầng | Cơ chế | Mã HTTP |
| --- | --- | --- |
| Biên HTTP | `packages/contracts/src/chat.ts:35` — `roomType: z.literal("group").default("group")` | **400** (Zod) |
| Service | `chat-rooms.service.ts:140` — `if (dto.roomType !== "group") throw …CHAT_ERR.CREATE_TYPE` | **422** |

Vì Zod chạy trước, nhánh 422 **không tới được qua HTTP** — nó là defense-in-depth cho đường gọi
service nội bộ (job/bridge), đúng như jsdoc của `createGroup` nói. Đo một tầng là để hở tầng kia
(memory `module-closed-by-second-assert-not-scope`) ⇒ ca mới đóng đinh **cả hai**.

> ⚠️ **Đính chính so với bản plan đầu tiên:** hằng của CHAT-ERR-002 tên là **`CREATE_TYPE`**, và nó
> **có** caller. Census tự động (`chat-error-code-census.spec.ts`) đo lại và chỉ ra hai hằng CHẾT
> thật sự là **`BODY_INVALID`** (ERR-004 — Zod `min(1).max(4000)` gác) và **`EDIT_UNSUPPORTED`**
> (ERR-007 — ép bằng SỰ VẮNG MẶT: 0 route `@Patch`/`@Put` + column-GRANT ở DB). Cả hai đều là
> chết-LÀNH; ghim bằng allowlist tường minh để hằng chết THỨ BA làm đỏ.

### 0.3 §20 ca 12 (FE `useCanExact`) — đã có, nhưng KHÔNG ở `apps/app`

Màn CHAT-SCREEN-007/008 sống ở **`apps/console`**, không phải `apps/app`:
`console/src/lib/nav.spec.ts:40` đã có `it.each([["view:*"], ["*:chat-oversight"]])` → VẪN ẩn.

⚠️ **`paths` của WO thiếu `apps/console/src/**`** ⇒ hook `guard-scope` sẽ cảnh báo và gate có thể đọc
sai vùng (memory `wo-paths-drive-gate-and-scheduler`). Phải nới `paths` trong `harness/backlog.mjs`.

---

## 1. WO này thực sự làm gì

Ba việc, theo thứ tự giá trị giảm dần:

### 1.1 (TRỌNG TÂM) Chứng minh test CẮN THẬT — RED-trước-GREEN cho §20 ca 5·9·10·11·12

273 ca xanh **không** chứng minh gì cả nếu chưa ai thử phá vị từ và xem test có đỏ không.
`done_when` đòi đúng thứ này: *"chạy THẬT, bằng chứng RED trước GREEN lưu `docs/QA/evidence/`"*.
Bài học nền: memory `tests-can-pin-a-hole-open` · `reviewers-pass-real-bugs` · `vitest-globalsetup-teardown-exits-zero`
("đo cổng cần trạng thái VI PHẠM thật").

**Phương pháp — đột biến có kiểm soát (mutation probe):**

Với mỗi ca nghiệm thu, gỡ ĐÚNG MỘT vị từ ở **production code**, chạy tập ca liên quan, ghi lại
`FAIL`, rồi `git checkout --` khôi phục và chạy lại ghi `PASS`. Đột biến chỉ sống trong cây làm việc,
**không** commit.

| §20 | Vị từ bị gỡ (đột biến) | File | Kỳ vọng |
| --- | --- | --- | --- |
| ca 5 | vế membership trong vị từ tìm kiếm | `chat-search.repository.ts` | `be4` ca 1/5/6/9 ĐỎ |
| ca 9 | `PermissionGuard` cặp `('view','chat-oversight')` | `chat-oversight.controller.ts` | `be7` ca 16/16b/16c ĐỎ |
| ca 10 | `recordSuccess` (audit) khỏi đường đọc-vượt | `chat-oversight.service.ts` | `be7` ca 17/19 ĐỎ |
| ca 11 | (dùng chung đột biến ca 5) | — | `be7` ca 22 ĐỎ |
| ca 12 | `useCanExact` → `useCan` ở cổng nav | `console/src/lib/chat-oversight-gate.ts` | `nav.spec` ca `view:*` ĐỎ |

**Chốt an toàn:** đột biến chạy trên lane `mediaos_s7qa1`, KHÔNG bao giờ trên `mediaos`/`mediaos_dev`
(`scripts/lane-db-setup.sh` đã từ chối 2 tên đó). Script probe phải `git diff --stat` **trước và sau**
để chứng minh cây sạch trở lại — không tin "tôi đã revert rồi".

### 1.2 Bít 2 lỗ thật (nhóm 4 · nhóm 12)

**a. `chat-qa1-error-census.int-spec.ts`** — hai việc:
1. Ca cho **CHAT-ERR-002**: `POST /chat/rooms` với `roomType` `direct`/`department`/`project` → **400**,
   và `chat_rooms` **+0 hàng** (chặn ở biên, không rơi vào nhánh tạo rồi mới lỗi).
2. **Census máy-đọc**: quét toàn bộ `test/integration/chat-*.int-spec.ts`, khẳng định **cả 20 mã**
   `CHAT-ERR-001…020` đều xuất hiện ≥1 lần. Đây là cái chống trôi: thêm mã lỗi mới mà quên ca test
   thì ca census ĐỎ, không im lặng.
   > Vì sao census bằng grep nguồn chứ không bằng runtime: mã lỗi là **chuỗi trong thông điệp**, không
   > phải mã HTTP — không có bề mặt runtime nào liệt kê được chúng.

**b. `chat-qa1-scale.int-spec.ts`** — ngưỡng §19 ở quy mô, món BE-4 cố ý hoãn sang đây.

Ràng buộc từ chính bàn giao BE-4 + memory `pg-planner-index-assert-trap` / `idx-scan-zero-is-not-unused`:
- **CẤM** assert `EXPLAIN` chọn đích danh `idx_chat_messages_search` — planner đổi kế hoạch là hành vi
  tối ưu, assert vào đó là ĐỎ OAN.
- Đo trên "vài trăm hàng" là vô nghĩa. Gieo **≥50.000 tin** bằng `generate_series` (một câu INSERT,
  không 50k round-trip), phân bố nhiều phòng, có phòng actor KHÔNG thuộc.
- Assert **hành vi**, không assert thời gian tuyệt đối trên máy CI (flaky): 
  - vế CỨNG: kết quả tìm kiếm ở quy mô **vẫn không rò phòng ngoài** (ca 5 ở quy mô lớn — đây mới là
    thứ đáng đóng đinh);
  - vế CỨNG: `/chat/rooms` vẫn **1 truy vấn** khi có 50k tin (N+1 không xuất hiện theo quy mô);
  - vế MỀM (ghi số, `console.log`, **không** assert): p95 ms của `/chat/search` và `/messages?limit=50`
    → vào `docs/QA/evidence/` làm số đo tham chiếu cho §19.
  > Ngưỡng 800ms @ ~1 triệu tin **không** nghiệm thu được trên lane dev — ghi tường minh là NỢ đo ở
  > môi trường có dữ liệu thật, KHÔNG đóng dấu "đạt" bằng một dòng không ai chạy (memory
  > `wo-status-auto-ledger`).

### 1.3 Ma trận truy vết + bằng chứng

- `docs/QA/evidence/S7-CHAT-QA-1-TRACEABILITY.md` — 12 nhóm §21 × 12 tiêu chí §20 → **tên file : tên ca**
  có thật. Không có ô nào để trống; ô nào là NỢ thì ghi NỢ.
- `docs/QA/evidence/S7-CHAT-QA-1-RED-before-GREEN.md` — log thô 5 lần đột biến (FAIL) + khôi phục (PASS).
- `docs/QA/evidence/S7-CHAT-QA-1-COVERAGE.md` — số coverage thật.

---

## 2. Coverage — đo thế nào cho khỏi tự lừa

`done_when`: tổng **≥80%**, `ChatAccessService` + tìm kiếm **≥95%**.

```bash
npx vitest run test/integration/chat-*.int-spec.ts test/integration/s7-chat-*.int-spec.ts src/chat \
  --coverage --coverage.include='src/chat/**' --no-file-parallelism
```

Hai bẫy phải né:
1. **`src/chat` colocated spec phải nằm trong cùng lần chạy** — `apps/api` chỉ chạy `src/**/*.spec.ts`
   cho unit, `test/integration/**` cho int; đo coverage mà bỏ một trong hai glob là **thổi phồng hoặc
   dìm** con số (memory `coverage-audit-scan-both-globs`).
2. **`TURBO_FORCE=1`** khi chạy qua turbo — cache trả log CŨ là xanh-giả (memory `turbo-cache-false-green`).
   Ở đây gọi thẳng `npx vitest`, không qua turbo ⇒ không dính.

---

## 3. KHÔNG làm ở WO này (chống scope creep)

- ❌ **Không sửa production code.** Phát hiện gì (hằng `GROUP_ONLY` chết…) thì ghi vào phần "Phát hiện"
  + backlog, không tự vá — WO QA mà sửa service là gate đọc sai vùng và review mất mốc.
- ❌ **Không viết lại** 273 ca đang xanh thành "bộ test QA-1" mới. Trùng lặp = hai nguồn sự thật.
- ❌ **Không** chạm `S7-CHAT-CLEAN-1` (drop cột) — WO riêng, phụ thuộc WO này.
- ❌ **Không** dùng Super Admin làm chủ thể bất kỳ ca oversight nào (memory `superadmin-not-a-canonical-role`).

---

## 4. Rủi ro

| # | Rủi ro | Chặn bằng |
| --- | --- | --- |
| 1 | Đột biến probe bị commit nhầm → mở lỗ thật trên master | Script in `git status --porcelain` sau khi revert; gate FULL đọc diff cuối |
| 2 | Ca scale 50k làm suite chậm/flaky | Gieo bằng 1 câu `generate_series`; assert hành vi chứ không assert ms |
| 3 | `paths` WO thiếu `apps/console/**` ⇒ `guard-scope` cảnh báo | Nới `paths` trong `backlog.mjs` **trước** khi sửa file console |
| 4 | Coverage đo thiếu glob ⇒ số đẹp giả | Chạy cả `test/integration/chat-*` **và** `src/chat` trong MỘT lệnh |
| 5 | Chạy `pnpm test` không `LANE_DB` ⇒ SKIP đúng ca deny-path quan trọng nhất | Mọi lệnh đi qua runner nạp `.env` + `LANE_DB=mediaos_s7qa1`; kết luận cuối bằng `harness/check.sh --all` |

---

## 5. Definition of Done

- [ ] 273 ca cũ + ca mới **xanh thật** trên `LANE_DB` (không phải `pnpm test` trần).
- [ ] Cả 20 mã lỗi §12 có ≥1 ca; ca census chống trôi tồn tại.
- [ ] 5 bằng chứng RED-trước-GREEN (§20 ca 5·9·10·11·12) lưu `docs/QA/evidence/`, cây code sạch sau probe.
- [ ] Ma trận truy vết 12 nhóm §21 không ô trống.
- [ ] Coverage: tổng ≥80%, `chat-access.service.ts` + `chat-search.*` ≥95% — số THẬT dán vào evidence.
- [ ] `bash harness/check.sh --all` xanh; FULL gate PASS.
