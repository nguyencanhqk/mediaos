# S19-FE-SIGNEDTAB-1 — nút tải CV ứng viên mở tab trắng không bao giờ được điều hướng (`noopener` ⇒ `window.open` trả `null`): chuyển sang helper dùng chung `openSignedUrlInNewTab`

> Trạng thái: **plan v2 (16/10/2026)**. v1 = `3565acd7`; v2 vá plan-review (PASS_WITH_FIXES: 3 HIGH · 5 MEDIUM · 8 LOW, §9.3).
> Đo tĩnh trên `a2aabe7e` (worktree `MediaOS-stab`, nhánh `fix/s19-fe-signedtab-1`).
> Zone ĐỎ (giữ — plan-review H1 cách (a)) · CHỈ FE (`apps/app`) · KHÔNG migration · KHÔNG dependency · KHÔNG đổi contracts/API.
> Giao **PR-A = N2** rồi dừng, hỏi owner. N3 · N11 · CHAT tách sang `S19-FE-SIGNEDTAB-2`; N9 nối vào
> `S16-SOCIAL-FILEOPENUX-1` (§7 L0). Commit L0 lên master TRƯỚC khi mở PR-A (§5, M1).
> Nguồn: mục WO `S19-FE-SIGNEDTAB-1` (`harness/backlog.mjs`) · §9 N2/N3/N9/N11 của `docs/plans/S19-OPS-TASKFILEURL-1.md` ·
> hai báo cáo quét ngày 14/10, nằm ngoài kho (`<kept>/s19-ops-taskfileurl-1/sweep-20261014/A-helper.md` · `B-direct.md`).
> Thẩm quyền: owner chọn «Mở SIGNEDTAB-1 tới PR-A (Recommended)» khoảng 17:22 ngày 16/10, trong khung ngân sách cùng ngày (WO đỏ ≤ 400 USD).
> Kho PUBLIC: plan, commit và PR không nêu host storage, mã tài khoản, tên bucket, URL ký nào, hay đường dẫn tuyệt đối của máy dev.
> **Bảng [OWNER] ở §8: 0 mục chặn phần mã. O1 (tách nợ ở L0) cần owner gật khi duyệt PR-A. O2 · O3 · O4 đã chốt ở plan-review; O6 xoá (§2).**

Viết tắt: `A/` = `apps/app/src/` · `Cv` = `A/routes/recruit/components/CandidateCvTab.tsx` · «helper» =
`A/lib/open-signed-url.ts` (`openSignedUrlInNewTab`) · «route 034» = `GET /candidates/:id/files/:fileId/download-url` ·
`<kept>` = thư mục `kept` trong thư mục dự án Claude Code của máy dev (ngoài kho, giữ lâu) · `<scratch>` = scratchpad của
phiên (ngoài kho, tạm).

## 1. Bối cảnh + phép đo

**Mã — đo tĩnh 16/10 [ĐO].** `git log 1519bd67..HEAD -- A/routes/recruit A/lib A/routes/hr A/routes/system/files` cho kết quả RỖNG,
nên mã FE vẫn y như lúc quét ngày 14/10.

- M1 `Cv:69-80`: gọi `window.open("", "_blank", "noopener,noreferrer")` (:71), sau đó `if (w) w.location.href = url` (:74).
  Khi lỗi: `w?.close()` rồi `parseRecruitError` → `setDownloadError` (:75-79). Chú thích :64-68 nói đúng ý định (mở tab đồng bộ),
  nhưng cờ `noopener` làm hàm trả `null`.
- M2 helper `:16-36`: gọi `window.open("", "_blank")` đồng bộ rồi đặt `tab.opener = null`. Sau `resolveUrl` có guard scheme
  `https:`/`http:` (:27-28), rồi gán `tab.location.href`, hoặc gọi `window.location.assign` khi popup bị chặn (:30). Khi lỗi:
  `tab?.close()` rồi ném lại. Docblock :9-10 đã ghi bẫy `noopener`. Nơi dùng: TASK (`TaskFilePanel`) và 3 nút payroll.
- M3 census `window.open(` trong `apps/app/src` + `packages` (không tính spec) có 5 chỗ: helper:19 · `Cv:71` · `hr/employees/EmployeeFilesTab.tsx:70` ·
  `hr/employees/EmployeeContractsPage.tsx:61` · `system/files/FileDetailPage.tsx:65`. `Cv:71` là chỗ DUY NHẤT gọi dạng `""` kèm `noopener`.
  Ba chỗ cuối gọi `window.open(url, …)` sau `await`, tức là N3. Vá `Cv` là đóng TRỌN lớp lỗi N2.
- M4 `candidateFileApi.getDownloadUrl` (`A/routes/recruit/candidate-file-api.ts:62-63`) = `apiFetch(route 034, downloadUrlSchema)` ⇒
  trả `{ url, expiresAt }` (`packages/contracts/src/files.ts:193-198`). Vì `url` là `z.string().url()`, CV không bao giờ đi vào
  nhánh `return false` của helper. `url()` KHÔNG chặn scheme: guard :27-28 là lớp chặn `javascript:`/`data:` duy nhất.
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
- M8 `harness/lib/wo-state.mjs:18`: `DONE = {finished, done, committed, pr_opened}`; `ledger.mjs:26` coi `pr_opened` là TERMINAL.
  Vì vậy, mở PR-A dưới id này sẽ ĐÓNG WO trên overlay và bảng. Bản thu hẹp phải nằm trên master TRƯỚC khi mở PR (§5, §7 L0).

**Trình duyệt — 14/10 [ĐO]** (Chromium qua Playwright MCP, app thật chạy bằng vite, API giả lập bằng `page.route`, FE = `1519bd67`):

