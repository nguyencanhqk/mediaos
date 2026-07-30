# S6-REL-1 — Release Candidate · Go-live Runbook · Monitoring & Support Readiness (WS7/WS8/WS9)

> Work Order: `S6-REL-1` · zone 🔴 **crown release** · gate **FULL**
> Nguồn: `IMPLEMENTATION-09` §16 (WS7) · §17 (WS8) · §18 (WS9) · `ISSUE-BOARD-01` §18
> (`RELEASE-REL-001`, `RELEASE-GO-001`) · `IMP02-STORY-112`
> Luật ràng buộc: **`RELEASE-05`** (scope freeze · severity S0..S4 · ngưỡng chặn RC · tag policy §6.2 ·
> branch model §6.3) · `RELEASE-06` §5 (bug scrub S0/S1/S2 TRƯỚC RC)
> Nguyên tắc của plan này: **script tồn tại ≠ script chạy được** (bài học `DEVOPS-13` §3.1) và
> **tài liệu tick ≠ điều kiện đạt**. Mọi ô trong §3 phải có lệnh/số đo, không suy luận.

---

## 1. Nền đã đo (2026-07-30, KHÔNG lấy từ tài liệu cũ)

| Mục | Số đo | Cách đo |
| --- | --- | --- |
| `master` | `c4afe351` | `git rev-parse --short HEAD` |
| Migration head | idx **201** · `0534_s6secmv1_dashboard_mv_tenant_barrier` (202 entry) | `apps/api/migrations/meta/_journal.json` |
| CI trên `master` | **4/4 xanh** (`API — CI` · `Apps — Frontend CI` · `Security` · `CI`) | `gh run list --branch master` |
| PROD `:3100` | **SỐNG** — `/health` 200 `status:ok`; `/health/db` 200 `ok`, latency 9ms | `curl` |
| Staging/UAT `:3200` | **KHÔNG LẮNG NGHE** | `curl` không phản hồi |
| Tag release trong repo | **0** (6 tag hiện có đều là `archive/*`·`backup/*`·`tooling-*` = tag lịch sử, `RELEASE-05` §6.2.5) | `git tag -l` |
| `version` trong `package.json` | `0.0.0` ở root · `apps/api` · `apps/app` | `grep` |
| Phụ thuộc WO | 9/9 `done` | ledger overlay + commit `#303…#310` |

**Hai WO 🔴 đang READY nhưng KHÔNG phải phụ thuộc của WO này** — `S6-SEC-IDENTITY-PROJ-1` và
`S6-SEC-XTENANTFK-1` (KI-046). Cả hai **`S3`** ⇒ theo `RELEASE-05` §5.3, `S3` không có ngưỡng chặn RC.
Chúng KHÔNG chặn WO này; ghi ra đây để không ai tưởng đã bỏ sót.

---

## 2. WO này làm gì · KHÔNG làm gì

**LÀM (WS7·WS8·WS9):** đủ điều kiện để *cắt được* RC — checklist RC có bằng chứng · release notes ·
runbook go-live + rollback · smoke sau deploy **chạy được** · đường deploy/rollback ứng dụng **thật** ·
monitoring/alerting **chạy được** · support readiness (kênh · mẫu incident · escalation · hypercare).

**KHÔNG LÀM:**

- **KHÔNG tạo git tag trong PR này.** `RELEASE-05` §6.2.1: tag annotated đặt trên commit **đã merge vào
  `master`**, không tag nhánh làm việc. Tag là bước owner **sau** merge — WO giao *lệnh + nội dung tag*,
  không tự bấm.
- **KHÔNG quyết định Go/No-go, KHÔNG ký nghiệm thu, KHÔNG chạy go-live.** Đó là `S6-GOLIVE-1` (WS10).
- **KHÔNG viết user/admin/support *guide* nội dung.** `S6-GOLIVE-1` sở hữu bộ guide (`IMPL-09` §19.5).
  WO này chỉ dựng **quy trình** support (§18.5: kênh · mẫu incident · escalation · known issues).
- **KHÔNG restart / đổi cấu hình service PROD trong phiên.** Cần Administrator + gây gián đoạn người
  dùng thật (`funtime`, 45 NV). WO giao **cơ chế + lệnh**; bấm là quyết định của owner (§8).
- **KHÔNG mở rộng scope MVP** (`RELEASE-05` §4.2).

