# S19-FE-SIGNEDTAB-1 — nút tải CV ứng viên mở tab trắng không bao giờ được điều hướng (`noopener` ⇒ `window.open` trả `null`): chuyển sang helper dùng chung `openSignedUrlInNewTab`

> Trạng thái: **plan v1 (16/10/2026)**, đo tĩnh trên `a2aabe7e` (worktree `MediaOS-stab`, nhánh `fix/s19-fe-signedtab-1`).
> Zone ĐỎ (giữ zone của WO, §8 O2) · CHỈ FE (`apps/app`) · KHÔNG migration · KHÔNG dependency · KHÔNG đổi contracts/API.
> Giao **PR-A = N2** rồi dừng, hỏi owner. N3 · N11 · CHAT tách sang `S19-FE-SIGNEDTAB-2`; N9 nối vào
> `S16-SOCIAL-FILEOPENUX-1` (§7 L0).
> Nguồn: mục WO `S19-FE-SIGNEDTAB-1` (`harness/backlog.mjs`) · §9 N2/N3/N9/N11 của `docs/plans/S19-OPS-TASKFILEURL-1.md` ·
> hai báo cáo quét ngày 14/10, nằm ngoài kho (`<kept>/s19-ops-taskfileurl-1/sweep-20261014/A-helper.md` · `B-direct.md`).
> Thẩm quyền: owner chọn «Mở SIGNEDTAB-1 tới PR-A (Recommended)» khoảng 17:22 ngày 16/10, trong khung ngân sách cùng ngày (WO đỏ ≤ 400 USD).
> Kho PUBLIC: plan, commit và PR không nêu host storage, mã tài khoản, tên bucket hay URL ký nào.
> **Bảng [OWNER] ở §8: 0 mục chặn phần mã. O1 (tách nợ ở L0) cần owner gật khi duyệt PR-A.**

Viết tắt: `A/` = `apps/app/src/` · `Cv` = `A/routes/recruit/components/CandidateCvTab.tsx` · «helper» =
`A/lib/open-signed-url.ts` (`openSignedUrlInNewTab`) · «route 034» = `GET /candidates/:id/files/:fileId/download-url` ·
`<kept>` = `C:/Users/fmcai/.claude/projects/c--dev-2-MediaOS/kept`.

## 1. Bối cảnh + phép đo

**Mã — đo tĩnh 16/10 [ĐO].** `git log 1519bd67..HEAD -- A/routes/recruit A/lib A/routes/hr A/routes/system/files` cho kết quả RỖNG,
nên mã FE vẫn y như lúc quét ngày 14/10.
- M1 `Cv:69-80`: gọi `window.open("", "_blank", "noopener,noreferrer")` (:71), sau đó `if (w) w.location.href = url` (:74).
  Khi lỗi: `w?.close()` rồi `parseRecruitError` → `setDownloadError` (:75-79). Chú thích :64-68 nói đúng ý định (mở tab đồng bộ),
  nhưng cờ `noopener` làm hàm trả `null`.
- M2 helper `:16-36`: gọi `window.open("", "_blank")` đồng bộ rồi đặt `tab.opener = null`. Sau `resolveUrl` có guard scheme
  `https:`/`http:` (:27-28), rồi gán `tab.location.href`, hoặc gọi `window.location.assign` khi popup bị chặn. Khi lỗi:
  `tab?.close()` rồi ném lại. Docblock :9-10 đã ghi bẫy `noopener`. Nơi dùng: TASK (`TaskFilePanel`) và 3 nút payroll.
- M3 census `window.open(` trong `apps/app/src` + `packages` (không tính spec) có 5 chỗ: helper:19 · `Cv:71` · `hr/employees/EmployeeFilesTab.tsx:70` ·
  `hr/employees/EmployeeContractsPage.tsx:61` · `system/files/FileDetailPage.tsx:65`. `Cv:71` là chỗ DUY NHẤT gọi dạng `""` kèm `noopener`.
  Ba chỗ cuối gọi `window.open(url, …)` sau `await`, tức là N3. Vá `Cv` là đóng TRỌN lớp lỗi N2.
- M4 `candidateFileApi.getDownloadUrl` (`A/routes/recruit/candidate-file-api.ts:62-63`) = `apiFetch(route 034, downloadUrlSchema)` ⇒
  trả `{ url, expiresAt }` (`packages/contracts/src/files.ts:193-198`). Vì `url` là `z.string().url()`, CV không bao giờ đi vào
  nhánh `return false` của helper.
