# S16-SOCIAL-QA-1 — nghiệm thu QA SOCIAL «bảng tin nội bộ» (bằng chứng đo)

> Work Order: `harness/backlog.mjs` → `S16-SOCIAL-QA-1`. Nguồn luật: [`SPEC-16 SOCIAL`](../../spec/SPEC-16%20SOCIAL.md)
> · [`API-19`](../../API%20Design/API-19_SOCIAL_API_Design.md) (59 route) ·
> [`permission-matrix-spec`](../../permission-matrix-spec.md) (15 cặp `feed*`, grant theo vai). Plan + khảo sát khoảng
> trống: [`docs/plans/S16-SOCIAL-QA-1.md`](../../plans/S16-SOCIAL-QA-1.md).
> Nhánh `test/s16-social-qa-1` cắt từ master `a3283ce3`. Lane DB `mediaos_qa1`. Ngày đo: **2026-10-09**.

File này là **nguồn duy nhất** của các bảng chi tiết (ma trận route × vai · mã lỗi → ca · mutant). QA-02 và
TESTABLE-FEATURES chỉ trỏ về đây. Viết tắt: `T/` = `apps/api/test/integration/` · `H/` = `apps/api/test/helpers/` ·
`S/` = `apps/api/src/social/`. Tên file int-spec trong bảng bỏ tiền tố `s16-social-qa1-` và đuôi `.int-spec.ts` khi
không gây nhầm (`pair-matrix` = `T/s16-social-qa1-pair-matrix.int-spec.ts`).

Ba nhãn độ chắc dùng trong file: **ĐO ĐƯỢC** (có lượt chạy / log) · **SUY RA** (đọc code, không chạy) · **CHƯA ĐO**.

---

## 1. Truy vết tiêu đề WO + 3 `done_when` → ca

### 1.1 Tiêu đề WO

| Vế của tiêu đề                                                            | File                                                          | Dải mã ca                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Ma trận allow / deny theo cặp, TỪNG route                                 | `pair-matrix`                                                 | QA1-M-A-001…059 · M-U-001…059 · M-P-`<cặp>` ×12 · M-F-001…059 · M-C-1…4 · M-K-1                    |
| Theo vai (employee · manager · hr · company-admin · vai «không thêm gì»)  | `roles` · `tier2-pairs`                                       | QA1-M-R-`<vai>`-001…059 · `-002-news` · `-0cap` · `<a>+employee` · `me-<vai>` · M-T-1…10 · M-S-1…3 |
| IDOR: bài nhóm kín · bài ẩn / đã xoá · sửa / xoá bài người khác · ack giả | `idor-posts` · `idor-content`                                 | QA1-I-P-`<mã>`-`<G/H/D/U>` (76 ô + 19 ca «-cũ») · I-C · I-O-1…5 · I-A-1…3 · I-G-1…7 · I-L          |
| Vote đôi · poll đóng                                                      | `social-be2b1-polls*` (đã có)                                 | P-1 · P-3 · P-e (nâng assert theo MÃ ở L5) + QA1-R-5 · R-6                                         |
| Kết quả ẩn danh không lộ danh tính                                        | `pii`                                                         | QA1-P-V0…V3                                                                                        |
| Sinh nhật không lộ năm · ẩn theo preference                               | `pii`                                                         | QA1-P-B0…B5                                                                                        |
| Cross-tenant 2 công ty                                                    | `cross-tenant`                                                | QA1-T-`<mã>` ×39 · T-B-1…9 · T-L-`<mã>` ×15 · T-Q-1…4 · T-X                                        |
| Fuzz mention / hashtag / emoji / body                                     | `fuzz` · `input-ctrl`                                         | QA1-F-0 · F-B · F-H · F-M · F-E · F-X · F-1                                                        |
| Race counters + đối soát COUNT ↔ counter                                  | `race` · `gaps`                                               | QA1-R-0…6 · R-8…12 · G-3 · G-4 (+ E-12 ở `error-codes`)                                            |
| WS payload (đọc là «hẹp hơn DTO» — §8)                                    | `ws`                                                          | QA1-W-0…7 · W-4a · W-4b                                                                            |
| Soft-delete lan đủ                                                        | `softdelete`                                                  | QA1-S-0…9 · S-7a · S-H · S-G · S-C · S-X · S-X1                                                    |
| Census mã lỗi theo MÃ                                                     | `error-codes` + `S/social-error-code-census.spec.ts` (tầng D) | QA1-E-01…14 · E-U-01…27 (tại chỗ ở 9 int-spec cũ) · E-X1…X5 · E-R1…R3                              |
| Coverage `social/` ≥ 85 % trên LANE_DB                                    | script `test:cov:social`                                      | §6                                                                                                 |

### 1.2 `done_when`

| #   | Điều kiện                                                                 | Bằng chứng                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0a  | Mỗi route API-19 có ≥ 1 ca allow + ≥ 1 ca deny theo cặp                   | §2: 59/59 route có ô cho phép (QA1-M-A) và ô từ chối đúng cặp của decorator (QA1-M-P); ca neo QA1-M-R-neo-chạy đếm trên các ô ĐÃ CHẠY THẬT                                                             |
| 0b  | Mọi SOCIAL-ERR có ≥ 1 ca                                                  | §3: 52 khoá có ca HTTP assert `error.code` bằng hằng mã; 3 khoá không ra dây + 2 khoá không bao giờ ném khai tường minh (lệch O2 — §7)                                                                 |
| 0c  | IDOR + cross-tenant là cụm riêng                                          | 3 file riêng: `idor-posts` (96 ca) · `idor-content` (24 ca) · `cross-tenant` (133 ca)                                                                                                                  |
| 0d  | Ca PII sinh nhật + poll ẩn danh soát response                             | `pii` (11 ca): bộ dò năm sinh / danh tính quét toàn thân response của mọi bề mặt người khác đọc được                                                                                                   |
| 1a  | Race like · vote · tham gia nhóm đồng thời — counters đúng                | `race` (12 ca): giữ khoá hàng cha bằng pool riêng → phóng N request → chờ đủ N backend bị chặn → nhả; N = 5 (poll: 3)                                                                                  |
| 1b  | Đối soát COUNT ↔ counter chạy trong test                                  | `H/social-qa1-kit-counters.ts` (`expectCountersReconciled`, 7 cột) — gọi ở cuối các spec có ghi counter                                                                                                |
| 1c  | Bài xoá biến khỏi 6 bề mặt (feed · đếm · tìm kiếm · tag · saved · widget) | `softdelete` QA1-S-1…7: một bài đi qua sáu bề mặt với cặp assert «thấy trước → không thấy sau»; «widget» đo theo O1 (§7)                                                                               |
| 2a  | Lỗi sản phẩm lộ ra được vá trong WO                                       | §5: QA1-BUG-1 · QA1-BUG-2 đã vá; QA1-BUG-3 có gốc ngoài `S/` ⇒ tách WO (mục O8)                                                                                                                        |
| 2b  | TESTABLE-FEATURES + QA-02 cập nhật                                        | cùng commit với file này                                                                                                                                                                               |
| 2c  | `check.sh --lane-db` XANH                                                 | **ĐO ĐƯỢC (09/10/2026)** — `bash harness/check.sh --all --lane-db=qa1` trên lane vừa `--reset`: XANH 9/9; api 844/844 file (5 lần chạy lại vì crash hạ tầng, 0 ca đỏ). Chi tiết ở sổ vết của plan (§9) |

