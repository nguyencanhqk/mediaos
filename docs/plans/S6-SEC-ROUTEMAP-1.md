# S6-SEC-ROUTEMAP-1 — Census route bằng QUÉT RUNTIME + đóng vế GET của route-guard sweep

> Zone 🟡 · gate LIGHT (`typescript-reviewer` + `quality-gate`) + `security-reviewer` đọc phán quyết ·
> Không chạm `apps/api/src/**` (WO này KHÔNG sửa hành vi runtime — nó dựng phép đo và cái lưới).

## 1. Vấn đề

Báo cáo `S6-SEC-1` §0.4 ghi lại: con số "route không gate" **sai bốn lần** (49 → 38 → 114 → 40) vì
đo bằng regex trên mã nguồn. Bốn bẫy đều là bẫy của parse tĩnh, không phải bất cẩn:

| Lần | KQ | Bẫy |
| --- | ---: | --- |
| 1 | 49 | bỏ `@RequirePermission` **cấp class** ⇒ đếm thừa route `/me/*` |
| 2 | 38 | cửa sổ decorator `i+8` **nuốt decorator route kế tiếp** ⇒ đếm THIẾU (chính chỗ giấu `GET /org/teams/:id/members`) |
| 3 | 114 | `@RequirePermission(` trải nhiều dòng ⇒ regex đòi trọn cặp ngoặc trượt |
| 4 | 40 | docstring nhắc TÊN decorator để giải thích vì sao KHÔNG dùng ⇒ đọc thành "đã gác" |

Song song, cái lưới đang có (`route-guard-coverage.e2e-spec.ts:148`) lọc `httpMethod !== "GET"` —
đó **chính xác** là lý do KI-030 (`GET /org/employees` + 2 route họ hàng) đi qua mọi cổng review mà
không ai kêu.

## 2. Quyết định thiết kế

**QĐ-1 — Một bộ quét, chạy runtime, 0 regex.** Tái dùng hạ tầng đã có ở
`route-guard-coverage.e2e-spec.ts` (boot `AppModule` + `DiscoveryService` + đọc
`PATH_METADATA`/`METHOD_METADATA`/`REQUIRE_PERMISSION`/`IS_PUBLIC`), tách thành module dùng chung
`test/foundation/route-census.ts`. KHÔNG viết máy quét thứ hai — hai máy quét là hai con số.

**QĐ-2 — Phạm vi phán quyết rộng hơn bản cũ: gồm cả `@Public`.** Bản cũ chỉ phán quyết 2/12 route
`@Public` (`/health`, `/health/db`). `@Public` bỏ qua **cả** `JwtAuthGuard` lẫn `CompanyGuard` ⇒ đó là
mức rủi ro cao nhất, không phải mức được miễn ký. Tập bắt buộc = mọi route không `@RequirePermission`
= **43 không gate + 12 `@Public` = 55**.

**QĐ-3 — Sổ phán quyết là CODE, không phải bảng trong doc.** `test/foundation/route-verdicts.ts` giữ
7 ô (`SELF · PUBLIC · OTHER_GUARD · TENANT_READ · DEAD-410 · PARKED · GAP`), mỗi route đúng một ô +
lý do thành câu. Phụ lục A trong báo cáo được **sinh từ** sổ này, không chép tay ⇒ không thể lệch.

**QĐ-4 — `MUTATION_BASELINE` bị thay, không được nới.** Sổ phán quyết bao trùm cả 7 dòng baseline cũ
(đều là `PARKED`). Bỏ lọc GET; luật mới: *route không gate mà không có phán quyết = ĐỎ*, bất kể verb.

**QĐ-5 — Đóng băng danh sách `GAP`.** Nếu chỉ cần "có một dòng trong sổ" là xanh thì người vội sẽ dán
nhãn `GAP` cho route mới. `FROZEN_GAPS` khoá đúng tập 3 route KI-030; thêm/bớt đều ĐỎ. Kèm luật phụ:
route GHI không bao giờ được mang ô `TENANT_READ`/`GAP`.