- M5 Đường đi của route 034: `apps/api/src/recruit/recruit-candidate-file.controller.ts:57-67` (`@RequirePermission` = `view:candidate`,
  `recruit-route-pairs.const.ts:85`) → service `:83-90` (resolveActor · ứng viên còn sống · tệp link đúng ứng viên, lệch ⇒ 404
  chống IDOR) → `FileService.getDownloadUrl` → `createDownloadUrl` (`apps/api/src/storage/object-storage.service.ts:269-277`,
  tham số `serveAs` BẮT BUỘC) → `resolveServeDirectives` (`content-serving.ts:99-112`). Cách phục vụ: `inline` CHỈ cho
  `INLINE_SERVE_MIME_TYPES` (`:19-26`: png · jpeg · gif · webp · mp4 · webm); mọi kiểu khác (PDF, DOCX…) ⇒ `attachment` kèm tên tệp.
  Route có từ `2bf9cead` (#477). `git merge-base --is-ancestor 2bf9cead f66c94d9` exit 0, tức API PROD đo gần nhất đã có route ⇒
  PR-A không phải deploy API.
- M6 Lỗi của helper không phải `ApiError` (`unsafe-url`, hoặc `TypeError` từ `new URL`). Khi đó `parseKindError`
  (`packages/web-core/src/lib/error-mapper.ts:171-180`) trả `kind`/`code` = `null`, nên `recruitErrorI18nKey` → `errors.generic`
  (`A/routes/recruit/recruit-errors.ts:93-101`). Không lộ chi tiết và không cần khoá i18n mới.
- M7 `Cv.spec.tsx` (174 dòng) có 9 ca về cổng và tải lên. Ca tải xuống duy nhất (:155-174) chỉ kiểm nút có HIỆN, không ca nào
  chạm `window.open`. Spec của TASK và payroll giả `window.open` trả tab giả VÔ ĐIỀU KIỆN (`TaskFilePanel.spec.tsx:187-191`),
  nên không mô phỏng quy tắc chuẩn «`noopener` ⇒ `null`». Đó là lý do lỗi N2 sống được.
- M8 `harness/lib/wo-state.mjs:18`: `DONE = {finished, done, committed, pr_opened}`. Vì vậy, mở PR-A dưới id này sẽ ĐÓNG WO trên
  overlay và bảng. Phải thu hẹp WO TRƯỚC khi mở PR (§7 L0).

**Trình duyệt — 14/10 [ĐO]** (Chromium qua Playwright MCP, app thật chạy bằng vite, API giả lập bằng `page.route`, FE = `1519bd67`):

| Nhóm | Kết quả |
| --- | --- |
| CV PDF nhanh (211 ms) · chậm (6008 ms) · CV PNG nhanh | `window.open` chạy 26–30 ms sau click, activation còn, TRẢ `null` 3/3. Tab mới đứng ở `about:blank` (lúc 3,2 s và 9 s), 0 request tới storage, 0 download, 0 `role=alert`. **Hỏng ở mọi tốc độ, cả hai loại tệp.** |
| Helper (TASK PDF/PNG + 3 nút phiếu lương), nhanh và chậm ~6 s | 10/10 lượt tới tay; `window.open` trả window thật. PDF tải đúng tên có dấu (193 B, `%PDF-1.4`), nhưng tab mới đứng lại ở `about:blank` (N9). PNG hiện trong tab mới. |
| HR ×2 + SYSTEM (N3) | API nhanh: chạy, tab tự đóng, sự kiện download phát trên trang app. API chậm 6 s + bật chặn popup (Chrome thứ hai, `ignoreDefaultArgs`): 0 tab, 0 tệp, 0 thông báo (3/4 lượt; 1 lượt FileDetail bất thường, activation = true). Activation hết 5011 ms sau `pointerdown`. |

**Hệ quả của PR-A [SUY RA từ M5 + số đo helper]:** sau khi vá, CV dạng ảnh sẽ hiện trong tab mới, như TASK PNG.
CV dạng PDF/DOCX sẽ tải đúng tên nhưng để lại một tab `about:blank`, giống phiếu lương và TASK đang chạy trên PROD (N9).
Vẫn tốt hơn hẳn hiện trạng (không tải được gì).
Khi storage PROD chưa chuyển sang R2, người dùng ở máy khác vẫn không tới được URL ký. PR-A biến «tab trắng im lặng» thành
«tab điều hướng tới storage» (lỗi kết nối hiện ngay trong tab đó). Điều này không chặn merge (§8 O5).

## 2. Quyết định owner đã có

- 14/10, hộp hỏi «Add all 6, grouped»: gieo WO gom N2 · N3 · N9 · N11 (dòng `src` của WO).
- `done_when[0]` của WO ghi: «N2 hỏng thật ⇒ vá N2 TRƯỚC (giao được thành PR riêng)». Số đo 14/10 cho thấy N2 hỏng thật ⇒ điều kiện đạt.
- 16/10 khoảng 17:22: «Mở SIGNEDTAB-1 tới PR-A (Recommended)». Làm tới khi mở PR-A rồi hỏi lại; ngân sách WO đỏ ≤ 400 USD.
- Cùng hộp đó: «Bỏ qua — phép đo đã đủ (Recommended)». Đầu vào của planner không có câu hỏi gốc. Planner hiểu là KHÔNG đo lại trước
  khi vá (§8 O6).

## 3. Bất biến phải giữ

- B1 Không hard-code quyền. Cổng giữ NGUYÊN `useCanExact("view", "candidate")` (`Cv:28`) cho cả danh sách lẫn nút tải: cặp đọc
  phải bằng cặp tải. PR-A không đụng `canView`/`canUpload` và không đụng chuỗi tải lên.
- B2 Không lưu URL ký: không vào state, store, log, cache truy vấn hay thông báo lỗi. URL chỉ sống trong closure của helper.
- B3 Cắt opener: tab mới có `opener = null` (helper:20). KHÔNG truyền `noopener` vào `window.open` (helper:9-10).
- B4 `window.open` chạy ĐỒNG BỘ trong onClick, trước mọi `await`. Không bọc bằng `useMutation`, không `await` trước helper.
- B5 PR-A KHÔNG sửa helper. Guard scheme giữ nguyên (`https:`/`http:`); siết lại là việc của N11 → SIGNEDTAB-2.
- B6 Bất biến dự án #1–#3 không bị chạm (không query, không DB, không secret).
- B7 `git diff --stat origin/master -- apps/api packages` phải RỖNG ở PR-A.

## 4. Thiết kế

- **D1** Thay thân hàm `Cv.download` bằng:
  ```ts
  const download = async (fileId: string) => {
    setDownloadError(null);
    try {
      await openSignedUrlInNewTab(
        async () => (await candidateFileApi.getDownloadUrl(candidateId, fileId)).url,
      );
    } catch (err) {
      const info = parseRecruitError(err);
      setDownloadError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    }
  };
  ```
  Helper gọi `window.open` ở dòng đầu tiên, đồng bộ. Nút vẫn gọi trực tiếp `void download(f.fileId)` (`Cv:129`), nên lời gọi
  vẫn nằm trong nhịp click. Helper tự đóng tab rồi ném lại, nên `catch` chỉ lo hiện thông báo; bỏ `w?.close()`. Giá trị `boolean`
  helper trả về bị bỏ qua vì CV không có nhánh `null` (M4).
- **D2** Viết lại docblock `Cv:64-68`: trỏ tới helper và nêu bẫy `noopener`; bỏ phần tự mô tả cơ chế.
- **D3** Không thêm trạng thái chờ hay disabled cho nút (hiện chưa có). Bấm hai lần sẽ mở hai tab: ghi nợ ở §9.
- **D4** Không thêm khoá i18n. Không sửa 9 ca cũ của `Cv.spec.tsx`.
- **Phương án đã loại:**
  - (a) Giữ mã tự viết, chỉ bỏ `noopener` và thêm `w.opener = null`: sửa được lỗi nhưng sinh bản sao thứ hai của helper
    (dễ trôi, thiếu guard scheme và thiếu nhánh popup bị chặn).
  - (b) Gọi `window.open(url, …)` sau `await` như HR: đó chính là N3, bị chặn popup khi API chậm hơn ~5 s.

## 5. Triển khai — PR-A

- Nhánh `fix/s19-fe-signedtab-1`, worktree `MediaOS-stab`, cắt từ `a2aabe7e`. Thứ tự commit:
  1. L0 plan (`docs(plan)`)
  2. L0 tách nợ backlog (`chore(docs)`)
  3. L1 RED
  4. L2 GREEN
  5. sổ vết (`docs(plan)`)
- Chỉ đổi FE ⇒ Pages tự lên khoảng 13 phút sau khi merge. API không đổi, route 034 đã có trên API PROD (M5), nên không có ràng buộc
  thứ tự deploy. Đường lùi: revert PR, Pages lùi theo.
- Mô tả PR ghi:
  - số đo trước và sau vá, viết trung tính;
  - hệ quả N9 với PDF;
  - WO đã thu hẹp còn N2, cùng hai nơi nhận phần nợ còn lại.
- Agent KHÔNG merge. Dừng ngay sau khi mở PR để hỏi owner.

## 6. Ca test viết TRƯỚC (TỪ CHỐI đứng cạnh CHO PHÉP) + mutant ★

Giả lập theo đúng chuẩn trong `Cv.spec.tsx`, một describe mới:
`const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() }` cùng
`vi.spyOn(window, "open").mockImplementation((_u, _t, f) => (/noopener/i.test(String(f ?? "")) ? null : (tab as unknown as Window)))`.
Cấp quyền bằng cách gieo `capabilities` thẳng vào `useAuthStore`, không mock `useCanExact` (khuôn M7). Thêm `afterEach(vi.restoreAllMocks)`.
Trên jsdom, spy của `window.open` hiện tên là `"bound "` (L2 của TASKFILEURL đã đo).

| Ca | Loại | Kịch bản | Khẳng định | Trên mã cũ |
| --- | --- | --- | --- | --- |
| C-1 | CHO PHÉP | `view:candidate`; `getDownloadUrl` → `{ url: SIGNED }`; bấm «Tải xuống» | `open` gọi 1 lần với `("", "_blank")`; `tab.location.href === SIGNED`; `tab.opener === null`; `tab.close` không gọi; 0 alert; `getDownloadUrl(CANDIDATE_ID, FILE_ID)` | ĐỎ (`open` trả `null`) |
| C-2 | nhịp click | `getDownloadUrl` trả promise hoãn | ngay sau `fireEvent.click`, CHƯA resolve: `open` đã gọi 1 lần; sau resolve: `href === SIGNED` | ĐỎ ở vế `href` |
| C-3 | TỪ CHỐI ⇄ C-1 | reject `ApiError(404)`, `details` có `kind: "not-found"` | `tab.close` được gọi; `href === ""`; nội dung alert = `i18n.t("recruit:errors.notFound")` | ĐỎ (không có tab để đóng) |
| C-4 | popup bị chặn ⇄ C-1 | `open` luôn trả `null`; mock getter `location` = `{ assign }` | `assign(SIGNED)` gọi 1 lần; 0 alert | ĐỎ (mã cũ không làm gì) |
| C-5 | TỪ CHỐI ⇄ C-1 | `url = "javascript:alert(1)"` (zod bị bỏ qua vì API được mock) | `tab.close`; `href === ""`; `assign` không gọi; alert = `i18n.t("recruit:errors.generic")` (M6) | ĐỎ |
| C-6 | TỪ CHỐI cổng ⇄ C-1 | caps `{}` và `{ "*:*": true }` | không có nút tải; `open` và `getDownloadUrl` không được gọi | XANH (ca nền) |

**Mutant ★** chạy bằng MỘT script ngoài kho, `<kept>/s19-fe-signedtab-1/bin/mutants-fe.mjs`, theo khuôn `mutants-fe.mjs` của
TASKFILEURL. Mỗi lượt:
1. sao lưu tệp;
2. cấy mutant (neo phải xuất hiện đúng 1 lần);
3. chạy `Cv.spec` + `TaskFilePanel.spec` + `payroll-track-d-pdf.spec`;
4. khôi phục TỪ bản sao;
5. kiểm `git status --porcelain` RỖNG.

| Mutant | Cấy | Phải chết ở |
| --- | --- | --- |
| ★1 | helper thêm `"noopener,noreferrer"` | C-1 |
| ★2 | `Cv` chèn `await Promise.resolve()` trước lời gọi helper | C-2, ở vế đồng bộ |
| ★3 | helper bỏ `tab?.close()` trong `catch` | C-3, C-5 |
| ★4 | `Cv` nuốt lỗi (bỏ `setDownloadError`) | C-3 |
| ★5 | helper bỏ `tab.opener = null` | C-1 |

Lượt RED ở L1 (chạy spec mới trên `Cv` cũ) chính là mutant «trả về mã cũ».

## 7. Lát thi công · verify · gate

**L0 — tách nợ backlog** (commit `chore(docs): S19-FE-SIGNEDTAB-1 — thu hẹp còn N2; gieo SIGNEDTAB-2; nối N9 vào FILEOPENUX`).
Sau commit chạy `node --test harness/id-uniqueness.test.mjs`. Nội dung đổi CHÍNH XÁC:

(a) `S19-FE-SIGNEDTAB-1`:
- `layer: "FE"`.
- `title:` «Nút tải CV ứng viên (`CandidateCvTab`) mở tab bằng cờ `noopener` nên `window.open` trả `null` và tab trắng không bao giờ được điều hướng — ĐÃ ĐO hỏng ở mọi tốc độ, PDF lẫn PNG (N2 của S19-OPS-TASKFILEURL-1); N3 · N11 tách sang S19-FE-SIGNEDTAB-2, N9 nối vào S16-SOCIAL-FILEOPENUX-1».
- `paths:` `["apps/app/src/routes/recruit/components/CandidateCvTab.tsx", "apps/app/src/routes/recruit/components/CandidateCvTab.spec.tsx", "docs/plans/**", "harness/backlog.mjs"]`.
- `done_when:`
  - [0] «ĐO TRƯỚC bằng trình duyệt thật — ĐẠT 14/10/2026 (lượt quét ngoài kho, trích ở plan §1): nút tải CV hỏng ở mọi tốc độ, PDF lẫn PNG»
  - [1] «`CandidateCvTab` mở tệp qua `openSignedUrlInNewTab`: tab mở ĐỒNG BỘ trong onClick, không cờ `noopener` trong lời gọi `window.open`, opener bị cắt, lỗi ⇒ đóng tab + `role=alert`; spec giả lập ĐÚNG chuẩn (`window.open` có `noopener` ⇒ `null`) và ĐỎ trên mã cũ; mutant ★ chết»
  - [2] «Đo SAU vá bằng trình duyệt thật (app thật + API giả lập + tệp phục vụ cục bộ, KHÔNG storage thật): CV PNG hiện ở tab mới; CV PDF tải đúng tên có dấu (tab `about:blank` còn lại = N9, ghi nhận); API chậm ~6 s + chặn popup BẬT vẫn tới tay; lỗi API ⇒ tab đóng + thông báo»
  - [3] «Không đổi `apps/api/**` · `packages/**`; cổng `useCanExact("view", "candidate")` giữ nguyên»
- `src`: GIỮ các dòng cũ, THÊM: «16/10/2026 plan `docs/plans/S19-FE-SIGNEDTAB-1.md`: thu hẹp còn N2 (PR-A). N3 + N11 + phát hiện CHAT → `S19-FE-SIGNEDTAB-2`; N9 → `S16-SOCIAL-FILEOPENUX-1` (WO đó vốn có «CV + phiếu lương không để lại tab trắng»).»
- `notes[0]` đổi thành: «Seed 🔴 vì N9 đổi DTO; sau khi thu hẹp ngày 16/10, phần còn lại chỉ là FE. Zone giữ 🔴 tới khi owner hạ (plan §8 O2).»
- `zone`, `status`, `skills` và `depends_on` (`S19-OPS-TASKFILEURL-1`) giữ nguyên.

(b) Mục MỚI, chèn ngay sau `S19-FE-SIGNEDTAB-1`:
```js
{
  id: "S19-FE-SIGNEDTAB-2",
  module: "FRONTEND",
  layer: "FULL",
  title:
    "Mở tệp qua URL ký — phần còn lại sau SIGNEDTAB-1: 3 nút HR/SYSTEM gọi `window.open(url)` SAU `await` (API > ~5 s + chặn popup ⇒ không tab, không tệp, không báo) (N3) · guard scheme của helper còn nhận `http:` (N11) · CHAT gắn URL ký tạo lúc render vào `<a target=_blank>` (bấm muộn có thể quá TTL — CHƯA đo)",
  zone: "red",
  status: "todo",
  paths: [
    "apps/app/src/lib/**",
    "apps/app/src/routes/hr/employees/**",
    "apps/app/src/routes/system/files/**",
    "apps/app/src/components/chat/**",
    "apps/app/src/i18n/**",
    "packages/web-core/**",
    "apps/api/src/config/**",
    "docs/plans/**",
    "harness/backlog.mjs",
  ],
  skills: ["security-review", "code-review"],
  depends_on: ["S19-FE-SIGNEDTAB-1", "S16-SOCIAL-FILEOPENUX-1"],
  src: [
    "Tách từ `S19-FE-SIGNEDTAB-1` ở plan `docs/plans/S19-FE-SIGNEDTAB-1.md` §7 L0 (16/10/2026) — nợ N3 · N11 của `docs/plans/S19-OPS-TASKFILEURL-1.md` §9.",
    "N3 — ĐO 14/10/2026 (Chromium, app thật + API giả lập, FE = `1519bd67`; báo cáo ngoài kho, trích ở plan SIGNEDTAB-1 §1): `hr/employees/EmployeeFilesTab.tsx:70` · `hr/employees/EmployeeContractsPage.tsx:61` · `system/files/FileDetailPage.tsx:65` gọi `window.open(url, \"_blank\", \"noopener,noreferrer\")` sau `await`. API nhanh ⇒ chạy, tab tự đóng (KHÔNG để lại tab trắng); API ~6 s + chặn popup BẬT ⇒ 0 tab · 0 tệp · 0 thông báo (3/4 lượt). Activation hết ~5 s sau click.",
    "Phụ thuộc FILEOPENUX vì: chuyển 3 nút sang helper khi N9 chưa vá sẽ biến mọi lượt tải nhanh (đang chạy, không tab trắng) thành lượt để lại tab `about:blank`.",
    "N11 — FULL gate SEC-TFU-01 của TASKFILEURL: guard scheme `apps/app/src/lib/open-signed-url.ts:27-28` nhận cả `http:`; chọn chỗ ép `https:` (FE ngoài DEV/loopback, hay `apps/api/src/config/env.schema.ts` đòi `S3_ENDPOINT` https khi production) SAU khi ghi endpoint storage từng môi trường.",
    "CHAT — [SUY RA, chưa đo] lượt quét 14/10: `<a target=\"_blank\">` tới URL ký tạo lúc render ở `components/chat/MessageBubble.tsx` (:94 · :144 · :163) · `components/chat/room-info/RoomMediaGrid.tsx:111` · `components/chat/RoomFilesTab.tsx` (:130 · :147); TTL URL ký ngắn ⇒ bấm sau khi hết hạn có thể nhận lỗi từ storage.",
  ],
  done_when: [
    "ĐO TRƯỚC (trình duyệt thật): CHAT — bấm tệp sau khi URL ký hết hạn (TTL thật của môi trường đo) ⇒ ghi kết quả; N3 dùng số đo 14/10",
    "3 nút HR/SYSTEM mở tab ĐỒNG BỘ trong onClick qua helper chung (sau khi FILEOPENUX vá N9): API chậm + chặn popup BẬT vẫn tới tay; tải `attachment` KHÔNG để lại tab trắng; spec giả lập đúng chuẩn, ĐỎ trên mã cũ",
    "N11: plan ghi endpoint storage của từng môi trường (PROD sau R2 · dev-online · dev · CI) rồi mới chọn chỗ ép `https:`; ca test: `http:` bị từ chối ở môi trường ép, vẫn chạy ở dev",
    "CHAT: đo thấy hỏng ⇒ lấy URL ký lúc bấm (không lúc render) hoặc làm mới khi hết hạn; không hỏng ⇒ ghi số đo + đóng mục",
  ],
  notes: [
    "Seed 16/10/2026 khi thu hẹp S19-FE-SIGNEDTAB-1. 🔴 vì N11 có thể chạm `env.schema` (cấu hình storage) và HR/CHAT là đường cấp quyền đọc tệp.",
  ],
},
```

(c) `S16-SOCIAL-FILEOPENUX-1`: CHỈ nối thêm, không viết lại.
- `src` thêm: «16/10/2026 — nhận N9 của `docs/plans/S19-OPS-TASKFILEURL-1.md` §9 (tách từ S19-FE-SIGNEDTAB-1, plan `docs/plans/S19-FE-SIGNEDTAB-1.md` §7 L0). ĐO 14/10 (Chromium): mọi nút qua helper `apps/app/src/lib/open-signed-url.ts` (đã dời từ `payroll/`) đều để lại tab `about:blank` sau khi tải tệp `attachment` — TASK PDF + 3 nút phiếu lương, nhanh lẫn chậm; ảnh `inline` hiện bình thường. Câu «TASK tệp không đổi (đã tải blob)» ở trên ĐÃ CŨ: từ `1519bd67` TASK đi qua helper; sau SIGNEDTAB-1, CV cũng vậy.»
- `done_when` thêm: «N9 (helper chung): tải `attachment` qua `openSignedUrlInNewTab` KHÔNG để lại tab trắng cho TASK · 3 nút phiếu lương · CV; cách phục vụ lấy từ quyết định của SERVER (`resolveServeDirectives`), FE không đoán theo đuôi tệp; tệp `inline` vẫn mở tab mới; tab vẫn mở ĐỒNG BỘ trong onClick; đo lại bằng trình duyệt thật»
- `paths` thêm: `"apps/app/src/lib/**"`, `"apps/app/src/routes/tasks/**"`.

**L1 RED.** Build contracts rồi web-core nếu dist cũ. Viết C-1…C-6 trên `Cv` cũ.
Chạy `pnpm --filter @mediaos/app exec vitest run src/routes/recruit/components/CandidateCvTab.spec.tsx`. Không dùng `pnpm test -- <path>`
vì lệnh đó KHÔNG lọc mà chạy cả suite.
Kỳ vọng: C-1…C-5 ĐỎ; C-6 và 9 ca cũ XANH. Chép nguyên văn thông điệp đỏ vào §9.3.

**L2 GREEN.** Làm D1 + D2. Spec phải xanh 15/15.

**L3 mutant.** Chạy ★1–★5 (§6). Ghi số liệu, khôi phục và `git status` của từng lượt vào §9.3.

**L4 đo trình duyệt sau vá.**
1. Chuẩn bị:
   - Server tệp cục bộ, ngoài kho: `<kept>/s19-fe-signedtab-1/bin/local-files.mjs` (node `http`, chỉ 127.0.0.1). Phục vụ `/f.pdf`
     (`application/pdf` + `attachment`, tên tệp có dấu) và `/f.png` (`image/png` + `inline`). Header lấy đúng đầu ra của
     `resolveServeDirectives` (in một lần từ dist `apps/api`). KHÔNG dùng storage R2 thật.
   - Chạy vite từ worktree trên một cổng trống. `VITE_API_URL` và `VITE_AUTH_APP_URL` trỏ tới cổng chết.
   - Giả lập bằng `page.route`: refresh · `/auth/me` (`access:recruit`, `view:candidate`) · ứng viên · danh sách 2 tệp ·
     `download-url` trả URL của server cục bộ; có biến thể trễ 200 ms / 6 s và biến thể 404.
2. Các lượt đo:
   - (a) PDF nhanh
   - (b) PDF chậm 6 s
   - (c) PNG nhanh
   - (d) PDF chậm 6 s trên Chrome thứ hai, BẬT chặn popup (`ignoreDefaultArgs: ['--disable-popup-blocking']`)
   - (e) lỗi 404
3. Đo trong mỗi lượt:
   - `window.open` có trả `null` không (bọc bằng `addInitScript`, đối số bị che);
   - số tab trước → sau;
   - URL và `contentType` cuối của tab mới;
   - sự kiện `download` trên CẢ trang app lẫn tab mới (tên, `failure()`, số byte);
   - số `role=alert`;
   - URL tab app có giữ nguyên không.
4. Lưu ý khi đo:
   - KHÔNG `page.evaluate` trong lúc chờ API, vì lệnh này tự cấp user activation.
   - Ca `assign` khi popup bị chặn chỉ phủ bằng unit (C-4), vì không ép được `null` khi activation còn hiệu lực.
5. Dọn dẹp:
   - Chỉ dừng PID của chính lượt đo (`taskkill /PID … /T /F`), không diệt theo tên ảnh.
   - Chuyển các tệp trong `.playwright-mcp` của lượt này sang scratchpad.
   - Grep chặn trên `git diff --cached`: phải RỖNG.

**Gate** (diff chỉ FE, ~20 dòng mã + spec):
- `security-reviewer` với đề hẹp, trần 15 lượt công cụ: opener/tabnabbing · nhịp click đồng bộ · đường guard scheme · URL không bị
  lưu hay log · thông báo lỗi không lộ chi tiết · cặp cổng không đổi · lỗi không bị nuốt im lặng.
- `ecc:typescript-reviewer`, trần 10 lượt.
- Vá các finding rồi chạy lại L1/L2. Không dùng `santa-method` (không có logic crown-jewel, §8 O3).

**Verify** (sau gate):
- V1 `pnpm --filter @mediaos/app test` (cả suite app) + spec ở L1.
- V2 `pnpm --filter @mediaos/app typecheck` · eslint + `prettier --check` cho 2 tệp.
- V3 `bash harness/check.sh --all --lane-db=stab`. Lý do: `--all` khi thiếu `LANE_DB` sẽ ĐỎ vì ~184 int-spec bị skip. Không có
  Postgres ⇒ ghi lại đỏ-do-skip kèm V5, owner chốt (§8 O4).
- V4 `node --test harness/id-uniqueness.test.mjs`.
- V5 `git diff --stat origin/master -- apps/api packages` RỖNG.
- V6 gitleaks trên các commit của nhánh, cộng grep chặn host/`X-Amz` trên diff.

**PR:** push `-u`, `gh pr create` (mô tả theo §5, có test plan), rồi DỪNG.
**Mốc ⏸:** chi phí WO vượt 300 USD trước khi tới PR ⇒ dừng, hỏi owner.

## 8. Bảng [OWNER]

| # | Câu hỏi | Mặc định nếu không trả lời | Chặn? |
| --- | --- | --- | --- |
| O1 | Tách nợ ở L0 (thu hẹp SIGNEDTAB-1 · gieo SIGNEDTAB-2 · nối N9 vào FILEOPENUX)? | Làm như §7 L0 | Không (đảo được trước khi merge) |
| O2 | Zone của SIGNEDTAB-1 sau khi thu hẹp (chỉ còn FE)? | Giữ 🔴, gate hẹp như §7 | Không |
| O3 | Gate: `security-reviewer` + `typescript-reviewer`, hay thêm `react-reviewer` + `silent-failure-hunter` theo bảng §6 của CLAUDE.md? | Hai reviewer; phần «lỗi im lặng» đã nằm trong đề của `security-reviewer` | Không |
| O4 | V3 cần Postgres cho `--lane-db` | Chạy `--lane-db=stab`; không có Postgres ⇒ ghi đỏ-do-skip + V5 | Không |
| O5 | Merge PR-A trước khi chuyển storage PROD sang R2? | Được: không hại; máy khác chỉ tải được thật sau khi chuyển R2 | Không |
| O6 | «Bỏ qua — phép đo đã đủ» có nghĩa là KHÔNG đo lại trước khi vá? | Hiểu như vậy; L4 chỉ đo sau vá | Không |

## 9. Ngoài phạm vi / nợ · rủi ro + đường lùi

**Không làm trong PR-A:**
- N3 · N11 · CHAT → `S19-FE-SIGNEDTAB-2`.
- N9 → `S16-SOCIAL-FILEOPENUX-1`. Có hai hướng, chọn ở plan của WO đó:
  - (a) Thêm cờ cách phục vụ vào DTO URL ký: đổi contracts + API, zone 🔴, phải thêm `paths`.
  - (b) FE đọc tham số `response-content-disposition` ĐÃ KÝ trong URL. Giá trị do `resolveServeDirectives` quyết, nên vẫn là
    server quyết; chỉ đổi FE. Nhược điểm: chỉ chạy với URL ký kiểu S3; URL proxy không có tham số này thì rơi về mở tab mới.
- N10 (timeout `apiFetch`) → `S19-FE-APIFETCHTIMEOUT-1` (đã seed).
- Nút CV không có trạng thái chờ: bấm hai lần ⇒ hai tab. Nợ nhỏ, có thể gộp vào FILEOPENUX.

| Rủi ro | Giảm bằng | Đường lùi |
| --- | --- | --- |
| Mở PR-A đóng CẢ WO trên overlay (M8) | L0 thu hẹp TRƯỚC; L0 dùng tiền tố `chore(docs)` | Ghi sự kiện `reopened` |
| Start-on-touch đóng dấu SAI: `Cv` khớp cả glob `apps/app/src/routes/recruit/**` của FILEOPENUX | Sau L2, đọc `harness/activity.jsonl` (chỉ có ở checkout chính) | Thêm sự kiện `reopened` cho FILEOPENUX |
| Unit giả lập ≠ trình duyệt thật | C-1 mô phỏng ĐÚNG chuẩn `noopener ⇒ null`; L4 đo thật | — |
| PDF vẫn để lại tab trắng sau vá | Chấp nhận (§1, giống PROD đang chạy); N9 → FILEOPENUX | — |
| Lộ host/URL ký vì kho PUBLIC | L4 chỉ dùng server cục bộ, không R2; đối số bị che; grep chặn | Commit chưa push ⇒ sửa lại commit |
| Trùng id SIGNEDTAB-2 | V4 | Đổi id |
| Vượt chi phí | Mốc ⏸ 300 USD; trần lượt cho mỗi reviewer | Dừng, hỏi owner |

### 9.3 Sổ vết

| Bước | Ngày | Kết quả |
| --- | --- | --- |
| Plan v1 | 16/10/2026 | Commit này, trên `a2aabe7e`. Đối chiếu mã M1–M8 và trích số đo 14/10. |
| L0 tách nợ | | |
| L1 RED | | |
| L2 GREEN | | |
| L3 mutant | | |
| L4 trình duyệt | | |
| Gate | | |
| Verify | | |
| PR-A | | |