---

## 2. Ma trận 59 route × vai

Dựng từ hai bảng VIẾT TAY trong test (không chép từ sản phẩm): bảng route `H/social-qa1-routes.ts` (mã · đường dẫn · cặp
tầng 1 · mã thành công) và bảng vai `T/s16-social-qa1-roles.int-spec.ts` (`ROLE_GRANTS` · `DENIED_CODES`). Ca neo
QA1-M-C-1…4 đối chiếu bảng route với route ĐANG CHẠY, với cặp ở decorator lúc chạy và với bảng hằng sản phẩm; lệch là đỏ.

Cách đọc: số = status kỳ vọng CHÍNH XÁC của ô cho phép; `403` = từ chối ở tầng 1 (guard cặp quyền), assert
`error.code = AUTH-ERR-FORBIDDEN` + thông điệp bắt đầu `Permission denied:`. Đường dẫn bỏ tiền tố `/api/v1`.

- **9 vai canonical:** employee (7 cặp `feed*`) · manager (8 — thêm `view:feed-report` @Department) · hr (15) ·
  company-admin (15) · payroll-officer · recruiter · asset-manager · office-admin · hr-manager (0 cặp).
- **2 tổ hợp:** payroll-officer + employee · recruiter + employee ⇒ đúng cột employee («không thêm gì»).
- Mỗi vai có cặp chạy trên một **lát dữ liệu riêng** (cùng bộ gieo) nên ô cho phép và ô từ chối của một route là CÙNG
  request trên cùng hình dạng dữ liệu.

| Mã  | Method · đường dẫn                                 | Cặp tầng 1            | Mã OK | employee | manager | hr  | company-admin | 5 vai không cặp feed | 2 tổ hợp «+ employee» |
| --- | -------------------------------------------------- | --------------------- | ----- | -------- | ------- | --- | ------------- | -------------------- | --------------------- |
| 001 | `GET /social/feed`                                 | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 002 | `POST /social/posts`                               | `create:feed-post`    | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 003 | `GET /social/posts/:post_id`                       | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 004 | `PATCH /social/posts/:post_id`                     | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 005 | `DELETE /social/posts/:post_id`                    | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 006 | `PATCH /social/posts/:post_id/moderation`          | `manage:feed-post`    | 200   | 403      | 403     | 200 | 200           | 403                  | 403                   |
| 007 | `POST /social/posts/:post_id/view`                 | `view:feed`           | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 008 | `POST /social/posts/:post_id/save`                 | `view:feed`           | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 009 | `DELETE /social/posts/:post_id/save`               | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 010 | `GET /social/saved`                                | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 011 | `PUT /social/posts/:post_id/reaction`              | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 012 | `DELETE /social/posts/:post_id/reaction`           | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 013 | `GET /social/posts/:post_id/reactions`             | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 014 | `GET /social/posts/:post_id/comments`              | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 015 | `POST /social/posts/:post_id/comments`             | `create:feed-comment` | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 016 | `PATCH /social/comments/:comment_id`               | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 017 | `DELETE /social/comments/:comment_id`              | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 018 | `PUT /social/comments/:comment_id/reaction`        | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 019 | `DELETE /social/comments/:comment_id/reaction`     | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 020 | `GET /social/news`                                 | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 021 | `POST /social/posts/:post_id/ack`                  | `view:feed`           | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 022 | `GET /social/posts/:post_id/acks`                  | `manage:feed-news`    | 200   | 403      | 403     | 200 | 200           | 403                  | 403                   |
| 023 | `GET /social/search`                               | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 024 | `GET /social/tags`                                 | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 025 | `GET /social/profiles/:employee_id/posts`          | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 026 | `GET /social/birthdays`                            | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 027 | `POST /social/reports`                             | `view:feed`           | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 028 | `GET /social/reports`                              | `view:feed-report`    | 200   | 403      | 200     | 200 | 200           | 403                  | 403                   |
| 029 | `PATCH /social/reports/:report_id`                 | `manage:feed-report`  | 200   | 403      | 403     | 200 | 200           | 403                  | 403                   |
| 030 | `GET /social/groups`                               | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 031 | `POST /social/groups`                              | `create:feed-group`   | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 032 | `GET /social/groups/:group_id`                     | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 033 | `PATCH /social/groups/:group_id`                   | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 034 | `DELETE /social/groups/:group_id`                  | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 035 | `POST /social/groups/:group_id/join`               | `view:feed`           | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 036 | `POST /social/groups/:group_id/leave`              | `view:feed`           | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 037 | `GET /social/groups/:group_id/members`             | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 038 | `PATCH /social/groups/:group_id/members/:user_id`  | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 039 | `DELETE /social/groups/:group_id/members/:user_id` | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 040 | `GET /social/polls`                                | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 041 | `PUT /social/posts/:post_id/poll/vote`             | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 042 | `DELETE /social/posts/:post_id/poll/vote`          | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 043 | `GET /social/posts/:post_id/poll/results`          | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 044 | `POST /social/posts/:post_id/poll/close`           | `view:feed`           | 201   | 201      | 201     | 201 | 201           | 403                  | 201                   |
| 045 | `GET /social/ideas`                                | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 046 | `PATCH /social/posts/:post_id/idea/review`         | `approve:feed-idea`   | 200   | 403      | 403     | 200 | 200           | 403                  | 403                   |
| 047 | `GET /social/kudos`                                | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 048 | `GET /social/kudos-badges`                         | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 049 | `POST /social/kudos-badges`                        | `manage:feed-kudos`   | 201   | 403      | 403     | 201 | 201           | 403                  | 403                   |
| 050 | `PATCH /social/kudos-badges/:badge_id`             | `manage:feed-kudos`   | 200   | 403      | 403     | 200 | 200           | 403                  | 403                   |
| 051 | `DELETE /social/kudos-badges/:badge_id`            | `manage:feed-kudos`   | 200   | 403      | 403     | 200 | 200           | 403                  | 403                   |
| 052 | `GET /social/stats/engagement`                     | `view:feed-report`    | 200   | 403      | 200     | 200 | 200           | 403                  | 403                   |
| 053 | `GET /social/stats/engagement/export`              | `view:feed-report`    | 200   | 403      | 200     | 200 | 200           | 403                  | 403                   |
| 054 | `POST /social/files/upload-url`                    | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 055 | `POST /social/files/:id/confirm`                   | `view:feed`           | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |
| 056 | `GET /social/kudos-badges/manage`                  | `manage:feed-kudos`   | 200   | 403      | 403     | 200 | 200           | 403                  | 403                   |
| 057 | `GET /recycle-bin/feed-posts`                      | `restore:feed-post`   | 200   | 403      | 403     | 200 | 200           | 403                  | 403                   |
| 058 | `POST /recycle-bin/feed-posts/:post_id/restore`    | `restore:feed-post`   | 200   | 403      | 403     | 200 | 200           | 403                  | 403                   |
| 059 | `GET /social/kudos/recipients`                     | `create:feed-kudos`   | 200   | 200      | 200     | 200 | 200           | 403                  | 200                   |