| Nhóm                                                          | Kết quả                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CV PDF nhanh (211 ms) · chậm (6008 ms) · CV PNG nhanh         | `window.open` chạy 26–30 ms sau click, activation còn, TRẢ `null` 3/3. Tab mới đứng ở `about:blank` (lúc 3,2 s và 9 s), 0 request tới storage, 0 download, 0 `role=alert`. **Hỏng ở mọi tốc độ, cả hai loại tệp.**                                                        |
| Helper (TASK PDF/PNG + 3 nút phiếu lương), nhanh và chậm ~6 s | 10/10 lượt tới tay; `window.open` trả window thật. PDF tải đúng tên có dấu (193 B, `%PDF-1.4`), nhưng tab mới đứng lại ở `about:blank` (N9). PNG hiện trong tab mới.                                                                                                      |
| HR ×2 + SYSTEM (N3)                                           | API nhanh: chạy, tab tự đóng, sự kiện download phát trên trang app. API chậm 6 s + bật chặn popup (Chrome thứ hai, `ignoreDefaultArgs`): 0 tab, 0 tệp, 0 thông báo (3/4 lượt; 1 lượt FileDetail bất thường, activation = true). Activation hết 5011 ms sau `pointerdown`. |

**Hệ quả của PR-A [SUY RA từ M5 + số đo helper]:** sau khi vá, CV dạng ảnh sẽ hiện trong tab mới, như TASK PNG.
CV dạng PDF/DOCX sẽ tải đúng tên nhưng để lại một tab `about:blank`, giống phiếu lương và TASK đang chạy trên PROD (N9).
Vẫn tốt hơn hẳn hiện trạng (không tải được gì).
Khi storage PROD chưa chuyển sang R2, người dùng ở máy khác vẫn không tới được URL ký. PR-A biến «tab trắng im lặng» thành
«tab điều hướng tới storage» (lỗi kết nối hiện ngay trong tab đó). Điều này không chặn merge (§8 O5).

**Nhánh popup bị chặn [ĐỌC MÃ helper:30 — plan-review M2]:** khi `window.open` trả `null`, helper gọi `window.location.assign(url)`
trên tab APP. CV ảnh (`inline`) ⇒ tab app rời SPA sang ảnh trên storage, mất trạng thái màn; trước khi chuyển R2, ở máy khác tab
app thành trang lỗi kết nối. CV PDF/DOCX (`attachment`) ⇒ trình duyệt tải tệp về, trang app giữ nguyên. Đây là hành vi SẴN CÓ của
helper (TASK và phiếu lương đang chạy y vậy), không do PR-A gây ra. Ghi vào mô tả PR và vào `src` của FILEOPENUX (§7 L0(c)).

## 2. Quyết định owner đã có

- 14/10, hộp hỏi «Add all 6, grouped»: gieo WO gom N2 · N3 · N9 · N11 (dòng `src` của WO).
- `done_when[0]` của WO ghi: «N2 hỏng thật ⇒ vá N2 TRƯỚC (giao được thành PR riêng)». Số đo 14/10 cho thấy N2 hỏng thật ⇒ điều kiện đạt.
  Vế «ĐO TRƯỚC» đã thoả bằng lượt quét 14/10: mã FE không đổi từ `1519bd67` (§1, `git log` RỖNG).
- 16/10 khoảng 17:22: «Mở SIGNEDTAB-1 tới PR-A (Recommended)». Làm tới khi mở PR-A rồi hỏi lại; ngân sách WO đỏ ≤ 400 USD.
- **Đính chính v1 (O6 cũ):** câu trả lời thứ hai trong cùng hộp, «Bỏ qua — phép đo đã đủ (Recommended)», là về diễn tập Quit Docker
  của Đợt 0, KHÔNG liên quan WO này. v1 hiểu sai thành «không đo lại trước khi vá»; không cần hỏi owner, O6 xoá khỏi §8.
- 16/10, luồng chính chốt 16 finding plan-review (§9.3): H1 cách (a) — giữ zone 🔴, gate như §7; M1 cách (a) — commit L0 lên
  master trước khi mở PR-A; các finding còn lại chấp nhận nguyên văn.

## 3. Bất biến phải giữ

- B1 Không hard-code quyền. Cổng giữ NGUYÊN `useCanExact("view", "candidate")` (`Cv:28`) cho cả danh sách lẫn nút tải: cặp đọc
  phải bằng cặp tải. PR-A không đụng `canView`/`canUpload` và không đụng chuỗi tải lên.
- B2 Không lưu URL ký: không vào state, store, log, cache truy vấn hay thông báo lỗi. URL chỉ sống trong closure của helper.
- B3 Cắt opener: tab mới có `opener = null` (helper:20). KHÔNG truyền `noopener` vào `window.open` (helper:9-10).
- B4 `window.open` chạy ĐỒNG BỘ trong onClick, trước mọi `await`. Không bọc bằng `useMutation`, không `await` trước helper.
- B5 PR-A KHÔNG sửa helper. Guard scheme giữ nguyên (`https:`/`http:`); siết lại là việc của N11 → SIGNEDTAB-2.
- B6 Bất biến dự án #1–#3 không bị chạm (không query, không DB, không secret).
- B7 `git diff --stat a2aabe7e..HEAD -- apps/api packages` phải RỖNG ở PR-A (và so với `origin/master` lúc mở PR).

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
  1. plan v1 (`docs(plan)`, `3565acd7`) rồi vá plan-review (`docs(plan)`)
  2. L0 tách nợ backlog: MỘT commit `chore(docs): …` CHỈ đổi `harness/backlog.mjs` (§7 L0)
  3. L1 RED (`test(recruit): …`)
  4. L2 GREEN (`fix(recruit): …`)
  5. sổ vết (`docs(plan)`)