---

## 3. Cổng RC — đo THẬT hôm nay (IMPL-09 §16.3)

> Đây là **phán quyết đầu vào**, không phải kết quả mong muốn. Ô ❌ nào không đóng được trong PR thì
> ghi rõ ai đóng, đóng bằng gì.

| Mã | Điều kiện | Đo được hôm nay | Ai đóng |
| --- | --- | --- | --- |
| RC-001 | 0 `S0` open | ✅ **0** — `KI-038`·`KI-043` đã đóng | — |
| RC-002 | 0 `S1` open (hoặc có owner+ETA) | ✅ **0** — `KI-022/023/024/027/033/034/035/040` đóng | — |
| RC-003 | Regression P0 pass **trên staging** | ❌ **staging `:3200` không chạy** | **Owner** (§8) |
| RC-004 | Migration/seed verified **trên staging** | ❌ `mediaos_dev` chốt ở `0529`, head nay `0534` ⇒ **lệch 5** | **Owner** (§8) |
| RC-005 | Security blocker = 0 | ✅ 0 CRITICAL/HIGH mở; `Security` CI xanh | — |
| RC-006 | Release notes đủ module | ❌ chưa có | **WO này** (D5) |
| RC-007 | Monitoring/health hoạt động | ⚠️ health ✅ · **alerting ❌** (KI-011) | **WO này** (D6·D7) |
| RC-008 | Rollback runbook đã review | ❌ chưa có runbook | **WO này** (D3·D4) |

**Kết luận thẳng: RC `v1.0.0-rc.1` KHÔNG cắt được trong phiên này.** WO này đóng RC-006/007/008 và
dựng công cụ cho RC-003/004, nhưng RC-003/RC-004 cần **owner bật staging** rồi chạy — đó là hành động
ngoài PR. Tài liệu RC sẽ ghi hai ô đó là **CHƯA ĐẠT**, KHÔNG tick trước.

---

## 4. Bug scrub trước RC (`RELEASE-06` §5 · `RELEASE-05` §5.4)

Sổ `RELEASE-02` đang **lệch với thực tế đã ship**. Đối chiếu lại từng mục `S2`:

| KI | Sổ đang ghi | Thực tế đo được | Hành động |
| --- | --- | --- | --- |
| KI-008 | S2 mở — "chưa có bằng chứng diễn tập khôi phục" | **`DEVOPS-13` §3.1: drill PASS** (đã vá 3 phần, chạy thật 2026-07-29, `S6-PERF-DB-1` #307) | **ĐÓNG** |
| KI-029 | §1 ghi ĐÓNG · §2 còn nguyên văn "đề xuất" · §3 vẫn đếm là mở | `env.schema.ts:86` `PERMISSION_GUARD_ENABLED: z.enum(["true","false"]).default("true")` + `env.schema.spec.ts:168-203` | **ĐÓNG** — sửa §2 + §3 |
| KI-011 | S2 mở — chưa có cảnh báo tự động | đúng, chưa có gì | **WO này đóng** (D6) |
| KI-016 | S2 mở — PROD dùng chung `dist` với dev-online, ghi rõ "**go-live blocker**" | đúng: `04-build-install-service.ps1:41` trỏ `apps\api\dist\main.js`, `m dev-online` biên dịch lại chính thư mục đó | **WO này đóng** (D3) |
| KI-021 | S2 mở — 3 sự kiện NOTI của ATT không producer | chủ = "Sau MVP" | **giữ mở** — known issue có owner |
| KI-025 | S2 mở — 98/346 đường API không test HTTP | chủ = "Sau MVP" | **giữ mở** — known issue có owner |

Sau scrub: `S2` open = **2** (KI-021 · KI-025) ⇒ đạt ngưỡng `RELEASE-05` §5.3 (`≤3`, mỗi mục có owner +
workaround). `S0`=0 · `S1`=0.

⚠️ **Quy tắc tự chặn:** không đóng KI nào bằng lời. Mỗi ô "ĐÓNG" ở trên phải dẫn **file:dòng hoặc log
chạy**. KI-008/KI-029 đóng bằng bằng chứng của WO khác — ghi rõ WO nào, không nhận công.

---

## 5. Deliverable

### D1 — Build identity: biết CHÍNH XÁC bản nào đang chạy 🔴

**Vì sao đây là việc đầu tiên, không phải việc phụ:** hôm nay không có cách nào hỏi PROD "anh đang chạy
build nào". `m prod-restart` làm PID/log/env trông như đã deploy trong khi `dist` vẫn là code CŨ
(memory `prod-restart-does-not-rebuild-dist`). Không có định danh build thì **smoke sau deploy · canary ·
rollback đều không verify được** — chúng chỉ chứng minh "một cái gì đó đang sống".

- `apps/api/src/health/build-info.ts` — đọc `MEDIAOS_BUILD_*` (version · commit · builtAt) + migration
  head **tĩnh từ journal lúc build**. Thiếu env ⇒ trả `"unknown"`, **KHÔNG đoán**, không ném.
- `/health` (`@Public()`) trả thêm `build: { version, commit, builtAt, migrationHead }`.
  - *Lộ thông tin?* Repo **PUBLIC** ⇒ short-sha không thêm bit nào cho kẻ tấn công. Chỉ 4 trường tĩnh,
    **không** chạm DB (giữ `/health` là liveness thuần — `canary-watch.sh` dựa vào tính chất này).
  - Additive ⇒ không phá `canary-watch.sh` (đọc `status`), không có schema `health` trong `contracts`.
- `scripts/stamp-build.mjs` — sinh `apps/api/dist/build-info.json` lúc build (version + `git rev-parse`
  + timestamp + migration head). Không có git ⇒ `"unknown"`.
- **Test:** `apps/api/src/health/build-info.spec.ts` — thiếu env → `unknown`; đủ env → đúng giá trị;
  `/health` giữ nguyên các trường cũ (chốt hồi quy chống phá canary).

### D2 — Version stamp `v1.0.0-rc.1`

`package.json` root `0.0.0` → `1.0.0-rc.1` (**chỉ root** — packages đều `private`, bump lan man không
thêm gì mà đẻ diff). Đây là nguồn cho D1.

### D3 — Thư mục release riêng cho PROD + đường rollback ứng dụng 🔴 (đóng KI-016)

**Bài toán:** service PROD chạy thẳng `apps/api/dist` — thư mục mà `m dev-online`/`dev-online-fast`
biên dịch lại ⇒ bật UAT có thể đẩy binary mới vào PROD trong khi DB PROD chưa có migration tương ứng
(đã gây PROD login 500 ngày 2026-07-08).

**Giải:** snapshot `dist` sang `apps/api/releases/<stamp>/`, service trỏ `apps/api/releases/current`.

- Vì sao **trong** `apps/api`: node phân giải `node_modules` đi lên từ thư mục file. Đặt ở
  `apps/api/releases/<stamp>/` thì chuỗi tra là `…/releases/<stamp>/node_modules` →
  `apps/api/node_modules` ✅ → root. Đặt ở `<repo>/releases/` sẽ **trượt** `apps/api/node_modules`
  (pnpm isolated) ⇒ vỡ lúc chạy. Đây là ràng buộc kỹ thuật, không phải sở thích.
- `m prod-update api` đổi thành: build → **snapshot** → migrate (giữ nguyên fail-closed) → repoint
  `current` → restart → canary.
- `m prod-rollback [<stamp>]` — liệt kê release, repoint `current` về bản trước, restart, canary.
  Đây là **đường rollback ứng dụng thật đầu tiên** của dự án (`RELEASE-01` §7.3 đang ghi ⚠️).
- `m prod-status` **phát hiện service còn trỏ `dist`** ⇒ cảnh báo LOUD (không im lặng coi như xong).
- `apps/api/releases/` vào `.gitignore` (artifact, không phải nguồn).
- **Giữ lại `dist`** làm đường chạy hợp lệ: WO này KHÔNG đơn phương đổi cấu hình NSSM đang phục vụ
  người thật. Cutover = 1 lệnh admin trong runbook (§8).

### D4 — Smoke sau deploy CHẠY ĐƯỢC (IMP09-SMOKE-001…010)

`scripts/release-smoke.mjs` — 10 ca của `IMPL-09` §17.4, dựng theo khuôn `scripts/perf-smoke.mjs`
(đăng nhập thật, đọc `meta.request_id`, cred từ env, không log token).

- **Mặc định CHỈ ĐỌC.** SMOKE-008 (LEAVE) — `IMPL-09` §17.4 cho phép "smoke read-only pass"; nhánh ghi
  chỉ chạy khi `--write` **và** có tài khoản test riêng, tạo xong **xoá ngay**, verify đã xoá.
- Assert **build identity** khớp bản vừa deploy (`--expect-commit`) — nếu không, smoke đang chứng minh
  cho bản CŨ (chính cái bẫy `prod-restart-does-not-rebuild-dist`).
- Exit code phân biệt: `0` pass · `1` ca đỏ · `2` không đăng nhập được · `3` lỗi cấu hình.

### D5 — RC checklist + release notes (RELEASE-REL-001)

`docs/RELEASE/RELEASE-07_Release_Candidate_v1.0.0-rc.1.md` — đúng khuôn `IMPL-09` §16.4 (release
information · scope theo 8 module · fixed issues · known issues · test summary · deployment note ·
approval) **+ bảng RC-001…008 §3 ở trên**, ô nào chưa đạt ghi CHƯA ĐẠT kèm ai đóng.

### D6 — Alerting chạy được (đóng KI-011)

`scripts/ops-alert-check.mjs` + `scripts/lib/ops-alert-rules.mjs` (**logic thuần, tách ra để test
được**). Chỉ nhận những alert §18.3 **đo được trên hạ tầng này** — không khai cái không đo được:

| Alert §18.3 | Đo bằng | Ngưỡng |
| --- | --- | --- |
| Backend down | `/health` liveness | fail liên tiếp |
| DB connection/readiness | `/health/db` body `status` + `latencyMs` | `down` hoặc latency cao |
| Migration drift | journal ↔ `drizzle.__drizzle_migrations` | pending > 0 |
| Audit/job failure | `system_job_runs` status `Failed` trong cửa sổ | > ngưỡng |
| API 5xx spike | đếm `logs/api.err.log` trong cửa sổ | > ngưỡng |
| Disk | dung lượng trống ổ chứa `pgdata` + logs | < ngưỡng |
| Backup age | mtime backup mới nhất | > 24h |
| SSL expiry | hạn cert của domain | < 14 ngày |

- Ra `logs/ops-alerts.log` (dòng JSON) + bảng người đọc + `--json`; exit `0/1/2` theo severity cao nhất.
- Webhook **tuỳ chọn** qua env (`OPS_ALERT_WEBHOOK`) — **không hardcode**, không log URL.
- **Test:** `scripts/lib/ops-alert-rules.test.mjs` (`node --test`) — mỗi luật có ca đạt/vượt/thiếu-dữ-liệu.
  **Thiếu dữ liệu ⇒ `unknown`, KHÔNG phải `ok`** (fail-closed: cái không đo được không được báo xanh).
- **Wire test vào cổng:** thêm step `node --test scripts/lib/*.test.mjs harness/*.test.mjs` vào
  `harness/check.sh` + CI. `harness/lane-db-guard.test.mjs` hiện **14/14 pass nhưng KHÔNG chạy ở đâu cả**
  — nhận luôn vào cổng để test mới không thành đồ trang trí.

### D7 — Runbook go-live + rollback (RELEASE-GO-001)

`docs/RELEASE/RELEASE-08_Go_Live_Runbook.md` — `IMPL-09` §17.2/17.3/17.5/17.6/17.7 **ánh xạ sang lệnh
`m` thật** của repo này (`m prod-status` · `m prod-update` · `m prod-rollback` · `m migrate` ·
`backup-restore-drill.sh` · `canary-watch.sh` · `release-smoke.mjs`), + war-room + communication plan.
Không định nghĩa lại cơ chế deploy/backup (nguồn sự thật = `DEVOPS-01`/`-10`); runbook là **thứ tự +
người bấm + cách verify**.

### D8 — Monitoring · logging · support readiness

`docs/RELEASE/RELEASE-09_Monitoring_Alerting_Support_Readiness.md` — checklist §18.2 · alert §18.3
(ánh xạ D6, ô nào KHÔNG đo được thì ghi **KHÔNG ĐO ĐƯỢC**, không tick) · logging §18.4 (ghi thật:
JSON log **chưa có** = KI-009) · support §18.5 phần *quy trình* · hypercare §18.6.

### D9 — Cập nhật sổ

`RELEASE-02` (đóng KI-008/011/016/029, sửa §2+§3 tally) · `RELEASE-01` (§7.3 · §8 · §10 C5/C6 · điểm
scorecard) · `harness/backlog.mjs` (`S6-REL-1` done) · ledger.

---

## 6. Rủi ro & chốt chặn

| # | Rủi ro | Chốt |
| --- | --- | --- |
| R1 | Đổi đường chạy PROD (D3) ngay trước go-live có thể làm hỏng PROD | PR **không** đổi cấu hình service. `dist` vẫn chạy được. Cutover = 1 lệnh admin có ghi cách quay lại. `m prod-status` cảnh báo khi lệch |
| R2 | Thêm trường vào `/health` phá `canary-watch.sh` | Additive; chốt hồi quy giữ nguyên `status`/`service`/`time`; chạy `canary-watch.sh --once` thật để verify |
| R3 | Smoke ghi dữ liệu test vào PROD | Mặc định read-only; nhánh ghi cần `--write` + tài khoản test + xoá + verify đã xoá. Nhắc `check-prod-test-tenants.mjs` (KI-028) |
| R4 | Alert script tự nó hỏng im lặng ⇒ tưởng "không có cảnh báo = ổn" | Thiếu dữ liệu ⇒ `unknown` (không phải `ok`); exit code phân biệt; có test cho đúng ca này |
| R5 | Tick RC-003/004 dựa trên "PROD chạy được" thay vì staging | §3 ghi CHƯA ĐẠT tường minh; tài liệu RC không có ô nào tick hộ |
| R6 | Đóng KI bằng lời, không bằng bằng chứng (bẫy `reconcile đóng dấu OAN`) | §4 mỗi ô có file:dòng / log; KI đóng nhờ WO khác ghi rõ WO nào |
| R7 | Script mới không có ai chạy ⇒ trang trí (đúng bẫy `DEVOPS-13` §3.1) | D6 wire `node --test` vào `check.sh` + CI; D4/D6 phải **chạy thật** và dán log vào tài liệu |

---

## 7. Thứ tự thi công

1. D2 version → D1 build identity (+test) → verify `canary-watch.sh` không gãy
2. D3 release dir + `m prod-rollback` + cảnh báo `prod-status`
3. D4 smoke script → chạy thật vào PROD (**read-only**)
4. D6 alert rules + test + wire cổng → chạy thật
5. D7 runbook · D8 monitoring/support · D5 RC checklist + release notes (dán log của 3·4 vào)
6. D9 sổ + backlog/ledger
7. Verify `bash harness/check.sh --all` (lane DB) → PR

---

## 8. Bước của OWNER (ngoài PR — WO không tự bấm)

| # | Việc | Lệnh | Chặn cái gì |
| --- | --- | --- | --- |
| O1 | Bật staging + áp migration | `m dev-online-db` → `m dev-online-fast` | RC-003 · RC-004 |
| O2 | Chạy regression P0 + smoke trên staging | `node scripts/release-smoke.mjs --base http://localhost:3200/api/v1` | RC-003 |
| O3 | Cutover service PROD sang `releases/current` (Administrator) | ghi trong `RELEASE-08` §deploy | đóng KI-016 ở PROD |
| O4 | Đăng ký alert theo lịch (Task Scheduler) | ghi trong `RELEASE-09` | KI-011 ở PROD |
| O5 | Tạo tag RC **sau khi PR merge** | `git tag -a v1.0.0-rc.1 …` (nội dung soạn sẵn trong `RELEASE-07`) | cắt RC |
| O6 | Ký accepted-risk **D3** + chạy UAT Cycle 1 | `RELEASE-04` | `RELEASE-01` C3/C4 |

---

## 9. Verify

- `bash harness/check.sh --all` với `LANE_DB` (vùng đỏ ⇒ bắt buộc deny-path chạy thật).
- `node --test scripts/lib/*.test.mjs harness/*.test.mjs` xanh.
- `bash scripts/canary-watch.sh --once` vào PROD → HEALTHY (chứng minh D1 không phá canary).
- `node scripts/release-smoke.mjs` vào PROD read-only → dán kết quả 10 ca vào `RELEASE-07`.
- `node scripts/ops-alert-check.mjs` → dán bảng vào `RELEASE-09`.
- FULL gate: `security-reviewer` + `deploy-gate`; **không push thẳng `master`**; người chốt.