Tổng: employee 46 cho phép / 13 từ chối · manager 49 / 10 · hr và company-admin 59 / 0 · năm vai không cặp feed 0 / 59.

**Ngoài bảng (cặp kiểm ở tầng 2, cùng status 403 nhưng mang mã SOCIAL):** biến thể tin tức của 002 (`manage:feed-news`) ·
poll / sáng kiến / vinh danh (`create:feed-<loại>`) · cờ chính thức của vinh danh (`manage:feed-kudos`) · trường kiểm
duyệt của 006 · hành động kèm của 029 · các route nhóm qua `manage:feed-group` · đích tệp của 054 / 055 — ca
QA1-M-T-1…10 (`tier2-pairs`), mỗi ca có ca cho phép song sinh. **Sàn scope:** đủ 15 cặp nhưng ở @Department ⇒ 56 route
từ chối bằng sàn Company, 3 route (028 · 052 · 053) đọc được theo đơn vị — QA1-M-F-001…059; lọc theo đơn vị của manager
trên 028 · 052 · 053 — QA1-M-S-1…3.

---

## 3. Mã lỗi SOCIAL → ca

Nguồn: bảng `CODE_CASES` ở `H/social-qa1-code-cases.ts`, kiểu `Record<SocialErrorKey, …>` — thêm một khoá vào contracts
mà quên khai ở bảng là lỗi **typecheck**. Hai lưới máy canh bảng: (i) ca neo QA1-E-R1…R3 — file tồn tại, chứa đúng tên
ca, và hằng mã nằm TRONG thân của chính ca đó; (ii) tầng D của `S/social-error-code-census.spec.ts` — mọi khoá được
ném (trừ danh sách «không ra dây» khai tường minh) phải có một int-spec SOCIAL assert `error.code` bằng hằng mã.

57 khoá → 51 mã trên dây: **52 khoá có ca HTTP** (bảng dưới) · **3 khoá không ra dây** · **2 khoá không bao giờ ném**.