- **L0 lên master TRƯỚC khi mở PR-A (plan-review M1 cách (a)).** STATUS và bảng đọc `backlog.mjs` của master; `pr_opened` là DONE
  (M8). Nếu bản thu hẹp chỉ nằm trong nhánh thì từ lúc mở PR tới lúc merge, bảng hiện WO bốn-nợ là DONE; PR bị đóng thì N3/N9/N11
  mất dấu. Luồng chính đưa commit L0 lên master (docs-only được push thẳng; đi fast-forward thì hai commit `docs(plan)` đứng trước
  lên cùng). Cái giá: các PR đang mở thành BEHIND. Sau đó rebase nhánh lên master; diff của PR-A chỉ còn L1 · L2 · sổ vết.
- Chỉ đổi FE ⇒ Pages tự lên khoảng 13 phút sau khi merge. API không đổi, route 034 đã có trên API PROD (M5), nên không có ràng buộc
  thứ tự deploy. Đường lùi: revert PR, Pages lùi theo.
- **Tiêu đề PR (= subject của commit squash) CHỈ nêu `S19-FE-SIGNEDTAB-1`** (plan-review M5). `reconcile-merged.mjs` dò mã WO
  trong subject squash, và `fix(…)` không thuộc `BOOKKEEPING_RE`: nêu SIGNEDTAB-2 hay FILEOPENUX trong tiêu đề sẽ đóng dấu
  `finished` nhầm hai WO đó khi merge. Hai WO nhận nợ chỉ được nhắc trong THÂN PR. Subject của các commit mã cũng theo luật này.
- Mô tả PR ghi:
  - số đo trước và sau vá, viết trung tính;
  - hệ quả N9 với PDF, và hệ quả nhánh popup bị chặn (§1, M2);
  - WO đã thu hẹp còn N2, cùng hai nơi nhận phần nợ còn lại;
  - gate đã chạy (§7) và lý do `database-reviewer` = N/A.
- Agent KHÔNG merge. Dừng ngay sau khi mở PR để hỏi owner.

## 6. Ca test viết TRƯỚC (TỪ CHỐI đứng cạnh CHO PHÉP) + mutant ★

Giả lập theo đúng chuẩn trong `Cv.spec.tsx`, một describe mới:
`const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() }` cùng
`vi.spyOn(window, "open").mockImplementation((_u, _t, f) => (/noopener/i.test(String(f ?? "")) ? null : (tab as unknown as Window)))`.
Cấp quyền bằng cách gieo `capabilities` thẳng vào `useAuthStore`, không mock `useCanExact` (khuôn M7). Thêm `afterEach(vi.restoreAllMocks)`.
`beforeEach` của describe mới LUÔN đặt lại `listCandidateFiles.mockResolvedValue([FILE])`; `getDownloadUrl` đặt theo từng ca
(plan-review L5: tuỳ phiên bản vitest, `restoreAllMocks` có thể xoá implementation của `vi.fn` cấp module, `Cv.spec:25`).
Lỗi API dựng bằng constructor dạng input (`api-client.ts:110`):
`new ApiError({ status: 404, …, details: [{ field: "kind", message: "not-found", rule: "…" }] })`. `kind` được đọc từ MẢNG
`ErrorDetail` (`recruit-errors.ts:4-6`, `error-mapper.ts:135`); viết dạng object `{ kind }` sẽ ra `errors.generic` và C-3 đỏ cả
sau GREEN (plan-review L1).
Trên jsdom, spy của `window.open` hiện tên là `"bound "` (L2 của TASKFILEURL đã đo).

| Ca   | Loại                                                                                               | Kịch bản                                                                                                      | Khẳng định                                                                                                                                                            | Trên mã cũ                                                                   |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| C-1  | CHO PHÉP                                                                                           | `view:candidate`; `getDownloadUrl` → `{ url: SIGNED }`; bấm «Tải xuống»                                       | `open` gọi 1 lần với `("", "_blank")`; `tab.location.href === SIGNED`; `tab.opener === null`; `tab.close` không gọi; 0 alert; `getDownloadUrl(CANDIDATE_ID, FILE_ID)` | ĐỎ (`open` trả `null`)                                                       |
| C-2  | nhịp click                                                                                         | `getDownloadUrl` trả promise hoãn; bấm bằng `fireEvent.click` (CẤM `userEvent`, CẤM `await` trước khẳng định) | dòng NGAY sau click, CHƯA resolve: `expect(open).toHaveBeenCalledTimes(1)`; sau resolve: `href === SIGNED`                                                            | ĐỎ ở vế `href` (vế đồng bộ XANH trên mã cũ, chỉ để giết ★2 — plan-review L2) |
| C-3  | TỪ CHỐI ⇄ C-1                                                                                      | reject `ApiError` 404, `details` dạng MẢNG như trên                                                           | `tab.close` được gọi; `href === ""`; nội dung alert = `i18n.t("recruit:errors.notFound")`                                                                             | ĐỎ (không có tab để đóng)                                                    |
| C-4  | popup bị chặn ⇄ C-1                                                                                | `open` luôn trả `null`; mock getter `location` = `{ assign }`                                                 | `assign(SIGNED)` gọi 1 lần; 0 alert                                                                                                                                   | ĐỎ (mã cũ không làm gì)                                                      |
| C-5  | TỪ CHỐI ⇄ C-1                                                                                      | `url = "javascript:alert(1)"` (zod bị bỏ qua vì API được mock)                                                | `tab.close`; `href === ""`; alert = `i18n.t("recruit:errors.generic")` (M6)                                                                                           | ĐỎ                                                                           |
| C-5b | TỪ CHỐI ⇄ C-4                                                                                      | `open` luôn trả `null` + getter `location` = `{ assign }` + `url = "javascript:alert(1)"`                     | `assign` KHÔNG được gọi; alert = `i18n.t("recruit:errors.generic")`                                                                                                   | ĐỎ (mã cũ: không alert)                                                      |
| C-6  | mốc chống thoái lui (KHÔNG phải ca TỪ CHỐI của đường tải; cổng đã có ca [crown] ở `Cv.spec:73-93`) | caps `{}` và `{ "*:*": true }`                                                                                | CHỈ khẳng định: không có nút «Tải xuống»                                                                                                                              | XANH (ca nền)                                                                |