**QĐ-6 — Artifact máy-đọc được commit VÀ được test khoá.** `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`
chứa toàn bộ 452 route + phán quyết. Test so artifact đã commit với census runtime ⇒ số trong Phụ lục A
không thể là số chép tay cũ. Sinh lại bằng `ROUTE_CENSUS_WRITE=1` (ma sát có chủ đích: thêm route ⇒
buộc nhìn lại delta census).

**QĐ-7 — Không cần Postgres.** Giữ nguyên tính chất của spec cũ (không `skipIf(!hasDb)`) ⇒ lưới này
chạy trong `pnpm test` mặc định của CI, không phụ thuộc lane DB.

## 3. Việc

1. `route-census.ts` — collector runtime dùng chung (verb · path đầy đủ · `hasPermission` + cấp khai ·
   `isPublic` · guard cấp class/route).
2. `route-verdicts.ts` — sổ 55 phán quyết có chữ ký + `FROZEN_GAPS`.
3. `route-guard-coverage.e2e-spec.ts` — viết lại: bỏ lọc GET, 9 assertion (sanity · phủ phán quyết ·
   sổ không có dòng chết · phán quyết hợp lệ · GAP đóng băng · mutation không được TENANT_READ/GAP ·
   **`@RequirePermission` không trang trí** · hồi quy branding · artifact khớp census).

   > **QĐ-8 (thêm trong lúc làm):** đo luôn điểm mù cùng họ — `PermissionGuard` **không** phải
   > `APP_GUARD` mà opt-in theo controller, nên route khai `@RequirePermission` mà thiếu
   > `@UseGuards(PermissionGuard)` là **gate giả**: đọc code tưởng có gác, runtime không kiểm gì.
   > Census cho **0/397**; khoá bằng assertion để nó không âm thầm khác 0.
4. Sinh artifact JSON; dựng lại **Phụ lục A** của báo cáo `S6-SEC-1` từ artifact.
5. Chấm lại §2.3 · §13.3 · §13.4 theo số mới; **mọi sai lệch ghi tường minh** — không sửa lén số cũ.
6. RELEASE-02: KI-030 mở rộng theo census (1 → 3 route).

## 4. Rủi ro & cách chặn

| Rủi ro | Chặn |
| --- | --- |
| Sổ phán quyết thành bãi rác allow-list | `GAP` đóng băng · mutation cấm `TENANT_READ`/`GAP` · lý do bắt buộc ≥20 ký tự · dòng chết ⇒ ĐỎ |
| Người sau thêm route rồi "sửa test cho xanh" | Thông báo lỗi nêu thẳng lựa chọn (a) gate hay (b) ký phán quyết, và ghi "KHÔNG được nới luật ở file này" |
| Artifact so sánh theo byte ⇒ vỡ vì prettier | So sánh JSON đã parse, không so byte |
| Boot `AppModule` lần hai làm chậm suite | Gộp mọi assertion vào MỘT spec ⇒ đúng một lần boot (~6s) |
| WO này vô tình sửa hành vi | `paths` không có `apps/api/src/**`; việc gate thật là của `S6-SEC-ORG-1` |

## 5. Định nghĩa đóng

- Census runtime ra artifact máy-đọc cho **452/452** route; Phụ lục A sinh từ artifact, 55 phán quyết.
- 6 route "chưa từng được phán quyết" của §0.4 đều có mặt.
- RED-proof: gỡ phán quyết ⇒ test ĐỎ và in đúng 3 route GET của KI-030.
- §2.3 · §13.3 · §13.4 chấm lại, kèm bảng delta cũ↔mới.
- `pnpm lint` + `pnpm typecheck` + `check.sh --all` (LANE_DB) xanh; CI xanh trên PR.