| Khoá                               | Mã trên dây                                   | File int-spec                  | Ca (neo)                                          |
| ---------------------------------- | --------------------------------------------- | ------------------------------ | ------------------------------------------------- |
| `POST_NOT_FOUND`                   | `SOCIAL-ERR-001`                              | `social-grouperr1-wire-codes`  | W8 — 404 bài lạ                                   |
| `REPLY_DEPTH`                      | `SOCIAL-ERR-005`                              | `social-grouperr1-wire-codes`  | W7 — 422 trả lời quá 1 cấp                        |
| `GROUP_NOT_FOUND`                  | `SOCIAL-ERR-012`                              | `social-grouperr1-wire-codes`  | W1 — 404 nhóm lạ                                  |
| `GROUP_MEMBERSHIP_EXISTS`          | `SOCIAL-ERR-013`                              | `social-grouperr1-wire-codes`  | W4 — 409 vào nhóm lần hai                         |
| `GROUP_ROLE_REQUIRED`              | `SOCIAL-ERR-014`                              | `social-grouperr1-wire-codes`  | W2 — 403 vai nhóm không đủ                        |
| `GROUP_LAST_OWNER`                 | `SOCIAL-ERR-015`                              | `social-grouperr1-wire-codes`  | W3 — 409 owner cuối rời nhóm                      |
| `GROUP_NAME_TAKEN`                 | `SOCIAL-ERR-GROUP-NAME-TAKEN`                 | `social-grouperr1-wire-codes`  | W5 — 409 tên nhóm trùng                           |
| `GROUP_MEMBER_NOT_FOUND`           | `SOCIAL-ERR-GROUP-MEMBER-NOT-FOUND`           | `social-grouperr1-wire-codes`  | W6 — 404 người không phải thành viên              |
| `POLL_CREATE_REQUIRED`             | `SOCIAL-ERR-POLL-CREATE-REQUIRED`             | `social-grouperr1-wire-codes`  | W11 — 403 thiếu `create:feed-poll`                |
| `IDEA_APPROVE_REQUIRED`            | `SOCIAL-ERR-020`                              | `social-grouperr1-wire-codes`  | W12 — 403 `approve:feed-idea` @Department         |
| `CURSOR_INVALID`                   | `SOCIAL-ERR-CURSOR-INVALID`                   | `social-grouperr1-wire-codes`  | W9 — 400 con trỏ hỏng                             |
| `PIN_NEWS_ONLY`                    | `SOCIAL-ERR-PIN-NEWS-ONLY`                    | `social-grouperr1-wire-codes`  | W10 — 422 ghim bài KHÔNG phải tin tức             |
| `FILE_TARGET_POST_DENIED`          | `SOCIAL-ERR-FILE-TARGET-POST-DENIED`          | `social-be1c-file-door`        | DENY: `commentOnly` + target=post                 |
| `FILE_TARGET_COMMENT_DENIED`       | `SOCIAL-ERR-FILE-TARGET-COMMENT-DENIED`       | `social-be1c-file-door`        | DENY: `postOnly` + target=comment                 |
| `FILE_NOT_OWNED`                   | `SOCIAL-ERR-FILE-NOT-OWNED`                   | `social-be1c-file-door`        | DENY (IDOR): confirm tệp của NGƯỜI KHÁC           |
| `GROUP_MEMBER_STATE_MISMATCH`      | `SOCIAL-ERR-013`                              | `social-be2a-group-members`    | G16 — `{role}` lên hàng `pending`                 |
| `POLL_CLOSED`                      | `SOCIAL-ERR-016`                              | `social-be2b1-polls`           | P-1 — bình chọn đã ĐÓNG                           |
| `POLL_VOTE_DUPLICATE`              | `SOCIAL-ERR-017`                              | `social-be2b1-polls`           | P-3 — bình chọn MỘT lựa chọn, gửi 2 optionId      |
| `POLL_OPTIONS_RANGE`               | `SOCIAL-ERR-018`                              | `social-be2b1-polls`           | P-7 — số lựa chọn ngoài 2..10                     |
| `POLL_OPTION_NOT_FOUND`            | `SOCIAL-ERR-POLL-OPTION-NOT-FOUND`            | `social-be2b1-polls`           | P-e — optionId của bình chọn KHÁC                 |
| `POLL_CLOSES_AT_PAST`              | `SOCIAL-ERR-POLL-CLOSES-AT-PAST`              | `social-be2b1-polls`           | closesAt trong QUÁ KHỨ                            |
| `IDEA_TRANSITION`                  | `SOCIAL-ERR-019`                              | `social-be2b2-ideas`           | FSM: nhảy cóc `submitted → accepted`              |
| `IDEA_CREATE_REQUIRED`             | `SOCIAL-ERR-IDEA-CREATE-REQUIRED`             | `social-be2b2-ideas`           | T-1 — vai TUỲ BIẾN thiếu ĐÚNG `create:feed-idea`  |
| `IDEA_REJECT_NOTE_REQUIRED`        | `SOCIAL-ERR-IDEA-REJECT-NOTE-REQUIRED`        | `social-be2b2-ideas`           | I-3 — `rejected` với note toàn khoảng trắng       |
| `KUDOS_CREATE_REQUIRED`            | `SOCIAL-ERR-KUDOS-CREATE-REQUIRED`            | `social-be2b2-kudos`           | T-2 — vai TUỲ BIẾN thiếu ĐÚNG `create:feed-kudos` |
| `KUDOS_BADGE_INVALID`              | `SOCIAL-ERR-022`                              | `social-be2b2-kudos`           | K-0 — huy hiệu `is_active=false`                  |
| `KUDOS_SELF_RECIPIENT`             | `SOCIAL-ERR-KUDOS-SELF-RECIPIENT`             | `social-be2b2-kudos`           | K-1 — người nhận TRÙNG tác giả                    |
| `KUDOS_RECIPIENT_LIMIT`            | `SOCIAL-ERR-KUDOS-RECIPIENT-LIMIT`            | `social-be2b2-kudos`           | K-2 — 11 người nhận                               |
| `KUDOS_RECIPIENT_INVALID`          | `SOCIAL-ERR-KUDOS-RECIPIENT-INVALID`          | `social-be2b2-kudos`           | K-2b — `employeeId` không thuộc tenant            |
| `KUDOS_OFFICIAL_DENIED`            | `SOCIAL-ERR-KUDOS-OFFICIAL-DENIED`            | `social-be2b2-kudos`           | K-3 — `isOfficial:true` thiếu `manage:feed-kudos` |
| `REPORT_ACTION_DENIED`             | `SOCIAL-ERR-REPORT-ACTION-DENIED`             | `social-be3a-report-actions`   | R1: vai CHỈ manage:feed-report                    |
| `REPORT_ACTION_INVALID_FOR_TARGET` | `SOCIAL-ERR-REPORT-ACTION-INVALID-FOR-TARGET` | `social-be3a-report-actions`   | R4: báo cáo BÌNH LUẬN + hide_post                 |
| `REPORT_ACTION_TARGET_UNAVAILABLE` | `SOCIAL-ERR-REPORT-ACTION-TARGET-UNAVAILABLE` | `social-be3a-report-actions`   | R2: %s trên bài ĐÃ xoá                            |
| `REPORT_BUSY`                      | `SOCIAL-ERR-REPORT-BUSY`                      | `social-be3a-report-actions`   | R9: khoá đích bị giữ quá lock_timeout             |
| `REPORT_ALREADY_DECIDED`           | `SOCIAL-ERR-021`                              | `social-be3a-report-actions`   | R6: hai lượt resolve CÙNG báo cáo đồng thời       |
| `KUDOS_BADGE_CODE_TAKEN`           | `SOCIAL-ERR-KUDOS-BADGE-CODE-TAKEN`           | `social-be3a-kudos-badges`     | K3 — code trùng                                   |
| `KUDOS_BADGE_NOT_FOUND`            | `SOCIAL-ERR-KUDOS-BADGE-NOT-FOUND`            | `social-be3a-kudos-badges`     | K2 — PATCH/DELETE huy hiệu của công ty B          |
| `STATS_UNIT_OUT_OF_SCOPE`          | `SOCIAL-ERR-STATS-UNIT-OUT-OF-SCOPE`          | `social-be3b-engagement-stats` | S2: manager hỏi `orgUnitId` ngoài phạm vi         |
| `RESTORE_GROUP_DELETED`            | `SOCIAL-ERR-RESTORE-GROUP-DELETED`            | `social-be3c-recycle-restore`  | D5: bài thuộc nhóm đã xoá mềm                     |
| `WRITE_OUT_OF_AUDIENCE`            | `SOCIAL-ERR-002`                              | `s16-social-qa1-error-codes`   | QA1-E-01                                          |
| `NOT_CONTENT_OWNER`                | `SOCIAL-ERR-003`                              | `s16-social-qa1-error-codes`   | QA1-E-02                                          |
| `COMMENTS_LOCKED`                  | `SOCIAL-ERR-004`                              | `s16-social-qa1-error-codes`   | QA1-E-03                                          |
| `ATTACHMENT_LIMIT`                 | `SOCIAL-ERR-007`                              | `s16-social-qa1-error-codes`   | QA1-E-04                                          |
| `ATTACHMENT_INVALID`               | `SOCIAL-ERR-007`                              | `s16-social-qa1-error-codes`   | QA1-E-05                                          |
| `NEWS_MANAGE_REQUIRED`             | `SOCIAL-ERR-010`                              | `s16-social-qa1-error-codes`   | QA1-E-06                                          |
| `MODERATION_FIELD_DENIED`          | `SOCIAL-ERR-010`                              | `s16-social-qa1-error-codes`   | QA1-E-07                                          |
| `ACK_NOT_APPLICABLE`               | `SOCIAL-ERR-011`                              | `s16-social-qa1-error-codes`   | QA1-E-08                                          |
| `REPORT_NOT_FOUND`                 | `SOCIAL-ERR-001`                              | `s16-social-qa1-error-codes`   | QA1-E-09                                          |
| `COMMENT_NOT_FOUND`                | `SOCIAL-ERR-001`                              | `s16-social-qa1-error-codes`   | QA1-E-10                                          |
| `REPORT_DUPLICATE_OPEN`            | `SOCIAL-ERR-REPORT-DUPLICATE-OPEN`            | `s16-social-qa1-error-codes`   | QA1-E-11                                          |
| `POLL_WRITE_BUSY`                  | `SOCIAL-ERR-POLL-WRITE-BUSY`                  | `s16-social-qa1-error-codes`   | QA1-E-12                                          |
| `CURSOR_FILTER_MISMATCH`           | `SOCIAL-ERR-CURSOR-FILTER-MISMATCH`           | `s16-social-qa1-error-codes`   | QA1-E-13                                          |