C-5 bỏ vế «`assign` không gọi» của v1: với tab khác `null` nhánh `assign` không thể chạy, vế đó luôn xanh. Nhánh `assign` +
URL nguy hiểm chuyển sang C-5b (plan-review M3).

**Mutant ★** chạy bằng MỘT script ngoài kho, `<kept>/s19-fe-signedtab-1/bin/mutants-fe.mjs`, theo khuôn
`<kept>/s16-social-dash-1/bin/` (`mutants.mjs` · `patch.mjs` · `mutants-fe.sh`). Mỗi lượt:

1. sao lưu tệp;
2. cấy mutant (neo phải xuất hiện đúng 1 lần);
3. chạy `Cv.spec` + `TaskFilePanel.spec` + `payroll-track-d-pdf.spec`;
4. khôi phục TỪ bản sao;
5. kiểm `git status --porcelain` RỖNG.

| Mutant | Cấy                                                                                                                                      | Phải chết ở         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| ★1     | helper thêm `"noopener,noreferrer"`                                                                                                      | C-1                 |
| ★2     | `Cv` chèn `await Promise.resolve()` trước lời gọi helper                                                                                 | C-2, ở vế đồng bộ   |
| ★3     | helper bỏ `tab?.close()` trong `catch`. Neo: `} catch (err) {\n    tab?.close();` (`tab?.close()` có 2 lần, :24 và :33 — plan-review L4) | C-3, C-5            |
| ★4     | `Cv` nuốt lỗi (bỏ `setDownloadError`)                                                                                                    | C-3                 |
| ★5     | helper bỏ `tab.opener = null`                                                                                                            | C-1                 |
| ★6     | helper xoá dòng guard :28 (`if (p !== "https:" && p !== "http:") throw …`)                                                               | C-5 (`href` ≠ `""`) |
| ★7     | helper dời guard vào trong nhánh `if (tab)`, nhánh `assign` không còn guard                                                              | C-5b                |

Lượt RED ở L1 (chạy spec mới trên `Cv` cũ) chính là mutant «trả về mã cũ».

## 7. Lát thi công · verify · gate

**L0 — tách nợ backlog.** MỘT commit
`chore(docs): tách nợ S19-FE-SIGNEDTAB-1 — thu hẹp còn N2 (tải CV) · gieo S19-FE-SIGNEDTAB-2 (N3 · N11 · CHAT) · nối N9 vào FILEOPENUX`,
CHỈ đổi `harness/backlog.mjs` (`BOOKKEEPING_RE` khớp `chore(docs)`, nên reconcile không coi commit này là ship). Luồng chính đưa
commit này lên master TRƯỚC khi mở PR-A (§5). Sau khi sửa: `pnpm exec prettier --write harness/backlog.mjs` ·
`node --test harness/id-uniqueness.test.mjs` · nạp thử module (`node -e "import('./harness/backlog.mjs')…"`) · kiểm
`harness/activity.jsonl` (§9, M5). Nội dung đổi CHÍNH XÁC:

(a) `S19-FE-SIGNEDTAB-1`:

- `layer: "FE"`.
- `title:` «Nút tải CV ứng viên (`CandidateCvTab`) mở tab bằng cờ `noopener` nên `window.open` trả `null` và tab trắng không bao giờ được điều hướng — ĐÃ ĐO hỏng ở mọi tốc độ, PDF lẫn PNG (N2 của S19-OPS-TASKFILEURL-1); N3 · N11 tách sang S19-FE-SIGNEDTAB-2, N9 nối vào S16-SOCIAL-FILEOPENUX-1».
- `paths:` `["apps/app/src/routes/recruit/components/CandidateCvTab.tsx", "apps/app/src/routes/recruit/components/CandidateCvTab.spec.tsx", "docs/plans/**", "harness/backlog.mjs"]`.
- `done_when:`
  - [0] «ĐO TRƯỚC bằng trình duyệt thật — ĐẠT 14/10/2026 (lượt quét ngoài kho, trích ở plan §1; mã FE không đổi từ `1519bd67`): nút tải CV hỏng ở mọi tốc độ, PDF lẫn PNG»
  - [1] «`CandidateCvTab` mở tệp qua `openSignedUrlInNewTab`: tab mở ĐỒNG BỘ trong onClick, không cờ `noopener` trong lời gọi `window.open`, opener bị cắt, lỗi ⇒ đóng tab + `role=alert`; spec giả lập ĐÚNG chuẩn (`window.open` có `noopener` ⇒ `null`) và ĐỎ trên mã cũ; mutant ★ chết»
  - [2] «Đo SAU vá bằng trình duyệt thật (app thật + API giả lập + tệp phục vụ cục bộ, KHÔNG storage thật): CV PNG hiện ở tab mới; CV PDF tải đúng tên có dấu (tab `about:blank` còn lại = N9, ghi nhận); API chậm ~6 s + chặn popup BẬT vẫn tới tay (đối chứng âm cùng instance phải đỏ, ≥ 3 lượt — plan §7 L4(d)); lỗi API ⇒ tab đóng + thông báo»
  - [3] «Không đổi `apps/api/**` · `packages/**`; cổng `useCanExact("view", "candidate")` giữ nguyên»