**3 khoá không ra dây qua HTTP** (lệch O2 — §7):

| Khoá                     | Mã trên dây                        | Vì sao                                                                                     | Ca ghim hành vi thật ở biên                                    |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `REACTION_EMOJI_INVALID` | `SOCIAL-ERR-006`                   | schema của thân request từ chối giá trị ngoài bộ cảm xúc trước khi vào service (400 chung) | QA1-E-X1 (400 ở biên) · QA1-E-X5 (gọi thẳng service ⇒ đúng mã) |
| `AUDIENCE_KEY_MISSING`   | `SOCIAL-ERR-008`                   | schema tạo bài từ chối audience thiếu khoá trước khi vào service (400 chung)               | QA1-E-X2                                                       |
| `POST_TYPE_PAIR_DESYNC`  | `SOCIAL-ERR-POST-TYPE-PAIR-DESYNC` | chân fail-closed: chỉ ném khi hai bảng hằng theo loại bài lệch nhau — hai bảng đang khớp   | không có đường HTTP nào để ghim                                |

**2 khoá không bao giờ ném:** `AUDIENCE_GROUP_NOT_AVAILABLE` (`SOCIAL-ERR-008` — hằng còn lại sau khi audience nhóm được
mở) · `MENTION_DROPPED_NOT_AN_ERROR` (`SOCIAL-ERR-009` — không phải lỗi: request vẫn 201, danh sách bị bỏ trả ở
`droppedMentions`).

Ca theo mã ngoài bảng khoá: QA1-E-14 (404 «một thông điệp» trên 003) · QA1-E-X3 `[O8]` (thân quá cỡ — §5) · QA1-E-X4 ·
QA1-E-N1 (thông báo «bài bị báo cáo» đi hết outbox — §5) · QA1-E-G1 (gỡ chủ nhóm duy nhất ⇒ 409 theo mã).

---

## 4. Mutant (đỏ-trước-xanh)

Quy ước: cấy vào file sản phẩm → chạy đúng file spec → chép thông điệp đỏ → hoàn tác → chạy lại xanh. Đỏ vì 500 hoặc
lỗi biên dịch KHÔNG tính. Mọi dòng dưới đây là **ĐO ĐƯỢC**; cột cuối là thông điệp rút gọn của ca đỏ ĐẦU TIÊN.

### 4.1 17 mutant ★ của 9 lát

| Lát | Cấy gì                                                     | Ca đỏ                                                        | Thông điệp (rút gọn)                                                         |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| L0  | `bumpPostCounter` cộng 0 thay vì delta                     | QA1-K-4                                                      | «cột đếm lệch so với COUNT thật … `feed_posts.like_count` stored=0 actual=2» |
| L1  | gỡ decorator cặp quyền ở handler 019                       | QA1-M-C-2 (+ M-P-`view:feed` · M-A-019 · M-F-019 · M-K-1)    | «019 DELETE …/reaction: bảng `view:feed` ≠ decorator null»                   |
| L1  | bỏ nhánh sàn scope ở `resolveActor`                        | 56 ca QA1-M-F (đúng 56 route có sàn Company)                 | «expected 200 to be 403»                                                     |
| L2  | `assertCreatablePostType` bỏ nhánh tin tức                 | QA1-M-R-employee-002-news · -manager- · 2 tổ hợp · QA1-M-T-1 | «expected 201 to be 403»                                                     |
| L2  | `moderateTx` bỏ kiểm theo trường                           | QA1-M-T-7 (đúng 1 ca)                                        | «expected 200 to be 403»                                                     |
| L3  | `visiblePostCondition` bỏ vế «chưa xoá»                    | 17 ca QA1-I-P-`<mã>`-D-cũ                                    | «expected 200 to be 404» — lượt đầu 0 ca đỏ (xem ghi chú dưới bảng)          |
| L3  | `assertCanMutateContent` luôn cho qua                      | QA1-I-O-1…5 · I-O-4b                                         | «expected 200 to be 403»                                                     |
| L4  | service thùng rác đổi 404 thành 403                        | QA1-T-058 (đúng 1/133)                                       | «expected 403 to be 404»                                                     |
| L4  | service tệp đổi 404 thành 403                              | QA1-T-055 (đúng 1/133)                                       | «expected 403 to be 404»                                                     |
| L5  | service báo cáo bỏ bọc mã SOCIAL                           | QA1-E-11                                                     | «expected 'RESOURCE-ERR-CONFLICT' to be 'SOCIAL-ERR-REPORT-DUPLICATE-OPEN'»  |
| L5  | service bình luận ném nhầm khoá anh em                     | QA1-E-03                                                     | «expected 'SOCIAL-ERR-005' to be 'SOCIAL-ERR-004'»                           |
| L6  | bỏ lời gọi cộng `like_count`                               | QA1-R-1                                                      | «`feed_posts.like_count` … stored=0 actual=5»                                |
| L6  | `groupMemberCountDelta` trả 0 cho «chưa có → active»       | QA1-R-8                                                      | «`feed_groups.member_count` … stored=0 actual=6»                             |
| L7  | `softDeletePostTx` bỏ vòng trừ `usage_count`               | QA1-S-4 · QA1-S-X1                                           | «expected 2 to be 1» · «`feed_tags.usage_count` … stored=1 actual=0»         |
| L7  | đảo điều kiện hiển thị sinh nhật                           | QA1-P-B3                                                     | «chưa có hàng preference ⇒ có mặt: expected undefined to be defined»         |
| L8  | bỏ lưới «chỉ bài đang hiển thị» ở chỗ phát sự kiện cảm xúc | QA1-W-5 (đúng 1/9)                                           | «cảm xúc trên bài ĐÃ ẨN không được phát: … to have a length of 1 but got 3»  |
| L8  | `parseHashtags` bỏ hạ chữ thường                           | QA1-F-H (đúng 1/6)                                           | «cùng thẻ khác hoa thường phải là MỘT thẻ»                                   |

Ghi chú L3: mutant theo đúng plan không làm đỏ ca nào ở lượt đầu — route xoá ghi cả mốc xoá lẫn trạng thái nên hai lớp
chặn trùng nhau. Đã bù 19 ca trên hàng mang mốc xoá mà trạng thái chưa đổi (schema cho phép); khi đó mutant đỏ 17 ca.

Tự-kiểm ratchet của L5 (phía test, không tính ★): gỡ một khoá khỏi `CODE_CASES` ⇒ typecheck đỏ `TS2741`; gỡ dòng assert
theo mã của một khoá ở int-spec cũ ⇒ tầng D đỏ «thiếu ca theo MÃ».

### 4.2 Kiểm toán mutant độc lập — 11 điểm gác (plan §4, đoạn cuối)

Chạy bởi một lượt KHÁC lượt viết ca, trên đủ bộ QA1 lúc đó (13 file · 872 ca). Kết quả: **8 bị bắt · 2 sống sót (đã bù
ca) · 1 không áp dụng**.

| Mã  | Cấy gì                                                                 | Kết quả           | Ca đỏ · thông điệp (rút gọn)                                                                                         |
| --- | ---------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| M01 | `resolveActor`: thiếu grant của cặp route coi như scope rộng nhất      | không áp dụng     | tầng 1 chặn trước bằng CÙNG cặp ⇒ lớp thứ hai không tới được qua HTTP                                                |
| M02 | cờ quản lý bài bỏ sàn Company                                          | **sống sót → bù** | sau khi bù: QA1-G-1 «expected 200 to be 404» · QA1-G-2 «expected 200 to be 403»                                      |
| M03 | vị từ đọc bài nhóm bỏ vế «thành viên active»                           | bị bắt            | QA1-I-L-1 — danh sách của người đang chờ duyệt không còn rỗng                                                        |
| M04 | `assertGroupRoleTx` bỏ vế vai                                          | bị bắt            | QA1-I-G-2 · I-G-4 — «expected 200 to be 403»                                                                         |
| M05 | lọc đơn vị của danh sách báo cáo trả «tất cả»                          | bị bắt            | QA1-M-S-1 — «expected [ …(3) ] to deeply equal [ Array(1) ]»                                                         |
| M06 | lọc đơn vị của thống kê trả «tất cả»                                   | bị bắt            | QA1-M-S-2 · M-S-3                                                                                                    |
| M07 | `countUnackedFor` bỏ vế «thấy được»                                    | bị bắt            | QA1-S-2 — «expected [ 1, false, false ] to deeply equal [ +0, false, false ]» (+ S-H; S-8 · S-9 đỏ dây chuyền)       |
| M08 | `resolveMentions`: (a) bỏ vế cùng công ty · (b) bỏ vế tài khoản active | (b) bị bắt        | QA1-F-M — «droppedMentions: mong [id] nhận []». Vế (a): ca chéo công ty vẫn xanh ⇒ lớp chặn là RLS (**SUY RA**)      |
| M09 | sinh nhật: để năm lọt vào hàng trả về                                  | bị bắt            | QA1-P-B1 — «expected { …(6) } to deeply equal { …(5) }»                                                              |
| M10 | lượt trừ phiếu bình chọn thành no-op                                   | bị bắt            | QA1-R-6 — «cột đếm lệch so với COUNT thật» (R-8…R-12 đỏ dây chuyền)                                                  |
| M11 | khôi phục bài không đếm lại 3 cột                                      | **sống sót → bù** | sau khi bù: QA1-G-3 «commentCount … expected 2 to be 1» · QA1-G-4 «`like_count` / `view_count` … expected 2 to be 1» |

Ca bù: `T/s16-social-qa1-gaps.int-spec.ts` (QA1-G-1…4). G-3 đi hoàn toàn qua HTTP (đua xoá bình luận × xoá bài rồi
khôi phục); G-4 gỡ hai hàng nguồn bằng SQL trên chính bài của ca rồi khôi phục qua route thật.

### 4.3 Mutant của hai bản vá và của bước vá gate

| Bản vá          | Cấy gì                                     | Ca đỏ · thông điệp (rút gọn)                                                                    |
| --------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| QA1-BUG-1       | trả lại hành vi cũ của nhánh «đổi loại»    | QA1-W-4 — «số sự kiện phát cho lượt đổi loại …: expected [] to have a length of 1 but got +0»   |
| QA1-BUG-2       | gỡ lớp chặn khỏi MỘT controller            | ca kiểm đủ tĩnh của `S/social-input-text.pipe.spec.ts` — nêu đúng tên controller thiếu lớp chặn |
| QA1-BUG-2       | bộ quét bỏ qua mảng                        | `input-ctrl` (chuỗi lồng trong mảng) + 6 ca unit của pipe                                       |
| vá gate (G1-01) | bỏ mệnh đề «chỉ ghi khi loại khác loại cũ» | QA1-W-4b — «… to have a length of +0 but got 1»                                                 |
| vá gate (G2-01) | gỡ kiểm UUID ở một tham số đường dẫn       | ca kiểm đủ tĩnh mới của pipe spec — nêu đúng `social-files.controller.ts:86`                    |

---

## 5. Lỗi sản phẩm

| Mã        | Mô tả (trung tính)                                                            | Vùng | Xử lý                                                                                                                                                                                              | Ca                                                                                                                  |
| --------- | ----------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| QA1-BUG-1 | Đổi loại cảm xúc không phát sự kiện realtime                                  | vàng | **ĐÃ VÁ** — commit `aad82bb7` (`S/social-reactions.repository.ts`: phân loại thêm / đổi / không đổi trong một câu lệnh)                                                                            | QA1-W-4 (đỏ trước vá, xanh sau) · W-4a · W-4b · QA1-R-2                                                             |
| QA1-BUG-2 | Chuỗi đầu vào chứa U+0000 trả sai lớp status                                  | vàng | **ĐÃ VÁ hẹp trong SOCIAL** (mục O7 phương án (b)) — commit `4c96fa4a` + `853f0eb1`: lớp chặn cấp class trên 12 controller SOCIAL ⇒ 400 `VALIDATION-ERR-001` kèm `details[]`, không dội lại giá trị | QA1-F-1 (`input-ctrl`, 32 ca) · `S/social-input-text.pipe.spec.ts` (24 ca)                                          |
| QA1-BUG-3 | Thân request quá cỡ trả sai lớp status (gốc ở tầng chung của API, ngoài `S/`) | vàng | **KHÔNG vá trong WO** (mục O8 phương án (a)) ⇒ WO `S1-FND-BODYLIMIT-1`                                                                                                                             | QA1-E-X3 nhãn `[O8]`: chỉ assert bất biến yếu (status ≥ 400 · phong bì lỗi chuẩn · không dội nội dung · 0 hàng ghi) |