- `src`: GIỮ các dòng cũ, THÊM: «16/10/2026 plan `docs/plans/S19-FE-SIGNEDTAB-1.md`: thu hẹp còn N2 (PR-A). N3 + N11 + phát hiện CHAT → `S19-FE-SIGNEDTAB-2`; N9 → `S16-SOCIAL-FILEOPENUX-1` (WO đó vốn có «CV + phiếu lương không để lại tab trắng»).»
- `notes[0]` đổi thành: «Seed 🔴 vì N9 đổi DTO; sau khi thu hẹp ngày 16/10, phần còn lại chỉ là FE. Zone GIỮ 🔴 (plan-review H1 cách (a)): gate = security-reviewer + typescript-reviewer (kèm câu hỏi React) + silent-failure-hunter, chạy TRƯỚC khi mở PR; database-reviewer N/A (diff `apps/api` · `packages` rỗng).»
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
    "Trùng dòng mã với `S16-SOCIAL-FILEOPENUX-1` (src của WO đó đã liệt kê các nút HR/SYSTEM/CHAT này): plan của hai WO phải ghi rõ ranh giới, hoặc gộp.",
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

(c) `S16-SOCIAL-FILEOPENUX-1`: CHỈ nối thêm, không viết lại dòng nào.

- `src` thêm ba dòng:
  - «16/10/2026 — nhận N9 của `docs/plans/S19-OPS-TASKFILEURL-1.md` §9 (tách từ S19-FE-SIGNEDTAB-1, plan `docs/plans/S19-FE-SIGNEDTAB-1.md` §7 L0). ĐO 14/10 (Chromium): mọi nút qua helper `apps/app/src/lib/open-signed-url.ts` (đã dời từ `payroll/`) đều để lại tab `about:blank` sau khi tải tệp `attachment` — TASK PDF + 3 nút phiếu lương, nhanh lẫn chậm; ảnh `inline` hiện bình thường. Câu «TASK tệp không đổi (đã tải blob)» ở trên ĐÃ CŨ: từ `1519bd67` TASK đi qua helper; sau SIGNEDTAB-1, CV cũng vậy.»
  - «16/10/2026 — nhánh popup bị chặn của helper (`open-signed-url.ts:30`) gọi `window.location.assign(url)` trên tab APP: tệp `inline` làm tab app rời SPA (mất trạng thái màn), `attachment` thì tải về và trang giữ nguyên. Hành vi sẵn có (TASK · phiếu lương · CV sau SIGNEDTAB-1); muốn đổi thì làm ở WO này.» (plan-review M2)
  - «16/10/2026 — tham chiếu chéo: N3 (`window.open` sau `await`, HR/SYSTEM) + CHAT-TTL nằm ở `S19-FE-SIGNEDTAB-2`, CÙNG các dòng mã đã liệt kê ở dòng src đầu — plan của WO này nên cân nhắc gộp hoặc ghi rõ ranh giới.» (plan-review M4)
- `done_when` thêm: «N9 (helper chung): tải `attachment` qua `openSignedUrlInNewTab` KHÔNG để lại tab trắng cho TASK · 3 nút phiếu lương · CV; cách phục vụ lấy từ quyết định của SERVER (`resolveServeDirectives`), FE không đoán theo đuôi tệp; tệp `inline` vẫn mở tab mới; tab vẫn mở ĐỒNG BỘ trong onClick; đo lại bằng trình duyệt thật»
- `paths` thêm: `"apps/app/src/lib/**"`, `"apps/app/src/routes/tasks/**"`.
- `notes` thêm (plan-review H3, chặn hạ vùng ngầm): «16/10/2026 (plan-review H3 của S19-FE-SIGNEDTAB-1): nếu chọn hướng (a) cho N9 — cờ cách phục vụ trong DTO URL ký, đổi contracts/API — thì TRƯỚC khi code phải nâng zone `red` + FULL gate + thêm paths `packages/contracts/**` và `apps/api/src/storage/**`, và thêm điều kiện merge: API PROD chứa commit DTO (`git merge-base --is-ancestor <sha> <data.build.commit của GET /api/v1/health>` exit 0). Hướng (b) — FE đọc tham số `response-content-disposition` đã ký trong URL — giữ `amber`.»

**L1 RED.** Build contracts rồi web-core nếu dist cũ. Viết C-1…C-6 + C-5b trên `Cv` cũ.
Chạy `pnpm --filter @mediaos/app exec vitest run src/routes/recruit/components/CandidateCvTab.spec.tsx`. Không dùng `pnpm test -- <path>`
vì lệnh đó KHÔNG lọc mà chạy cả suite.
Kỳ vọng: C-1…C-5 và C-5b ĐỎ; C-6 và 9 ca cũ XANH. Chép nguyên văn thông điệp đỏ vào §9.3. Kiểm `activity.jsonl` (M5).

**L2 GREEN.** Làm D1 + D2. Spec phải xanh 16/16. Kiểm `activity.jsonl` (M5).

**L3 mutant.** Chạy ★1–★7 (§6). Ghi số liệu, khôi phục và `git status` của từng lượt vào §9.3.

**L4 đo trình duyệt sau vá.**

1. Chuẩn bị:
   - Server tệp cục bộ, ngoài kho: `<scratch>/stab/bin/file-server.mjs` (node `http`, chỉ 127.0.0.1, cổng mặc định 5186).
     `GET /f.pdf?d=<giây>` ⇒ `application/pdf` + `attachment`, tên tệp có dấu; `GET /f.png?d=<giây>` ⇒ `image/png` + `inline`;
     `GET /log` ⇒ JSON các lượt GET đã nhận. Header đối chiếu với đầu ra của `resolveServeDirectives`. KHÔNG dùng storage R2 thật.
   - Chạy vite từ worktree trên một cổng trống. `VITE_API_URL` và `VITE_AUTH_APP_URL` trỏ tới cổng chết.
   - Giả lập bằng `page.route`: refresh · `/auth/me` (`access:recruit`, `view:candidate`) · ứng viên · danh sách 2 tệp ·
     `download-url` trả URL của server cục bộ; có biến thể trễ 200 ms / 6 s và biến thể 404.
   - Thêm cho đối chứng ở (d): `/auth/me` có thêm quyền đọc tệp nhân viên · hồ sơ nhân viên · danh sách tệp · `download-url`
     trễ 6 s của `EmployeeFilesTab`.
2. Các lượt đo:
   - (a) PDF nhanh · (b) PDF chậm 6 s · (c) PNG nhanh · (e) lỗi 404 — chạy trên Chrome của MCP. Chrome này có
     `--disable-popup-blocking` nên `window.open` luôn trả window: các lượt này đo đường điều hướng, tải và thông báo,
     **KHÔNG chứng minh nhịp click**.
   - (d) Chrome thứ hai, BẬT chặn popup (`ignoreDefaultArgs: ['--disable-popup-blocking']`). Trong CÙNG một instance
     (plan-review H2):
     1. Đối chứng âm TRƯỚC: nút tải của HR `EmployeeFilesTab` (vẫn là mã N3) với API chậm 6 s ⇒ PHẢI ra 0 tab mới · 0 tải.
        Đối chứng không đỏ ⇒ HUỶ lượt (trình chặn popup không bật, hoặc activation bị cấp nhầm), không tính.
     2. Sau đó CV PDF chậm 6 s ⇒ phải tới tay.
     3. Click bằng `locator.click` (input tin cậy). CẤM `evaluate(el => el.click())`.
     4. Lặp ≥ 3 lượt (mỗi lượt gồm đối chứng + CV); ghi `navigator.userActivation` lúc gọi `window.open` ở từng lượt.
3. Đo trong mỗi lượt:
   - `window.open` có trả `null` không (bọc bằng `addInitScript`, đối số bị che);
   - số tab trước → sau;
   - URL và `contentType` cuối của tab mới;
   - sự kiện `download` trên CẢ trang app lẫn tab mới (tên, `failure()`, số byte);
   - số `role=alert`;
   - URL tab app có giữ nguyên không;
   - `GET /log` của server tệp (lượt nào thật sự tới «storage»).
4. Lưu ý khi đo:
   - KHÔNG `page.evaluate` trong lúc chờ API, vì lệnh này tự cấp user activation.
   - Ca `assign` khi popup bị chặn chỉ phủ bằng unit (C-4, C-5b), vì không ép được `null` khi activation còn hiệu lực.
5. Dọn dẹp:
   - Chỉ dừng PID của chính lượt đo (vite, server tệp, Chrome thứ hai — lấy từ `netstat -ano` của cổng mình nghe, đối chiếu
     CommandLine; `taskkill /PID … /T /F`). Không diệt theo tên ảnh.
   - Chuyển các tệp trong `.playwright-mcp` của lượt này sang scratchpad.
   - Grep chặn trên `git diff --cached`: phải RỖNG.

**Gate** (zone 🔴 giữ — plan-review H1 cách (a); diff chỉ FE, ~20 dòng mã + spec). Ba reviewer chạy SONG SONG trên diff L1 + L2,
TRƯỚC khi mở PR:

- `security-reviewer`, trần 15 lượt công cụ: opener/tabnabbing · nhịp click đồng bộ · đường guard scheme (cả nhánh `assign`) ·
  URL không bị lưu hay log · thông báo lỗi không lộ chi tiết · cặp cổng không đổi · mất `noreferrer`: xác nhận Referrer-Policy
  của `apps/app` (mặc định `strict-origin-when-cross-origin` chỉ gửi origin; policy lỏng hơn ⇒ ghi nợ, vì đường dẫn màn có UUID
  ứng viên — plan-review L6).
- `ecc:typescript-reviewer`, trần 12 lượt, kèm câu hỏi React (môi trường KHÔNG có agent `react-reviewer`): handler async trong
  onClick · reset state lỗi · không gọi helper trong render/effect · spec không race · cách ly mock giữa hai describe.
- `ecc:silent-failure-hunter`, trần 8 lượt: lỗi helper → `catch` của `Cv` → `role=alert`; giá trị `boolean` bị bỏ qua;
  `tab.close` khi lỗi; không nhánh nào im lặng.
- `database-reviewer` = N/A. Bằng chứng: V5 (`git diff a2aabe7e..HEAD -- apps/api packages` rỗng).
- `quality-gate` = lint + typecheck + `prettier --check`, luồng chính chạy ở Verify (V2).
- Không dùng `santa-method`: không có logic crown-jewel (không quyền, RLS, secret, audit, FSM).
- Vá các finding rồi chạy lại L1/L2 (và mutant liên quan).

**Verify** (sau gate):

- V1 `pnpm --filter @mediaos/app test` (cả suite app) + spec ở L1.
- V2 `pnpm --filter @mediaos/app typecheck` · eslint + `prettier --check` cho 2 tệp.
- V3 (plan-review L8) Lấy khoá nặng chung trước (máy một-lệnh-nặng; worktree khác có thể đang build).
  Có Postgres ⇒ `bash harness/check.sh --all --lane-db=stab`.
  KHÔNG có `LANE_DB`/Postgres ⇒ không chạy `--all` (chắc chắn đỏ-do-skip ~184 int-spec, không mang thông tin): verify FE đầy đủ
  ở máy (V1 + V2 + `bash harness/check.sh` mức thường); int-spec API do CI của PR chạy trên Postgres thật, kèm V5.
- V4 `node --test harness/id-uniqueness.test.mjs`.
- V5 `git diff --stat a2aabe7e..HEAD -- apps/api packages` RỖNG (và so với `origin/master` khi mở PR).
- V6 gitleaks trên các commit của nhánh, cộng grep chặn host/`X-Amz` trên diff.