Biên chung cho lớp ký tự của QA1-BUG-2 ở các module khác (mục O7 phương án (a)) ⇒ WO `S1-FND-NULINPUT-1`.

**Nghi vấn S5** (thông báo của sự kiện «bài bị báo cáo» thất bại không tất định ở lượt nền): **không phải lỗi sản phẩm.**
ĐO ĐƯỢC: ca QA1-E-N1 xanh 6/6 lượt chạy một-file (sự kiện outbox về `done`, người kiểm duyệt nhận đúng 1 thông báo);
lượt cả cụm chạy tuần tự không có dòng lỗi nào. Dòng lỗi chỉ xuất hiện khi nhiều file chạy song song trên cùng DB ⇒
đua giữa bước dọn dữ liệu của một spec với outbox worker của app thuộc file khác (lỗi cách ly của bộ test, không phải
đường chạy của sản phẩm).

Không còn `it.fails` nào trong 15 int-spec QA1.

---

## 6. Số đo

| Chỉ số                                      | Giá trị                                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Int-spec mới của WO                         | **15 file · 909 ca** · 0 skip · 0 `it.fails`                                                                                                                            |
| Helper mới                                  | 7 file `H/social-qa1-*.ts`                                                                                                                                              |
| Unit / ratchet chạm bởi WO                  | `S/social-input-text.pipe.spec.ts` 24 ca (mới) · `S/social-error-code-census.spec.ts` 147 ca (thêm tầng D)                                                              |
| Int-spec SOCIAL cũ được nâng assert theo mã | 9 file (27 khoá nhóm B)                                                                                                                                                 |
| Thời gian 15 int-spec QA1                   | 86,2 s cộng dồn (5 lượt × 3 file: 14,1 · 16,3 · 17,8 · 17,6 · 20,4 s) — ngân sách plan: < 5 phút                                                                        |
| Lượt đo coverage (`test:cov:social`)        | **81 file · 2.335 ca** · 0 đỏ — đo theo 6 mảnh tuần tự rồi gộp báo cáo, 338 s cộng dồn (lượt một tiến trình chết `Channel closed` 3/3 lần trên máy đo, không ca nào đỏ) |

Số ca theo file: `cross-tenant` 133 · `error-codes` 77 · `fuzz` 6 · `gaps` 4 · `idor-content` 24 · `idor-posts` 96 ·
`input-ctrl` 32 · `pair-matrix` 196 · `pii` 11 · `race` 12 · `roles` 261 · `smoke` 15 · `softdelete` 16 ·
`tier2-pairs` 16 · `ws` 10.

**Coverage `src/social/**`(dòng «All files», có`LANE_DB`):\*\*

| Chỉ số     | Nền trước WO |  Sau WO | Chênh |
| ---------- | -----------: | ------: | ----: |
| Statements |      98,16 % | 98,66 % | +0,50 |
| Branches   |      90,75 % | 92,65 % | +1,90 |
| Functions  |      99,31 % | 99,77 % | +0,46 |
| Lines      |      98,16 % | 98,66 % | +0,50 |

Ngưỡng của WO: statements ≥ 85 % và không tụt quá 0,5 điểm so với nền — **ĐẠT (không chỉ số nào tụt)**. Nền đã vượt 85 % trước khi viết
ca nào, nên WO không có «lát bù coverage»: khoảng trống thật (route chưa có ca nào tới handler, mã lỗi chỉ assert
status…) được lấp bằng ca theo route và theo mã — coverage dòng không nhìn thấy các lỗ đó.

Script `test:cov:social` nay gồm đủ 48 int-spec SOCIAL trên đĩa (31 file `social-*` + 2 file `s16-social-db*-invariants` + 15 file
`s16-social-qa1-*`) — trước WO script chỉ có 18 file, thiếu 15 int-spec cũ. Không gồm `s16-filedisposition-storage`
(spec đó cần storage thật). Script hiện **chỉ đo**, chưa có cổng máy nào gọi (nợ — §9).

---

## 7. Lệch có chủ đích O1–O8 + câu hỏi đang chờ owner

| #   | Lệch / quyết định                                                                                                                          | Trạng thái                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| O1  | Bề mặt «widget» của xoá mềm: chưa có widget SOCIAL nào ở Dashboard ⇒ đo NGUỒN dữ liệu của widget (hàng tuần hiện tại của 052 + hàm widget) | áp dụng phương án (a); bàn giao cho `S16-SOCIAL-DASH-1`                |
| O2  | «Mọi mã có ≥ 1 ca»: 3 khoá không ra dây + 2 khoá không ném được khai tường minh, kèm ca ghim hành vi thật ở biên                           | áp dụng phương án (a); đính chính tài liệu ở `S16-SOCIAL-DOC-3`        |
| O3  | 024 (danh sách thẻ): phạm vi tổng hợp của danh sách — thiết kế hay cần thu hẹp?                                                            | đã đo, **chờ owner**; ca giữ ngoài kho                                 |
| O4  | 035 / 036: cổng vào của hai route thành viên khác cổng của 032 — thiết kế hay cần hợp nhất?                                                | đã đo, **chờ owner**; ca giữ ngoài kho                                 |
| O5  | Bài trong nhóm đã xoá: quy tắc «tác giả luôn thấy bài mình» và docblock của route xoá nhóm nói khác nhau — bên nào đúng?                   | đã đo, **chờ owner**; ca giữ ngoài kho                                 |
| O6  | Mention thêm vào bài không ở trạng thái đang hiển thị: có sinh thông báo không — tài liệu im lặng                                          | đã đo, **chờ owner**; ca giữ ngoài kho                                 |
| O7  | Phạm vi vá của QA1-BUG-2                                                                                                                   | (b) vá hẹp trong SOCIAL — đã làm; (a) biên chung ⇒ `S1-FND-NULINPUT-1` |
| O8  | Lỗi có gốc ngoài `S/` (QA1-BUG-3)                                                                                                          | (a) không vá trong WO ⇒ `S1-FND-BODYLIMIT-1`                           |