**PR:** push `-u`, `gh pr create` (tiêu đề CHỈ nêu `S19-FE-SIGNEDTAB-1`, mô tả theo §5, có test plan), rồi DỪNG.
**Mốc ⏸:** chi phí WO vượt 300 USD trước khi tới PR ⇒ dừng, hỏi owner.

## 8. Bảng [OWNER]

| #   | Câu hỏi                                                                        | Mặc định nếu không trả lời                                    | Chặn?                                               |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------- |
| O1  | Tách nợ ở L0 (thu hẹp SIGNEDTAB-1 · gieo SIGNEDTAB-2 · nối N9 vào FILEOPENUX)? | Làm như §7 L0; commit L0 lên master trước PR-A                | Không (đảo được bằng một commit `chore(docs)` khác) |
| O5  | Merge PR-A trước khi chuyển storage PROD sang R2?                              | Được: không hại; máy khác chỉ tải được thật sau khi chuyển R2 | Không                                               |

Đã chốt, không còn là câu hỏi mở: O2 + O3 (zone giữ 🔴, gate như §7 — plan-review H1 cách (a)) · O4 (V3 theo plan-review L8).
O6 xoá: đính chính ở §2.

## 9. Ngoài phạm vi / nợ · rủi ro + đường lùi

**Không làm trong PR-A:**

- N3 · N11 · CHAT → `S19-FE-SIGNEDTAB-2`.
- N9 → `S16-SOCIAL-FILEOPENUX-1`. Có hai hướng, chọn ở plan của WO đó:
  - (a) Thêm cờ cách phục vụ vào DTO URL ký: đổi contracts + API, zone 🔴, phải thêm `paths` (ghi chú H3 đã nối vào notes của WO đó).
  - (b) FE đọc tham số `response-content-disposition` ĐÃ KÝ trong URL. Giá trị do `resolveServeDirectives` quyết, nên vẫn là
    server quyết; chỉ đổi FE. Nhược điểm: chỉ chạy với URL ký kiểu S3; URL proxy không có tham số này thì rơi về mở tab mới.
- N10 (timeout `apiFetch`) → `S19-FE-APIFETCHTIMEOUT-1` (đã seed).
- Nút CV không có trạng thái chờ: bấm hai lần ⇒ hai tab. Nợ nhỏ, có thể gộp vào FILEOPENUX.
- Nhánh popup bị chặn điều hướng tab app với tệp `inline` (§1, M2): hành vi sẵn có của helper, ghi ở src của FILEOPENUX.
- Nợ từ FULL gate PR-A (17/10/2026; đã THÊM dòng src vào backlog, commit `chore(docs)` riêng):
  - → `S16-SOCIAL-FILEOPENUX-1`: **F1** (MEDIUM) nhánh popup bị chặn còn điều hướng tab app sau khi component unmount.
    Vá đúng chỗ là helper (tuỳ chọn `isCurrent()`/`AbortSignal`, kiểm CHỈ trước `assign`); vá ở caller bằng resolver trả
    `null` sẽ đóng cả tab mới ở nhánh bình thường. · **F2 + SF-4** (LOW) chống bấm đúp (mục trên).
  - → `S19-FE-SIGNEDTAB-2` (thêm path `apps/app/public/_headers`): **SEC-SIGNEDTAB-01** (LOW) thiếu `Referrer-Policy`
    (DEVOPS-11:130) · **SEC-SIGNEDTAB-02** = N11, kèm gợi ý điều hướng bằng `href` của `URL` đã kiểm · **SF-3** (LOW) lỗi không
    phải ApiError mất dấu chẩn đoán · **F3** (LOW) docblock helper thiếu caller CV.
  - Đã vá trong PR-A: **SF-1** (MEDIUM, alert dùng chung để lỗi cũ che lỗi mới; ca C-7 · C-8) · **F4** (LOW, spy location).
  - Từ chối: **SF-2** — resolver CV không thể trả `null`: `downloadUrlSchema.url = z.string().url()`
    (`packages/contracts/src/files.ts:195`), `apiFetch` parse qua schema (`candidate-file-api.ts:63`).

| Rủi ro                                                                                         | Giảm bằng                                                                                      | Đường lùi                                                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Mở PR-A đóng CẢ WO trên overlay (M8)                                                           | L0 thu hẹp và lên master TRƯỚC khi mở PR-A (§5); L0 dùng tiền tố `chore(docs)`                 | Ghi sự kiện `reopened`                                                |
| Start-on-touch đóng dấu SAI: `Cv` khớp cả glob `apps/app/src/routes/recruit/**` của FILEOPENUX | Sau L0, L1, L2: đọc 5 dòng cuối `harness/activity.jsonl` ở CẢ worktree lẫn checkout chính (M5) | `node harness/ledger.mjs event <WO> reset "…"` ở đúng cây có dấu nhầm |
| Tiêu đề PR nêu mã WO khác ⇒ reconcile đóng dấu `finished` nhầm khi merge                       | Tiêu đề và subject commit mã CHỈ nêu SIGNEDTAB-1 (§5, M5)                                      | Sửa tiêu đề trước merge; đã merge ⇒ ghi `reopened`                    |
| Lượt (d) xanh giả (trình chặn popup không thật sự bật)                                         | Đối chứng âm cùng instance, `locator.click`, ≥ 3 lượt (§7 L4(d), H2)                           | Huỷ lượt, đo lại                                                      |
| FILEOPENUX (amber) nhận N9 rồi chọn hướng đổi DTO mà không nâng vùng                           | Ghi chú H3 trong notes của FILEOPENUX (§7 L0(c))                                               | Planner của FILEOPENUX nâng zone trước khi code                       |
| Unit giả lập ≠ trình duyệt thật                                                                | C-1 mô phỏng ĐÚNG chuẩn `noopener ⇒ null`; L4 đo thật                                          | —                                                                     |
| PDF vẫn để lại tab trắng sau vá                                                                | Chấp nhận (§1, giống PROD đang chạy); N9 → FILEOPENUX                                          | —                                                                     |
| Lộ host/URL ký vì kho PUBLIC                                                                   | L4 chỉ dùng server cục bộ, không R2; đối số bị che; grep chặn; plan dùng `<kept>`/`<scratch>`  | Commit chưa push ⇒ sửa lại commit                                     |
| Trùng id SIGNEDTAB-2                                                                           | V4                                                                                             | Đổi id                                                                |
| Vượt chi phí                                                                                   | Mốc ⏸ 300 USD; trần lượt cho mỗi reviewer                                                      | Dừng, hỏi owner                                                       |

### 9.3 Sổ vết

| Bước                | Ngày          | Kết quả                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1             | 16/10/2026    | `3565acd7`, trên `a2aabe7e`. Đối chiếu mã M1–M8 và trích số đo 14/10.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Plan-review         | 16/10/2026    | PASS_WITH_FIXES — 3 HIGH · 5 MEDIUM · 8 LOW. **H1** cách (a): giữ 🔴, gate 3 reviewer song song trước PR, database-reviewer N/A theo V5 (§7) · **H2** đối chứng âm cùng instance + `locator.click` + ≥ 3 lượt, các lượt trên Chrome của MCP không chứng minh nhịp click (§7 L4) · **H3** ghi chú nâng vùng vào notes FILEOPENUX (§7 L0(c)) · **M1** cách (a): L0 là commit `chore(docs)` riêng, lên master trước PR-A (§5) · **M2** hệ quả nhánh popup bị chặn (§1, mô tả PR, src FILEOPENUX) · **M3** thêm C-5b · ★6 · ★7 (§6) · **M4** tham chiếu chéo trong src của FILEOPENUX và SIGNEDTAB-2 · **M5** kiểm ledger sau L0/L1/L2, tiêu đề PR chỉ nêu SIGNEDTAB-1 (§5) · **L1** `details` dạng mảng · **L2** `fireEvent.click` + khẳng định ở dòng kế · **L3** C-6 là mốc, chỉ khẳng định không có nút · **L4** neo ★3 · **L5** `beforeEach` đặt lại mock · **L6** Referrer-Policy vào đề security-reviewer · **L7** `<kept>`/`<scratch>` thay đường dẫn tuyệt đối · **L8** V3 lấy khoá nặng; không Postgres ⇒ FE ở máy + int-spec qua CI, kèm V5. Đính chính O6 (§2). |
| Vá plan-review (v2) | 16/10/2026    | Commit này.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L0 tách nợ          | 16/10/2026    | `ea9afb6e` (`chore(docs)`, CHỈ `harness/backlog.mjs`): thu hẹp S19-FE-SIGNEDTAB-1 còn N2 · gieo S19-FE-SIGNEDTAB-2 (N3 · N11 · CHAT) · nối N9 + ghi chú nâng vùng (H3) + tham chiếu chéo (M4) vào S16-SOCIAL-FILEOPENUX-1; prettier + id-uniqueness xanh. Lên master TRƯỚC khi mở PR-A (M1 cách a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| L1 RED              | 16/10/2026    | `6c20a738`: spec mới chạy trên `Cv` CŨ ⇒ 6 ca ĐỎ đúng lý do — C-1 (`href` rỗng vì `window.open` có `noopener` trả `null`) · C-2 ở vế `href` (vế đồng bộ xanh: mã cũ cũng mở trong nhịp click) · C-3 (`tab.close` không gọi) · C-4 (`assign` không gọi) · C-5 + C-5b (không có alert); C-6 ×2 + 9 ca cũ XANH                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L2 GREEN            | 16–17/10/2026 | `8ac91100`: `Cv` gọi `openSignedUrlInNewTab`, giữ `parseRecruitError` → `setDownloadError`. Spec CV 17/17 · TaskFilePanel 19/19 · payroll-track-d-pdf 13/13 · typecheck app · eslint + prettier tệp đổi sạch. Cả suite `vitest run` một-lượt chết vì `ERR_IPC_CHANNEL_CLOSED` (KI-014, 0 ca đỏ) ⇒ chạy qua `harness/chunk-test.mjs --packages=@mediaos/app,@mediaos/web-core,@mediaos/ui`: XANH mọi chunk — app 398/398 · web-core 50/50 · ui 24/24 file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| L3 mutant           | 17/10/2026    | Script `<kept>/s19-fe-signedtab-1/bin/mutants-fe.mjs` (neo khớp đúng 1 lần · sao lưu → cấy → 3 spec → khôi phục → cây sạch sau MỖI lượt). Nền 49/49 xanh. **7/7 bị giết, đúng ca kỳ vọng**: ★1 noopener ⇒ C-1 + C-2 + C-3 + C-5 (+ F-2 TASK, payroll allow) · ★2 `await` trước helper ⇒ C-2 «called 1 times, but got 0» · ★3 bỏ close khi lỗi ⇒ C-3 + C-5 (+ 5 ca TASK/payroll) · ★4 nuốt lỗi ⇒ C-3 + C-5 + C-5b «Unable to find role=alert» · ★5 bỏ cắt opener ⇒ C-1 «expected {} to be null» (+ 2) · ★6 bỏ guard scheme ⇒ C-5 + C-5b (+ 3) · ★7 guard chỉ ở nhánh có tab ⇒ C-5b (+ ca popup-bị-chặn của payroll)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| L4 trình duyệt      |               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Gate                |               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Verify              |               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PR-A                |               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