O3–O6 là «tài liệu im lặng / tự mâu thuẫn» nên không mặc nhiên là lỗi sản phẩm. Số đo và ca tái lập của bốn mục này
nằm ở sổ ngoài kho của phiên điều phối; owner chọn «giữ thiết kế» cho mục nào thì ca của mục đó được commit như ca ghim
thiết kế, chọn «siết» thì mở WO riêng.

**Câu hỏi khác đang chờ owner (không phải nghi vấn hiển thị):**

1. Thứ tự của mảng `tags` trên thẻ bài không ổn định giữa hai lần gửi cùng một thân; API-19 không cam kết thứ tự. Có cần
   thứ tự ổn định không? (Ca fuzz hiện so theo TẬP.)
2. Thân bài chỉ gồm ký tự vô hình được nhận như bài hợp lệ. Giữ hay chặn ở biên? (Ca fuzz ghim hành vi hiện tại.)
3. Bộ lọc bảng tin (001) mang id nhóm / đơn vị / tác giả ngoài phạm vi người gọi trả 200 danh sách rỗng; API-19 không
   nêu status. Ghi rõ vào API-19? (Ca QA1-T-Q-1…4 ghim hành vi hiện tại.)
4. API-19 §7 có nên liệt kê tường minh tập khoá của sự kiện bình luận mới và các khoá của sự kiện bài mới đang chỉ ghim
   theo quan sát?
5. Có muốn một ràng buộc DB buộc mốc xoá và trạng thái «đã xoá» của bài luôn đi cùng nhau (hiện schema cố ý không ràng)?

---

## 8. Lệch đề bài (tiêu đề WO ↔ thực tế đã đo)

| Đề ghi                                      | Thực tế                                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «53 route»                                  | **59 route** (57 dưới `/social` + 2 dưới `/recycle-bin/feed-posts`) — ca QA1-M-C-1 ghim bằng tập route đang chạy                                                                 |
| «14 cặp»                                    | **15 cặp** `feed*` (14 + `restore:feed-post`); 12 cặp gác ở decorator, 3 cặp chỉ kiểm ở tầng 2                                                                                   |
| «WS payload = DTO»                          | đọc là **«hẹp hơn DTO»**: payload trên dây là tập con có chủ đích của DTO REST — QA1-W-1 · W-2 ghim tập khoá bằng bảng literal (khoá tài liệu nêu + khoá chỉ ghim theo quan sát) |
| «widget» (bề mặt thứ 6 của xoá mềm)         | đo theo O1 — nguồn dữ liệu của widget, chưa phải widget trên Dashboard                                                                                                           |
| «payroll-officer / recruiter không thêm gì» | mở rộng thành đủ 9 vai canonical + 2 tổ hợp «+ employee»                                                                                                                         |

Lệch so với plan khi thi công (đều theo hướng siết, không nới kỳ vọng): L3 tách hai file (`idor-posts` · `idor-content`)
và thêm 19 ca «-cũ» · L5: hai khoá phải có ca riêng (QA1-E-02 · E-06) vì ca của lát khác assert qua tên khoá dạng chuỗi ·
đăng bài vào nhóm kín khi đang chờ duyệt ⇒ 404 «không thấy nhóm» theo API-19 (plan ghi 403) · QA1-W-4 tách thành W-4a
(ca thường) + W-4 · kiểm toán mutant: số điểm «bị bắt» đếm theo bảng chi tiết là 8 (bản tóm tắt của lượt đó ghi 7).

---

## 9. Nợ + WO kế

| WO (đã seed, `status: todo`) | Nội dung                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S16-SOCIAL-DOC-3`           | Đính chính SPEC-16 + API-19 theo các chỗ lệch đã đo (§8 + câu hỏi 3 · 4 của §7)                                                                                                                                                                                                 |
| `S1-FND-BODYLIMIT-1`         | QA1-BUG-3 — thân request quá cỡ trả sai lớp status ở tầng chung của API                                                                                                                                                                                                         |
| `S1-FND-NULINPUT-1`          | Ký tự U+0000 trong chuỗi đầu vào ở các module ngoài SOCIAL                                                                                                                                                                                                                      |
| `S16-SOCIAL-QADEBT-1`        | Chuyển 18 int-spec SOCIAL dựng tay sang `applyMainPipeline` · đưa `test:cov:social` vào một cổng máy · tách hàm dài của bộ đồ nghề (finding G1-07) · ca cho cờ quản lý bài trên đường tải tệp · ca trên dây cho đổi loại cảm xúc ở bình luận · mở rộng census tham số đường dẫn |
| `S16-SOCIAL-DASH-1` (đã có)  | Widget thật phải có ca xoá mềm riêng (bàn giao từ O1)                                                                                                                                                                                                                           |

**Gate của WO (vòng 1, mức «bản gọn»):** `ecc:typescript-reviewer` trên toàn diff — PASS_WITH_FIXES (1 MEDIUM · 6 LOW) ·
`security-reviewer` hẹp trên hai bản vá — PASS_WITH_FIXES (1 MEDIUM · 3 LOW) · 0 CRITICAL / HIGH. 10/11 finding đã vá
(commit `853f0eb1` · `648e569c`); G1-07 (hàm helper dài, hai file sát trần 800 dòng) ghi nợ vào `S16-SOCIAL-QADEBT-1`.

**CHƯA ĐO trong WO (ghi để không đọc nhầm thành đã phủ):**

- Đường tải tệp thật qua storage (WO không chạm storage; `s16-filedisposition-storage` đứng ngoài lượt đo).
- Cờ quản lý bài ở scope hẹp trên đường tải tệp (điểm gác M02, vế thứ hai).
- Ký tự điều khiển C0 khác U+0000 và surrogate lẻ trong chuỗi đầu vào.
- Bề mặt realtime chéo công ty (socket của công ty này không nhận sự kiện của công ty kia) — WO chỉ đo room trong cùng
  công ty.
- `ATTACHMENT_INVALID`: chỉ một trong các nhánh có ca theo mã; `CURSOR_FILTER_MISMATCH` chỉ đo trên bảng tin;
  `POLL_WRITE_BUSY` chỉ đo trên route bỏ phiếu.
- Độ ổn định của 15 int-spec khi chạy song song với toàn bộ suite trên cùng DB kiểu CI — trong WO chỉ chạy theo cụm
  ≤ 3 file (lượt nhiều file trên máy dev hay chết `Channel closed`, không ca nào đỏ khi chạy lại).
- Ngưỡng cỡ thân chính xác của QA1-BUG-3.

Nợ ĐÃ CÓ WO từ trước, WO này ghim hiện trạng chứ không báo lại: danh sách ở plan §5.3.
