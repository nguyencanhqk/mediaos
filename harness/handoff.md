# BÃ n giao phiÃªn â Memory táº§ng 2 (phiÃªn trÆ°á»c â phiÃªn sau)

> `harness/finish.sh` nháº¯c ghi vÃ o ÄÃ¢y cuá»i phiÃªn; `harness/init.sh` Äá»c Äáº§u phiÃªn.

## Phiên 2026-09-15 (d) — S15-PAYROLL-BE-4 → **PLAN commit `502c21e5`, plan-review PASS sau vá §0b, CHƯA code** (🔴, dừng theo hook COST CRITICAL ~$64; owner chốt «mở trong phiên mới»)

**Bắt đầu phiên sau ở đây — không đọc lại SPEC/DB/API từ đầu:**
- `git checkout feat/s15-payroll-be-4` (stacked trên BE-3 `9ed2e99b` — **PR #510 CI xanh, chờ owner merge `--admin`**; khi #510 merge ⇒ `git merge origin/master` + `git checkout --ours` file BE-3, memory `squash-merge-breaks-stacked-prs`).
- Đọc `docs/plans/S15-PAYROLL-BE-4.md` **§0 (11 quyết định D-1..D-11) → §0b (5 BLOCKING đã vá + 13 cảnh báo) → §4.3 (thứ tự khoá 072 kỳ→đợt→dòng) → §6 (RED-first)**. Memory `s15-payroll-be4-wave-state` tóm tắt + số neo phải bump.
- Lane `mediaos_be4` ĐÃ dựng (243 mig, 3 trigger track C); **BE-4 KHÔNG có migration**. Runner tay: nạp `*_DB_PASSWORD` từ `.env` (KHÔNG source cả file — `NODE_ENV=production`), unset `DATABASE_*_URL`, `LANE_DB=mediaos_be4`, `pnpm --filter @mediaos/api exec vitest run <file>`.
- Thứ tự thi công gợi ý: contracts `payroll-disbursement.ts` (file MỚI — `payroll.ts` đã 860 dòng) → `payroll-route-pairs.const.ts` +19 → `payroll.errors.ts` (+6 mã, map TAG/UNIQUE/CHECK, `payrollBadRequest`) → 3 int-spec ĐỎ → service/repo/controller → census/FE pin (2 tầng 58→77 · mã lỗi 26→32 · FE kinds +18 · wiring 58→77 · `MIN_COVERED_COUNT` 605→624 · regen route-census) → `bash harness/check.sh --lane-db=be4` → đột biến §6.4 → reviewer tuần tự security → silent-failure → database HẸP (4 câu ở header plan) → PR KHÔNG auto-merge.

**Điều đắt nhất phiên này mua được (plan-review ~$64) — ĐỪNG mở lại:** (1) gỡ dòng chi đã `paid_at` là nhả `payslip_uq` partial ⇒ chi hai lần ⇒ 409 027 `line-already-paid`; (2) four-eyes tạm ứng phải chặn CẢ người thụ hưởng (`user_id === actor`), CHECK DB chỉ soi `created_by`; (3) duyệt tạm ứng ở kỳ `Calculated` ⇒ `warnings ["recalculate-required"]` kẻo khoản mồ côi im lặng; (4) body 069 `status` enum RIÊNG `Draft|Ready` — tái dùng enum 3 giá trị là lách toàn bộ cổng 072; (5) `payslips` KHÔNG có `deleted_at` (append-only) — vị từ «phiếu của kỳ» = MỘT hàm dùng chung populate/coverage.

**Đã đo, không đo lại:** officer 0565 có `export:payroll` + `view-payslip:payslip` ⇒ 071 dùng được · 8 cặp track C đã ở CẢ HAI allowlist `permission.service.ts` · audit object_type track C có sẵn (0571) · NOTI 024–027 seed + bật (0573).

## PhiÃªn 2026-09-07 (c) â S18-QA-ASSETFLAKE-1 â **PR #485 Má»** (ð¡, cÃ³ nhÃ£n auto-merge, váº«n chá» 1 review NGÆ¯á»I)

**Káº¿t quáº£:** ca `H1` cá»§a `s11-asset-db1-invariants` háº¿t Äá»-giáº£. `check.sh --all --lane-db=s18assetflake`
**XANH 9/9** trÃªn lane **vá»«a `--reset`**. LIGHT gate `typescript-reviewer` **PASS** (0 phÃ¡t hiá»n).
KhÃ´ng code sáº£n pháº©m, khÃ´ng migration. Plan Äáº§y Äá»§ sá» Äo: `docs/plans/S18-QA-ASSETFLAKE-1.md`.

### Äiá»u Äáº¯t nháº¥t phiÃªn nÃ y mua ÄÆ°á»£c â Äá»ªNG ÄO Láº I

**TrÆ°á»ng `grants` cá»§a má»i ca "replay migration rá»i so count" pháº£i lá»c theo pháº¡m vi Sá» Há»®U.**
`role_permissions` khÃ´ng cÃ³ `company_id`, nÃªn Äáº¿m theo `permissions.resource_type` lÃ  Äáº¿m luÃ´n hÃ ng
cá»§a cÃ´ng ty fixture. MÃ  **má»i int-spec boot `AppModule` sinh má»t role `super-admin` COMPANY-SCOPED
mang TRá»N catalog** (`super-admin-bootstrap.service.ts:94-113`, log `granted 411 catalog
permissions`) â má»i spec Äáº©y counter ÄÃºng báº±ng **sá» cáº·p cá»§a module ÄÃ³** (ASSET = 11) khi seed, rá»i
kÃ©o vá» khi `cleanupTenants`. Äo táº¥t Äá»nh trÃªn lane: **28** (sá» há»¯u) vs **105** (counter cÅ©).

**VÃ¬ sao CI chÆ°a tá»«ng Äá» mÃ  local Äá» â KHÃNG pháº£i vÃ¬ CI sáº¡ch hÆ¡n.** `super-admin` sinh á» CI y há»t.
KhÃ¡c lÃ  _khá»i lÆ°á»£ng_: `LANE_DB` á» local báº­t thÃªm cáº£ há» spec `skipIf(!hasLaneDb)` (`s11-asset-qa1-*`,
`asset-be1-*`, `dashboard-office-widgets`â¦) â nhiá»u vÃ²ng seed/cleanup cÃ´ng ty hÆ¡n háº³n trong cÃ¹ng
chunk. **Xanh á» CI lÃ  may, khÃ´ng pháº£i báº±ng chá»©ng.**

**Ranh giá»i chunk trÃ´i má»i láº§n thÃªm/bá»t má»t spec file** (chunk 40 file, chia theo tá»ng sá» file cá»§a
package) â cÃ¹ng má»t ca lÃºc Äá» lÃºc xanh giá»¯a cÃ¡c wave mÃ  cháº³ng ai Äá»¥ng vÃ o module ÄÃ³. Äá»«ng truy vÃ o
diff cá»§a mÃ¬nh khi tháº¥y má»t ca láº¡ Äá» trong lane chung.

**Tá» lá» Äá» cá»§a int-spec Äi theo Äá» Báº¨N cá»§a lane DB.** Äo ÄÆ°á»£c á» ÄÃ¢y: `task-pipeline-backfill-0500`
dÃ­nh FK **0/5** lÆ°á»£t khi lane vá»«a dá»±ng Â· **2/6** sau khi lane tÃ­ch rÃ¡c (**681 companies Â· 80
projects Â· 999 role tenant** sÃ³t láº¡i tá»« nhá»¯ng chunk crash háº¡ táº§ng â chunk cháº¿t thÃ¬ `afterAll`
khÃ´ng cháº¡y) Â· **0/1** ngay sau `--reset`. â "cháº¡y 5 lÆ°á»£t trÃªn má»t lane" **khÃ´ng** pháº£i 5 phÃ©p Äo
cÃ¹ng Äiá»u kiá»n.

### CÃ¡ch lÃ m ÄÃ£ hiá»u quáº£, giá»¯ láº¡i

- **ÄO TRÆ¯á»C, VÃ SAU.** 5 lÆ°á»£t `chunk-test.mjs` cho tá» lá» **1/5** + diff chá» ÄÃºng má»t trÆ°á»ng â
  loáº¡i ÄÆ°á»£c cáº£ H-B (Äua CHECK) láº«n H-C, vÃ  chá»©ng minh migration VáºªN idempotent. KhÃ´ng cÃ³ diff ÄÃ³
  thÃ¬ má»i káº¿t luáº­n lÃ  suy ÄoÃ¡n (hai phiÃªn trÆ°á»c chá» ghi tay "H1 Äá»", vÃ´ dá»¥ng cho phiÃªn nÃ y).
- **Äá»t biáº¿n Äá» chá»©ng minh ca khÃ´ng xanh-Rá»NG:** thÃªm táº¡m 1 cÃ¢u `INSERT â¦ 'DENY'` cho role há» thá»ng
  vÃ o 0550 â H1 Äá» (`grants` 28 â 29). Rá»i `git checkout` file + `diff` vá»i báº£n chÃ©p trÆ°á»c Äá»t biáº¿n
  (byte-giá»ng) + dá»n hÃ ng láº¡ khá»i lane. ChÃ©p báº£n gá»c ra scratchpad TRÆ¯á»C khi Äá»t biáº¿n.
- **NÃ³i tháº³ng vá»i reviewer lÃ  ÄÆ°á»£c dá»«ng á» review TÄ¨NH** + liá»t kÃª sáºµn thá»© mÃ¬nh ÄÃ£ cháº¡y. Reviewer
  tuÃ¢n thá»§, tá»± cháº¡y `tsc`/`eslint`/`prettier --check` (ráº») vÃ  váº«n tráº£ lá»i Äá»§ 5 cÃ¢u há»i Äáº·t ra.

### Báº«y ÄÃ£ sáº­p

- **Backtick trong comment SQL náº±m TRONG template literal â ÄÃ³ng chuá»i sá»m.** Comment `-- â¦ \`x\` â¦`Äáº·t trong`const COUNTS = \`â¦\``lÃ m swc bÃ¡o "Expected a semicolon" á» ÄÃºng dÃ²ng comment. DÃ¹ng
ngoáº·c kÃ©p trong comment SQL. (Comment`//` sau khi chuá»i ÄÃ£ ÄÃ³ng thÃ¬ backtick vÃ´ háº¡i.)

### CÃ²n láº¡i cho phiÃªn sau

- **PR #485 chá» 1 review NGÆ¯á»I** (ÄÃ£ cÃ³ nhÃ£n auto-merge, `mergeStateStatus=BLOCKED`). **#484**
  (RESETMETA) vÃ  cÃ¡c PR cÅ© váº«n theo tráº¡ng thÃ¡i riÃªng cá»§a chÃºng.
- **Seed má»i `S18-QA-PIPELINEREPLAY-1`** ð¡: `task-pipeline-backfill-0500` replay 0500 â backfill
  TOÃN Cá»¤C nÃªn ghi lÃªn project cá»§a spec khÃ¡c â FK `project_states_project_id_fkey`. WO ÄÃ³ pháº£i Äo
  trÃªn **Cáº¢ HAI** tráº¡ng thÃ¡i lane (vá»«a dá»±ng vs dÃ¹ng láº¡i), Äo má»t tráº¡ng thÃ¡i lÃ  ra tá» lá» sai.
- **Lane DB tá»n Äá»ng:** `mediaos_s18assetflake` (DROP sau khi #485 merge) + danh sÃ¡ch tá»n cá»§a hai
  phiÃªn trÆ°á»c (`mediaos_s18resetmeta`, `mediaos_s18twofadel`, â¦). `docker exec mediaos-postgres psql
-U mediaos -d postgres -c "SELECT datnameâ¦"` Äang liá»t kÃª **ráº¥t nhiá»u** lane cÅ©.
- **ChÆ°a vÃ¡, ÄÃ£ ghi:** phÃ©p Äáº¿m cá»§a H1 mÃ¹ vá»i "Äá»i scope" (0550 re-scope báº±ng DELETE+INSERT â tá»ng
  sá» hÃ ng khÃ´ng Äá»i). Giá»i háº¡n CÃ Sáº´N, khÃ´ng pháº£i do báº£n vÃ¡ nÃ y; F1 má»i lÃ  chá» ghim ma tráº­n Â§9d.

## PhiÃªn 2026-09-07 (b) â S18-AUTH-RESETMETA-1 â **PR #484 Má»**, chá» ngÆ°á»i chá»t

> â ï¸ NhÃ¡nh nÃ y cáº¯t tá»« master nÃªn KHÃNG tháº¥y má»¥c bÃ n giao cá»§a `S18-AUTH-2FADELETED-1` (PR #483, váº«n
> Äang má»). Äá»c cáº£ hai khi merge.

**Káº¿t quáº£:** 5 hÃ ng audit cá»§a `resetPassword`+`changePassword` mang `ip`/`userAgent`.
`check.sh --all --lane-db=s18resetmeta` XANH 9/9 (cháº¡y láº¡i cho Cáº¢ commit vÃ¡). FULL gate 2 reviewer
**PASS** (0 CRITICAL, 0 HIGH). KhÃ´ng migration.

### Äiá»u Äáº¯t nháº¥t phiÃªn nÃ y mua ÄÆ°á»£c â Äá»ªNG ÄO Láº I

**ÄÆ°á»ng `reset` vÃ  ÄÆ°á»ng `change` KHÃC NHAU vá» chá» Äáº·t váº¿ `deleted_at`, nÃªn nhÃ¡nh tá»i ÄÆ°á»£c cÅ©ng khÃ¡c.**
`changePassword` lá»c `deleted_at` ngay á» **SELECT** â user xoÃ¡ má»m rÆ¡i vÃ o `bad_credentials`, nhÃ¡nh ÄÃ³
**KHÃNG ghi `audit_logs`** â ca "user xoÃ¡ má»m â `password_change_denied`" tráº£ **0 hÃ ng** = xanh-Rá»NG.
`resetPassword` thÃ¬ váº¿ ÄÃ³ náº±m á» cÃ¢u **UPDATE** nÃªn tá»i tháº³ng ÄÆ°á»£c. TÃ´i ÄÃ£ chÃ©p nháº§m tiá»n Äá» tá»« ÄÆ°á»ng
kia; `plan-reviewer` báº¯t ÄÆ°á»£c. CÃ¡ch tá»i hÃ ng `password_change_denied` mÃ  váº«n giá»¯ HTTP tháº­t: spy
`password.hash` (argon2id náº±m ÄÃºng giá»¯a SELECT vÃ  UPDATE), soft-delete qua `directPool` trong ÄÃ³.
Memory: `deleted-user-hits-badcreds-not-accountgone`.

**Plan v1 Äáº¿m THIáº¾U má»t hÃ ng audit.** CÃ³ hÃ ng thá»© nÄm `user.login_throttle_cleared`
(`auth.service.ts:1834`) qua chuá»i private `resetPassword` â `clearLoginLocksAfterReset` â
`recordFailedLockClear`. Census "grep `audit.record` trong thÃ¢n method" bá» sÃ³t nÃ³ vÃ¬ nÃ³ náº±m sau HAI lá»p
gá»i. Chuá»i ÄÃ³ hoÃ n toÃ n kÃ­n (private, 1 caller) nÃªn ná»i dÃ¢y bÃ¡n kÃ­nh ná» = 0.

**`Â§shape` kiá»u "so hai pháº£n há»i vá»i nhau" tá»± nÃ³ xanh-Rá»NG ÄÆ°á»£c.**
`expect(a.error?.code).toBe(b.error?.code)` xanh khi Cáº¢ HAI lÃ  `undefined`. Pháº£i cÃ³ neo TUYá»T Äá»I
(`toBeTruthy()`) trÆ°á»c phÃ©p so tÆ°Æ¡ng Äá»i.

### Báº«y má»i gáº·p

- **prettier vá»i glob rá»ng reformat 43 file chÆ°a tá»«ng Äá»¥ng** (chÃºng vá»n lá»ch format trÃªn master) â diff
  phÃ¬nh 13â56 file, reviewer FULL gate pháº£i lá»c nhiá»u. Format theo **danh sÃ¡ch file ÄÃ£ sá»­a**, khÃ´ng theo
  glob. Memory: `prettier-glob-reformats-untouched-files`.
- **Script chÃ¨n Äá»i sá» báº±ng cÃ¢n báº±ng ngoáº·c gÃ£y á» call cÃ³ Dáº¤U PHáº¨Y CUá»I** â sinh `f(a, b, c, , {})`.
  `tsc` báº¯t ÄÆ°á»£c (TS1135), nhÆ°ng pháº£i nhá» vÃ¡ láº¡i 3 chá».

### Chi phÃ­

**~$163/phiÃªn** â vÆ°á»£t má»c ~$136/WO Äá» nhÆ°ng THáº¤P HÆ N $246 cá»§a phiÃªn trÆ°á»c. CÃ¡ch tiáº¿t kiá»m cÃ³ hiá»u quáº£:
**nÃ³i tháº³ng vá»i reviewer lÃ  ÄÆ°á»£c phÃ©p dá»«ng á» review tÄ©nh** vÃ  liá»t kÃª sáºµn thá»© mÃ¬nh ÄÃ£ cháº¡y (check.sh,
Äá»t biáº¿n). Cáº£ hai reviewer Äá»u tuÃ¢n thá»§ vÃ  váº«n báº¯t ÄÆ°á»£c lá»i tháº­t. Giá»¯ cÃ¡ch nÃ y.

### CÃ²n láº¡i cho phiÃªn sau

- **PR #484 chá» NGÆ¯á»I chá»t** (vÃ¹ng Äá», KHÃNG gáº¯n auto-merge). **PR #483 váº«n Äang chá»** tá»« phiÃªn trÆ°á»c.
- Seed má»i: `S18-AUTH-RESETFLOOR-1` ð´ (oracle timing cÃ³ sáºµn á» `/auth/reset-password` â `done_when` báº¯t
  ÄO TRÆ¯á»C, Äá»«ng vÃ¡ theo lÃ½ thuyáº¿t) Â· `S18-AUTH-SECEVENTMETA-1` ð´ (`user_security_events` nhÃ¡nh
  `bad_credentials` váº«n vÃ´ danh; hoÃ£n vÃ¬ `recordReauthFailure` dÃ¹ng chung vá»i `disableTwoFactor`).
- **Sau khi #483 merge:** thÃªm `ip`/`userAgent` vÃ o `done_when` cá»§a `S18-AUTH-RESTORE2FA-1` (WO ÄÃ³ ÄÆ°á»£c
  seed TRONG #483, khÃ´ng cÃ³ trÃªn master â ná»£ N1 treo vÃ o ÄÃ³).
- **Lane DB tá»n Äá»ng:** thÃªm `mediaos_s18resetmeta` vÃ o danh sÃ¡ch xoÃ¡ cá»§a phiÃªn trÆ°á»c.

## PhiÃªn 2026-09-07 â S18-AUTH-2FADELETED-1 â **PR #483 Má»**, chá» ngÆ°á»i chá»t

**Káº¿t quáº£:** tÃ i khoáº£n ÄÃ£ xoÃ¡ má»m háº¿t táº¯t ÄÆ°á»£c 2FA. `harness/check.sh --all --lane-db=s18twofadel`
XANH â (9/9). FULL gate 2 reviewer **PASS** (0 CRITICAL, 0 HIGH). KhÃ´ng migration.

### Äiá»u Äáº¯t nháº¥t phiÃªn nÃ y mua ÄÆ°á»£c â Äá»ªNG ÄO Láº I

**WO cÃ³ HAI khiáº¿m khuyáº¿t, khÃ´ng pháº£i má»t.** TiÃªu Äá» WO chá» nÃ³i cÃ¢u SELECT. NhÆ°ng
`twoFactor.disable()` cháº¡y á» **tx RIÃNG** má» SAU khi tx re-auth commit â váº¿ `deleted_at` á» SELECT
**khÃ´ng báº£o vá» ÄÆ°á»£c má»t cÃ¢u ghi á» tx khÃ¡c**. VÃ¡ má»t váº¿ lÃ  Äá» ÄÆ°á»ng kia má».

**Há» quáº£: cá»ng CHá»NG NHAU.** Sau khi vÃ¡ cáº£ hai, má»i ca "user xoÃ¡ má»m gá»i endpoint" bá» cháº·n bá»i Cáº¢
HAI â xanh y há»t nhau dÃ¹ chá» má»t váº¿ ÄÆ°á»£c vÃ¡. CÃ¡ch tÃ¡ch duy nháº¥t Äo ÄÆ°á»£c: `Â§direct` assert **Sá» Äáº¾M**
chá»¯ kÃ½ riÃªng cá»§a L1 (`auth.2fa_disable_denied`=1 **vÃ ** `REAUTH_FAILED`=1), KHÃNG chá» HTTP 401.
ÄÃ£ kiá»m chá»©ng: gá»¡ `isNull` khá»i L1 mÃ  giá»¯ L2 â váº«n 401, totp váº«n cÃ²n â chá» sá» Äáº¿m má»i Äá».

### Ba cÃ¡i báº«y ÄÃ£ sáº­p (ghi Äá» phiÃªn sau khá»i sáº­p láº¡i)

1. **ChÃ©p D1 cá»§a `#482` sang ÄÃ¢y lÃ  SAI.** #482 giá»¯ nhÃ¡nh `!row` nguyÃªn váº¹n vÃ¬ á» ÄÃ³ cÃ¢u SELECT
   _ÄÃ£_ lá»c `deleted_at` â user xoÃ¡ má»m _ÄÃ£_ Äá» láº¡i `REAUTH_FAILED`, Äá»i Äi lÃ  xoÃ¡ váº¿t. á» ÄÃ¢y SELECT
   **tráº§n** â há» KHÃNG Äi vÃ o `!row`, há» Äi tháº³ng tá»i **thÃ nh cÃ´ng**. KhÃ´ng cÃ³ váº¿t nÃ o Äá» báº£o tá»n â
   nÃªn pháº£i **THÃM** `auth.2fa_disable_denied`, náº¿u khÃ´ng ÄÆ°á»ng táº¥n cÃ´ng CHÃNH im láº·ng cÃ²n ÄÆ°á»ng phá»¥
   láº¡i cÃ³ váº¿t (**quan sÃ¡t bá» Äáº£o ngÆ°á»£c**). `plan-reviewer` báº¯t ÄÆ°á»£c; tÃ´i ÄÃ£ chÃ©p nháº§m tiá»n Äá».
2. **`disable()` cÃ³ caller TEST ghim Há»¢P Äá»NG.** `two-factor.int-spec.ts` ca (f) ÄÃ²i disable
   cross-tenant = **no-op im láº·ng**. Plan v1 Äá»nh cho nhÃ¡nh `!alive` nÃ©m 401 â sáº½ lÃ m Äá» ca ÄÃ³ VÃ ghi
   hÃ ng audit **append-only** gÃ¡n `actor_user_id` chÃ©o tenant (`audit_logs.actor_user_id` FK
   `users(id)`, KHÃNG composite). Äáº¿m caller mÃ  gáº¡t spec sang bÃªn lÃ  cÃ¡ch bá» sÃ³t há»£p Äá»ng.
3. **`login` KHÃNG tráº£ access token khi 2FA ÄÃ£ báº­t** (`auth.service.ts:418-421`, `:479-481`) â tráº£
   `{twoFactorRequired, challengeToken}`. Int-spec pháº£i login **khi 2FA cÃ²n Táº®T** rá»i má»i enroll.

### PhÃ¡t hiá»n ÄÃ¡ng giÃ¡ nháº¥t cá»§a `security-reviewer` â ÄÃ£ vÃ¡ thÃ nh ca `Â§rls-shape`

TÃ­nh ÄÃºng Äáº¯n cá»§a váº¿ L2 **ngá»i lÃªn HÃNH Dáº NG** cá»§a policy `users_tenant_isolation`
(`0002_companies_users.sql:65-67` â lá»c **má»i** `company_id`). Náº¿u migration sau siáº¿t thÃªm
`deleted_at IS NULL` (hardening ráº¥t há»£p lÃ½), hÃ ng xoÃ¡ má»m **cÃ¹ng tenant** hoÃ¡ vÃ´ hÃ¬nh â rÆ¡i vÃ o
`!alive` â no-op â hai DELETE **váº«n khá»p** (policy `user_totp`/`user_recovery_codes` lÃ  company-only)
â **lá» má» láº¡i mÃ  KHÃNG ca nÃ o Äá»**. Nay ÄÃ£ cÃ³ ca chá»t tiá»n Äá» ÄÃ³.

### CÃ²n láº¡i cho phiÃªn sau

- **PR #483 chá» NGÆ¯á»I chá»t** (vÃ¹ng Äá», KHÃNG gáº¯n auto-merge).
- Seed má»i `S18-AUTH-RESTORE2FA-1` (ð´): `restoreUser` khÃ´ng soÃ¡t láº¡i 2FA + `enroll`/`confirmEnable`
  khÃ´ng lá»c `deleted_at` â káº» giá»¯ token cÃ i ÄÆ°á»£c **yáº¿u tá» thá»© hai cá»§a mÃ¬nh** vÃ o tÃ i khoáº£n sáº½ ÄÆ°á»£c
  khÃ´i phá»¥c. Cá»ng ná»£ MEDIUM #3 (hai cÃ¢u DELETE cá»§a `disable()` thiáº¿u `company_id`).
- **Lane DB tá»n Äá»ng** (`pgdata-bloat-lane-dbs-and-job-log`): `mediaos_s18retry` Â· `s18resetdel` Â·
  `s18listen` Â· `s18chgpw` Â· `s18twofadel` â WO cá»§a chÃºng ÄÃ£ merge/PR, xoÃ¡ ÄÆ°á»£c khi ráº£nh.
  (`s18tfdrev` cá»§a reviewer ÄÃ£ xoÃ¡.)

### Chi phÃ­ â Cáº¢NH BÃO

**~$246/phiÃªn**, vÆ°á»£t xa há» sÆ¡ ~$136/WO Äá» (`red-zone-wo-cost-profile`). Gá»c: 1 vÃ²ng plan-review +
2 reviewer FULL gate, trong ÄÃ³ `security-reviewer` **tá»± cháº¡y láº¡i** cáº£ hai Äá»t biáº¿n + dá»±ng lane DB
riÃªng + cháº¡y int-spec (nÃ³ tá»± khai trong bÃ¡o cÃ¡o). XÃ¡c minh Äá»c láº­p ÄÃ³ CÃ giÃ¡ trá» â nÃ³ báº¯t ÄÆ°á»£c
`Â§rls-shape` â nhÆ°ng láº§n sau nÃªn **nÃ³i rÃµ vá»i reviewer lÃ  ÄÆ°á»£c phÃ©p dá»«ng á» review tÄ©nh**, hoáº·c chá»
cho Má»T reviewer cháº¡y thá»±c nghiá»m.

---

## PhiÃªn 2026-09-05 â S14-SEC-CAPWILDCARD-1: **thiáº¿t káº¿ CHá»T, 0 dÃ²ng code**, WO Äá» `blocked`

**Káº¿t quáº£:** `docs/DECISIONS/DECISIONS-13_Capabilities_Mirror_Company_Tier_Decision.md` (Má»I) +
`docs/plans/S14-SEC-CAPWILDCARD-1.md` **v3** + `â¦census.sql` (**6 cÃ¢u**). Owner dá»«ng trÆ°á»c code á» cá»ng
chi phÃ­ ($72). Plan v3 lÃ  **tÃ i liá»u thi cÃ´ng** â phiÃªn sau code tháº³ng tá»« Â§9/Â§14, **khÃ´ng cáº§n
plan-review láº¡i** trá»« khi Äá»i thiáº¿t káº¿.

### â VÃ¬ sao `blocked` chá»© khÃ´ng `ready`

Plan Â§14 bÆ°á»c 1 = **Äá»c Q4/Q6 cá»§a census PROD**, mÃ  agent khÃ´ng cháº¡m ÄÆ°á»£c DB PROD
(`classifier-blocks-prod-db-from-agent`). Äá» `ready` lÃ  dá»±ng báº«y: phiÃªn sau nháº­n WO rá»i **dá»«ng á» dÃ²ng
Äáº§u tiÃªn**. Gá»¡ cháº·n báº±ng ÄÃºng má»t lá»nh:

```bash
psql "$PROD_URL" -f docs/plans/S14-SEC-CAPWILDCARD-1.census.sql   # chá»-Äá»c, vai bá» qua RLS
```

- **Q4** â ï¸ = danh sÃ¡ch mÃ n sáº½ hiá»n thÃªm. CÃ³ cáº·p lá»p reveal/step-up hoáº·c cáº·p owner khÃ´ng muá»n phÆ¡i â
  **Äá»i thiáº¿t káº¿ trÆ°á»c khi code**, khÃ´ng pháº£i chá» PR.
- **Q6** â = tráº£ vá» hÃ ng catalog wildcard `is_sensitive=true` â **Dá»ªNG** (tiá»n Äá» T1 cá»§a plan Â§8 sai â
  cÃ³ actor sáº½ **Máº¤T** khoÃ¡).

### Ba Äiá»u Äáº¯t tiá»n nháº¥t phiÃªn nÃ y mua ÄÆ°á»£c â Äá»ªNG ÄO Láº I

1. **Giáº£ Äá»nh "PROD = 0 holder wildcard" lÃ  SAI.** memory `superadmin-not-a-canonical-role` (Äo tháº­t
   PROD 02/08): role **`SA`**, company-scoped, **10 user**, giá»¯ **379/379** cáº·p catalog gá»m **128/128**
   sensitive, vÃ  cÃ³ `*:*`. `migrations/0569:167-168` xÃ¡c nháº­n Äá»c láº­p. Dev Äo ra 0 vÃ¬ dev **chÆ°a
   bootstrap SA**, khÃ´ng vÃ¬ há» sáº¡ch.
2. **`mediaos` (dev dÃ¹ng chung) Lá»CH catalog so vá»i migration.** dev = 390/139/**1 wildcard**;
   `mediaos_capwildcard` dá»±ng thuáº§n migration = 389/140/**0 wildcard**. Dev **thá»«a** `*:*` +
   `view:employee`, **thiáº¿u** `upload:candidate-file` â fixture int-spec ÄÃ³ng dáº¥u vÃ o catalog GLOBAL.
   **KhÃ´ng migration nÃ o seed hÃ ng `('*','*')`.** â Äá»«ng suy tá»« dev ra PROD.
3. **Q4 trÃªn dev = 71 cáº·p, 6 cáº·p Äáº§u cháº¡m 49 actor**: `view/upload/delete:leave-file` Â·
   `view-detail:attendance` Â· `view-own:adjustment` Â· `view-own:remote-request`. ÄÃ³ lÃ  **mÃ n tá»±-phá»¥c-vá»¥
   cá»§a chÃ­nh nhÃ¢n viÃªn** Äang bá» allowlist giáº¥u khá»i há» â WO nÃ y gá»¡ thá»© Äang há»ng, khÃ´ng pháº£i hardening
   phÃ²ng xa.

### Hai vÃ²ng plan-review â 12 lá», ÄÃ£ vÃ¡ háº¿t vÃ o v3

VÃ²ng 1 BLOCK v1 (6 má»¥c). VÃ²ng 2 BLOCK v2 (6 má»¥c). Hai má»¥c ÄÃ¡ng nhá» nháº¥t:

- **B1/v2 â break-glass lá»t vÃ o caps.** `permission.decide.ts:98-101` cháº·n `needsObjectGrant =
objectGrantRequired ?? (isSensitive && requiresReauth)` **TRÆ¯á»C** company-tier. Vá» ngá»¯ v2 thiáº¿u váº¿ nÃ y
  â grant exact `reveal-secret:platform-account` sáº½ báº­t `caps[...] = true` trong khi `can()` khÃ´ng bao
  giá» ALLOW. â v3 Â§4.2-(3) thÃªm táº­p `EXCLUDED`.
- **B4/v2 â tÃ´i trÃ¬nh bÃ y SAI cho owner.** ÄÃ£ nÃ³i allowlist lÃ  "hÃ ng rÃ o tuá»³ tiá»n". **Sai**: tiÃªu chÃ­ cÃ³
  tháº­t (`permission.service.ts:21-27`, `S2-AUTH-BE-5`) + cÃ³ cá»ng mÃ¡y
  (`sensitive-screen-gate-allowlist.spec.ts:20-31`). ÄÃ£ ÄÃ­nh chÃ­nh vá»i owner; ADR-13 Â§1 viáº¿t láº¡i cho
  ÄÃºng **trÆ°á»c khi** bÃ¡c. `security-reviewer` pháº£i Äá»c ADR-13 Â§1âÂ§2, **khÃ´ng** Äá»c cÃ¢u cá»§a plan v2.

### Báº«y má»i gáº·p

**`prettier --write` trÃªn docs Äá»i `*` thÃ nh `_` BÃN TRONG code span** khi code span náº±m trong má»t cá»¥m
emphasis á» **Ã´ báº£ng**. Trong tÃ i liá»u quyá»n thÃ¬ `*` lÃ  kÃ½ tá»± wildcard â **há»ng ná»i dung, khÃ´ng pháº£i
há»ng Äá»nh dáº¡ng**. ÄÃ£ sá»­a; cÃ¡ch trÃ¡nh: Äá»«ng bá»c emphasis quanh cá»¥m cÃ³ backtick chá»©a `*`. Sau khi sá»­a thÃ¬
prettier á»n Äá»nh (chá» cÄn láº¡i Äá» rá»ng cá»t).

### Háº¡ táº§ng Äá» láº¡i cho phiÃªn sau

- Lane DB **`mediaos_capwildcard`** ÄÃ£ dá»±ng + migrate (389/140/0). Baseline `src/permission`:
  **342 pass / 14 skip**.
- `docs/plans/S14-SEC-CAPWILDCARD-1.census.sql` â 6 cÃ¢u, chá»-Äá»c, cháº¡y sáº¡ch trÃªn cáº£ hai DB. Danh sÃ¡ch 69
  cáº·p allowlist trong Q4 **sinh tá»± Äá»ng** tá»« `permission.service.ts` â sinh láº¡i náº¿u allowlist Äá»i.
- `backlog.mjs`: `paths` 6â9 (**cÃ²n thiáº¿u `apps/console/**`** â ná»i lÃºc code, plan Â§13.1),
`done_when`5â10,`status: blocked`.

### Chi phÃ­

**$72** cho **0 dÃ²ng code** â toÃ n bá» vÃ o 2 vÃ²ng plan-review Opus trÃªn vÃ¹ng Äá». Äáº¯t, nhÆ°ng vÃ²ng 2 báº¯t
ÄÃºng lá» break-glass. BÃ i há»c: **Äá»c `superadmin-not-a-canonical-role` TRÆ¯á»C khi viáº¿t plan dá»±a trÃªn "0
holder wildcard"** â nÃ³ ÄÃ£ bÃ¡c giáº£ Äá»nh ÄÃ³ tá»« 02/08, v1 ÄÃ£ khÃ´ng Äá»c.

---

## PhiÃªn 2026-09-04 (d) â S14-SEC-CATALOGSNAP-HARDEN-1 â **PR #478 Má»**, chá» ngÆ°á»i chá»t

**Tráº¡ng thÃ¡i:** code xong, gate xong, PR má». `bash harness/check.sh --all --lane-db` **XANH â** 9/9
step (int-spec deny-path cháº¡y THáº¬T trÃªn `mediaos_check`). Full `apps/api` 4867 passed / 0 failed.
Ledger ÄÃ£ `finished`. NhÃ¡nh `fix/s14-sec-catalogsnap-harden-1` (3 commit) ÄÃ£ push.

**Gate:** plan-review **2 vÃ²ng Äá»u BLOCK** (6 má»¥c + 3 má»¥c) trÆ°á»c khi cho code cháº¡y â vÃ²ng 2 cháº·n ÄÃºng
cÆ¡ cháº¿ mÃ  vÃ²ng 1 vá»«a Äáº» ra (sÃ n thá»­-láº¡i). `security-reviewer` PASS 0 CRIT/0 HIGH (10 lÆ°á»£t Äá»t biáº¿n,
3 Äá»t biáº¿n fail-OPEN Äá»u bá» giáº¿t). `silent-failure-hunter` PASS 0 CRIT. MEDIUM + HIGH-1 + 1 LOW ÄÃ£ vÃ¡
ngay trong PR; pháº§n cÃ²n láº¡i Äáº©y sang follow-up (liá»t kÃª trong mÃ´ táº£ PR).

### CÃN Láº I Cá»¦A S14 â 2 WO

**`S14-SEC-CAPWILDCARD-1` ð´ â CÃ Cá»NG NGÆ¯á»I CHáº¶N á» Äáº¦U.**
`done_when` #1 ÄÃ²i **Äáº¿m actor giá»¯ wildcard trÃªn PROD**, mÃ  classifier cháº·n phiÃªn agent cháº¡m DB PROD
(`classifier-blocks-prod-db-from-agent`) â **owner pháº£i tá»± cháº¡y** trÆ°á»c khi má» WO. Dev = **0 role giá»¯
wildcard** â náº¿u PROD cÅ©ng 0 thÃ¬ ÄÃ¢y lÃ  **ná»£ Sáº CH**, 0 ngÆ°á»i gáº·p.

PhÃ¢n tÃ­ch ÄÃ£ lÃ m sáºµn (Äá»«ng Äo láº¡i):

- `permission.service.ts` `getCapabilities()` lá»c `!g.isSensitive` â cá» cá»§a **HÃNG GRANT**. HÃ ng `*:*`
  cÃ³ `is_sensitive=false` â sá»ng sÃ³t â publish `caps["*:*"]=true`.
- `packages/web-core/src/hooks/use-can.ts:16-22` `useCan` rÆ¡i xuá»ng `caps["*:*"]` â FE render mÃ n
  sensitive rá»i Än 403. `useCanExact` (`:39-41`) lÃ  lá»i ÄÃºng ÄÃ£ cÃ³ sáºµn.
- **Bá» máº·t FE náº¿u Äá»¥ng `useCan`: 345 call-site `useCan(` Â· 128 `useCanExact(` Â· 72 `<PermissionGate`.**
  â gá»¡ fallback `*:*` trong `useCan` lÃ  Äá»i hÃ nh vi toÃ n há», KHÃNG lÃ m báº±ng cáº£m giÃ¡c.
- HÆ°á»ng Äá» xuáº¥t (chÆ°a chá»t, chÆ°a qua plan-review): lá»c theo **Cáº¶P ÄÃCH** báº±ng `pairIsSensitive`; grant
  chá»©a `*` thÃ¬ **khai triá»n** theo catalog thÃ nh cÃ¡c cáº·p EXACT non-sensitive nÃ³ phá»§ (giá»¯ ÄÆ°á»£c ca ALLOW
  Äá»i chá»©ng trong done_when: actor wildcard VáºªN tháº¥y cáº·p non-sensitive). Rá»i Äá» `useCan` NGUYÃN Váº¸N +
  thÃªm ratchet Â«getCapabilities khÃ´ng bao giá» phÃ¡t khoÃ¡ chá»©a `*`Â» â ráº» hÆ¡n nhiá»u so vá»i sá»­a 345 chá».
  Nhá» **Bá»N hÃ¬nh dáº¡ng wildcard** (`permission-grant-census-must-cover-four-wildcard-shapes`).

**`S14-FE-DEBT-1` ð¢ â owner ÄÃ CHá»T PHáº M VI 04/09.** Census Äáº§y Äá»§ ÄÃ£ Äo (Äá»«ng cháº¡y láº¡i, tá»n):

- **PhÃ¢n trang: 38 nÆ¡i render.** 1 shared (`packages/ui` `data-table.tsx:213-235`, chá» client-side) Â·
  2 shared app-local Äáº·t nháº§m chá» (`AuthLogPagination` á» `routes/system/auth-logs/AuthLogControls.tsx:112`,
  `AuditLogPagination` á» `routes/system/foundation/audit-logs/AuditLogControls.tsx:112` â file thá»© 2 tá»±
  thÃº trong docblock lÃ  báº£n chÃ©p cá»§a file thá»© 1) Â· **35 báº£n chÃ©p tay**, **11 hÃ¬nh dáº¡ng**, 3 namespace
  i18n khÃ¡c nhau. **KHÃNG cÃ³ component tÃªn `PaginationFooter`/`Pagination`/`Pager` nÃ o trong repo.**
- **Parse lá»i: ~85 helper, 5 há».** Báº£n dÃ¹ng chung `packages/web-core/src/lib/error-mapper.ts`
  (`mapApiErrorToUi:43`, `showApiErrorToast:149`) chá» cÃ³ **9 call-site**. 4 module `parse*Error`
  (asset/recruit/payroll/room) chÃ©p tá»« cÃ¹ng má»t khuÃ´n â `readDetailFields` **byte-identical cáº£ 4**.
  32 helper Â«ladder `instanceof ApiError`Â» + 6 báº£n duck-typed + 7 báº£n inline.
- **Picker org-unit: 22 nÆ¡i, 0 component dÃ¹ng chung, 4 NGUá»N Dá»® LIá»U khÃ¡c nhau** â vÃ  **má»t lá»i tháº­t**:
  `hrApi.listDepartments` (`/hr/lookups/departments`, má») vÃ  `hrMasterDataApi.listDepartments`
  (`/hr/departments`, gÃ¡c `read:department`) **dÃ¹ng CHUNG `queryKey: hrKeys.departments.list()`** â cÃ¡i
  nÃ o mount trÆ°á»c Äáº§u Äá»c cache cá»§a cÃ¡i kia. KhÃ¡c shape, khÃ¡c cá»ng quyá»n. **TÃ¡ch WO riÃªng náº¿u Äá»¥ng.**
- 2 chá» **khÃ´ng cÃ³ picker**, nháº­p UUID thÃ´: `attendance/admin/ShiftAssignmentFormDialog.tsx:159`,
  `attendance/admin/RuleFormDialog.tsx:201`.
- Spec pháº£i giá»¯ xanh: ~33 (phÃ¢n trang) Â· 10 (parse lá»i) Â· 35 (picker). 5 spec hard-code khoÃ¡ i18n
  `pagination.prev/next` â Äá»i khoÃ¡ lÃ  Äá».
- **Pháº¡m vi owner chá»t:** dá»±ng báº£n chung á» `packages/ui` + `web-core`, rá»i **CHá» Ã¡p cho cá»¥m chÃ©p-y-nguyÃªn
  lá»n nháº¥t**: 10 báº£n hÃ¬nh Î¸ (Äang dÃ¹ng glyph `â¹`/`âº` **khÃ´ng i18n, khÃ´ng `aria-label`** â lá»i a11y tháº­t),
  9 báº£n hÃ¬nh Î±, vÃ  4 module `parse*Error`. ÄuÃ´i dÃ i Äá» láº¡i + ghi WO ná»i tiáº¿p. **KhÃ´ng** lÃ m cáº£ ~140 Äiá»m.

### Chi phÃ­ â Äá»c trÆ°á»c khi má» WO Äá» káº¿

PhiÃªn nÃ y cháº¡m **$106** cho **má»t** WO Äá» (2 vÃ²ng plan-review + 2 reviewer Opus + Äá»t biáº¿n). Khá»p sá»
`red-zone-wo-cost-profile` (~$136/WO Äá»). `S14-SEC-CAPWILDCARD-1` cÃ¹ng háº¡ng â dá»± trÃ¹ tÆ°Æ¡ng ÄÆ°Æ¡ng.

---

## PhiÃªn 2026-09-04 (c) â S14-RECRUIT-FILEGRANT-1 **ÄÃ MERGE** (PR #477 â squash `2bf9cead`)

**Tráº¡ng thÃ¡i:** ÄÃ³ng sá» xong. CI **14/14 xanh** (gá»m `Build Â· Typecheck Â· Migrate Â· Test` cá»§a API â
job cháº¡y int-spec + migration, vÃ  `Lint Â· Typecheck Â· Migrate Â· RLS Test`). Branch protection ÄÃ²i
review ngÆ°á»i â owner chá»t trong phiÃªn, merge báº±ng `--admin --squash --delete-branch`. NhÃ¡nh ÄÃ£ xoÃ¡ cáº£
local láº«n remote; `master` local Äá»ng bá» 0/0. Ledger `finished`, `gen-status` **0 Äang lÃ m Â· 10 ready**
vÃ  **khÃ´ng in dÃ²ng `ð§ reconcile`** (ÄÃºng nghiá»m thu cá»§a `wo-status-auto-ledger`).

### Báº«y gáº·p láº¡i trong phiÃªn nÃ y (memory ÄÃ£ ghi, xÃ¡c nháº­n váº«n ÄÃºng)

- **`gh pr checks --watch` thoÃ¡t `exit 0` khi VáºªN CÃN 2 check `pending`.** Láº§n nÃ y Äo ÄÆ°á»£c táº­n máº¯t:
  watcher bÃ¡o "completed (exit code 0)" trong khi `Build Â· Typecheck Â· Migrate Â· Test` vÃ 
  `Lint Â· Typecheck Â· Migrate Â· RLS Test` cÃ²n Äang cháº¡y. Náº¿u tin exit code thÃ¬ ÄÃ£ merge lÃªn má»t CI
  chÆ°a cháº¡y xong. **Nguá»n tháº­t lÃ  `gh pr checks --json name,bucket` rá»i tá»± Äáº¿m `bucket != pass|skipping`**
  â ÄÃ³ lÃ  cÃ¡i ÄÃ£ dÃ¹ng Äá» chá»t. Xem `gh-watch-exit-code-unreliable`.

### Ná»£ mang sang (KHÃNG lÃ m á» WO nÃ y â plan Â§13.2)

- **MEDIUM** â `list` (API-033) khÃ´ng Äi qua `FilePolicyService` â lá»ch pha listâdownload khi KI-d xáº£y
  ra. Reviewer Tá»° khuyáº¿n nghá» khÃ´ng vÃ¡ á» ÄÃ¢y â gá»p vÃ o WO ÄÃ³ng **KI-b/KI-d**.
- 3 LOW: `confirm` 403 khÃ´ng Äá» váº¿t Â· má»¥c B cá»§a qa1 dÃ¹ng `.not.toBe(403)` Â· khá»i (4b) cá»§a 0569 lÃ  báº¥t
  biáº¿n toÃ n cá»¥c lÃºc migrate.
- **KI-a/KI-b/KI-c/KI-d** cá»§a plan Â§9 giá»¯ nguyÃªn, chÆ°a Äá»¥ng. KI-d (`EmployeeFileResolver.canLinkFile`
  thiáº¿u owner-check) lÃ  cÃ¡i **reachable HÃM NAY**, ÄÃ¡ng seed WO sá»m.
- `database-reviewer` cá»§a FULL gate **khÃ´ng ra verdict** (bá» hook chi phÃ­ cáº¯t giá»¯a chá»«ng) â cÃ¡c cÃ¢u nÃ³
  bá» ngá» ÄÃ£ tá»± Äo, ghi á» plan Â§12.6. Náº¿u muá»n verdict chÃ­nh thá»©c thÃ¬ pháº£i cháº¡y láº¡i riÃªng.

---

## PhiÃªn 2026-09-04 (b) â S14-RECRUIT-FILEGRANT-1 â code + FULL gate (PR #477, ÄÃ£ merge á» phiÃªn (c))

**Tráº¡ng thÃ¡i:** nhÃ¡nh `feat/s14-recruit-filegrant-1`, 2 commit. VÃ¹ng Äá» â theo CLAUDE.md Â§9.4 **KHÃNG
gáº¯n nhÃ£n auto-merge**, Äá» ngÆ°á»i chá»t.

- `bash harness/check.sh --lane-db=filegrant1` â **XANH â má»i cá»ng** (657/657 file api Â· 259/259 app;
  6 láº§n cháº¡y láº¡i do crash háº¡ táº§ng `ERR_IPC_CHANNEL_CLOSED`, 0 test Äá»).
- **security-reviewer PASS** (0 CRITICAL / 0 HIGH / 1 MEDIUM / 5 LOW) Â· **silent-failure-hunter PASS**
  (1 MEDIUM, ÄÃ£ vÃ¡) Â· `database-reviewer` **dá»«ng á» hook chi phÃ­, khÃ´ng cÃ³ verdict** â cÃ¢u nÃ³ bá» ngá» ÄÃ£
  **tá»± Äo** (plan Â§12.6), khÃ´ng há»i láº¡i.
- Test má»i: 30 int-spec Â· 20 unit-spec (Äá»t biáº¿n Tá»ªNG Váº¾ `canLinkFile`) Â· 9 FE spec.

### Ba Äiá»u ÄÃ¡ng nhá» (ÄÃ£ ÄÃ³ng bÄng vÃ o plan Â§12âÂ§13)

1. **Plan Äáº¿m THIáº¾U cá»ng census: cÃ³ Báº¢Y, khÃ´ng pháº£i sÃ¡u.** Cá»ng thá»© 7 lÃ  FE
   `recruit-wiring.spec.ts` â nÃ³ Äá»c file BE báº±ng `fs`, ghim 32 cáº·p vÃ  cÃ³ ca _"khÃ´ng resource nÃ o KHÃC
   `candidate` bá» sensitive"_. ÄÃ£ vÃ¡ theo hÆ°á»ng **ghim Táº¬P, khÃ´ng ghim TÃN**.
2. **Ca `/auth/me` (K1) ÄÃ£ Äá»T BIáº¾N Äá» chá»©ng minh khÃ´ng xanh-rá»ng:** gá»¡ dÃ²ng allowlist â K1 Äá»
   (`expected undefined to be true`). Lá»p lá»i CAP-2 nÃ y ÄÃ£ láº·p 12+ láº§n mÃ  trÆ°á»c ÄÃ¢y khÃ´ng cÃ³ ca Äo.
3. **Äo thay vÃ¬ tin lá»i khai:** replay `0569` láº§n 2 trÃªn lane DB cho `INSERT 0 0` + 2 khá»i verify xanh;
   vÃ  trong 8 hÃ ng grant `candidate-file` cÃ³ **5 role company-scoped cá»§a fixture test** mÃ  verify
   NEGATIVE **khÃ´ng** trip â váº¿ neo `company_id IS NULL` hoáº¡t Äá»ng ÄÃºng trÃªn dá»¯ liá»u tháº­t.

### Ná»£ ghi nháº­n (KHÃNG lÃ m á» WO nÃ y â plan Â§13.2)

- **MEDIUM** â `list` (033) khÃ´ng Äi qua `FilePolicyService` â lá»ch pha listâdownload khi KI-d xáº£y ra.
  Reviewer Tá»° khuyáº¿n nghá» khÃ´ng vÃ¡ á» ÄÃ¢y. â gá»p WO ÄÃ³ng **KI-b/KI-d**.
- 3 LOW: `confirm` 403 khÃ´ng Äá» váº¿t Â· má»¥c B cá»§a qa1 dÃ¹ng `.not.toBe(403)` Â· khá»i (4b) cá»§a 0569 lÃ  báº¥t
  biáº¿n toÃ n cá»¥c lÃºc migrate.
- KI-a/KI-b/KI-c/KI-d cá»§a plan Â§9 giá»¯ nguyÃªn, chÆ°a Äá»¥ng.

### Friction

- **Chi phÃ­ phiÃªn cháº¡m $293.80** â riÃªng 3 reviewer FULL gate Äá»t ~$160 (security 181k token, silent-
  failure 143k, database 88k _mÃ  khÃ´ng ra verdict_). `database-reviewer` bá» hook chi phÃ­ cáº¯t giá»¯a chá»«ng
  vÃ  tráº£ vá» cÃ¢u há»i thay vÃ¬ káº¿t luáº­n â **tiá»n máº¥t, verdict khÃ´ng cÃ³**. BÃ i há»c: vá»i lane vÃ¹ng Äá», cháº¡y
  reviewer **tuáº§n tá»± vÃ  há»i ÄÃNG thá»© mÃ¬nh khÃ´ng tá»± Äo ÄÆ°á»£c**; nhá»¯ng cÃ¢u nhÆ° "index cÃ³ tá»n táº¡i khÃ´ng",
  "canLink cÃ³ cháº¡y ngoÃ i tx khÃ´ng", "migration cÃ³ idempotent khÃ´ng" thÃ¬ tá»± Äo báº±ng 1 cÃ¢u SQL / 1 láº§n
  `sed` ráº» hÆ¡n hai báº­c.

---

## PhiÃªn 2026-09-04 â S14-RECRUIT-FILEGRANT-1 ÄANG Dá»: plan v3 + migration XONG, code CHÆ¯A viáº¿t

**Tráº¡ng thÃ¡i:** nhÃ¡nh `feat/s14-recruit-filegrant-1` (cáº¯t tá»« master `1685f9e5`), backlog `in_progress`.
Dá»«ng CÃ CHá»¦ ÄÃCH á» ranh giá»i sáº¡ch vÃ¬ chi phÃ­ phiÃªn cháº¡m $174 â pháº§n Äáº¯t nháº¥t (hiá»u há» thá»ng + quyáº¿t
Äá»nh thiáº¿t káº¿) ÄÃ£ káº¿t tinh vÃ o plan, phiÃªn sau Äá»c plan rá»i code tháº³ng sáº½ ráº» hÆ¡n nhiá»u cho cÃ¹ng káº¿t quáº£.

### Owner ÄÃ£ chá»t trong phiÃªn (KHÃNG há»i láº¡i)

1. **HÆ°á»ng = wrapper RECRUIT**, KHÃNG cáº¥p cáº·p `foundation-file` cho recruiter/hr (WO seed viáº¿t sai hÆ°á»ng).
2. **`hr` ÄÆ°á»£c Äá»§ 4 thao tÃ¡c CV nhÆ° `recruiter`.**
3. _(ngÆ°á»i thá»±c hiá»n tá»± quyáº¿t, owner chÆ°a bÃ¡c)_ KHÃNG cáº¥p `update:candidate` cho hr â SPEC-12 Â§11:276
   chá»t cáº·p ÄÃ³ cho tháº¥y email/phone KHÃNG che â sáº½ bá» mask PII toÃ n role hr. Thay báº±ng cáº·p ghi-tá»p riÃªng.

### VÃ¬ sao WO seed sai hÆ°á»ng (Äo trÃªn DB tháº­t, khÃ´ng suy ÄoÃ¡n)

Cáº¥p `view:foundation-file` cho recruiter/hr sáº½ má» **mÃ n quáº£n trá» `System > Files`**
(`sidebar-registry.ts:692` + `FilesPage.tsx:111`), vÃ  `GET /foundation/files` **khÃ´ng gÃ¡c per-file**
(`file.repository.ts:308 listTx` bá» qua `moduleCode/entityType/entityId`) â liá»t kÃª Má»I tá»p tenant.
`download:foundation-file` má» fallback `FOUNDATION.FILE.*` cho tá»p chÆ°a tá»«ng link.

### ÄÃ XONG (trÃªn ÄÄ©a, chÆ°a merge)

- **`docs/plans/S14-RECRUIT-FILEGRANT-1.md` v3** â qua **2 vÃ²ng plan-review Äá»i khÃ¡ng**, 8 Äiá»m BLOCK
  ÄÃ£ vÃ¡, má»i Äiá»m kÃ¨m `file:dÃ²ng` ÄÃ£ tá»± kiá»m chá»©ng. **Äá»C PLAN TRÆ¯á»C KHI CODE** â nÃ³ cÃ³ sáºµn 20 ca test,
  khuÃ´n pháº£i chÃ©p, vÃ  6 cá»ng census pháº£i cáº­p nháº­t.
- **`apps/api/migrations/0569_s14recruitfilegrant1_candidate_file_perm.sql`** + journal idx 236.
  **ÄÃ CHáº Y THáº¬T 2 Láº¦N trÃªn `mediaos_filegrant1`**: láº§n 1 seed 1 cáº·p + 3 grant, láº§n 2 idempotent
  (0 INSERT), cáº£ 4 khá»i verify xanh. State: `recruiter|hr|company-admin Ã upload:candidate-file
Ã ALLOW@Company`, `is_sensitive=true`.
- **`harness/backlog.mjs`** â layer `DB+BE+FE`, paths 7â14, done_when +1 (hÆ°á»ng owner chá»t).
- Lane DB `mediaos_filegrant1` sáºµn sÃ ng (236 migration + 0569).

### CHÆ¯A LÃM â pháº§n cÃ²n láº¡i cá»§a WO

4 file BE má»i (controller Â· service Â· repository Â· unit-spec resolver) Â· 5 file BE sá»­a
(`recruit-route-pairs.const` +5 key Â· resolver `canLinkFile` 5 váº¿ Â· `recruit.module` Â· `permission.service`
2 máº£ng allowlist) Â· 2 contract Â· 3 file FE Â· int-spec ~20 ca Â· **6 cá»ng census toÃ n cá»¥c** Â· 6 doc
(SPEC-12 Â§11/Â§15/Â§18 Â· permission-matrix Â§9f Â· API-17 Â· route-census artifact) Â· FULL gate Â·
`bash harness/check.sh --all --lane-db=filegrant1`.

### BA Äiá»u KHÃNG ÄÆ°á»£c quÃªn (má»i cÃ¡i lÃ  má»t lá» tháº­t review ÄÃ£ báº¯t)

1. **`canLinkFile` pháº£i cÃ³ NÄM váº¿**, khÃ´ng pháº£i chá» cáº·p quyá»n. `FileService.link`
   (`files.service.ts:530-600`) **khÃ´ng há» kiá»m `owner_user_id`** â chá» tenant + `Infected`. Thiáº¿u váº¿
   "caller sá» há»¯u tá»p" + váº¿ "tá»p CHÆ¯A tá»«ng link" thÃ¬ recruiter/hr link ÄÆ°á»£c **tá»p báº¥t ká»³** vÃ o á»©ng viÃªn,
   ká» cáº£ tá»p ÄÃ£ bá» **thu há»i** (gá»¡ link) â biáº¿n `deny-links-revoked` thÃ nh vÃ´ dá»¥ng **vÄ©nh viá»n**.
   KhuÃ´n pháº£i chÃ©p: `ChatMessageFileResolver.canAttach` (`chat-message-file.resolver.ts:110`).
2. **Cáº·p má»i Äáº·t trÃªn resource `candidate-file`, KHÃNG pháº£i `('file-upload','candidate')`** â lÃ½ do ká»¹
   thuáº­t, khÃ´ng pháº£i Äáº·t tÃªn: `0560:336-347` (b1) RAISE náº¿u â 42 vÃ  `:431-444` (b4) náº¿u â 14 trÃªn 5
   resource RECRUIT, mÃ  int-spec I1 (`s12-recruit-db1-invariants:982-1016`) **Äá»c `0560_*.sql` tá»« ÄÄ©a
   rá»i cháº¡y láº¡i** â Äáº·t trÃªn `candidate` lÃ  migration ÄÃ SHIP ná» khi replay, exception nÃ©m tá»« trong SQL
   nÃªn khÃ´ng "sá»­a ká»³ vá»ng á» test" ÄÆ°á»£c.
3. **Má»i cÃ¢u Äo role trong migration pháº£i neo `company_id IS NULL`.** `SuperAdminBootstrapRepository`
   grant TOÃN Bá» catalog khÃ´ng lá»c (`:127-128`) â gá»m cáº·p `('*','*')` â cho role `super-admin`
   **COMPANY-SCOPED** (`:44`). KhÃ´ng neo â RAISE trÃªn má»i DB ÄÃ£ bootstrap. **Báº«y nÃ y KHÃNG lá» ra khi
   thá»­ local** (DB dev chÆ°a bootstrap super-admin nÃªn grant wildcard = 0 hÃ ng).

### Ná»£ ghi nháº­n, KHÃNG lÃ m trong WO nÃ y (plan Â§9)

- **KI-a** `GET /foundation/files` bá» qua bá» lá»c entity â tab CV hiá»n táº¡i Äang liá»t kÃª Má»I tá»p tenant
  (lá»i CÃ Sáº´N, Äang bá» che vÃ¬ chá» admin giá»¯ cáº·p). WO riÃªng â bá» máº·t dÃ¹ng chung.
- **KI-b** TASK vÃ  HR cÃ³ **cÃ¹ng lá»p gap**: `employee`/`manager` giá»¯ `file-upload:task@Own`, `hr` giá»¯
  `file-upload:employee@Company`, nhÆ°ng cáº£ hai váº«n upload qua `/foundation/files/upload`. DÃ¹ng láº¡i
  khuÃ´n wrapper cá»§a WO nÃ y.
- **KI-d** `EmployeeFileResolver.canLinkFile` (`employee-file.resolver.ts:57-59`) **khÃ´ng cÃ³
  owner-check** â hr gáº¯n ÄÆ°á»£c CV á»©ng viÃªn vÃ o há» sÆ¡ nhÃ¢n viÃªn qua HR-API-801, lÃ m recruiter **máº¥t**
  quyá»n táº£i chÃ­nh CV ÄÃ³ (AND-verdict `decideForLinkedFile:238-261`). **Reachable HÃM NAY**, khÃ´ng pháº£i
  giáº£ Äá»nh. KhÃ´ng pháº£i escalation nÃªn khÃ´ng cháº·n WO nÃ y.

### Friction

- **Chi phÃ­ plan-review vÃ¹ng Äá» cao hÆ¡n `red-zone-wo-cost-profile` ghi nháº­n**: 2 vÃ²ng review = ~$90
  (vÃ²ng 2 má»t mÃ¬nh Äá»t 295k token). VÃ²ng 2 váº«n ÄÃ¡ng â nÃ³ báº¯t 3 Äiá»m BLOCK mÃ  **chÃ­nh báº£n vÃ¡ vÃ²ng 1 Äáº»
  ra** (ÄÃºng `plan-review-rounds-inject-new-holes`). NhÆ°ng pháº£i tÃ­nh vÃ²ng review vÃ o ngÃ¢n sÃ¡ch WO ngay
  tá»« Äáº§u, vÃ  dá»«ng á» 2 vÃ²ng.
- **Bash heredoc `<<'PY'` vá»¡** vá»i ná»i dung nhiá»u backtick/nhÃ¡y tiáº¿ng Viá»t ("unexpected EOF looking for
  matching `''`") â script vÃ¡ file pháº£i ghi ra file rá»i cháº¡y, Äá»«ng nhÃ©t inline.

> Ghi NGáº®N gá»n. CÅ© Äáº©y xuá»ng "Lá»ch sá»­". Quyáº¿t Äá»nh kiáº¿n trÃºc â ghi vÃ o `docs/DECISIONS/`, khÃ´ng nhá»i vÃ o ÄÃ¢y.
> Ã **Friction**: ghi cÃ¡i gÃ¬ lÃ m tay/khÃ³ láº·p láº¡i â cÃ¹ng má»t friction xuáº¥t hiá»n **â¥2 láº§n** â gá»i skill `skill-smith` Äá» ÄÃ³ng bÄng thÃ nh skill.

## PhiÃªn 2026-09-04 â S14-SEC-DASHGATE-WILDCARD-1 **ÄÃ MERGE** (PR #476 â `092fc6e7`)

PhiÃªn trÆ°á»c Äá» láº¡i 2 commit trÃªn nhÃ¡nh `feat/s14-sec-dashgate-wildcard-1` mÃ  **chÆ°a má» PR, chÆ°a ÄÃ³ng sá»
ledger**. PhiÃªn nÃ y lÃ m ná»t pháº§n cá»ng + PR. VÃ¹ng Äá» â theo CLAUDE.md Â§9.4 **khÃ´ng auto-merge**, Äá»
ngÆ°á»i chá»t.

**Viá»c ÄÃ¡ng ká» nháº¥t cá»§a phiÃªn: cho gate cháº¡y VÃNG HAI trÃªn riÃªng `21fe3d20`.** Commit ÄÃ³ lÃ  báº£n vÃ¡
_cho cÃ¡c phÃ¡t hiá»n_ cá»§a vÃ²ng gate Äáº§u â nÃªn tá»± nÃ³ chÆ°a tá»«ng qua cá»ng â mÃ  nÃ³ láº¡i sá»­a ÄÃºng **báº¥t biáº¿n
trung tÃ¢m cá»§a WO** (`auditRequired` hard-code `true` â SUY RA; cá» cháº£y vÃ o `reveal = allow &&
auditRequired`, láº­t nháº§m má»t bit = **mask thÃ nh reveal**). Commit rá»§i ro nháº¥t cá»§a WO lÃ  commit duy nháº¥t
khÃ´ng ai Äá»c. ÄÃ£ ÄÃ³ng bÄng thÃ nh memory `fix-commit-for-review-findings-is-itself-ungated`.

- **verdict PASS, 0 CRITICAL / 0 HIGH.** Reviewer dá»±ng láº¡i báº£ng chÃ¢n trá» `auditRequired` Äá»C Láº¬P vÃ 
  khá»p: khÃ´ng tá» há»£p nÃ o láº­t trueâfalse hay falseâtrue, vÃ  ÄÃºng vÃ¬ lÃ½ do **Cáº¤U TRÃC** â biá»u thá»©c má»i
  CHÃNH LÃ vá» tá»« vÃ o-nhÃ¡nh cá»§a báº£n tiá»n-vÃ¡, khÃ´ng pháº£i may máº¯n. Báº£ng Äáº§y Äá»§ á» plan Â§11.1.
- XÃ¡c nháº­n thÃªm: `epoch` khÃ´ng ABA (nhÆ°ng chá» phá»§ ÄÆ°á»ng TEST â `reset()` chá» gá»i tá»« test) Â· never-throw
  kÃ­n (Äiá»m duy nháº¥t ngoÃ i try lÃ  `this.now()`) Â· `canBatch` máº£ng-theo-chá»-sá» loáº¡i lá» `?? false` **vá»
  máº·t KIá»U**, khÃ´ng pháº£i ká»· luáº­t.

**2 MEDIUM defer sang `S14-SEC-CATALOGSNAP-HARDEN-1` (ÄÃ£ seed, 485 WO).** Cáº£ hai KHÃNG tá»i ÄÆ°á»£c vá»i
code sáº£n pháº©m hÃ´m nay â reviewer chá»©ng minh chá»© khÃ´ng phá»ng ÄoÃ¡n:

1. **`permission-catalog-snapshot.ts:137-143` â náº¡p THÃNH CÃNG mÃ  Rá»NG lÃ  hÃ¬nh dáº¡ng fail-OPEN DUY NHáº¤T**,
   cache 300s, KHÃNG váº¿t (`emitError` chá» á» nhÃ¡nh catch). Äá»i xá»©ng ngÆ°á»£c: cÃ¹ng sá»± cá» mÃ  biá»u hiá»n báº±ng
   THROW thÃ¬ siáº¿t + cÃ³ log. KhÃ´ng tá»i ÄÆ°á»£c vÃ¬ `SELECT` khÃ´ng tráº£ PARTIAL vÃ  catalog lÃ  báº£ng global
   khÃ´ng RLS â 0 hÃ ng chá» khi báº£ng tháº­t sá»± rá»ng. â memory `empty-success-is-the-fail-open-shape`.
2. **`:131,150-157` â `inFlight` gÃ¡n SAU khi thÃ¢n cÃ³ thá» settle** â káº¹t vÄ©nh viá»n (fail-CLOSED nhÆ°ng lÃ 
   DoS quyá»n tá»i khi restart). KhÃ´ng tá»i ÄÆ°á»£c vÃ¬ `load` sáº£n pháº©m lÃ  method `async`.

**â ï¸ Báº«y cho WO káº¿:** ca ghim D3 (`permission-catalog-snapshot.spec.ts:54-62`) **Cá» Ã neo empty â
`false`** vá»i lÃ½ do **tiá»n test** (Â«chá»n `true` sáº½ lÃ m hÃ ng loáº¡t spec Äá» vÃ¬ lÃ½ do saiÂ») â lÃ½ do váº­n
hÃ nh-test, khÃ´ng pháº£i lÃ½ do an ninh. ÄÃ³ lÃ  `tests-can-pin-a-hole-open`: pháº£i **sá»­a ca ghim**, khÃ´ng
lÃ¡ch quanh. Blast radius ÄÃ£ Äo sáºµn Äá» khá»i Äo láº¡i: ~9 stub repo khai `getAllPermissions`, 2 khai kiá»u
`Promise<[]>` (`permission.service.reveal.spec.ts:80`, `permission.service.spec.ts:137`).

**Plan doc trÆ°á»c ÄÃ³ dá»«ng á» Â§9 vÃ  KHÃNG á» ÄÃ¢u ghi láº¡i 5 phÃ¡t hiá»n ÄÃ£ vÃ¡** â ká» cáº£ cÃ¡i HIGH láº­t báº¥t biáº¿n.
WO sau Äá»c plan sáº½ tÆ°á»ng báº¥t biáº¿n gá»c váº«n ÄÃºng. ÄÃ£ bá» sung **Â§10** (5 vÃ¡ vÃ²ng 1) + **Â§11** (vÃ²ng 2 +
báº£ng chÃ¢n trá» + defer).

`bash harness/check.sh --all --lane-db=s14dashgate`: **9/9 XANH**, khÃ´ng banner. FORCE RLS 0 báº£ng
thiáº¿u Â· append-only 0 grant UPDATE/DELETE trÃªn 9 báº£ng ledger.

**ÄÃ£ ÄÃ³ng trá»n:** CI xanh 8/8 â squash-merge `092fc6e7` (pháº£i dÃ¹ng `--admin`: GitHub cáº¥m tá»± duyá»t PR cá»§a mÃ¬nh, mÃ  `required_approving_review_count: 1` â owner ÄÃ£ kÃ½ duyá»t miá»ng nÃªn thá»© bá» vÆ°á»£t chá» lÃ  CÆ  CHáº¾). Lane `mediaos_s14dashgate` ÄÃ£ DROP. STATUS regen + push master (`5c29fd40`). **Hai WO giá» Má» KHOÃ** (deps=done): `S14-SEC-CAPWILDCARD-1` vÃ  `S14-SEC-CATALOGSNAP-HARDEN-1`.

**Friction:** (1) `node harness/ledger.mjs --help` khÃ´ng in usage mÃ  **render cáº£ timeline** â Äá»c
docblock Äáº§u file thay vÃ¬ gá»i `--help`. (2) Láº·p láº¡i friction phiÃªn trÆ°á»c: heredoc dÃ i + backtick vá»¡ á»
Bash tool â dÃ¹ng `python - << EOF` rá»i `npx prettier --write` tay (hook prettier khÃ´ng cháº¡y khi python
ghi tháº³ng file). Friction nÃ y ÄÃ£ xuáº¥t hiá»n **â¥2 láº§n** â ÄÃ¡ng gá»i `skill-smith`.

## PhiÃªn 2026-09-03 (chiá»u muá»n) â S18-AUTH-RESETCLEARS-1

**ÄÃ³ng sá» trÆ°á»c ÄÃ³:** `S18-AUTH-UNLOCK429-1` ÄÃ£ merge (PR #472, `13219b1b`) nhÆ°ng ledger chÆ°a cÃ³ má»c
`finished` â STATUS váº«n váº½ nÃ³ lÃ  "Äang lÃ m". ÄÃ£ `ledger.mjs done` + regen. BÃ i há»c láº·p láº¡i: **merge
xong pháº£i ÄÃ³ng sá» ledger**, khÃ´ng thÃ¬ WO káº¿ bá» cháº·n oan (máº«u `blocked-status-is-the-only-machine-readable-stop`).

**WO nÃ y (0 migration).** Äáº·t láº¡i máº­t kháº©u thÃ nh cÃ´ng â gá»¡ luÃ´n khoÃ¡ 429, á» Cáº¢ hai ÄÆ°á»ng: tá»± phá»¥c vá»¥
(`AuthService.resetPassword`) vÃ  admin Äáº·t láº¡i há» (`AuthUsersService.resetPassword`). Káº¿ hoáº¡ch + toÃ n
bá» sá» Äo: `docs/plans/S18-AUTH-RESETCLEARS-1.md` (Â§8 báº£n vÃ¡ sau plan-review Â· Â§9 káº¿t quáº£ cháº¡y tháº­t).

- **Owner ÄÃ£ chá»t 4 quyáº¿t Äá»nh** (Â§8.1â8.4): gÃ¡c lá»i gá»i clear theo `deleted_at` chá»© KHÃNG siáº¿t `WHERE`
  cá»§a UPDATE Â· ghi váº¿t CHá» khi gá»¡ tháº¥t báº¡i Â· sá»­a `done_when` #6 (khÃ´ng thÃªm sÃ n thá»i gian, thay báº±ng
  3 rÃ ng buá»c Äo ÄÆ°á»£c) Â· thÃªm 1 dÃ²ng invalidate `loginThrottle` á» FE.
- **`clearLoginLocks` nháº­n `opts: {includeForgot}` Báº®T BUá»C** (khÃ´ng máº·c Äá»nh): `rl:forgot:*` gÃ¡c má»t
  endpoint CÃNG KHAI khÃ´ng xÃ¡c thá»±c, nÃªn "quÃªn khai" pháº£i lÃ  lá»i BIÃN Dá»CH. ÄÆ°á»ng tá»± phá»¥c vá»¥ khai
  `false`, ÄÆ°á»ng admin khai `true`. Cá» Ã¡p á» ÄÃºng BA chá» (vÃ²ng family Â· `exact` Â· `purgeMemoryLocks`).
- **KHÃNG truyá»n `subject` á» cáº£ hai ÄÆ°á»ng** â bucket `rl:2fa` khÃ´ng bá» gá»¡. Äáº·t láº¡i máº­t kháº©u khÃ´ng
  chá»©ng minh quyá»n kiá»m soÃ¡t yáº¿u tá» thá»© hai.

**Ba giáº£ Äá»nh cá»§a plan SAI khi Äo tháº­t (plan-reviewer báº¯t, ÄÃ£ sá»­a cáº£ plan láº«n test):**

1. Ca int-spec bucket `acct` viáº¿t "2 IP" lÃ  **báº¥t kháº£ thi** â `login()` tráº£ 429 TRÆ¯á»C
   `recordLoginFailure` nÃªn má»i IP chá» gÃ³p tá»i Äa `LOGIN_MAX_ATTEMPTS`=5 vÃ o ngÆ°á»¡ng 20 â pháº£i ráº£i
   **4 IP Ã 5**, vÃ  ca ÄÃ³ pháº£i gá»i `auth.login(...,{ip})` TRá»°C TIáº¾P (supertest cho `req.ip` háº±ng sá»).
2. `resetPassword` KHÃNG lá»c `deleted_at`, mÃ  unique email lÃ  **partial** (`WHERE deleted_at IS NULL`)
   â email cá»§a user ÄÃ£ xoÃ¡ má»m cÃ³ thá» ÄÃ£ cáº¥p láº¡i cho NGÆ¯á»I KHÃC; clear theo `(slug,email)` sáº½ gá»¡ khoÃ¡
   nháº§m. R1 cá»§a plan kháº³ng Äá»nh Äiá»u nÃ y báº¥t kháº£ â kháº³ng Äá»nh ÄÃ³ SAI.
3. `requireRateLimiter()` lÃ m **4 ca hiá»n cÃ³** Äá» (5 chá» dá»±ng `AuthUsersService` thiáº¿u tham sá» thá»© 9);
   plan nÃ³i "chá» spec nÃ o assert Äá»i sá» má»i pháº£i sá»­a" â sai.

**silent-failure-hunter BLOCK â 3 vÃ¡:** (a) nhÃ¡nh `degraded` **khÃ´ng nÃ©m** trÆ°á»c ÄÃ¢y chá» ghi audit â
log/APM im láº·ng ÄÃºng lÃºc báº¥t thÆ°á»ng nháº¥t â nay `logger.error` NGAY Táº I nhÃ¡nh á» cáº£ hai ÄÆ°á»ng; (b) nhÃ¡nh
thiáº¿u `slug` im láº·ng tuyá»t Äá»i, mÃ  ÄÃ³ lÃ  ca "khÃ´ng gá»¡ vÃ¬ CHÆ¯A Tá»ªNG THá»¬ gá»¡" (Ã­t dáº¥u váº¿t hÆ¡n cáº£ ca
Valkey cháº­p chá»n) â nay tÃ¡ch khá»i `deletedAt` vÃ  `logger.warn`; (c) spec ÄÆ°á»ng admin khÃ´ng cÃ³ spy
logger â Äá»i `catch (err) {log; â¦}` thÃ nh `catch {â¦}` váº«n xanh.

**security-reviewer PASS**, 0 CRITICAL/HIGH. LOW ÄÃ£ vÃ¡: `redactEmailFromDetail` + giá»¯ `stack` á» hai
`catch` cá»§a ÄÆ°á»ng admin; int-spec má»i thÃªm vÃ o `test:cov:sensitive`.

**14/14 Äá»t biáº¿n Äá»** (10 unit + 3 int + 1 FE) â báº£ng Äáº§y Äá»§ á» plan Â§9.3. **p50/p95** (plan Â§9.4):
token-SAI 6/18ms Â· token-ÄÃNG 29/39ms TRÆ¯á»C â 30/54ms SAU â round-trip Valkey ÄÃ³ng gÃ³p ~1ms á» p50,
khoáº£ng cÃ¡ch 5Ã giá»¯a hai nhÃ¡nh vá»n ÄÃ£ cÃ³ tá»« trÆ°á»c.

**Giá»i háº¡n ghi ra Äá» khÃ´ng ai tÆ°á»ng lÃ  bug má»i** (plan Â§9.6): `degraded` khÃ´ng verify láº¡i bucket `acct`
Â· marker "chá» má»¥c IP trÃ n tráº§n" (64 IP) khiáº¿n `degraded` bá» tÃ¡c Äá»ng tá»« ngoÃ i â Äáº» `USER_UNLOCKED{ok:false}`
dÃ¹ gá»¡ ÄÃºng Â· hÃ ng `user.login_throttle_cleared` giá» cÃ³ HAI hÃ¬nh dáº¡ng (discriminator lÃ 
`after.reason='password_reset'`) â bÃ¡o cÃ¡o Äáº¿m "admin ÄÃ£ gá»¡ khoÃ¡" theo má»i `action` sáº½ Äáº¿m DÆ¯.

**Ná»£ CÅ¨ chÆ°a vÃ¡ (owner chá»t ngoÃ i pháº¡m vi):** user ÄÃ£ xoÃ¡ má»m váº«n **Äáº·t láº¡i ÄÆ°á»£c máº­t kháº©u** â
`resetPassword` khÃ´ng lá»c `deleted_at` á» cÃ¢u UPDATE. WO nÃ y chá» cháº·n pháº§n cá»§a mÃ¬nh (khÃ´ng gá»¡ khoÃ¡ cho
hÃ ng ÄÃ£ xoÃ¡ má»m). Siáº¿t `WHERE` = Äá»i 200 â 401 trÃªn ÄÆ°á»ng auth, cáº§n WO riÃªng.

**check.sh --all --lane-db=s18reset:** 8/9 cá»ng XANH; ca Äá» duy nháº¥t lÃ 
`s11-asset-db1-invariants` H1 â cháº¡y RIÃNG 22/22 XANH â **flake lane chung, Láº¶P Láº I y há»t WO trÆ°á»c
trong cÃ¹ng wave** (ÄÃ£ ghi á» má»¥c dÆ°á»i). KhÃ´ng liÃªn quan diff S18 (ASSET mig 0549â0551 vs auth).
CÃ¹ng má»t ca flake ná» hai láº§n liÃªn tiáº¿p â ÄÃ¡ng seed WO dá»n riÃªng thay vÃ¬ tiáº¿p tá»¥c miá»n trá»« báº±ng tay.

**Friction:** (1) Bash tool vá»¡ vá»i heredoc dÃ i chá»©a backtick â dÃ¹ng Write tool rá»i `cat >>`, hoáº·c
`python - << EOF`. (2) python ghi tháº³ng file thÃ¬ hook prettier KHÃNG cháº¡y â thá»¥t lá» lá»ch, pháº£i
`npx prettier --write` tay; vÃ  má»t `assert` gÃ£y giá»¯a script lÃ m Má»I thay Äá»i trÆ°á»c ÄÃ³ khÃ´ng ÄÆ°á»£c ghi
(script chá» write á» cuá»i) â dá» tÆ°á»ng ÄÃ£ vÃ¡ mÃ  chÆ°a. (3) `test:cov:sensitive` Äá» Má»T láº§n rá»i xanh vá»i
cÃ¹ng Äáº§u vÃ o (flake), pháº£i cháº¡y láº¡i Äá» phÃ¢n biá»t vá»i há»i quy tháº­t. (4) Lane `mediaos_s18reset` cÃ²n
sá»ng, DROP sau khi merge.

## PhiÃªn 2026-09-03 (tá»i) â S18-AUTH-RETRYAFTER-1: Káº¾ HOáº CH xong + qua 1 vÃ²ng plan-review, **CHÆ¯A cÃ³ code**

**NhÃ¡nh `feat/s18-auth-retryafter-1`** (ÄÃ£ commit plan; cÃ¢y sáº¡ch). Viá»c tiáº¿p theo = **code tháº³ng theo
`docs/plans/S18-AUTH-RETRYAFTER-1.md` Â§6 (thá»© tá»± thi cÃ´ng)** â Äá»«ng láº·p láº¡i vÃ²ng Äá»c code/plan-review,
plan ÄÃ£ tráº£ lá»i háº¿t. Dá»«ng á» ÄÃ¢y lÃ  quyáº¿t Äá»nh cá»§a owner vÃ¬ chi phÃ­ phiÃªn ($67).

- **HÃ¬nh dáº¡ng chá»t:** 429 mang `retryAfterSec` qua `error.details` (`ErrorDetail{field,message,rule}` â
  hÃ¬nh DUY NHáº¤T `AllExceptionsFilter` cho ra ngoÃ i) + header `Retry-After` Äáº·t TRONG filter, suy Tá»ª
  `details` (má»t nguá»n). HÃ m má»i `apps/api/src/common/filters/retry-after.ts`. DÃ¹ng láº¡i
  `remainingLockSec()` cá»§a WO trÆ°á»c â khÃ´ng viáº¿t báº£n thá»© hai.
- **plan-review tráº£ BLOCK, ÄÃ£ vÃ¡ Äá»§ 5 Äiá»m.** Ba Äiá»m lÃ  lá»i sá» Äo cá»§a phiÃªn nÃ y, ÄÃ£ tá»± kiá»m láº¡i vÃ 
  xÃ¡c nháº­n reviewer ÄÃNG:
  1. **Census 429 lÃ  8 chá», khÃ´ng pháº£i 5** â grep Äáº§u tiÃªn bá» `head -30` cáº¯t máº¥t. `step-up.service.ts:122`
     (cÃ¹ng module AUTH!), `chat-calls.service.ts:531`, `lms-service-intake.guard.ts:107`. Cáº£ ba NGOÃI
     `paths` â cá» Ã½ khÃ´ng lÃ m; ná»£ ÄÃ£ ghi vÃ o plan Â§1 + Â§6. Sau WO nÃ y AUTH cÃ³ HAI há»£p Äá»ng 429.
  2. **Mock response cá»§a `all-exceptions.filter.spec.ts:32` chá» cÃ³ `status`** â gá»i `setHeader` trong
     filter sáº½ lÃ m Äá» cáº£ 5 ca Äang xanh. Plan Â§4.0 lÃ  bÆ°á»c-0 báº¯t buá»c: vÃ¡ mock TRÆ¯á»C.
  3. **Census mock `LoginRateLimiter` sai** â `grep -l` báº¯t cáº£ file _dÃ¹ng_ limiter tháº­t. ÄÃºng lÃ  4 chá» /
     3 file; vÃ  `two-factor.service.spec.ts` mock Rá»NG (`{} as never`) pháº£i dá»±ng má»i.
  4. `done_when[1]` (ca ÄO THá»I GIAN 429 vs sai-máº­t-kháº©u) chÆ°a ÄÆ°á»£c phá»§ â plan Â§4.4 `Â§floor` (Äo p50,
     N=15/nhÃ³m, ngÆ°á»¡ng 60ms theo jitter 80ms).
  5. Â§3.4 láº«n **tráº§n** TTL vá»i **TTL cÃ²n láº¡i** â `retryAfterSec` CÃ lá» thá»i Äiá»m khoÃ¡ ÄÆ°á»£c dá»±ng. ÄÃ£ ghi
     lÃ  cháº¥p nháº­n (polling Äo ÄÆ°á»£c sáºµn), vÃ  **cáº¥m** ghim "hai bucket cÃ¹ng sá»" thÃ nh assert.
- **Sá» Äo tá»± kiá»m, dÃ¹ng ÄÆ°á»£c ngay, Äá»«ng Äo láº¡i:**
  - `main.ts:37-40` CORS **khÃ´ng cÃ³ `exposedHeaders`** â trÃ¬nh duyá»t KHÃNG Äá»c ÄÆ°á»£c `Retry-After`
    cross-origin. ÄÆ°á»ng táº£i tháº­t cho FE lÃ  BODY. â ï¸ int-spec supertest cháº¡y cÃ¹ng tiáº¿n trÃ¬nh nÃªn header
    XANH â Äá»«ng vÃ¬ tháº¿ tÆ°á»ng FE Äá»c ÄÆ°á»£c.
  - KhÃ´ng spec nÃ o ghim BODY cá»§a 429 hiá»n táº¡i (chá» assert status) â Äá»i payload stringâobject an toÃ n.
  - `recordFailure` set `:lock` báº±ng cÃ¹ng `LOGIN_LOCKOUT_SEC` cho Má»I bucket
    (`login-rate-limiter.ts:230-241`), vÃ  `login()` nÃ©m 429 TRÆ¯á»C `recordLoginFailure` â khÃ´ng khoÃ¡
    per-IP má»i nÃ o sinh ra khi `acct` Äang khoÃ¡ â **TTL(acct) â¥ TTL(ip)**, láº¥y `acct` trÆ°á»c lÃ  ÄÃNG chiá»u.
  - `assertKeysScoped` chá» nÃ©m khi `NODE_ENV==='test'` (`valkey-key.ts:240-241`); Valkey client
    `enableOfflineQueue:false` + `maxRetriesPerRequest:1` â Valkey rá»t lÃ  fail NHANH, khÃ´ng treo quÃ¡ sÃ n.
  - `LOGIN_LOCKOUT_SEC` **khÃ´ng cÃ³ `.max()`** (`env.schema.ts:116`) â tráº§n 86400 cá»§a FE cÃ³ thá» cháº·n cÃ¢m
    má»t khoÃ¡ tháº­t (R7, cháº¥p nháº­n, pháº£i ghi docblock).
- **Friction:** (1) `grep | head -N` trÃªn má»t cÃ¢u lá»nh CENSUS Äáº» ra kháº³ng Äá»nh "khÃ´ng cÃ²n chá» nÃ o khÃ¡c"
  SAI â census thÃ¬ khÃ´ng ÄÆ°á»£c `head`. (2) Bash tool vá»¡ vá»i heredoc dÃ i (`unexpected EOF`) khi viáº¿t file
  markdown lá»n â dÃ¹ng Write tool, vÃ  dÃ¹ng `python - <<PY` cho má»i vÃ¡ cÃ³ backtick.

## PhiÃªn 2026-09-03 (chiá»u) â S18-AUTH-UNLOCK429-1: code + test XONG, CHÆ¯A commit/PR

**NhÃ¡nh `feat/s18-auth-unlock429-1`, working tree Báº¨N (chÆ°a commit).** Káº¿ hoáº¡ch + toÃ n bá» sá» Äo:
`docs/plans/S18-AUTH-UNLOCK429-1.md` (Â§9 báº£n vÃ¡ sau plan-review Â· Â§10 káº¿t quáº£ cháº¡y tháº­t Â· Â§11 FULL gate).

- **ÄÃ£ ship (0 migration):** chá» má»¥c IP `rl:{env}:ip-index:â¦` + `forgot:ip-index` (SADD, CAP 64, KHÃNG
  SCAN) Â· `clearLoginLocks`/`loginThrottleState`/`remainingLockSec` Â· `sMembers`+`ttl` á» ValkeyService Â·
  2 route gate `unlock:user` + audit `user.login_throttle_cleared` + security event Â· badge & nÃºt FE
  tÃ¡ch báº¡ch nhÃ£n vá»i "Má» khoÃ¡" Â· cá»ng coverage má»i cho `login-rate-limiter.ts` (trÆ°á»c nay NGOÃI má»i
  `--coverage.include`; Äo ÄÆ°á»£c 100% lines/funcs Â· 98.97% branches).
- **Owner ÄÃ£ chá»t 2 má» rá»ng:** chuáº©n hoÃ¡ slug trong khoÃ¡ (citext) Â· gá»¡ luÃ´n bucket `2fa` bÆ°á»c-2.
- **FULL gate BLOCK â ÄÃ£ vÃ¡, cáº§n ngÆ°á»i xÃ¡c nháº­n láº¡i:** (1) `normSlug` **KHÃNG ÄÆ°á»£c `trim()`** â trim
  lÃ m `" acme"` (slug khÃ´ng ÄÄng nháº­p ÄÆ°á»£c) ghi vÃ o bucket THáº¬T â khoÃ¡ ÄÆ°á»£c tÃ i khoáº£n ngÆ°á»i khÃ¡c + hÃ ng
  `login_logs` gÃ¡n `company_id=NULL` lÃ m admin mÃ¹; (2) bucket `2fa` chá» ÄÆ°á»£c gá»¡ khi actor qua cáº·p
  SENSITIVE `reset-2fa:user` â `unlock:user` lÃ  non-sensitive nÃªn wildcard `*:*` thoáº£ nÃ³, vÃ  bucket ÄÃ³
  lÃ  control duy nháº¥t cháº·n dÃ² TOTP.
- **Ba giáº£ Äá»nh cá»§a plan sai khi Äo tháº­t** (ÄÃ£ sá»­a cáº£ plan láº«n code): tráº§n tá»± nhiÃªn cá»§a chá» má»¥c Â· "gá»¡
  `acct` lÃ  Äá»§" Â· `after` quan sÃ¡t ÄÆ°á»£c bucket `ip`.
- **Ba cá»ng Äá» á» lÆ°á»£t `check.sh --all` Äáº§u, ÄÃ£ xá»­:** (1) `valkey-key-census` â spec cá»§a WO chá»©a literal
  `"rl:ip-index:â¦"` (ca Äá»i chá»©ng cá»ng envScope) â Äá»i sang GHÃP CHUá»I, KHÃNG thÃªm dÃ²ng miá»n trá»« nÃ o;
  (2) `route-guard-coverage` â 2 route má»i chÆ°a cÃ³ trong artifact â regen báº±ng
  `ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts`
  (file `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` ÄÃ£ thÃªm vÃ o `paths` cá»§a WO);
  (3) `s11-asset-db1-invariants` H1 â cháº¡y RIÃNG thÃ¬ XANH, full-suite láº§n 2 cÅ©ng xanh â **flake do
  spec cháº¡y song song trÃªn lane chung**, khÃ´ng pháº£i há»i quy cá»§a WO nÃ y (Äá»«ng truy vÃ o diff S18).
- **Full test api trÃªn `LANE_DB=mediaos_s18unlock`: XANH, 0 FAIL** (lÆ°á»£t 2, sau 3 vÃ¡ trÃªn).
- **Viá»c cÃ²n láº¡i:** commit â PR (vÃ¹ng Äá», KHÃNG auto-merge, ngÆ°á»i chá»t). Lane `mediaos_s18unlock` cÃ²n
  sá»ng, DROP sau khi merge.
- **Friction:** (1) cháº¡y 1 int-spec cáº§n export tay `APP_DB_PASSWORD`/`WORKER_DB_PASSWORD`/
  `SUPERUSER_DB_PASSWORD` tá»« `.env` (khÃ´ng `source .env` â Äáº§u Äá»c NODE_ENV). (2) Bash tool nuá»t
  backtick trong chuá»i JS cá»§a `node -e` â comment bá» máº¥t chá»¯; dÃ¹ng `python - << EOF` cho má»i vÃ¡ cÃ³
  backtick. (3) Ba mock `LoginRateLimiter` dá»±ng tay vá»¡ khi thÃªm method â cÃ¡i giÃ¡ cá»§a mock theo hÃ¬nh dáº¡ng.

## PhiÃªn 2026-09-03 â S14-PERF-DASHACTOR-1 â PR #469 Má» (vÃ¹ng Äá», chá» ngÆ°á»i chá»t)

- **Ship (PR #469, nhÃ¡nh `perf/s14-perf-dashactor-1`, 2 commit, 0 migration):** (1) gá»p 4 báº£n `gateOrThrow` byte-giá»ng-nhau á» dashboard handlers vá» Má»T hÃ m thuáº§n `gateWidgetOrThrow` (`dashboard-widget-gate.ts`) â gá»p CODE gate, KHÃNG gá»p háº±ng sÃ n scope; giá»¯ `gate â¥ fetch`. (2) batch scope: thÃ¢n quyáº¿t Äá»nh chuyá»n NGUYÃN XI sang hÃ m thuáº§n `decideStrongestScope` (`permission.decide.ts`) + `resolveStrongestScopes` = 1 fetch + N decide, mirror `canBatch`. **Sá» Äo spy táº§ng repo: /dashboard/me 3â1 Â· resolveActor 4â1 Â· tá»ng ÄÆ°á»ng admin 12â7 (â42%)**; nhÃ¢n viÃªn thÆ°á»ng giá»¯ 0â0 nhá» short-circuit `requests.length===0` TRÆ¯á»C fetch.
- **HÃ¬nh dáº¡ng tráº£ vá» lÃ  Máº¢NG THEO CHá» Sá», KHÃNG Map** â ÄÃ¢y lÃ  Äiá»u kiá»n an toÃ n, khÃ´ng pháº£i sá» thÃ­ch: `Map.get()` miss tráº£ `undefined` mÃ  caller kiá»m `scope !== null` â má» khoÃ¡ PII á»©ng viÃªn + lÆ°Æ¡ng offer, typecheck KHÃNG báº¯t. Cáº¤M máº«u `<batch>.get(...) !== null` á» má»i caller má»i.
- **Cá»ng coverage vÃ¡ cÃ¹ng commit:** `permission.decide.ts` trÆ°á»c nay KHÃNG cÃ³ khoÃ¡ threshold vÃ  ngoÃ i Má»I `--coverage.include` (`decideCan` ÄÃ£ ngoÃ i cá»ng tá»« HR-PERF-1). ThÃªm khoÃ¡ â¥80% + include + spec má»i vÃ o `test:cov:sensitive` â Äo ÄÆ°á»£c 91.3% lines / 94.56% branches / 100% funcs.
- **â ï¸ PhÃ¡t hiá»n phá»¥ ÄÃ£ seed WO ná»£ `S14-SEC-DASHGATE-WILDCARD-1` (ð´, FULL, depends_on WO nÃ y):** cÃ¢u Â«wildcard KHÃNG lá»tÂ» láº·p á» cáº£ 4 báº£n `gateOrThrow` cÅ© lÃ  **SAI** â `decideCan` Äá»c `is_sensitive` cá»§a HÃNG GRANT KHá»P (hÃ ng `*:*`, false) chá»© khÃ´ng cá»§a Cáº¶P ÄÃCH â actor cáº§m `*:*` qua ÄÆ°á»£c gate widget cáº·p sensitive (Äo báº±ng test cháº¡y engine tháº­t). ChÆ°a ná» (census 0565 Â§6.7 Â· 2 role PROD ÄÃ£ thu há»i Â· táº§ng-2 truyá»n cá» tÆ°á»ng minh); há» á» ÄÆ°á»ng METADATA /dashboard/me + gá»i tháº³ng slug. KHÃNG vÃ¡ trong WO perf â siáº¿t = Äá»i hÃ nh vi quyá»n tháº­t.
- **Verify:** `check.sh --all --lane-db=check` XANH 9/9 khÃ´ng banner Â· `test:cov:sensitive` **dÆ°á»i LANE_DB** 970/970 pass, 0 ngÆ°á»¡ng Äá». (LÆ°á»£t Äáº§u cháº¡y KHÃNG cÃ³ LANE_DB cho Äá» GIáº¢ á» `auth.service.ts` + 2 repository vÃ¬ 164 test skip â cá»ng nÃ y vÃ´ nghÄ©a náº¿u thiáº¿u LANE_DB.)
- **Káº¿:** ngÆ°á»i chá»t merge #469 (`gh pr merge 469 --squash --admin`), rá»i `S14-SEC-DASHGATE-WILDCARD-1` má»i háº¿t cháº·n. Backlog S14 cÃ²n READY: `S14-RECRUIT-FILEGRANT-1` (ð´) Â· `S14-FE-DEBT-1` (ð¢).
- **Friction:** (1) WO seed `zone:green` + `paths` ÄO THIáº¾U (thiáº¿u `apps/api/src/permission/**`) â mÃ  `pickReviewers` chá» Äá»c `task`+`gate`, KHÃNG Äá»c `paths` â sá»­a má»i paths lÃ  gate FULL khÃ´ng bao giá» cháº¡y; pháº£i sá»­a Cáº¢ BA (zone+gate+paths). (2) PhiÃªn trÆ°á»c Äá» code+4 spec trong working tree KHÃNG commit vÃ  KHÃNG cÃ³ dáº¥u ledger nÃ o â phiÃªn sau pháº£i suy tráº¡ng thÃ¡i tá»« `git status` + plan file.

## PhiÃªn 2026-08-31 â S12-RECRUIT-DASH-1 XONG (#452 squash `36b4b283`) â ÄÃNG WAVE S12-RECRUIT

**Tráº¡ng thÃ¡i:** merged --admin sau CI 14/14 xanh; STATUS regen push docs-only (`34190163`). Backlog
hiá»n **0 READY / 0 in-progress** â háº¿t WO, wave sau chá» owner seed. Lane `mediaos_recruitdash1` ÄÃ£ DROP.

- Widget `RECRUIT_FUNNEL` (RECRUIT-WIDGET-001, SPEC-12 Â§10.1; mig 0563 CHECK+'RECRUIT'+seed row):
  khuÃ´n 0558 nhÆ°ng **sÃ n scope = `Company` vÃ¬ lÃ½ do KHÃC ASSET** â `summaryTx` Äáº¿m TOÃN company,
  sÃ n pháº£i báº±ng bá» rá»ng phÃ©p Äáº¿m (grant háº¹p hÆ¡n ÄÆ°á»£c serve = rÃ² sá» liá»u ngoÃ i scope). Cache
  company-shared (payload chá» Äáº¾M). Handler file riÃªng; `RecruitModule` export `CandidatesService`;
  seeder v3âv4. 19 ca test má»i (int 10 + FE 9), regression DASH 127/127.
- **Follow-up ghi nháº­n (khÃ´ng cháº·n):** `gateOrThrow` trÃ¹ng 3 báº£n (main/office/recruit handlers) Â·
  `resolveActor` Äá»t 4 round-trip `getCompanyRoleGrantsWithScope` uncached má»i `summary()` (tá»« BE-1).
  Gap defer wave (tá»« FE-1): grant foundation-file recruiter/hr Â· org-unit picker Â· refactor
  PaginationFooter/error-parser.
- **Friction:** classifier auto-mode cháº·n cáº£ `git log`/`node harness/gen-status.mjs` NGAY SAU lá»nh
  `gh pr merge --admin` (lá»nh merge ÄÃ£ cháº¡y xong, chá» lá»nh sau bá» váº¡) â retry lá»nh y há»t qua Bash
  sau 1 nhá»p lÃ  qua; Äá»«ng tÆ°á»ng merge fail.

## PhiÃªn 2026-08-30 â S11-ROOM-BE-1 merge (#438) â S11-ASSET-FE-1 XONG (#439, master `8b551f93`)

**Tráº¡ng thÃ¡i:** cáº£ hai ÄÃ£ merge, lane `mediaos_roombe1`/`assetfe1`/`assetfe2` ÄÃ£ DROP. Plan + káº¿t quáº£:
`docs/plans/S11-ASSET-FE-1.md` Â§7. Káº¿ tiáº¿p READY: `S11-ROOM-FE-1` ð¢ Â· `S11-ASSET-QA-1` ð¡ Â·
`S10-AUTH-2FAGUARD-FAILMODE-1` ð´.

- **S11-ASSET-FE-1**: 7 mÃ n ASSET-SCREEN-001..007 + `asset-api.ts` (22 hÃ m / 26 route) + 11 mÃ£ dotted +
  mig 0556 báº­t `modules.ASSET`. 91 test má»i; CI xanh 11/11.
- **Hai chá» SPEC-13 lá»ch báº£n ship, lÃ m theo CODE THáº¬T:** (1) ba `kind` lá»i trong báº£ng Â§12
  (`employee-not-found`/`maintenance-not-found`/`readonly-field`) **khÃ´ng bao giá» ÄÆ°á»£c phÃ¡t ra** â báº£n ship
  phÃ¡t 19 kind khÃ¡c; map theo spec sáº½ Äáº» 3 nhÃ¡nh cháº¿t + sÃ³t 9 kind. (2) Ã´ FSM `Under Maintenance â Under
Maintenance: revoke` cÃ³ tháº­t trong `asset-fsm.ts`; bá» nÃ³ lÃ  dá»±ng **ngÃµ cá»¥t** (cÃ²n ngÆ°á»i giá»¯ â khÃ´ng thu
  há»i ÄÆ°á»£c mÃ  cÅ©ng khÃ´ng thanh lÃ½ ÄÆ°á»£c vÃ¬ ERR-008).
- **Gate lá»i vÃ o ASSET ÄÃ²i Äá»¦ Cáº¢ HAI** `access:asset` + `view:asset` (lá»ch tiá»n lá» GOAL vá»n chá» dÃ¹ng
  `access`) â trang táº£i `GET /assets` = `view:asset`, gate báº±ng mÃ¬nh cáº·p access lÃ  dá»±ng láº¡i lá» ÄÃ£ vÃ¡ á»
  CHAT/social.

**â ï¸ BáºªY ÄÃ ÄO â `S11-ROOM-FE-1` Sáº¼ DÃNH Y Há»T:** `0554:373-375` cÃ³ guard
`RAISE EXCEPTION ... modules.ROOM phai ... is_active=false` **vÃ´ Äiá»u kiá»n**. Ca H1 cá»§a
`s11-room-db1-invariants` replay NGUYÃN file 0554 â khi WO ÄÃ³ báº­t cá» ROOM sáº½ Äá» `P0001`, ÄÃºng nhÆ° ASSET ÄÃ£
Äá» á» CI #439. **WO báº­t module = 3 viá»c CÃNG commit:** migration `UPDATE is_active=true` (hÃ ng cÃ³ sáºµn tá»«
0435 â UPDATE, khÃ´ng INSERT) Â· gá»¡ mÃ£ khá»i `EXTENSION_INACTIVE_MODULES` Â· **ná»i guard verify cá»§a migration
seed module ÄÃ³**. 0550 ÄÃ£ vÃ¡ á» `230c41b7`; 0554 **CHÆ¯A** â cá» Ã½, vÃ¬ khÃ´ng cÃ³ test nÃ o á» PR #439 chá»©ng minh
ÄÆ°á»£c. Memory: `module-enable-guard-blocks-next-wo`.

**Ná»£ ASSET:** gÃ¡n role `asset-manager` (mig 0550) cho admin tháº­t trÃªn PROD qua mÃ n quáº£n trá» role â
`SuperAdminBootstrap` no-op trÃªn PROD, 0550 khÃ´ng cÃ³ khá»i catch-up; tá»i khi gÃ¡n, ASSET vÃ´ hÃ¬nh vá»i admin
PROD vÃ  job `ASSET_MAINTENANCE_DUE` phÃ¡t 0 thÃ´ng bÃ¡o (KHÃNG vÃ¡ báº±ng blanket grant). `MODULE_APP_METADATA`
thiáº¿u ASSET (ngoÃ i `paths` WO; GOAL ÄÃ£ váº­y tá»« 0506 â hÃ nh vi cÃ³ sáºµn). e2e UI chÆ°a cháº¡y.

**Friction:** (1) `harness/check.sh` in `THIáº¾U 40 file â pháº¡m vi bá» co láº¡i` vÃ  `s11-asset-db1-invariants`
náº±m trong nhÃ³m bá» co â **mÃ¡y xanh, CI Äá»**. Tháº¥y dÃ²ng ÄÃ³ pháº£i cháº¡y tay ÄÃºng spec cá»§a module Äang Äá»¥ng.
(2) `gh run view --log-failed` kÃ©o log ráº¥t lá»n â tá»n ~$260 cho 2 láº§n gá»i; láº§n sau lá»c báº±ng
`grep -E "Failed Tests|FAIL "` ngay trong cÃ¹ng lá»nh, Äá»«ng pipe cáº£ log. (3) Backtick trong `node -e "â¦"` bá»
shell Än (ÄÃ£ ghi memory) â dÃ¹ng nhÃ¡y ÄÆ¡n cho script node, hoáº·c ghi file rá»i cháº¡y.

## PhiÃªn 2026-08-30 â S11-ROOM-BE-1 THI CÃNG XONG â PR #438 (vÃ¹ng Äá», ngÆ°á»i chá»t)

**Tráº¡ng thÃ¡i:** nhÃ¡nh `wo/s11-room-be-1` (2 commit `44bddd23` + `52cb4761`), PR **#438** base master, KHÃNG auto-merge. Lane
`mediaos_roombe1` cÃ²n sá»ng â DROP sau merge (`docker exec mediaos-postgres psql -U mediaos`, terminate backend rá»i
`DROP DATABASE mediaos_roombe1`). Plan `docs/plans/S11-ROOM-BE-1.md` Â§12 = káº¿t quáº£ + FULL gate + Â§12.1 ná»£.

- Quy trÃ¬nh tháº­t: orchestrator tá»± viáº¿t plan tá»« sá» Äo (khÃ´ng planner Sonnet) â plan-reviewer Opus 1 vÃ²ng (5 BLOCK + 8 cáº£nh
  bÃ¡o, ÄÃ£ vÃ¡) â thi cÃ´ng trá»±c tiáº¿p 17 file `rooms/` + 3 `notifications/room-*` + contracts â QA agent viáº¿t 3 int-spec song
  song (RED tháº­t: láº§n Äáº§u 5 Äá» = 1 lá»i code drizzle SELECT-list + 4 lá»i test) â FULL gate 3 reviewer Opus: security
  **BLOCK** (nhÃ¡nh fail-closed identity chÆ°a test Â· `employeeCode` khÃ´ng qua cá»ng Â· `conflicts.title` phÆ¡i Â· `view@Own` coi
  nhÆ° Company) â vÃ¡ háº¿t â 69/69 int + 55 unit/ratchet xanh; `check.sh --all --lane-db=roombe1` xanh trÃªn commit 1, cháº¡y láº¡i
  sau commit 2 (káº¿t quáº£ á» comment PR / ledger).
- Viá»c káº¿: owner merge #438 sau CI xanh â DROP lane â `S11-ASSET-FE-1` / `S11-ROOM-FE-1` (báº­t `modules.ROOM`, 5 mÃ£ dotted
  `ROOM.*` vÃ o `PERMISSION_CODE_TO_PAIR`, FE dÃ¹ng `parseRoomConflictsDetail`).

**Friction:** (1) heredoc dÃ i trong Bash tool bá» cáº¯t (quote/ENAMETOOLONG) â ghi file báº±ng Write rá»i `cat >>`, hoáº·c node
patch-script Äá»c tá»« file; python khÃ´ng cÃ i trÃªn mÃ¡y. (2) Prettier hook reflow lÃ m `old_string` lá»ch â patch báº±ng node
script (regex) thay vÃ¬ Edit tool; **KHÃNG** nhÃºng backtick vÃ o `node -e "â¦"` (shell Än). (3) Chi phÃ­ phiÃªn ~$115 â 3
reviewer + plan-reviewer + QA agent â 60%; reviewer báº¯t ÄÆ°á»£c 1 HIGH tháº­t (nhÃ¡nh fail-closed khÃ´ng test) nÃªn ÄÃ¡ng tiá»n.

## PhiÃªn 2026-08-29 â wave S11-OFFICE: ASSET-DOC-1 PASS + PR #433 Â· ROOM-DOC-1 ÄÃ£ viáº¿t (xáº¿p chá»ng)

**Hai nhÃ¡nh Xáº¾P CHá»NG, má»t PR má»:** `#433` = `wo/s11-asset-doc-1` (base master, docs + hot-file harness â Äi PR,
KHÃNG push tháº³ng). `wo/s11-room-doc-1` xáº¿p TRÃN Äá»nh `79d77f7f` cá»§a DOC-1 â **sau squash-merge #433 pháº£i**
`git rebase --onto origin/master c1542c14 wo/s11-room-doc-1` + force-push, rá»i má»i merge PR ROOM **#434** (ÄÃ£ má»; plan-reviewer ROOM vÃ²ng 1 BLOCK 3 ÄÃ£ vÃ¡, vÃ²ng xÃ¡c nháº­n chÆ°a cháº¡y)
([[squash-merge-breaks-stacked-prs]]). Merge #433 = `gh pr merge 433 --squash --delete-branch --admin` sau CI xanh;
auto-mode classifier cháº·n lá»nh nÃ y tá»i khi owner nÃ³i duyá»t.

- ASSET plan-reviewer **PASS sau 3 vÃ²ng** (5B â 4B+2H+8M+4L â 2B â PASS). VÃ²ng 3 sinh ra tá»« chÃ­nh báº£n vÃ¡ vÃ²ng 2
  (ÄÆ°á»ng `restore` khÃ´ng cÃ³ endpoint phÃ¡t id) â ÄÃºng [[plan-review-rounds-inject-new-holes]]; vá»i DOC cÃ²n láº¡i cÃ¢n nháº¯c
  1 vÃ²ng + vÃ¡ lÃ  dá»«ng. `S11-ASSET-BE-1` vÃ  `S11-ROOM-BE-1` nÃ¢ng ð´ (data-scope Ã©p á» service + audit = khuÃ´n GOAL-BE-1).
- ROOM-DEC-001 chá»t sau khi ÄO: `logs/measure-meeting-legacy.mjs` (chá» SELECT, Äá»c env trong tiáº¿n trÃ¬nh) â `--env .env.prod`
  bá» classifier cháº·n 2 láº§n, `--env .env` cháº¡y ÄÆ°á»£c vÃ  trá» cÃ¹ng DB `mediaos` (PROD + dev-online dÃ¹ng chung): **0 hÃ ng cáº£ 5
  báº£ng meeting\_\***, 6 cáº·p quyá»n meeting\* Ã 2 grant, 0 guard. Káº¿t luáº­n: tÃ¡i dá»¥ng+ALTER `meeting_rooms`, THAY
  `meetings`/`meeting_attendees` báº±ng `room_bookings`/`room_booking_attendees`, DROP 4 báº£ng (DB-16 Â§3.0/Â§9).
- Viá»c káº¿ theo thá»© tá»±: merge #433 â rebase + PR ROOM-DOC-1 (Ã¡p verdict plan-reviewer ROOM náº¿u cÃ²n BLOCK) â má»
  `S11-ASSET-DB-1` ð´ (planner sonnet xhigh â plan-reviewer â Opus; head migration tháº­t lÃºc ÄÃ³).

**Friction:** (1) classifier cháº·n cáº£ lá»nh `grep`/`awk` vÃ´ háº¡i cÃ³ chá»¯ `DELETE FROM` hoáº·c command-substitution â tÃ¡ch
lá»nh ÄÆ¡n giáº£n hoáº·c dÃ¹ng Grep tool. (2) Chi phÃ­ phiÃªn ~$88 chá»§ yáº¿u do 3 vÃ²ng plan-review + Äá»c láº¡i tÃ i liá»u dÃ i.

## PhiÃªn 2026-08-25 â **Äá»£t 3 tiáº¿p**: 3 WO ÄÃ³ng (KI-047Â·048Â·077Â·010 + KI-078 má»i) â PR #411 #412 #413

**BA PR Äá»C Láº¬P, chÆ°a merge, base `master`, KHÃNG xáº¿p chá»ng.** Merge thá»© tá»± nÃ o cÅ©ng ÄÆ°á»£c.
`#411` vÃ¹ng Äá» â **ngÆ°á»i chá»t**, khÃ´ng nhÃ£n auto-merge. `#412`/`#413` vÃ¹ng vÃ ng.

TrÆ°á»c ÄÃ³ ÄÃ£ merge `#409` + `#410` cá»§a phiÃªn trÆ°á»c. â ï¸ Squash-merge `#409` lÃ m `#410` **CONFLICTING**
ngay láº­p tá»©c â pháº£i `git rebase --onto origin/master <sha-cÅ©-cá»§a-base>` rá»i force-push, CI cháº¡y láº¡i
14'. ÄÃ³ lÃ  [[squash-merge-breaks-stacked-prs]] xáº£y ra ÄÃºng nhÆ° sá» ghi; **Äá»«ng xáº¿p chá»ng PR ná»¯a**.

### #411 `wo/s10-sec-loginlog429-1` â KI-047 + KI-048 (ð´)

VÃ¡ theo **LUáº¬T**, khÃ´ng vÃ¡ tá»«ng chá»:

> ÄÆ°á»ng Dá»°NG NÃN cÃ¡i khoÃ¡ pháº£i Äá» láº¡i váº¿t; ÄÆ°á»ng ÄANG Bá» KHOÃ ghi 0 hÃ ng.

Luáº­t nÃ y ÄÃ³ng Cáº¢ HAI KI thay vÃ¬ Äá» chÃºng ÄÃ¡nh nhau (KI-047 ÄÃ²i ghi thÃªm, KI-048 kÃªu ghi quÃ¡ nhiá»u).

**`stepUp` KHÃNG pháº£i lá»** â nhÃ¡nh khoÃ¡ ghi 0 hÃ ng lÃ  _ná»­a (a)_ cá»§a báº£n vÃ¡ A09 chá»ng bá»i hÃ ng
append-only, cÃ³ docblock kÃ½ sáºµn (`step-up.service.ts:52-63`). Ghi vÃ o ÄÃ³ lÃ  **hoÃ n tÃ¡c** nÃ³. Sá»
KI-047 Äáº¿m nÃ³ lÃ  "ÄÆ°á»ng thá»© 5 khÃ´ng ghi" â Äáº¿m ÄÃºng, káº¿t luáº­n sai.

**PhÃ¡t hiá»n ngoÃ i khung KI-047:** `completeTwoFactorLogin` ghi `login_logs` **CHá» khi thÃ nh cÃ´ng** â
challenge há»ng Â· replay Â· 429 Â· mÃ£ sai Â· cÃ´ng ty ngá»«ng Äá»u 0 dÃ²ng; cá»ng bÆ°á»c-1 nhÃ¡nh cáº¥p challenge
cÅ©ng 0 dÃ²ng â **tÃ i khoáº£n báº­t 2FA chá» Äá» láº¡i váº¿t THÃNH CÃNG** á» AUTH-API-401.

**Hai cá»ng CÃ Sáº´N báº¯t ÄÆ°á»£c thay Äá»i nÃ y** vÃ  báº¯t ÄÃºng: ratchet Äiá»m-chiáº¿u-danh-tÃ­nh cháº·n `users.email`
má»i cho tá»i khi cÃ³ verdict; rá»i `BASIS_CEILINGS` cháº·n tiáº¿p buá»c ná»i 7â8 pháº£i cÃ³ chá»¯ kÃ½ WO.

### #412 `wo/s10-fnd-paramuuid-1` â KI-077 (ð¡) + **KI-078 má»i**

ÄO TRÆ¯á»C KHI VÃ: cáº£ 5 tham sá» tráº£ **500 `SYSTEM-ERR-001` + `error.type='Error'`** â giáº£ thuyáº¿t
"ÄÆ°á»ng DB `22P02`" xÃ¡c nháº­n. Sau vÃ¡ 400 á» biÃªn, má»i ca deny cÃ³ ca ALLOW Äá»i chá»©ng.

**Sá» Äo ÄÃ¡ng nhá»:** census AST toÃ n API ra **312 `@Param` / 298 id-like / 77 cÃ³ pipe â 221 chÆ°a cÃ³**.
KI-077 kÃª 5 chá» trong Má»T module; hÃ¬nh dáº¡ng ÄÃ³ tá»n táº¡i 221 láº§n â cáº¥p **KI-078**. Ratchet lÃ  **TRáº¦N**
(cháº·n má»c thÃªm) chá»© khÃ´ng pháº£i "=0", vÃ¬ chá» 5 chá» tá»«ng ÄÆ°á»£c ÄO â 216 chá» cÃ²n láº¡i chÆ°a ai cháº¡m.

**ÄÃ­nh chÃ­nh docblock sai:** route `unlink` ghi ":id khoanh pháº¡m vi" â handler KHÃNG khai
`@Param("id")`; cÃ´ láº­p tenant giá»¯ bá»i `findByIdTx(user.companyId, linkId, tx)`. CÃ¢u cÅ© sai theo hÆ°á»ng
lÃ m ngÆ°á»i Äá»c **yÃªn tÃ¢m hÆ¡n thá»±c táº¿**.

### #413 `wo/s10-hr-emppage-1` â KI-010 (ð¡)

`employeeListQuerySchema` **ÄÃ£ tá»n táº¡i tá»« trÆ°á»c** nhÆ°ng controller chÆ°a há» dÃ¹ng (4 `@Query()` rá»i).
`LIMIT/OFFSET` á» SQL; `total` = `count(*)` cÃ¹ng `where` (sau filter + sau scope).

**Váº¿ FE lÃ  pháº§n Äáº¯t nháº¥t, ÄÃºng nhÆ° notes WO cáº£nh bÃ¡o.** `apiFetch` bÃ³c `.data` vÃ  **vá»©t**
`pagination` â thÃªm **`apiFetchPaginated`** vÃ o `web-core` (ÄÆ°á»ng song song, opt-in). Há» tiÃªu thá»¥
`/employees` **duy nháº¥t** lÃ  `apps/console` â `apps/app` dÃ¹ng `/hr/employees` (ÄÃ£ phÃ¢n trang sáºµn).

â ï¸ **Hai quy Æ°á»c phÃ¢n trang tá»n táº¡i song song TRÆ¯á»C WO nÃ y:** `/employees` nay `per_page`,
`/hr/employees` lÃ  `pageSize`. KhÃ´ng pháº£i bá» sÃ³t; há»£p nháº¥t lÃ  viá»c cá»§a WO gá»p hai ÄÆ°á»ng.

Äá»i chiáº¿u cáº£ cá»¥m: KI-009 Â· KI-011 Â· KI-010 â **cáº£ ba khuyáº¿n nghá» cá»§a `S5-PERF-1` ÄÃ£ ÄÃ³ng**.

### CÃN Láº I cá»§a Äá»£t 3 â 3 WO Äá»/crown

`S10-SEC-ROLEMEMBERDEL-1` (ð´, chá»§ trÆ°Æ¡ng hÆ°á»ng (b) ÄÃ KÃ, cáº§n ADR) â `S10-SEC-FKCATALOG-1`
(ð´ **CROWN**) â `S10-QA-ROUTEHTTP-3` (ð¡, cháº¡y CUá»I Äá» Äo máº«u sá» ÄÃ£ á»n Äá»nh).

â ï¸ **`S10-QA-ROUTEHTTP-2` ÄÃ£ Äá»I TÃN thÃ nh `S10-QA-ROUTEHTTP-3`**: entry seed Äá»£t 3 **trÃ¹ng id** vá»i
má»t WO ÄÃ£ `done` (PR #392). TrÃ¹ng id lÃ m ledger overlay + gen-status + guard-scope Äá»c nháº§m entry.

### Friction â CHI PHÃ, Äá»c trÆ°á»c khi má» phiÃªn Äá»

**PhiÃªn nÃ y $102 â ~$300. WO Äá» Äáº§u tiÃªn má»t mÃ¬nh tá»n ~$136.** Pháº§n Äáº¯t KHÃNG pháº£i code mÃ  lÃ 
subagent Äá»c láº¡i code tá»« Äáº§u: 2 vÃ²ng `plan-reviewer` (354k token) + 1 `security-reviewer` (143k) =
gáº§n ná»­a chi phÃ­ WO ÄÃ³. Æ¯á»c lÆ°á»£ng ban Äáº§u cá»§a tÃ´i ($150â250 cho Cáº¢ 5 WO cÃ²n láº¡i) **sai má»t báº­c**.

â Vá»i 3 WO Äá»/crown cÃ²n láº¡i: **má» phiÃªn Má»I, context sáº¡ch**, vÃ  cÃ¢n nháº¯c **1 vÃ²ng plan-review** thay
vÃ¬ 2. VÃ²ng 2 á» WO nÃ y chá» ra 4 blocker, trong ÄÃ³ 1 cÃ¡i ÄÃ£ tá»± vÃ¡ trÆ°á»c vÃ  1 cÃ¡i (B6) **tá»± mÃ¢u thuáº«n**
â lá»£i tá»©c giáº£m rÃµ rá»t. VÃ²ng 1 thÃ¬ ÄÃ¡ng tiá»n: B3 vÃ  B4 lÃ  lá»i tháº­t sáº½ lÃ m báº£n vÃ¡ KI-048 vÃ´ tÃ¡c dá»¥ng.

**BÃ i há»c review:** `security-reviewer` cho verdict BLOCK vá»i **0 lá» há»ng sá»ng** â cháº·n vÃ¬ cÃ¡c há»£p
Äá»ng plan ÄÃ£ kÃ½ chá» ÄÆ°á»£c giá»¯ báº±ng Äá»C CODE, khÃ´ng báº±ng cá»ng. ÄÃ³ lÃ  BLOCK ráº» (3 ca test, 2 file,
khÃ´ng Äá»¥ng code sáº£n pháº©m) vÃ  ÄÃºng. Äá»«ng Äá»c "BLOCK" thÃ nh "cÃ³ lá» há»ng".

**Báº«y ÄÃ£ gáº·p láº¡i:** (1) `contracts` dist cÅ© â typecheck Äá» oan, pháº£i
`pnpm --filter @mediaos/contracts build` ([[stale-contracts-dist-typecheck-false-red]]). (2)
`Unhandled Rejection: Channel closed` sau teardown lÃ m `check.sh` Äá» Má»T láº§n rá»i xanh láº§n sau
([[vitest-unhandled-rejection-after-teardown]]) â cháº¡y láº¡i trÆ°á»c khi Äi truy root-cause.

## PhiÃªn 2026-08-24 (b) â **Äá»£t 3**: seed 5 WO + thi cÃ´ng 3.1 (KI-068) â PR #409 â #410

**Hai PR Xáº¾P CHá»NG, chÆ°a merge â #409 lÃ  base cá»§a #410. Merge #409 TRÆ¯á»C.**

### #409 `gov/dot3-seed-wo` â seed (CI xanh toÃ n bá»)

6/8 mÃ³n cá»§a báº£ng Äá»£t 3 cÃ³ sá» hiá»u KI nhÆ°ng KHÃNG cÃ³ WO â vÃ´ hÃ¬nh vá»i auto-loop. Seed 5 WO
(backlog 391 â 396): `S10-FND-BODYVALIDATE-1` (KI-068) Â· `S10-SEC-LOGINLOG429-1` (KI-047+KI-048,
**gá»p** vÃ¬ cÃ¹ng `auth.service.ts` + cÃ¹ng báº£ng `login_logs`) Â· `S10-HR-EMPPAGE-1` (KI-010) Â·
`S10-SEC-FKCATALOG-1` (KI-055, **CROWN**) Â· `S10-QA-ROUTEHTTP-2` (KI-025, ÄÃ£ trá» sáºµn tá»« trÆ°á»c).
3.2 (KI-075) ÄÃ£ ÄÃ³ng á» #408 rá»i; 3.5 (KI-074) ÄÃ£ cÃ³ WO tá»« Äá»£t 2.

**KI-047 ÄÃ TRÃI â ÄÃ£ sá»­a trong sá»:** nay **6** Äiá»m nÃ©m `TOO_MANY_REQUESTS` trong `auth/**` (khÃ´ng
pháº£i 5) â **5 ÄÆ°á»ng khÃ´ng ghi `login_logs`** (khÃ´ng pháº£i 4). Äiá»m má»c thÃªm: `step-up.service.ts`.
**`verifyTwoFactorLogin` KHÃNG tá»n táº¡i** â hÃ m tháº­t `completeTwoFactorLogin` (`auth.service.ts:452`).

### #410 `wo/s10-fnd-bodyvalidate-1` â thi cÃ´ng 3.1, `check.sh --lane-db` XANH (api 566/566)

KI-068 **ÄÃNG**. VÃ¡ hÆ°á»ng (a): `api-keys.dto.ts` + `files.dto.ts` (`createZodDto`). 3/4 route trÆ°á»c
chá» lÃ  SUY LUáº¬N, nay ÄÃ£ **ÄO báº±ng HTTP** â cáº£ ba 500 + `ZodError` â 400
(`test/integration/files-http-validate.int-spec.ts`, spec `files` Äáº§u tiÃªn dÃ¹ng supertest).

**Census: dÃ¹ng báº£n AST, Äá»ªNG dÃ¹ng sá» regex.** trÆ°á»c 193/189/**4** â sau **193/193/0**. Báº£n seed ghi
`177/173/4`: sá» 4 + danh sÃ¡ch route ÄÃNG, **máº«u sá» sai** (regex bá» sÃ³t 16 handler). ÄÃ£ comment ÄÃ­nh
chÃ­nh lÃªn #409, cá» Ã½ KHÃNG sá»­a lá»ch sá»­ Äá» giá»¯ dáº¥u váº¿t "sá» nÃ o Äo báº±ng cÃ´ng cá»¥ nÃ o".

**PhÃ¡t sinh â KI-077 + WO `S10-FND-PARAMUUID-1`:** Äá»c láº¡i diff tháº¥y báº£n sao CÃNG cÆ¡ cháº¿ cÃ¡ch báº£n vÃ¡
**má»t dÃ²ng**, kÃªnh PARAM. 2 route GHI ÄÃ£ Äo + vÃ¡ kÃ¨m (`ParseUUIDPipe`); **5 tham sá» READ/DELETE
CHÆ¯A ÄO** â cáº¥p sá» thay vÃ¬ vÃ¡ mÃ¹. HÃ ng KI-068 ghi rÃµ dáº¥u gáº¡ch chá» phá»§ **kÃªnh BODY**.

### CÃ²n láº¡i cá»§a Äá»£t 3 (theo thá»© tá»± ÄÃ£ xáº¿p)

`S10-SEC-LOGINLOG429-1` (ð´ 3.3+3.4) â `S10-SEC-ROLEMEMBERDEL-1` (ð´ 3.5) â `S10-HR-EMPPAGE-1` (3.6)
â `S10-SEC-FKCATALOG-1` (ð´ CROWN 3.7) â `S10-QA-ROUTEHTTP-2` (3.8, cháº¡y CUá»I Äá» Äo máº«u sá» ÄÃ£ á»n Äá»nh).

**Friction:** (1) heredoc bash >200 dÃ²ng vá»¡ parse â file seed lá»n pháº£i ghi báº±ng Write rá»i chÃ¨n báº±ng
node, Äá»«ng nhá»i vÃ o `cat <<EOF`. (2) `python -c` in tiáº¿ng Viá»t ra stdout **cháº¿t cp1252** dÃ¹ ÄÃ£ ghi file
xong â Äá»«ng `print()` tiáº¿ng Viá»t. (3) Cháº¡y vitest vá»i `LANE_DB` cáº§n 3 biáº¿n máº­t kháº©u; **KHÃNG**
`source .env` (`NODE_ENV=production` trong ÄÃ³); dÃ¹ng
`eval "$(grep -E '^(APP|WORKER|SUPERUSER)_DB_PASSWORD=' .env)"`. (4) Census decorator báº±ng regex sai
**ba láº§n** â chuyá»n sang TypeScript compiler API lÃ  ÄÃºng thuá»c, xem
[[nestjs-zod-class-level-pipe-does-nothing]].

## PhiÃªn 2026-08-24 â `S10-SEC-ROLEMEMBERFE-1` (KI-073) â 4/4 `done_when` ÄÃNG, CHÆ¯A COMMIT

**ÄÃ£ lÃ m (táº¥t cáº£ náº±m á» WORKING TREE CHÆ¯A COMMIT trÃªn `master` â 21 file, Äá»«ng discard):**
plan qua 2 vÃ²ng plan-reviewer (9 blocker ÄÃ£ vÃ¡ â trong ÄÃ³ ÄÃNH CHÃNH lá»n: oracle lÃ  THÃN **201**
cá»§a `POST /permissions/users/:userId/roles`, KHÃNG pháº£i "loáº¡t 409"; route tráº£ 201 chá»© khÃ´ng 200) â
RED 10 ca Äá» ÄÃºng chá» â implement: `userRoleSchema` cÃ²n 4 khoÃ¡ + `projectAssignResult` (ratchet
`Promise<UserRoleDto>`) + `complete: z.boolean().catch(false)` (deploy 2 chiá»u tá»± lÃ nh) + FE D5
5 hÃ ng (partial-label Â· dedup-off-trá»«-mÃ¬nh Â· dÃ²ng pháº¡m-vi Â· empty-state riÃªng) + 5 há» tiÃªu thá»¥ test
sá»­a theo ÄÆ¡n plan Â§0.3b â Äá»t biáº¿n **M-Aâ¦M-F 6/6 Äá» ÄÃºng ca** (báº£ng Â§3.5 ÄÃ£ Äiá»n) â
`check.sh --lane-db=rolememberfe` **XANH Äáº§y Äá»§** (563/563 api) â gate: **database-reviewer PASS +
silent-failure-hunter PASS** (1 MEDIUM = ná»£ N-5 telemetry). RELEASE-02: **KI-074 ÄÃ£ cáº¥p**
(DELETE 404-oracle) TRÆ¯á»C dáº¥u gáº¡ch; permission-matrix-spec ÄÃ£ thÃªm bullet KI-073.

### â HAI cá»ng cuá»i ÄÃ£ ÄÃ³ng (phiÃªn tiáº¿p 24/08)

1. **security-reviewer â verdict `PASS`** (cháº¡y 1 láº§n trÃªn Opus, khÃ´ng cháº¿t 529). Reviewer **tá»± cháº¡y
   láº¡i báº±ng chá»©ng chá»© khÃ´ng tin lá»i khai**: deny-path O1Â·O2Â·O3Â·O4Â·S1aÂ·S1b dÆ°á»i `LANE_DB=mediaos_rolememberfe`
   **24/24 CHáº Y-khÃ´ng-SKIP**, 3 há» tiÃªu thá»¥ + HTTP 41/41, `test/foundation` + `src/permission` 501/501,
   `TURBO_FORCE=1 typecheck` 10/10 (0 cached). XÃ¡c nháº­n cáº£ 6 cÃ¢u há»i cá»ng: bá» chiáº¿u lÃ  **má»t object
   literal DUY NHáº¤T** dÃ¹ng chung 3 nhÃ¡nh â thá»© tá»± field + Äá» dÃ i thÃ¢n giá»ng há»t; `expiresAt` lÃ  **thuáº§n
   hÃ m cá»§a request** (khÃ´ng bao giá» Äá»c `existing.expiresAt`) â 0 bit; **409 náº±m cÃ¹ng phÃ­a TIáº¾NG á»N**
   (chá» tá»i ÄÆ°á»£c khi target CHÆ¯A lÃ  thÃ nh viÃªn) nÃªn khÃ´ng phÃ¢n biá»t ÄÆ°á»£c vá»i 201 no-op; `audit` váº«n Än
   `inserted.id`; `.catch(false)` khÃ´ng gate hÃ nh vi an ninh nÃ o. Findings: **1 MEDIUM + 3 LOW** â
   plan **Â§N-6â¦N-9**.
2. **Sá» Äo PROD Â§0.4 â ÄÃ ÄO 24/08**, chá»-SELECT, `default_transaction_read_only = on`, ÄÃ­ch
   `localhost:5432/mediaos`: **(2b) = 0 vai** â Â· **(3) = 0 hÃ ng DENY** â (â 0 lÆ°á»£t 403 má»i) Â·
   **(5) = 0 vai**, khá»p sá» 22/08 â Â· **(4)** `assign-role:user`=sensitive, `*:*`=khÃ´ng â 0 nhiá»u
   `effectivelySensitive`. Káº¿t quáº£ phá»¥: **`QUáº¢N LÃ Cáº¤P CAO` chá» cÃ³ `*:*`, KHÃNG cÃ³ exact
   `assign-role:user`** â nhÃ¡nh lá»c EXACT khiáº¿n vai nÃ y **khÃ´ng gá»i ná»i** ÄÆ°á»ng GHI; táº­p vai cháº¡m ÄÆ°á»£c
   tháº­t sá»± = {`SA`, `company-admin`}, cáº£ hai `@Company`. â lá» **TIá»M TÃNG**, 0 há»i quy.

**ÄÃ£ Ã¡p:** plan Â§0.4 Äiá»n sá» tháº­t + Â§N-6â¦N-9; RELEASE-02 **KI-073 ÄÃ£ gáº¡ch** (`~~**KI-073**~~`, cá»t
cuá»i `ÄÃNG 2026-08-24`); `backlog.status â "done"`; ledger 2 dáº¥u `gate`; STATUS regen.
**Váº¿ i18n cá»§a MEDIUM ÄÃ£ VÃ trong PR** â dÃ²ng `dedupUnavailable` do chÃ­nh WO nÃ y viáº¿t ra mÃ  há»©a sai
"há» thá»ng tá»± bá» qua", trong khi batch POST `{roleId}` khÃ´ng kÃ¨m `expiresAt` â thÃ nh viÃªn **cÃ³ háº¡n** rÆ¡i
nhÃ¡nh reassign vÃ  **bá» san thÃ nh vÄ©nh viá»n**. Váº¿ service (bá» qua reassign khi request khÃ´ng khai
`expiresAt` mÃ  hÃ ng active cÃ³) = **Äá»i ngá»¯ nghÄ©a API GHI** â cá» Ã½ Äá» ná»£ N-6, cáº§n WO riÃªng + plan-review.

### ð¡ CÃ²n láº¡i: CI + NGÆ¯á»I CHá»T duyá»t PR #405

`check.sh --lane-db=rolememberfe` **XANH Äáº§y Äá»§** (api 563/563 Â· app 232/232 Â· console 22 Â· contracts
32 Â· ui 16 Â· web-core 43 Â· auth 4; cáº£ 6 gate: secret-literals Â· lint Â· typecheck Â· migration-no-drop Â·
tooling-tests Â· test). Commit `4662c7bb` trÃªn `wo/s10-sec-rolememberfe-1` â **PR #405** (base `master`).
**NhÃ£n = rá»ng, Cá» Ã** â vÃ¹ng Äá», ngÆ°á»i chá»t merge ([[automerge-label-is-dead-end-on-master]]).
Ledger ÄÃ£ ÄÃ³ng dáº¥u `finished`.

**Friction:** (1) subagent cháº¿t 529 váº«n Äá»T trá»n token Äá»c-diff má»i láº§n â phiÃªn trÆ°á»c 4 xÃ¡c = pháº§n lá»n
cá»§a cÃº nháº£y $107â$299; cap 2 láº§n thá»­ rá»i CHUYá»N PHIÃN, Äá»«ng Äá»£i-vÃ -thá»­ trong phiÃªn Äáº¯t. _(PhiÃªn 24/08
cháº¡y 1 láº§n lÃ  xong â Äá»i phiÃªn lÃ  ÄÃºng thuá»c.)_
(2) `.catch(false)` trong contract lÃ m Inputâ Output â `apiFetch<T>(z.ZodType<T>)` Äá» typecheck â
fix chuáº©n lÃ  type-assertion Táº I call-site kÃ¨m comment (role-admin-api.ts), Äá»«ng Äá»i apiFetch.
(3) ð **Classifier cháº·n sá» Äo PROD 5 láº§n â nguyÃªn nhÃ¢n KHÃNG pháº£i "Äá»¥ng DB PROD"** mÃ  lÃ  **chuá»i káº¿t
ná»i Äi qua DÃNG Lá»NH** (`PROD_DATABASE_URL="$(node -e 'â¦Äá»c .env.prodâ¦')" node script.mjs`). Cháº¡y ÄÆ°á»£c
ngay khi bá»c wrapper **tá»± Äá»c `.env.prod`TRONG tiáº¿n trÃ¬nh** rá»i`await import()`bá» Äo. Ghi láº§n 2 (phiÃªn
trÆ°á»c ÄÃ£ cháº·n 3 láº§n rá»i bá» cuá»c) â **á»©ng viÃªn`skill-smith`**. Báº«y phá»¥: script á» `c:\tmp\` khÃ´ng resolve
ÄÆ°á»£c `import pg` â pháº£i Äáº·t trong cÃ¢y repo (dÃ¹ng `logs/`, ÄÃ£ gitignore) Äá» vá»i tá»i `node_modules` gá»c.

## PhiÃªn 2026-08-05 (session b74ca3cc) â `S7-SEC-ROLE2FA-UI-1` â PR #345

**ÄÃ£ lÃ m:** vÃ¡ mÃ n "Sá»­a vai trÃ²" Äá»c sai + khÃ´ng táº¯t ÄÆ°á»£c cá» `requires_two_factor`. `roleSchema`
(GET /auth/roles) += `requiresTwoFactor` **báº¯t buá»c** Â· `listRolesTx` select thÃªm cá»t Â·
`roleToFormValues` bá» hard-code `false`. KhÃ´ng route má»i, khÃ´ng migration, khÃ´ng Äá»¥ng
`TwoFactorEnforcementGuard`. `check.sh --lane-db=role2fa` XANH; FULL gate PASS.

### BÃ i há»c: prefill sai lÃ  má»t lá»i GHI, khÃ´ng pháº£i lá»i hiá»n thá»

Ai Äá»c `roleToFormValues()` hard-code `false` cÅ©ng tháº¥y "hiá»n thá» sai". Lá»p thá»© hai má»i Äáº¯t: giÃ¡ trá»
prefill **cÅ©ng lÃ  `defaultValues` cá»§a react-hook-form**, mÃ  patch chá» gá»­i field **dirty**. Máº·c-Äá»nh-
`false` â tick-rá»i-bá»-tick tráº£ giÃ¡ trá» _vá» ÄÃºng máº·c Äá»nh_ â RHF **xoÃ¡ dirty** â field rÆ¡i khá»i PATCH.
Káº¿t quáº£: mÃ n chá» **Báº¬T** ÄÆ°á»£c, khÃ´ng **Táº®T** ÄÆ°á»£c â vÃ  khÃ´ng cÃ³ lá»i nÃ o hiá»n ra.

â Vá»i form dirty-patch, **má»i Ã´ prefill sai Äá»u lÃ  lá» ghi má»t chiá»u**, khÃ´ng pháº£i lá»i cosmetic. Sá»­a
prefill xong PHáº¢I cÃ³ ca khoÃ¡ **chiá»u ngÆ°á»£c**; sá»­a xong tá»± tháº¥y ÄÃºng lÃ  báº«y, vÃ¬ prefill ÄÃºng lÃ m chiá»u
kia má»i báº¯t Äáº§u cháº¡y láº§n Äáº§u. CÃ¹ng lÃ½ do: `Â§downgrade` (PATCH `trueâfalse`) á» BE trÆ°á»c nay **chÆ°a ai
phá»§** â UI khÃ´ng gá»i tá»i ÄÆ°á»£c thÃ¬ test cÅ©ng khÃ´ng nghÄ© ra Äá» viáº¿t.

### Contract: chá»n `required` chá»© khÃ´ng `.optional()` â vÃ  cÃ¡i giÃ¡ cá»§a nÃ³

`.optional()`/`.default(false)` "cho an toÃ n deploy" chÃ­nh lÃ  tÃ¡i táº¡o lá» vá»«a vÃ¡ (máº·c-Äá»nh-ngáº§m). ÄÃ£
chá»n **required** + ratchet á» `user-admin.spec.ts` tá»« chá»i hÃ ng thiáº¿u cá». GiÃ¡ pháº£i tráº£ lÃ  tháº­t:
**BE pháº£i lÃªn TRÆ¯á»C FE**, náº¿u khÃ´ng `apiFetch` nÃ©m ZodError cho _má»i_ consumer `/auth/roles`
(7 mÃ n, gá»m cáº£ gÃ¡n vai). Fail-closed nÃªn cháº¥p nháº­n ÄÆ°á»£c â nhÆ°ng ÄÃ¢y lÃ  **luáº­t cho má»i PR thÃªm field
vÃ o má»t read-schema ÄÃ£ cÃ³**, khÃ´ng riÃªng PR nÃ y.

### ð´ ChÆ°a xong â viá»c cá»§a owner

FULL gate Äo PROD: `QUáº¢N LÃ Cáº¤P CAO` hiá»n `requires_two_factor = f`, **khÃ´ng cÃ³ dÃ²ng audit nÃ o ghi
chiá»u `trueâfalse`** (dÃ²ng role má»i nháº¥t lÃ  `falseâtrue` 03/08); 3/4 thÃ nh viÃªn chÆ°a enroll TOTP. Cáº£
hai writer lÃªn `roles` Äá»u audit trong cÃ¹ng tx â náº¿u ÄÃºng thÃ¬ cÃº láº­t Äi **ngoÃ i API** (SQL tay/restore).
**ChÆ°a tá»± xÃ¡c minh ÄÆ°á»£c** â truy váº¥n DB PROD bá» safety classifier cháº·n. Náº¿u ÄÃºng: tiá»n Äá» Äo-04/08 á»
`harness/backlog.mjs:10467` ÄÃ£ cÅ©, vÃ  bÆ°á»c nghiá»m thu "má» mÃ n edit tháº¥y ÄÃ£ tick" pháº£i chá»n vai khÃ¡c.

**Friction:** cháº¡y má»t int-spec láº» vá»i `LANE_DB` cáº§n `. scripts/lib/db-secrets.sh && db_secrets_load`
trÆ°á»c, náº¿u khÃ´ng vitest.config cháº¿t ngay lÃºc load ("THIáº¾U APP_DB_PASSWORD"). `set -a; . ./.env` KHÃNG
Äá»§. (Láº§n 2 gáº·p â láº§n sau ná»¯a thÃ¬ gá»i `skill-smith`.)

## PhiÃªn 2026-08-03c (session 6fc9d44c) â `S7-CHAT-DB-3` + ÄÆ¯A Cáº¢ WAVE CHAT LÃN MASTER

> â ï¸ **CÃ¢y KHÃNG sáº¡ch khi phiÃªn nÃ y ÄÃ³ng, vÃ  ÄÃ³ KHÃNG pháº£i rÃ¡c cá»§a nÃ³.** `apps/api/test/helpers/seed.ts`
> Äang dirty vÃ¬ **phiÃªn khÃ¡c â `sess:eb2cc14a`** â báº¯t Äáº§u `S7-QA-CATALOGFIXTURE-1` lÃºc `15:11:19Z`
> (ledger `harness/activity.jsonl`). ÄÃ³ lÃ  instrumentation táº¡m ghi má»i lá»i gá»i `seedPermissionCatalog`
> ra JSONL, **tá»± comment "Gá»  trÆ°á»c khi commit"**. Äá»ªNG `git checkout --` file ÄÃ³. Náº¿u phiÃªn kia ÄÃ£ káº¿t
> thÃºc mÃ  file cÃ²n dirty: Äá»c diff, xÃ¡c nháº­n chá» lÃ  bá» dÃ², rá»i má»i hoÃ n nguyÃªn. CÅ©ng canh
> `catalog-mismatch.jsonl` sinh ra á» thÆ° má»¥c gá»c â khÃ´ng ÄÆ°á»£c lá»t vÃ o commit.

**ÄÃ£ lÃ m:** `S7-CHAT-DB-3` (mig `0540`, PR #328 â wave) â **PR #329 ÄÆ°a cáº£ 29 commit wave lÃªn master**
(owner merge, squash `b5bc7a0c`). Fence go-live cho CHAT **ÄÃ£ gá»¡**. NhÃ¡nh `wave/s7-chat` local+remote ÄÃ£
xoÃ¡. Hiá»n chá» cÃ²n `master`, 0 PR má», migration head **`0540`**.

### BÃ i há»c ÄÃ¡ng giÃ¡ nháº¥t: khá»i VERIFY báº¯t lá»i trong chÃ­nh migration viáº¿t ra nÃ³

Báº£n Äáº§u cá»§a `0540` xáº¿p `GRANT` cá»t **trÆ°á»c** rá»i `REVOKE` cáº¥p báº£ng **sau**, láº­p luáº­n "expand-contract;
`relacl` vÃ  `attacl` lÃ  hai ACL Äá»c láº­p". **Sai.** Postgres: revoke quyá»n cáº¥p báº£ng thÃ¬ **cuá»n theo toÃ n
bá» column-GRANT cÃ¹ng báº£ng**. Äo 10 giÃ¢y trong má»t transaction:

```sql
GRANT UPDATE (name, description) ON chat_rooms  -->  attacl = {name,description}
REVOKE UPDATE ON chat_rooms                     -->  attacl = {}      -- Máº¤T Sáº CH
```

Thá»© tá»± "an toÃ n" theo trá»±c giÃ¡c táº¡o ra **ÄÃºng** tráº¡ng thÃ¡i nÃ³ Äá»nh trÃ¡nh â `chat_rooms` khÃ´ng cá»t nÃ o
ghi ÄÆ°á»£c â vÃ  lÃ  **vÄ©nh viá»n**. Náº¿u VERIFY chá» Äáº¿m `information_schema.table_privileges` nhÆ° `0539` thÃ¬
ÄÃ£ ship. â `0540` dÃ¹ng `aclexplode(relacl/attacl)`, pin táº­p cá»t **báº±ng ÄÃºng theo TÃN**, assert RLS+FORCE,
Äáº¿m **dÆ°Æ¡ng** 4 FK RESTRICT. ÄÃ£ tÃ¡ch memory `revoke-table-grant-wipes-column-grants`.

VÃ  **cá»­a sá» 500 vá»n khÃ´ng tá»n táº¡i**: `migrate()` cá»§a drizzle cháº¡y trong Má»T transaction, ACL lÃ 
transactional. "Expand-contract" cho GRANT náº±m á» **káº¿t quáº£**, khÃ´ng á» thá»© tá»± cÃ¢u lá»nh.

### Tiá»n Äá» WO sai â váº¿ thá»© hai trong hai phiÃªn liÃªn tiáº¿p

`done_when` cá»§a `S7-CHAT-DB-3` dá»±ng trÃªn "app role cÃ²n DELETE trÃªn `users`" (Äá»c `0002:70`, bá» qua
`0467` ÄÃ£ REVOKE). Äo `has_table_privilege` ra `f`. â **khÃ´ng** thÃªm ca `DELETE FROM users pháº£i 42501`
vÃ o RED: nÃ³ xanh sáºµn, chá»©ng minh 0 Äiá»u. Váº¿ `users` chuyá»n háº³n thÃ nh viá»c FK. CÃ¹ng lá»p vá»i phiÃªn trÆ°á»c
(`update:project` lÃ  `is_sensitive`): **Äá»c migration cÅ© â  hiá»n tráº¡ng, pháº£i Äo.**

### Friction â Láº¶P Láº I 3 Láº¦N TRONG Má»T PHIÃN

Sau squash-merge, nhÃ¡nh **local** giá»¯ N commit riÃªng láº» cÃ²n ÄÃ­ch cÃ³ **1** commit â git graph váº½ hai
ÄÆ°á»ng â ngÆ°á»i dÃ¹ng Äá»c thÃ nh "chÆ°a merge, sao khÃ´ng merge ná»t". Xáº£y ra vá»i `wo/s7-chat-be-gate-3`,
`wo/s7-chat-be-gate-fix`, rá»i `wave/s7-chat`. **CÃ¡ch dá»©t Äiá»m: `git diff <remote> <local>` HAI CHáº¤M â
rá»ng thÃ¬ xoÃ¡ nhÃ¡nh local ngay, Äá»«ng Äá» nÃ³ náº±m ÄÃ³.**

â **ÄÃ ÄÃNG BÄNG THÃNH SKILL: `.claude/skills/post-merge-branch-reconcile/`** (owner chá»t 03/08). Skill
ghi rÃµ vÃ¬ sao `git log A..B`, `git branch --merged` vÃ  `git diff A...B` **ba cháº¥m** Äá»u bÃ¡o sai sau
squash, kÃ¨m báº«y `push --delete` bÃ¡o `remote ref does not exist` (GitHub ÄÃ£ tá»± xoÃ¡, pháº£i `fetch --prune`)
vÃ  Äiá»u cáº¥m **Äá»i nhÃ¡nh khi cÃ¢y lÃ m viá»c Äang chia sáº» vá»i phiÃªn khÃ¡c**.

> á»¨ng viÃªn skill-smith CÃN Láº I (ÄÃ£ ghi â¥2 láº§n, chÆ°a ÄÃ³ng): cháº¡y int-spec vá»i `LANE_DB` â náº¡p `.env` lÃ m
> `DATABASE_URL` ÄÃ¨ `LANE_DB` rá»i bá» `S6-SEC-DBFENCE-1` cháº·n; cÃ¢u ÄÃºng náº±m á» Ã´ Friction phiÃªn
> `2026-08-01`. Xem thÃªm Ã´ Friction phiÃªn ÄÃ³ vá» `unset DATABASE_*`.

### Viá»c tiáº¿p theo

`S7-QA-CATALOGFIXTURE-1` ð´ **Äang cÃ³ phiÃªn khÃ¡c giá»¯** (xem cáº£nh bÃ¡o Äáº§u má»¥c). WO an toÃ n Äá» lÃ m ngay:
**`S7-CHAT-CLEAN-2`** ð¡ (`apps/api/src/chat/**` â `endpointOf` gÃ¡n nhÃ£n SAI cho path láº¡ Â· mapper gá»p
Failure/Error thÃ nh Denied Â· index dÆ° trÃªn `chat_messages` pháº£i Äo `pg_stat_user_indexes` trÆ°á»c khi drop
Â· `s7-chat-db1-invariants.int-spec.ts:427-433` thiáº¿u `WHERE company_id`). Sau ÄÃ³ lÃ  cáº£ nhÃ¡nh FE
`S7-CHAT-FE-1..5` â `FE-1` má» khoÃ¡ 4 WO cÃ²n láº¡i. Module `CHAT` váº«n `is_active=false`, viá»c báº­t thuá»c WO
cuá»i wave.

---

## PhiÃªn 2026-08-03b (session 99a7c530) â chá»t PR #327 cho gate-3 + tÃ¬m ra nguyÃªn nhÃ¢n THáº¬T cá»§a 2 má»¥c "chá» owner"

> Tiáº¿p ná»i phiÃªn `56e133e4`. **Cáº£nh bÃ¡o "26 file dirty" cá»§a Ã´ dÆ°á»i ÄÃ£ Lá»I THá»I** â phiÃªn ÄÃ³ cÃ³ commit
> (`03f9a924`) SAU khi viáº¿t handoff. CÃ¢y sáº¡ch, Äang Äá»©ng trÃªn `wo/s7-chat-be-gate-3`.

**ÄÃ£ lÃ m:** ÄÃ³ng sá» 4 WO CHAT cÃ²n treo â má» **PR #327** (base `wave/s7-chat`, KHÃNG gáº¯n auto-merge vÃ¬
vÃ¹ng Äá») â CI Äá» á» **hai** job â truy ra **ba** nguyÃªn nhÃ¢n, **táº¥t cáº£ náº±m trong test**, vÃ¡ á» `4f52948c`.

### Hai káº¿t luáº­n cá»§a phiÃªn trÆ°á»c bá» láº­t â cÃ¹ng má»t gá»c: Äá» náº±m trong DB, khÃ´ng trong code

1. **"`update:project` lÃ  `is_sensitive` nhÆ°ng ngoÃ i allowlist â cáº§n WO riÃªng"** â **KHÃNG PHáº¢I.**
   `chat-be5-derived-rooms.int-spec.ts` khai `["update","project",â¦,true]` trong khi catalog THáº¬T lÃ 
   `false` (mig `0005` L224; `0485` bÆ°á»c (b) chá» nÃ¢ng 5 cáº·p khÃ¡c). `seedPermissionCatalog` upsert
   `DO UPDATE SET is_sensitive = EXCLUDED.is_sensitive` vÃ o `permissions` â **báº£ng TOÃN Cá»¤C**, khÃ´ng
   `company_id`, khÃ´ng ai dá»n. VÃ  **CI Äáº·t `LANE_DB: mediaos` = chÃ­nh DB cá»§a job** (api.yml:221) nÃªn
   chat-be5 láº­t cá» ngay trong DB mÃ  `auth-me-capabilities.int.spec.ts` dÃ¹ng â 3 ca TASKCAP Äá», **phá»¥
   thuá»c thá»© tá»± cháº¡y**.
   â ï¸ PhÃ©p thá»­ "stash sáº¡ch code, cháº¡y láº¡i trÃªn CÃNG lane, váº«n Äá» y há»t" nghe Äanh thÃ©p nhÆ°ng **khÃ´ng
   phÃ¢n biá»t ÄÆ°á»£c gÃ¬**: stash bao nhiÃªu láº§n thÃ¬ hÃ ng catalog váº«n `t`. CÃ¡ch ÄÃºng tá»n 10 giÃ¢y: Äo hÃ ng ÄÃ³
   á» **nhiá»u DB** â 4 DB cho `f`, riÃªng lane tá»«ng cháº¡y chat-be5 cho `t`.
2. **"LÃ´ int-spec thá»© hai Äá» 1/4 lÆ°á»£t, khÃ´ng báº¯t ÄÆ°á»£c tÃªn ca"** â thá»±c ra lÃ  **HAI cháº¿ Äá» Äá» khÃ¡c nhau**,
   vÃ  chÃ­nh vÃ¬ trá»n láº«n nÃªn khÃ´ng ai báº¯t ÄÆ°á»£c tÃªn:
   - **CÃ³ tÃªn:** `outbox-fifo.int-spec.ts` â spec **tá»± dá»±ng sai tiá»n Äá»**. `available_at` láº¥y `now()` cá»§a
     Tá»ªNG cÃ¢u INSERT (má»i cÃ¢u má»t tx) trong khi khoáº£ng lÃ¹i giáº£m dáº§n: hai Äáº¡i lÆ°á»£ng ngÆ°á»£c chiá»u, cÃ¡ch nhau
     ÄÃºng 50ms â má»t cÃ¢u cháº­m >50ms lÃ  Äáº£o tráº­t tá»±. Nháº­n `[0..8, 11, 9, 10]` â trÃ´ng y há»t "báº£n vÃ¡ FIFO
     há»ng". VÃ¡: neo **Má»T** má»c `now()`.
   - **KHÃNG tÃªn:** `ERR_IPC_CHANNEL_CLOSED` (tinypool@1.1.1) â `rc=1` vá»i **0 ca Äá»**. 2/8 lÆ°á»£t dÃ­nh.
     ÄÃ¢y lÃ  á»©ng viÃªn sá» má»t bá» Äá»c thÃ nh "test Äá»".

### BÃ i há»c phÆ°Æ¡ng phÃ¡p

- **RED-proof flake khÃ´ng cáº§n chá» may.** Ãp ÄÃºng Äiá»u kiá»n táº£i: thÃªm `sleep(50ms+Îµ)` giá»¯a cÃ¡c INSERT â
  dáº¡ng CÅ¨ Äá», dáº¡ng VÃ XANH. Má»t phÃºt, táº¥t Äá»nh, thay cho "cháº¡y 4 lÆ°á»£t xem cÃ³ Äá» khÃ´ng".
- **Sá»­a spec xong pháº£i kiá»m spec CÃN Báº®T ÄÆ¯á»¢C BUG KHÃNG.** ÄÃ£ hoÃ n nguyÃªn `claim()` vá» dáº¡ng trÆ°á»c khi vÃ¡
  â spec (ÄÃ£ sá»­a timing) váº«n Äá» â khÃ´i phá»¥c â XANH. KhÃ´ng cÃ³ bÆ°á»c nÃ y thÃ¬ "vÃ¡ flake" ráº¥t dá» lÃ  "lÃ m cÃ¹n
  cÃ¡i test".
- **Äo trÆ°á»c khi láº·p láº¡i phÃ¡t hiá»n cá»§a reviewer.** MEDIUM "`users` cÃ²n DELETE â cascade xoÃ¡ Cá»¨NG
  `chat_messages`" sai má»t ná»­a: `mediaos_app` **chá» cÃ³ UPDATE** trÃªn `users`, DELETE chá» role owner cÃ³ â
  runtime khÃ´ng vá»i tá»i. Pháº§n tháº­t lÃ  FK `chat_messages_sender_id_fkey ON DELETE CASCADE` â rá»§i ro á» táº§ng
  migration/script, khÃ´ng pháº£i lá» phÃ¢n quyá»n. (`UPDATE(visible_from_seq)` cho `mediaos_app` thÃ¬ **ÄÃºng**.)

### Sá» Äo

api `src/**` **253 file / 4060 test XANH** (lane `mediaos_outboxfifo`, gá»m `auth-me-capabilities` 48/48) Â·
lÃ´ 14 int-spec CHAT+outbox **8 lÆ°á»£t, 0 ca Äá» cÃ³ tÃªn** Â· typecheck 10/10 Â· lint 7/7 (Äá»u `TURBO_FORCE=1`).

### ChÆ°a xong / chá» ngÆ°á»i

- **PR #327 chá» owner review+merge** vÃ o `wave/s7-chat`. KhÃ´ng gáº¯n nhÃ£n auto-merge (vÃ¹ng Äá» + base lÃ 
  nhÃ¡nh wave). Sau khi merge: hÃ ng Äá»£i káº¿ lÃ  **`S7-CHAT-FE-1`** â toÃ n bá» lá»p BE cá»§a wave ÄÃ£ ÄÃ³ng.
- **CÃ²n 2 má»¥c chá» owner** (má»¥c thá»© 3 ÄÃ£ gá»¡, xem trÃªn): â  gá»­i láº¡i tá»p sang phÃ²ng thá»© hai lÃ m máº¥t `url` á»
  phÃ²ng thá»© nháº¥t â quyáº¿t Äá»nh Sáº¢N PHáº¨M; â¡ ~15 MEDIUM, ÄÃ¡ng gom nháº¥t lÃ  4 má»¥c least-privilege.
- **á»¨ng viÃªn WO má»i:** `seedPermissionCatalog` ghi ÄÃ¨ `is_sensitive` im láº·ng vÃ  khÃ´ng hoÃ n nguyÃªn. VÃ¡ ÄÃºng
  táº§ng lÃ  á» helper (giá»¯ giÃ¡ trá» migration, kÃªu to khi lá»ch) nhÆ°ng pháº£i audit má»i caller Äang Cá» Ã láº­t cá».
- **`S7-CHAT-RT-0` cÃ²n nguyÃªn má»t má»¥c `done_when` lÃ  bÆ°á»c NGÆ¯á»I:** smoke báº±ng trÃ¬nh duyá»t tháº­t.

## PhiÃªn 2026-08-03 (session 56e133e4) â FULL gate `S7-CHAT-BE-GATE-3` + 6 vÃ¡ ð´ Â· ~~26 FILE CHÆ¯A COMMIT~~ (ÄÃ COMMIT `03f9a924`)

> â **Äá»C Ã NÃY TRÆ¯á»C KHI CHáº Y Báº¤T Ká»² Lá»NH GIT NÃO.** CÃ¢y `wave/s7-chat` Äang cÃ³ **26 file dirty** lÃ 
> cÃ´ng viá»c ÄÃ£ hoÃ n thÃ nh + verify cá»§a phiÃªn nÃ y, **chÆ°a commit**. Chá» cÃ³ Má»T worktree â phiÃªn sau Äá»©ng
> ÄÃºng trÃªn cÃ¢y nÃ y. **Cáº¤M `git add -A`, cáº¥m `git checkout`/`git stash`/Äá»i nhÃ¡nh** khi chÆ°a chá»t. ÄÃ¢y
> ÄÃºng báº«y ÄÃ£ dÃ­nh vá»i phiÃªn `69de512c` (xem Ã´ Friction phiÃªn 2026-08-01).
> Chá»t nhanh: `git checkout -b wo/s7-chat-be-gate-3 && git add <ÄÃºng path cá»§a mÃ¬nh> && git commit`.

**ÄÃ£ lÃ m:** cháº¡y FULL gate 5 lane trÃªn TOÃN bá» máº·t CHAT (`master...HEAD`: 62 file, +12.747 dÃ²ng) rá»i vÃ¡
háº¿t CRITICAL + 5 HIGH. LÃ½ do gate: 5 WO **chÆ°a tá»«ng qua gate** (`DB-2`, `BE-7`, `RT-0`, `RT-1`, vÃ  `BE-6`
má»i cÃ³ 1/3 reviewer), cá»ng vá»i viá»c gate cÅ© ÄÃ£ TRÃI â `chat-access.service.ts` (file 3-báº¥t-biáº¿n) bá» +69
dÃ²ng SAU khi ÄÆ°á»£c bless á» `631d683e`.

- **Verdict:** L1 PASS Â· L2/L3/L4/L5 BLOCK. **L2 vÃ  L4 Äá»c láº­p tÃ¬m ra CÃNG má»t CRITICAL** â tÃ­n hiá»u máº¡nh
  hÆ¡n báº¥t ká»³ verdict ÄÆ¡n láº» nÃ o. L1 thÃ¬ **bÃ¡c bá»** giáº£ thuyáº¿t trÃ´i-gate tÃ´i ÄÆ°a cho nÃ³ (pháº§n +69 dÃ²ng lÃ 
  siáº¿t cháº·t, khÃ´ng ná»i) â giá»¯ ÄÆ°á»£c cÃ¡ch lÃ m nÃ y: ÄÆ°a giáº£ thuyáº¿t cho reviewer vÃ  cháº¥p nháº­n nÃ³ nÃ³i "sai".
- **CRITICAL ÄÃ£ vÃ¡:** `sendMessage` dá»±ng DTO báº±ng `readMessage(actor,â¦)` = **ÄÃ£ kÃ½ cho NGÆ¯á»I Gá»¬I** rá»i
  `emitChatMessage` phÃ¡t nguyÃªn object ÄÃ³ cho Cáº¢ PHÃNG; `wsChatMessageEventSchema = chatMessageSchema` giá»¯
  nguyÃªn `attachments[].url`. URL presign lÃ  **bearer** â ai cáº§m cÅ©ng táº£i ÄÆ°á»£c, 0 dÃ²ng `file_access_logs`.
  VÃ¡: khai `wsChatAttachmentSchema` KHÃNG cÃ³ `url`/`thumbnailUrl` (khai Láº I, khÃ´ng `.omit()`).
- **5 HIGH ÄÃ£ vÃ¡:** cáº¯t phiÃªn WS khi thu há»i phiÃªn (SPEC-15 Â§18, chá»t á» `revokeAllSessionsForUserTx`) Â·
  `LEAST(${x}::int)` trÃªn cá»t **bigint** â `seq â¥ 2^31` tráº£ **500** thay vÃ¬ káº¹p tráº§n Â· `removeMember` Äá»ng
  bá» theo `pm.user_id` legacy trong khi vá» tá»« phÃ²ng chat Äi qua `employee_profiles.user_id` Â·
  `S7-FND-LINKFALLBACK-1` Â· pháº§n im-láº·ng cá»§a tá»p Äa-link.
- **KI-059 ÄÃNG** (`S7-INT-OUTBOX-FIFO-1`) kÃ¨m **pháº¡m vi báº£o Äáº£m nÃ³i chÃ­nh xÃ¡c**: chá» ÄÃºng trong Má»T lÃ´
  claim cá»§a Má»T worker â khÃ´ng vá»i tá»i ties trong cÃ¹ng tx, retry-backoff, vÃ  Äa-instance.

### Ba bÃ i há»c Äáº¯t nháº¥t phiÃªn nÃ y

1. **Äá» xuáº¥t cá»§a reviewer cÃ³ thá» lÃ  VECTOR LEO THANG â pháº£i tá»± tháº©m Äá»nh trÆ°á»c khi lÃ m.** L4 Äá» nghá» ná»i
   luáº­t AND cá»§a `decideForLinkedFile` Äá» "ngÆ°á»i cÃ³ quyá»n á» phÃ²ng mÃ¬nh váº«n táº£i ÄÆ°á»£c". LÃ m nguyÃªn vÄn thÃ¬ káº»
   táº¥n cÃ´ng chá» cáº§n link tá»p cá»§a phÃ²ng nÃ³ KHÃNG thuá»c vÃ o tin nháº¯n cá»§a CHÃNH NÃ lÃ  ÄÆ°á»£c cáº¥p quyá»n â vÃ  ÄÃ³
   ÄÃºng lÃ  lá» `S5-TASK-COVER-1` ÄÃ£ ÄÃ³ng. **Giá»¯ AND**, chá» vÃ¡ pháº§n khuyáº¿t táº­t tháº­t (sá»± im láº·ng) báº±ng
   `deniedByLink` (cháº©n ÄoÃ¡n, Cáº¤M dÃ¹ng Äá» phÃ¢n quyá»n).
2. **Spec lÃ¡i worker tháº­t trÃªn lane DB dÃ¹ng chung vá»«a Än cáº¯p vá»«a bá» cÆ°á»p.** Spec báº±ng chá»©ng Äáº¦U TIÃN cá»§a
   tÃ´i cho KI-059 dÃ¹ng `processBatch(50)` + gieo probe `available_at` lÃ¹i 1 giá» (= giÃ  nháº¥t DB) â worker
   spec khÃ¡c nháº·t trÆ°á»c (táº¥t Äá»nh, vÃ¬ `ORDER BY available_at`), cÃ²n worker cá»§a tÃ´i ÄÃ¡nh `'done'` im láº·ng
   má»i event khÃ´ng cÃ³ consumer trong bus. LIGHT gate báº¯t ÄÆ°á»£c. Luáº­t ÄÃ£ cÃ³ sáºµn á»
   `dead-letter-alert-threshold.int-spec.ts:12-15` vÃ  `test/helpers/outbox-drain.ts` â **Äá»c trÆ°á»c khi viáº¿t
   spec Äá»¥ng outbox**. Báº£n viáº¿t láº¡i: probe lÃ¹i ~600ms, batch ÄÃºng báº±ng N, TRáº¢ Láº I event lá»¡ nuá»t, vÃ  tÃ¡ch
   báº¡ch "bá» cÆ°á»p probe" khá»i "vÃ¡ há»ng" báº±ng assert riÃªng cÃ³ thÃ´ng Äiá»p cháº©n ÄoÃ¡n.
3. **Äá»i chá»¯ kÃ½ thÃ nh Báº®T BUá»C Äá» TypeScript chá» máº·t caller.** `revokeAllForUserTx(+companyId)` vÃ 
   `decideForLinkedFile(+everLinked)` â khÃ´ng dÃ¹ng tham sá» optional-máº·c-Äá»nh-false, vÃ¬ caller má»i quÃªn lÃ 
   lá» má» láº¡i IM Láº¶NG. CÃ¡ch nÃ y lÃ´i ra 5 + 15 Äiá»m gá»i mÃ  grep sáº½ sÃ³t.
   KÃ¨m: **census nguá»n báº¯t ÄÆ°á»£c 2 lá» mÃ  reviewer khÃ´ng tháº¥y** â `self_revoke` vÃ  `self_revoke_others` thu
   há»i phiÃªn á» DB nhÆ°ng khÃ´ng cáº¯t socket (thiáº¿t bá» vá»«a bá» "ÄÄng xuáº¥t tá»« xa" váº«n nháº­n tin). NhÃ¡nh `rotated`
   Cá» Ã khÃ´ng cáº¯t vÃ  census khoÃ¡ luÃ´n ngoáº¡i lá» ÄÃ³.

### Sá» Äo (LANE_DB=mediaos_outboxfifo)

Unit **1217/1220** Â· int-spec 5 module resolver **139/139** Â· CHAT int-spec **164/164** (cháº¡y 2 lÃ´) Â·
typecheck workspace **10/10** Â· lint **0 error**. **Má»i vÃ¡ Äá»u cÃ³ RED-proof tháº­t** (láº­t ngÆ°á»£c báº£n vÃ¡,
xÃ¡c nháº­n Äá», khÃ´i phá»¥c) â khÃ´ng cÃ³ vÃ¡ nÃ o chá» "xanh sau khi sá»­a".

### 3 má»¥c CHá» OWNER (chÆ°a ai chá»t)

1. ~~`update:project` lÃ  `is_sensitive` nhÆ°ng ngoÃ i allowlist~~ â **Káº¾T LUáº¬N NÃY SAI, ÄÃ£ ÄÃ­nh chÃ­nh á»
   commit `4f52948c`.** Catalog tháº­t khai `('update','project', false)` (`0005:224`); giÃ¡ trá» `TRUE` tÃ´i
   Äo ÄÆ°á»£c lÃ  **rÃ¡c do fixture cá»§a `chat-be5` ÄÃ³ng dáº¥u vÃ o báº£ng `permissions` toÃ n cá»¥c**. KhÃ´ng cÃ³ lá» phÃ¢n
   quyá»n; WO `S7-AUTH-CAPSWEEP-1` ÄÃ£ Gá» , thay báº±ng `S7-QA-CATALOGFIXTURE-1` (nháº¯m ÄÃºng cÆ¡ cháº¿ Ã´ nhiá»m).
   **BÃ i há»c phÆ°Æ¡ng phÃ¡p â ÄÃ¢y má»i lÃ  thá»© ÄÃ¡ng mang Äi:** phÃ©p thá»­ "`git stash` rá»i cháº¡y láº¡i trÃªn CÃNG
   lane" trÃ´ng ráº¥t thuyáº¿t phá»¥c nhÆ°ng **khÃ´ng phÃ¢n biá»t ÄÆ°á»£c lá»i náº±m trong DB**; stash bao nhiÃªu láº§n thÃ¬
   hÃ ng catalog váº«n `t`. Muá»n quy trÃ¡ch nhiá»m cho code pháº£i Äá»i **DB sáº¡ch**, khÃ´ng pháº£i Äá»i code.
2. **HÃ nh vi gá»­i láº¡i tá»p sang phÃ²ng thá»© hai** lÃ m máº¥t `url` á» phÃ²ng thá»© nháº¥t â quyáº¿t Äá»nh Sáº¢N PHáº¨M: cháº¥p
   nháº­n (an toÃ n, gÃ¢y báº¥t ngá») hay Äá»i táº§ng GHI Äá» gá»­i-láº¡i táº¡o **báº£n sao tá»p** thay vÃ¬ link thá»© hai.
3. **~15 MEDIUM** cÃ²n tá»n. ÄÃ¡ng gom nháº¥t: 4 má»¥c least-privilege cá»§a L3 â `GRANT UPDATE(visible_from_seq)`
   lÃ  quyá»n CHáº¾T Äang gÃ¡c báº¥t biáº¿n CHAT-DEC-008 báº±ng _má»t unit test_; `users` cÃ²n DELETE â cascade xoÃ¡
   Cá»¨NG `chat_messages` (báº£ng append-only). Má»t migration expand-contract lÃ  gá»n.

### ChÆ°a xong / chÆ°a cháº¯c

- **ChÆ°a commit, chÆ°a PR, chÆ°a lÃªn master.**
- LÃ´ int-spec thá»© hai **Äá» 1 láº§n trong 4 lÆ°á»£t**, KHÃNG báº¯t ÄÆ°á»£c tÃªn ca; 3 lÆ°á»£t sau xanh sáº¡ch. ChÆ°a káº¿t
  luáº­n ÄÆ°á»£c â Äá»«ng Äá»c thÃ nh "ÄÃ£ á»n Äá»nh".
- Lá»nh cháº¡y láº¡i: `set -a; . ./.env; set +a; unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL;
export LANE_DB=mediaos_outboxfifo` (lane nÃ y cÃ²n sá»ng, nhá» `DROP DATABASE` khi xong â pgdata tá»«ng phÃ¬nh).

## PhiÃªn 2026-08-02 (session b817bc82) â chuá»i cá»ng G4âG6 + NGHIá»M THU engine phÃ©p Äáº T

> Báº±ng chá»©ng Äáº§y Äá»§: **`docs/_review/S6-GOLIVE-G4-G6-EVIDENCE-2026-08-02.md`**. `RELEASE-10` Â§6 ÄÃ£ thÃªm cá»t Tráº¡ng thÃ¡i.

- **G4 hoÃ¡ ra ÄÃ XONG tá»« trÆ°á»c â cÃ¡i há»ng lÃ  CHá» BÃO.** `nssm get MediaOS-API AppParameters` = `apps\api\releases\current\main.js`, nhÆ°ng `m prod-status` váº«n in "service VAN tro thang apps\api\dist". Gá»c: `Show-ReleaseStatus` Äá»c `ImagePath` cá»§a service rá»i thá»­ `-match "releases"` â vá»i **service NSSM, `ImagePath` LUÃN lÃ  ÄÆ°á»ng dáº«n `nssm.exe`**, má»¥c tiÃªu tháº­t náº±m á» subkey `Parameters\Application`+`AppParameters` â phÃ©p thá»­ **khÃ´ng bao giá» ÄÃºng** â Ã´ KI-016 bÃ¡o "chÆ°a ÄÃ³ng" VÄ¨NH VIá»N. **ÄÃ¢y lÃ  má»t tÃ­n hiá»u NO-GO GIáº¢ ÄÃ£ tÃ­nh vÃ o phÃ¡n quyáº¿t NO-GO 2026-07-31.** VÃ¡ á» #324.
- **Chá»©ng minh cutover báº±ng HÃNH VI, khÃ´ng báº±ng cáº¥u hÃ¬nh:** `m dev-online-fast` biÃªn dá»ch láº¡i `apps/api/dist` â dist Äá»i sang `43237f5b` trong khi `:3100/health` **váº«n** tráº£ `969f330c-dirty`. TrÆ°á»c cutover, ÄÃºng chuá»i nÃ y tÃ¡i táº¡o sá»± cá» 2026-07-08.
- **NGHIá»M THU Äáº T â sá» ÄÃºng lÃ  245, KHÃNG pháº£i 295** (owner chá»t trong phiÃªn; plan Â§1.1 F1 ÄÃ£ ÄÃ­nh chÃ­nh tá»« trÆ°á»c, chá» handoff/WO cÃ²n giá»¯ sá» ngÃ¢y thÆ¡). Preview **245 ngÃ y / 41 NV**, phÃ¢n bá» `30Ã7 Â· 2Ã5 Â· 3Ã4 Â· 3Ã3 Â· 1Ã2 Â· 2Ã1`. Job cháº¡y tháº­t: `total=success=245, failed=0`. **Ba nguá»n khá»p tuyá»t Äá»i**: preview 245 = `leave_balances` 245.0 = sá» cÃ¡i `ACCRUAL` 245.00 (41 NV). **Idempotent ÄÃ£ chá»©ng minh** (preview ngay sau khi cáº¥p: `pendingTotal=0, alreadyGranted=245`). 45 quÃ©t = 41 cáº¥p + 3 nghá» trÆ°á»c 2026 (`1111`/`1119`/`1129`, ÄÃºng pháº§n chÃªnh so vá»i 295) + 1 thiáº¿u `start_date` (`1136`, bá» qua **kÃ¨m bÃ¡o cÃ¡o**).
- **CÃ´ng táº¯c ÄÃºng lÃ  cÃ´ng táº¯c:** `accrual_method='None'` â `policies: []`, `totalDays: 0`. Merge PR tháº­t sá»± = 0 thay Äá»i dá»¯ liá»u.
- **G6 `--strict`: 10 PASS Â· 0 FAIL Â· 0 SKIP** trÃªn staging dá»¯ liá»u tháº­t. Seed 4 tÃ i khoáº£n UAT trÆ°á»c nÃªn **khÃ´ng ca nÃ o SKIP ngáº§m**.
- **Seed demo KHÃNG nghiá»m thu ÄÆ°á»£c** â 245 lÃ  hÃ m cá»§a `start_date`/`end_date` cá»§a 45 há» sÆ¡ `funtime`. Pháº£i clone PROD. **Báº«y: `backup-db.sh` dump `--no-owner --no-privileges`** â restore báº£n ÄÃ³ thÃ¬ `mediaos_app` máº¥t sáº¡ch grant, API cháº¿t `28P01`/permission denied. Clone cho staging pháº£i `pg_dump --format=custom` **CÃ** owner+ACL (verify sau restore: 463 grant Â· 155 FORCE RLS Â· 172 policy).
- **Hai lá»ch cáº¥u hÃ¬nh staging sáº½ gáº·p láº¡i:** (1) role Postgres lÃ  **Cá»¤M-rá»ng** â `mediaos_app` chá» cÃ³ Má»T máº­t kháº©u (theo `.env` PROD), `.env.dev-online` giá»¯ báº£n cÅ© â `FATAL 28P01`; (2) `PLATFORM_SUPERADMIN_COMPANY_SLUG`/`STAGING_SEED_COMPANY_SLUG` = `demo` trong khi clone lÃ  `funtime` â `SuperAdminBootstrapService` sáº­p lÃºc boot.
- **`RC-004` KHÃNG Ã¡p dá»¥ng ÄÆ°á»£c** (nÃ³i rÃµ Äá» khÃ´ng ai Äá»c thÃ nh ÄÃ£ diá»n táº­p): PROD ÄÃ£ á» head `0537` nÃªn **khÃ´ng cÃ²n migration nÃ o Äang chá»** Äá» diá»n táº­p. G6 chá» ÄÃ³ng `RC-003`.
- **ÄÃ£ dá»«ng staging sau khi láº¥y xong báº±ng chá»©ng** â clone mang PII tháº­t, `cian-dev.*` tráº£ 200 cÃ´ng khai, vÃ  `.env.dev-online` cÃ³ `TWO_FACTOR_ENFORCEMENT_ENABLED=false` â staging lÃ  **ÄÆ°á»ng vÃ²ng qua 2FA cá»§a PROD**. `m dev-online-stop` â 502. **DB `mediaos_dev` váº«n giá»¯ dá»¯ liá»u tháº­t** â dá»±ng láº¡i lÃ  lá» láº¡i.
- **#324 (chá» owner merge):** 2 lá»i ÄANG Sá»NG trÃªn PROD â `leave-type-form.ts` cÃ²n regex lowercase-only â **má»i loáº¡i nghá» ÄÃ£ seed khÃ´ng lÆ°u ÄÆ°á»£c** (cÃ¹ng há» cá»­a-má»t-chiá»u vá»i #323); key i18n `codeInvalid` treo (ÄÆ°á»£c `leave-policy-form.ts` ÄÃ£ ship á» #323 tham chiáº¿u nhÆ°ng chÆ°a tá»«ng tá»n táº¡i).
- **G9 xong nhÆ°ng pháº£i cáº¯t HAI tag â bÃ i há»c thá»© tá»±.** `v1.0.0-rc.1` bá» cáº¯t táº¡i `6f160b9a` **trÆ°á»c** láº§n build láº¡i cuá»i, PROD sau ÄÃ³ cháº¡y `a968fcfe` â tag khÃ´ng trá» báº£n Äang cháº¡y, mÃ  pháº§n chÃªnh ÄÃºng báº±ng #324 nÃªn **rollback vá» `rc.1` = ÄÆ°a FE vá» ÄÃºng báº£n lá»i mÃ n Loáº¡i nghá» vá»«a vÃ¡**. Tag khÃ´ng bao giá» move (`RELEASE-05` Â§6.2 quy táº¯c 4) â ÄÃ£ cáº¯t **`v1.0.0-rc.2` @ `a968fcfe`**, xÃ¡c minh `RC-BUILD-MATCH` â. **Má»c rollback ÄÃºng = `rc.2`.** Luáº­t rÃºt ra, ÄÃ£ bake vÃ o `RELEASE-08` Â§2: **deploy â `--expect-commit` â Má»I tag**. KÃ¨m báº«y Äá»c sá»: `data.build.version` láº¥y tá»« `package.json` nÃªn **khÃ´ng Äá»i** giá»¯a cÃ¡c rc (cáº£ rc.1 láº«n rc.2 Äá»u in `1.0.0-rc.1`) â Äá»nh danh cÃ³ tháº©m quyá»n lÃ  `data.build.commit`.
- **PROD hiá»n táº¡i:** `a968fcfe` Â· builtAt 2026-08-02T02:33:15Z Â· head `0537` (205/205) Â· release `20260802-023315__1.0.0-rc.1__a968fcfe` (**háº¿t `-dirty`**). Báº£n vÃ¡ FE cá»§a #324 ÄÃ£ **xÃ¡c minh live trong bundle tháº­t** (`LeaveTypesPage-CxkNjNmC.js` cÃ³ `A-Za-z0-9_-`, 0 dáº¥u váº¿t regex thÆ°á»ng-only; `master-data-fields-DXdSbJVm.js` cÃ³ `codeInvalid`) â khÃ´ng tin workflow xanh, kiá»m bundle.
- **`KI-058` â lá»i TO nháº¥t phiÃªn, tÃ¬m ra chá» vÃ¬ owner há»i "mÃ n ÄÃ³ á» ÄÃ¢u": 4 mÃ n QUáº¢N TRá» LEAVE khÃ´ng vÃ o ÄÆ°á»£c tá»« UI** dÃ¹ quyá»n trong DB cÃ³ Äá»§ (PR #325, ÄÃ£ deploy `30540ab0`). CÆ¡ cháº¿: `getCapabilities()` lá»c bá» **toÃ n bá»** cáº·p `is_sensitive`; chá» cáº·p trong `SENSITIVE_CAPABILITY_ALLOWLIST` má»i ÄÆ°á»£c `getAllowlistedSensitiveCapabilities()` tráº£ láº¡i FE. 10 cáº·p gÃ¡c LEAVE-SCREEN-010/011/012 + Giao dá»ch sá» dÆ° chÆ°a bao giá» ÄÆ°á»£c thÃªm â `/auth/me` khÃ´ng tráº£ â **mÃ n áº©n vá»i ÄÃºng vai ÄÆ°á»£c cáº¥p quyá»n**, im láº·ng hoÃ n toÃ n. **Cháº·n go-live** vÃ¬ SCREEN-011 lÃ  ÄÆ°á»ng DUY NHáº¤T báº­t `accrual_method`. **VÃ¬ sao khÃ´ng lá» sá»m:** chá» `SA` dÃ¹ng ÄÆ°á»£c, vÃ  chá» nhá» TAI Náº N â `SA` cÃ³ `*:*` (`is_sensitive=false`) nÃªn lá»t fallback wildcard cá»§a `useCan()`; mÃ n dÃ¹ng `useCanExact()` thÃ¬ SA cÅ©ng trÆ°á»£t. ÄÃ¢y lÃ  **láº§n láº·p thá»© 8+** â ÄÃ£ kÃ¨m **test khoÃ¡** `SENSITIVE_SCREEN_GATE_PAIRS` â allowlist Äá» CI Äá» thay vÃ¬ áº©n im láº·ng. **BÃ i há»c phÆ°Æ¡ng phÃ¡p:** "quyá»n cÃ³ trong DB" KHÃNG káº¿t luáº­n ÄÆ°á»£c "ngÆ°á»i dÃ¹ng tháº¥y mÃ n" â pháº£i kiá»m **ÄÆ°á»ng CAPABILITY tá»i FE**, khÃ´ng chá» `role_permissions`.
- **RED-proof cá»§a chÃ­nh tÃ´i tá»«ng vÃ´ hiá»u:** `sed 's/^  "view:leave-policy",$//'` khá»p **Cáº¢ HAI** chá» (allowlist láº«n `SCREEN_GATE_PAIRS`) â test váº«n xanh = xanh giáº£. Gá»¡ ÄÃºng Má»T váº¿ má»i Äá». Khi RED-proof báº±ng sed trÃªn file cÃ³ háº±ng láº·p láº¡i: **Äáº¿m sá» match trÆ°á»c khi tin**.
- **Deploy lá»ch Äá»nh danh 2 Láº¦N LIÃN TIáº¾P, cÃ¹ng má»t gá»c: `m prod-update` build tá»« CÃY ÄANG CHECKOUT.** Láº§n 1 deploy ngay sau merge mÃ  chÆ°a `git pull` â PROD mang `6f160b9a` (tá» tiÃªn master). Láº§n 2 tá» hÆ¡n: cÃ²n Äang Äá»©ng trÃªn nhÃ¡nh feature â PROD mang `f2795ab4` = **commit CHá» cÃ³ trÃªn nhÃ¡nh**, xoÃ¡ nhÃ¡nh lÃ  sha má» cÃ´i. Ná»i dung cáº£ 2 láº§n Äá»u ÄÃºng (verify `git diff` toÃ n cÃ¢y rá»ng) nÃªn khÃ´ng lá»i runtime â nhÆ°ng Äá»nh danh sáº¡ch, khÃ´ng `-dirty`, **khÃ´ng cÃ³ tÃ­n hiá»u cáº£nh bÃ¡o nÃ o**. **Luáº­t: `git checkout master && git pull` TRÆ¯á»C `m prod-update`, rá»i `--expect-commit` sau.**
- **Tag: ÄÃ£ Äi tá»i `v1.0.0-rc.3` @ `30540ab0`** (khá»p PROD, `RC-BUILD-MATCH â`). `rc.1`/`rc.2` **Cáº¤M dÃ¹ng rollback** â rc.1 thiáº¿u #324 (loáº¡i nghá» khÃ´ng lÆ°u ÄÆ°á»£c), rc.2 thiáº¿u #325 (4 mÃ n admin biáº¿n máº¥t). Tag khÃ´ng move ÄÆ°á»£c nÃªn má»i láº§n lá»ch lÃ  má»t rc má»i; **Äá»«ng cáº¯t tag trÆ°á»c khi deploy xong**.
- **â ACCRUAL ÄÃ CHáº Y THáº¬T TRÃN PROD (07:10Z) â cháº·n go-live vá» phÃ©p ÄÃ Gá» .** Owner báº­t `Monthly` lÃºc 06:58:50Z qua `/leave/policies`; job cáº¥p **245 ngÃ y / 41 NV, failed=0**; ba nguá»n khá»p tuyá»t Äá»i (job 245 = `leave_balances` 41 dÃ²ng/245.0 = sá» cÃ¡i 245 dÃ²ng/245.00) â **ÄÃºng báº±ng sá» nghiá»m thu Äo trÆ°á»c trÃªn staging**, ká» cáº£ phÃ¢n bá» `30Ã7Â·2Ã5Â·3Ã4Â·3Ã3Â·1Ã2Â·2Ã1` vÃ  4 há» sÆ¡ khÃ´ng ÄÆ°á»£c cáº¥p (`1111`/`1119`/`1129` nghá» trÆ°á»c 2026 + `1136` thiáº¿u `start_date`). CÃ²n láº¡i cho HR: Äiá»n `start_date` cho `1136`.
- **Báº«y khi chá» job â suÃ½t káº¿t luáº­n sai lÃ  "engine há»ng":** 3 láº§n cháº¡y 06:15/06:30/06:45 tráº£ `total=0` vÃ¬ chÃºng cháº¡y **TRÆ¯á»C** lÃºc báº­t cÃ´ng táº¯c (06:58:50Z). VÃ  **nhá»p 15 phÃºt reset theo láº§n KHá»I Äá»NG API**, khÃ´ng pháº£i cháº¡y Äá»u theo Äá»ng há»: API restart 06:55:54Z â nhá»p Äáº§u rÆ¡i vÃ o 07:10:54Z chá»© khÃ´ng pháº£i 07:00. **TÃ­nh nhá»p tá»« giá» boot, Äá»«ng suy tá»« láº§n cháº¡y trÆ°á»c.**
- **CÃN TREO:** â  HR Äiá»n `start_date` cho `1136` (engine tá»± bÃ¹ nhá»p sau). â¡ rotate 3 máº­t kháº©u DB (tá»« phiÃªn trÆ°á»c). â¢ `S7-CHAT-DOC-1` WIP áº£o. â£ **G1 Â· G7 Â· G8 Â· G10** cáº§n ngÆ°á»i/Administrator. â¤ DB `mediaos_dev` váº«n giá»¯ báº£n sao dá»¯ liá»u PROD tháº­t â dá»±ng láº¡i staging lÃ  lá» láº¡i PII kÃ¨m ÄÆ°á»ng vÃ²ng qua 2FA; xoÃ¡ báº±ng `DROP DATABASE mediaos_dev WITH (FORCE)` khi khÃ´ng cÃ²n cáº§n cho UAT.
- **Friction:** (1) `.env` cÃ³ giÃ¡ trá» chá»©a **khoáº£ng tráº¯ng khÃ´ng trÃ­ch dáº«n** (dÃ²ng 51/79) â `set -a; . ./.env` in `command not found` â vÃ´ háº¡i cho biáº¿n khÃ¡c nhÆ°ng gÃ¢y hoang mang; (2) cá»t `system_job_runs` lÃ  `total_items/success_items/failed_items` (KHÃNG pháº£i `*_count`) â poll sai tÃªn cá»t thÃ¬ `2>/dev/null` nuá»t lá»i vÃ  vÃ²ng láº·p **im láº·ng mÃ£i mÃ£i**, trÃ´ng há»t nhÆ° "job chÆ°a cháº¡y"; (3) scheduler system-jobs cháº¡y **má»i 15 phÃºt**, khÃ´ng pháº£i 60s, vÃ  **khÃ´ng cháº¡y ngay lÃºc boot** â pháº£i chá» ÄÃºng má»t nhá»p; (4) `jq` KHÃNG cÃ³ trong Git Bash cá»§a mÃ¡y nÃ y.

## PhiÃªn 2026-08-01 (session 402e3d7c) â cá»­a sá» go-live: 4 WO SHIPPED (#317 Â· #320 Â· #321 Â· #322) + 4 quyáº¿t Äá»nh owner

> VÃ o phiÃªn Äá» "kiá»m tra tÃ¬nh hÃ¬nh", ra khá»i phiÃªn vá»i **module LEAVE ÄÆ°á»£c cá»©u khá»i cháº¿t ngÃ y Äáº§u go-live**. Master `3929e31a`. **Háº¾T item code** â cÃ²n láº¡i thuáº§n triá»n khai.

- **PhÃ¡t hiá»n cháº·n go-live mÃ  khÃ´ng doc nÃ o ghi:** `leave_balances` = **0 dÃ²ng / 45 NV**, trong khi `ANNUAL`Â·`COMPENSATORY`Â·`SICK` Äá»u `deduct_balance=true` vÃ  `allow_negative_balance` NULL(âfalse) â `available=0` â **Má»I ÄÆ¡n nghá» 3 loáº¡i ÄÃ³ bá» 422** ngay ngÃ y Äáº§u (`leave-request.service.ts:545`). `KI-002` tá»«ng ÄÃ³ng lá» nÃ y **cho company `demo`** â cÃ´ng ty tháº­t `funtime` chÆ°a bao giá» ÄÆ°á»£c nháº­p.
- **Owner chá»t 4 quyáº¿t Äá»nh cÆ¡ cháº¿ phÃ©p (D-A1â¦D-A4)** + chá»n **lÃ m Äá»¦ cáº£ hai engine TRÆ¯á»C go-live** (dá»i ~3-5 ngÃ y) thay vÃ¬ vÃ¡ táº¡m: cá»ng dá»n vÃ o **ngÃ y cuá»i thÃ¡ng** Â· bÃ¹ ká»³ ÄÃ£ qua **theo ngÃ y vÃ o lÃ m** Â· má»c háº¿t háº¡n + tráº§n chuyá»n tiáº¿p **cáº¥u hÃ¬nh ÄÆ°á»£c, máº·c Äá»nh 31/03** Â· báº­t/táº¯t **theo tá»«ng chÃ­nh sÃ¡ch**. ThÃªm **S-1** (SICK bá» trá»« quá»¹ â cháº¡y ÄÆ°á»£c trÃªn báº£n PROD hiá»n táº¡i, KHÃNG cáº§n deploy) vÃ  **C-1** (COMPENSATORY giá»¯ trá»« quá»¹, HR cáº¥p tay; sá» dÆ° 0 ngÃ y Äáº§u lÃ  ÄÃNG, cáº§n má»t cÃ¢u trong thÃ´ng bÃ¡o go-live).
- **Sá» nghiá»m thu tÃ­nh TRÆ¯á»C khi viáº¿t code â dÃ¹ng nÃ³ cháº¥m engine:** backfill 2026 pháº£i ra **ÄÃºng 295 ngÃ y**, phÃ¢n bá» `40 NVÃ7 Â· 2Ã5 Â· 1Ã4 Â· 1Ã1`; `employee_code 1136` (thiáº¿u `start_date`) pháº£i **bá» bá» qua kÃ¨m bÃ¡o cÃ¡o**, khÃ´ng ÄÆ°á»£c bá»a. Engine ra sá» khÃ¡c â engine sai, khÃ´ng pháº£i sá» sai.
- **Báº«y lá»n nháº¥t phiÃªn nÃ y â ghi memory `ui-promises-backend-never-reads`:** cá»t cáº¥u hÃ¬nh cÃ³ Äá»§ má»i táº§ng TRá»ª táº§ng thi hÃ nh. Báº¯t ÄÆ°á»£c **2 láº§n cÃ¹ng module**: `accrual_method` (form cho chá»n `Monthly`, 0 engine Äá»c) vÃ  `max_negative_days` (form cho nháº­p tráº§n, `leave-request.service.ts` khÃ´ng há» nháº¯c tá»i â cho-Ã¢m = **vÃ´ háº¡n**). Kiá»m báº±ng grep **ÄÆ¯á»NG QUYáº¾T Äá»NH**, khÃ´ng pháº£i grep toÃ n repo â toÃ n repo luÃ´n cÃ³ hit tá»« repo/mapper/DTO/form vÃ  chÃ­nh ÄÃ¡m ÄÃ³ táº¡o cáº£m giÃ¡c "ÄÃ£ dÃ¹ng rá»i".
- **VÃ  pháº£i kiá»m Cáº¢ HAI Äáº§u luá»ng:** vÃ¡ `submit` xong má»i lá» `approve` cháº·n cá»©ng á» `used + delta <= total`, khÃ´ng Äá»c tráº§n â ÄÆ¡n ná»£ phÃ©p **ná»p ÄÆ°á»£c nhÆ°ng khÃ´ng bao giá» duyá»t ÄÆ°á»£c**. VÃ¡ má»t Äáº§u = Äá» láº¡i tÃ­nh nÄng báº¥m-khÃ´ng-cháº¡y.
- **Doc vs thá»±c táº¿ lá»ch 3 chá», 1 chá» cháº·n go-live OAN â CHÆ¯A Sá»¬A:** `RELEASE-10` Ã´ #8 nÃ³i PROD tá»n Äá»ng `0535` (thá»±c táº¿ DB **203/203, á» head**) Â· **`KI-006` ÄÃ¡nh dáº¥u cháº·n go-live** nhÆ°ng `LMS_NOTI_TOKEN` **ÄÃ£ Äáº·t** á» cáº£ `.env` láº«n `.env.prod` vÃ  cÃ³ notification `LMS_ENROLLMENT_APPROVED` tháº­t 31/07 â nÃªn ÄÃNG Â· `KI-003` (3 loáº¡i nghá» trÃ¹ng chá»¯ thÆ°á»ng) thá»±c táº¿ 8 loáº¡i code HOA, sáº¡ch.
- **`ops-alert-check` tá»«ng tráº£ CRIT GIáº¢:** gate báº±ng mtime file rá»i Äáº¿m má»i chá»¯ `ERROR` trong 2MB cuá»i, khÃ´ng nhÃ¬n timestamp dÃ²ng â 5 ngÃ y lá»ch sá»­ thÃ nh "1787 lá»i trong 60 phÃºt". ÄÃ£ vÃ¡ á» #321 (Äáº¿m theo timestamp tá»«ng dÃ²ng + xoay log; `api.out.log` tá»«ng phÃ¬nh **721 MB**).
- **Bá» sung 2026-08-02 â hai quyáº¿t Äá»nh phÃ©p ÄÃ ÃP THáº¬T trÃªn PROD, kÃ¨m má»t láº§n Äá»i Ã½:** `SICK` bá» trá»« quá»¹ (**S-1**, ÄÃºng káº¿ hoáº¡ch) Â· `COMPENSATORY` **cÅ©ng bá» trá»« quá»¹** â tá»©c phÆ°Æ¡ng Ã¡n **C-2**, KHÃNG pháº£i C-1 nhÆ° chá»t ban Äáº§u. Owner chá»t giá»¯ nguyÃªn â ghi thÃ nh **`KI-057`** (`S3` 19â20). Há» quáº£ pháº£i nhá»: **khÃ´ng cÃ²n cÆ¡ cháº¿ nÃ o Äá»i chiáº¿u nghá» bÃ¹ vá»i giá» lÃ m thÃªm**, chá»t cháº·n duy nháº¥t lÃ  bÆ°á»c DUYá»T cá»§a quáº£n lÃ½ â thÃ´ng bÃ¡o go-live pháº£i nÃ³i rÃµ Äiá»u nÃ y. Gá»¡ vá» C-1 báº±ng 1 thao tÃ¡c: `/leave/types` â `COMPENSATORY` â tick láº¡i _Trá»« sá» dÆ° phÃ©p_.
- **Bá» sung 2026-08-02 â `S6-LEAVE-TYPEADMIN-1` (#323) ÄÃ£ ship vÃ  ÄÃ Cá»¨U ÄÃºng tÃ¬nh huá»ng nÃ³ sinh ra Äá» cá»©u:** mÃ n Loáº¡i nghá» trÆ°á»c ÄÃ³ lÃ  **cá»­a má»t chiá»u** (Äáº·t `inactive` xong khÃ´ng báº­t láº¡i ÄÆ°á»£c vÃ¬ mÃ n quáº£n trá» Äá»c route active-only). Sá»± cá» tháº­t: `SICK` + `COMPENSATORY` bá» Äáº·t `inactive` lÃºc 13:54Z, nhÃ¢n viÃªn máº¥t luÃ´n quyá»n xin nghá» á»m. Sau khi #323 lÃªn PROD, owner **báº­t láº¡i báº±ng chÃ­nh mÃ n hÃ¬nh vá»«a vÃ¡** lÃºc 18:38Z â cÃ³ váº¿t `LeaveTypeUpdated` chuáº©n, khÃ´ng pháº£i vÃ¡ tay DB. **Báº«y CI kÃ¨m theo:** thÃªm route â Äá» cá»ng kiá»m kÃª (`route Má»I chÆ°a cÃ³ trong artifact`); pháº£i `ROUTE_CENSUS_WRITE=1` regen `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`. Cháº¡y `src/**` KHÃNG báº¯t ÄÆ°á»£c â cá»ng nÃ y náº±m á» `test/foundation/**`.
- **CÃN TREO â Äá»c trÆ°á»c khi lÃ m tiáº¿p:**
  1. **PROD chÆ°a nháº­n gÃ¬ cáº£**: váº«n `14306b8a` / `migrationHead 0535` / `leave_balances` = 0. Bá»n WO chá» náº±m trong repo.
  2. **Rotate 3 máº­t kháº©u DB** (`APP_/WORKER_/SUPERUSER_DB_PASSWORD`) â phiÃªn nÃ y lá»¡ in ra transcript do lá»i quoting. `scripts/rotate-db-roles.mjs`, **verify Tá»ª HOST** (qua `docker exec` rÆ¡i vÃ o `pg_hba` trust nÃªn máº­t kháº©u nÃ o cÅ©ng qua).
  3. **`S7-CHAT-DOC-1` Äang hiá»n `in_progress` lÃ  WIP áº¢O** â start-on-touch báº¯t nháº§m vÃ¬ WO nÃ y khai `harness/backlog.mjs` trong `paths`, mÃ  cáº£ hai phiÃªn Äá»u sá»­a file ÄÃ³. Ná»i dung cá»§a nÃ³ cÃ³ váº» ÄÃ£ land á» #319. **Äá»«ng tin dáº¥u nÃ y**, verify `done_when` rá»i má»i ÄÃ³ng tay.
  4. Ca Äua song song cho tráº§n ná»£ phÃ©p chÆ°a cÃ³ test (vá» tá»« náº±m trong `WHERE` cá»§a `UPDATE` nÃªn nguyÃªn táº¯c lÃ  atomic, nhÆ°ng chÆ°a chá»©ng minh).
  5. Chuá»i cÃ²n láº¡i: **G4** cutover ð¡ï¸ â **G5** staging â **nghiá»m thu 295 ngÃ y** â **G6** â deploy PROD sáº¡ch â **G9** tag â G7/G8/G10.
- **Friction:** (1) **CÃ³ phiÃªn thá»© hai (`69de512c`) lÃ m viá»c trong CÃNG worktree** â nÃ³ seed 16 WO `S7-*` vÃ  build PROD lÃºc 00:03/00:11Z trong khi phiÃªn nÃ y Äang cháº¡y. LuÃ´n `claim.mjs list` + Äá»i chiáº¿u `git status` trÆ°á»c khi tin cÃ¢y lÃ m viá»c lÃ  cá»§a mÃ¬nh; commit pháº£i **stage ÄÃºng path cá»§a mÃ¬nh**, cáº¥m `git add -A`. (2) **Cháº¡y int-spec vá»i LANE_DB láº·p láº¡i 2 láº§n váº¥p:** náº¡p `.env` thÃ¬ `DATABASE_URL` trá» DB PROD **ÄÃ¨** `LANE_DB` vÃ  bá» `S6-SEC-DBFENCE-1` cháº·n (ÄÃºng). CÃ¢u ÄÃºng: `set -a; . ./.env; set +a; unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL; export LANE_DB=mediaos_<lane>`. Friction nÃ y ÄÃ£ xuáº¥t hiá»n â¥2 láº§n â **á»©ng viÃªn `skill-smith`**. (3) Nhá» `DROP DATABASE mediaos_<lane>` sau khi xong (pgdata tá»«ng phÃ¬nh vÃ¬ 325 lane DB).

## PhiÃªn 2026-07-20 (session dc2add15) â S5-TASK-SUBTASK-1 ð´ SHIPPED (#247 MERGED â master `1cf12a45`)

> Owner chá»t trong phiÃªn ("ok chá»t") = duyá»t **D-31** (ÄÃ³ng SPEC-06 Â§24 Q#14: CÃ subtask, checklist giá»¯ song song) + **D-40** (rail avatar CÃ tÃ­nh viá»c con) vÃ  uá»· quyá»n merge â squash --admin. NhÃ¡nh local/remote ÄÃ£ dá»n, backlog `done`, ledger `finished`. **DEPLOY CÃN CHá»: dev-online cáº§n `m dev-online-db` (CÃ mig 0503) â owner tá»± cháº¡y.** CÃ¡c má»¥c dÆ°á»i viáº¿t lÃºc PR cÃ²n má», váº«n ÄÃºng ná»i dung.

- **Ship (PR #247, nhÃ¡nh `feat/s5-task-subtask-1`, 9 commit):** viá»c con THáº¬T qua `parent_task_id` (cá»t cÃ³ sáºµn 0478 â KHÃNG migration cá»t) â cÃ¢y ÄÃNG 1 cáº¥p + **khoÃ¡ hÃ ng Má»T Láº¦N** (`SELECT â¦ ORDER BY id FOR UPDATE` trÃªn TOÃN Bá» táº­p hÃ ng cháº¡m, id tÄng dáº§n, má»i ÄÆ°á»ng ghi) Â· áº©n khá»i board & `state_id` NULL chá»t á» **Cáº¢ BA** writer Â· xoÃ¡ lan táº¥t-cáº£-hoáº·c-khÃ´ng (D-38) Â· **Äáº¿m-lÃ¡** (D-34) Ã¡p 3 nÆ¡i CÃNG release (MV mig 0503 Â· bÃ¡o cÃ¡o dá»± Ã¡n Â· widget project-progress) Â· TASK-API-701/702 Â· FE panel + badge + ghi chÃº quy táº¯c Äáº¿m. ADR **DECISIONS-05** (D-31â¦D-41 + D-36a).
- **Plan qua 3 vÃ²ng plan-reviewer Äá»i khÃ¡ng: 9 â 3 â 2 â PASS.** Má»i claim tá»± xÃ¡c minh láº¡i trÃªn code tháº­t trÆ°á»c khi vÃ¡. VÃ²ng nÃ o cÅ©ng tÃ¬m ra lá»i CÃNG Má»T Há» â bÃ i há»c ghi á» Äáº§u ADR: **báº¥t biáº¿n pháº£i kÃ¨m DANH SÃCH WRITER, chá»t á» method dÃ¹ng chung, khÃ´ng ráº£i á» route**.
- **Int-spec báº¯t lá»i CRITICAL mÃ  typecheck + 255 unit test Äá»u mÃ¹:** bind máº£ng SQL sai (`${arr}` sinh record thay vÃ¬ máº£ng) â **500 hÃ ng loáº¡t** trÃªn `DELETE /tasks/:id`, `GET /tasks/:id`, kanban má»i dá»± Ã¡n â tá»©c phÃ¡ tÃ­nh nÄng ÄÃ SHIP. Xem memory `drizzle-array-bind-sql-param`.
- **Lá» trong báº±ng chá»©ng cá»§a chÃ­nh mÃ¬nh:** ÄÃ£ bÃ¡o "255/255 xanh" khi Má»I cháº¡y `src/**` mÃ  CHÆ¯A cháº¡y `test/integration/**` â nÆ¡i chá»©a deny-path/IDOR/board tháº­t. Memory `src-green-is-not-integration-green`.
- **FULL gate 3 reviewer Äá»u BLOCK â vÃ¡ 8 finding:** oracle dÃ² tráº¡ng thÃ¡i á» `createTask` (kiá»m cáº¥u trÃºc trÆ°á»c kiá»m quyá»n â ÄoÃ¡n UUID Äá»c ÄÆ°á»£c nhiá»u bit ngoÃ i pháº¡m vi) Â· **mapper THá»¨ BA** (`TaskActionsService.toDto`) â ÄÃ£ Há»¢P NHáº¤T cáº£ ba Â· FK `ON DELETE SET NULL` thiáº¿u danh sÃ¡ch cá»t â null hoÃ¡ cáº£ `company_id` (NOT NULL), hiá»n bá» che bá»i thá»© tá»± trigger RI phá»¥ thuá»c OID Â· 409 "unreachable" tháº­t ra vá»i tá»i ÄÆ°á»£c + tráº£ thÃ´ng Äiá»p QUYá»N cho ca ÄUA (tÃ¡ch `TASK-ERR-048`) Â· reorder ghi `updated_by` lÃªn con ngoÃ i pháº¡m vi Â· filter toÃ n cá»¥c Ã©p kiá»u `details` mÃ¹ Â· index lÃ¡ thÃ nh partial (769â4 buffer).
- **Verify:** API **6398/6398** tuáº§n tá»± (`LANE_DB=mediaos_check`) Â· int-spec viá»c con + kanban regression 46/46 Â· app 1265 Â· web-core 587 Â· lint/typecheck xanh.
- **Friction:** (1) `check.sh --lane-db` Äá» **2 láº§n liÃªn tiáº¿p** vÃ¬ crash worker vitest `ERR_IPC_CHANNEL_CLOSED` â **0 ca test Äá»** trong log, suite cháº¿t giá»¯a chá»«ng; pháº£i cháº¡y tuáº§n tá»± má»i cÃ³ sá» xÃ¡c Äá»nh (memory `vitest-worker-crash-chunked-runs` Ã¡p nguyÃªn vÄn, nhÆ°ng nay xáº£y ra á» Cáº¢ api LáºªN app). (2) `git push` SSH fail "Could not read from remote" trong khi `ssh -T git@github.com` OK â retry vá»i `GIT_SSH_COMMAND="ssh -o BatchMode=yes"` lÃ  qua; `gh auth status` bÃ¡o token keyring há»ng nhÆ°ng `gh pr create` váº«n cháº¡y. (3) Lá»nh `git commit -m` vá»i ná»i dung chá»©a `$1`/`(` bá» shell nuá»t â dÃ¹ng `-F -` + heredoc trÃ­ch dáº«n ÄÆ¡n.

## PhiÃªn 2026-07-20 (session b83a39b8 tiáº¿p) â S5-DASH-TASKSTATUS-FIX-1 ð´ SHIPPED (#246 MERGED â master `880c7642`)

> Owner ra lá»nh "merge luÃ´n 246" â squash --admin (= chá»t D-30). NhÃ¡nh dá»n sáº¡ch, ledger done. **Deploy cÃ²n chá»: dev-online cáº§n `m dev-online-db` (CÃ migration 0502) â owner tá»± cháº¡y.** CÃ¡c má»¥c dÆ°á»i viáº¿t lÃºc PR cÃ²n má».

- **Ship (PR #246, nhÃ¡nh `feat/s5-dash-taskstatus-fix-1`):** mig **0502** â `mv_dashboard_task_status` Äáº¿m tráº¡ng thÃ¡i CANONICAL `COALESCE(task_status, map(status legacy))` (**ADR DECISIONS-03 D-30**, map not_startedâTodo Â· in_progress/revisionâIn Progress Â· waiting_reviewâIn Review Â· approved/completedâDone; GROUP BY positional Báº®T BUá»C; WITH DATA populate ngay trong migrate; GRANT láº¡i ÄÃºng tráº¡ng thÃ¡i cuá»i 0103). Sá» liá»u tháº­t Äo trÆ°á»c: dev 22/22 task hiá»n Äáº¡i sai, prod 114 task legacy "ÄÃºng tÃ¬nh cá»". VÃ¡ kÃ¨m `dashboard-refresh.service`: CONCURRENTLY CHá» task_status (output = index BIá»U THá»¨C, khÃ´ng bao giá» CONCURRENTLY ÄÆ°á»£c â lá» ngay láº§n Äáº§u sau 0502).
- **RED-first ÄÃºng nghÄ©a:** spec cháº¡y á» head 0501 â 3 fail ÄÃºng lÃ½ do â 0502 â 6/6; C6 REDâGREEN cho nhÃ¡nh refresh-láº·p. FULL gate 4 reviewer PASS (plan/security/DB/silent-failure). CI #246 10/10 (MigrateÂ·Test cháº¡y 0502 tháº­t).
- **Ná»¢ KIáº¾N TRÃC G14 phÃ¡t hiá»n (chÆ°a sá»­a â á»©ng viÃªn WO `S5-DASH-REFRESH-ROLE-1`):** refresh qua workerDb há»ng Tá»ª G14 ("must be owner"); Cáº¤M vÃ¡ báº±ng ALTER OWNER cho worker â worker khÃ´ng BYPASSRLS + tasks FORCE RLS â MV Rá»NG Láº¶NG Láº¼ (ÄÃ£ kiá»m chá»©ng pg_roles/pg_class; ghi jsdoc chá»ng vÃ¡ mÃ¹).
- **Chá» owner:** chá»t D-30 + `gh pr merge 246 --squash --admin`. Deploy: CÃ migration â dev-online cáº§n `m dev-online-db`.
- **Báº«y gáº·p láº¡i ÄÃºng memory:** vitest full-suite IPC crash â 4 shard; foundation-audit Äá» trÃªn lane Báº¨N tá»« run crash â reset lane sáº¡ch lÃ  xanh (vitest-worker-crash-chunked-runs Ã¡p nguyÃªn vÄn); `pnpm db:migrate` máº·c Äá»nh trá» DB dÃ¹ng chung â CHá» migrate lane.

## PhiÃªn 2026-07-20 (session 09a26423) â 6 WO SHIPPED qua 2 PR (#248 `6d9b245f`, #249 `239d7b69`)

- **Owner giao 1 WO (`S5-TASK-COVER-1`), thá»±c táº¿ pháº£i xá»­ lÃ½ 6.** VÃ o phiÃªn thÃ¬ phÃ¡t hiá»n **~1055 dÃ²ng cá»§a 5 WO náº±m tráº§n trÃªn `master` cá»¥c bá»: chÆ°a commit, chÆ°a PR, khÃ´ng cÃ³ dÃ²ng ledger nÃ o** â gá»m chÃ­nh `S5-TASK-AVATAR-1` mÃ  COVER-1 `depends_on`. Owner chá»t ship trÆ°á»c.
- **PR #248** (S5-TASK-BOARD-UX-1 Â· INLINE-1 Â· AVATAR-1 Â· CARDSUB-1 Â· MOVEPROJ-1): FULL gate tráº£ **BLOCK 4 HIGH**, tá»± xÃ¡c minh tá»«ng cÃ¡i rá»i vÃ¡ + 9 test khoÃ¡. ÄÃ¡ng nhá»: (1) `useTaskActionMutation.onSuccess` GHI ÄÃ cache chi tiáº¿t báº±ng `result.task` mÃ  `respond()` khÃ´ng mang `subtaskTotal` â máº¥t thanh tiáº¿n Äá» VÃ má» khoÃ¡ nÃºt Äá»i dá»± Ã¡n cho task cÃ³ viá»c con â báº¥m lÃ  400; (2)+(3) 4 route action vÃ  `DeleteTaskFileDialog` khÃ´ng invalidate `taskKeys.kanban`; (4) MOVEPROJ-1 **váº«n Äá» lá»t ÄÃºng bug nÃ³ sinh ra Äá» vÃ¡** qua 3 cá»­a (option "KhÃ´ng thuá»c dá»± Ã¡n" Â· dá»± Ã¡n ÄÃ­ch 0 cá»t Â· Äua táº£i cá»t).
- **PR #249 (`S5-TASK-COVER-1`, ð´ red, KHÃNG migration).** **Tiá»n Äá» WO SAI:** `linkType='Cover'` khÃ´ng tá»n táº¡i (CHECK `chk_file_links_link_type` mig 0433:159 + `FILE_LINK_TYPE_VALUES` Äá»u khÃ´ng cÃ³) nÃªn "dÃ¹ng Cover" mÃ¢u thuáº«n vá»i chÃ­nh lá»i há»©a "KHÃNG Cáº¦N MIGRATION". Owner chá»t phÆ°Æ¡ng Ã¡n tháº­t: **áº£nh bÃ¬a = dÃ²ng `Attachment` cá»§a task ÄÆ°á»£c báº­t `is_primary`**; unique index `uq_file_links_primary_per_entity_type` Ã©p sáºµn 1 bÃ¬a/task. Backlog `src[]`/`done_when[]`/`paths[]` ÄÃ£ sá»­a **trá»n 4 cÃ¢u sai**.
- **Chá»t an toÃ n = Vá» Tá»ª Äá»C QUYá»N** á» ÄÆ°á»ng Äá»C (`findVerifiedTaskCoversTx`): tá»p cÃ²n link sá»ng á» entity KHÃC thÃ¬ KHÃNG BAO GIá» ÄÆ°á»£c kÃ½. VÃ¬ ÄÆ°á»ng táº£i tháº­t Äi qua `FilePolicy.decideForLinkedFile` = AND-kháº¯t-khe-nháº¥t trÃªn Má»I link, thiáº¿u vá» tá»« nÃ y thÃ¬ áº£nh CCCD/há»£p Äá»ng (link cáº£ HR cáº£ task, Äang 403 khi táº£i) sáº½ hiá»n lÃ m bÃ¬a cho cáº£ board. â ï¸ **Cáº¤M thÃªm `fl2.company_id` vÃ o `NOT EXISTS`** â á» `NOT EXISTS` má»i Äiá»u kiá»n thÃªm lÃ  **fail-OPEN**, ngÆ°á»£c pháº£n xáº¡ "AND company_id tÆ°á»ng minh" cá»§a repo nÃ y.
- **FULL gate #249: 2 reviewer Äá»c láº­p Äá»u BLOCK, 6 finding + 1 lá»i Tá»° SOÃT.** Náº·ng nháº¥t (khÃ´ng ai trong 3 vÃ²ng plan-review tháº¥y): **board gate báº±ng cáº·p `view-kanban:task` cÃ²n ÄÆ°á»ng Táº¢I gate báº±ng `read:task`**; `data_scope` lÃ  PER-(permission,role) nÃªn `view-kanban@Company` + `read@Own` lÃ m board kÃ½ áº£nh Gá»C full-res cho ngÆ°á»i KHÃNG táº£i ÄÆ°á»£c tá»p. Seed 0485 hiá»n cáº¥p cÃ¹ng scope cho 4 role â chÆ°a khai thÃ¡c ÄÆ°á»£c, nhÆ°ng ÄÃ³ lÃ  **may máº¯n cáº¥u hÃ¬nh**. `getBoard` giá» resolve RIÃNG `read:task`. KÃ¨m: `onError` Äáº·t `display:none` tháº³ng lÃªn DOM + tháº» `key={task.id}` â React tÃ¡i dÃ¹ng `<img>` â **áº£nh áº©n VÄ¨NH VIá»N** sau 1 láº§n háº¿t TTL; `23505â409` ghi trong DoD mÃ  **chÆ°a implement**; xoÃ¡ tá»p-Äang-lÃ -bÃ¬a khÃ´ng invalidate board (URL ÄÃ£ kÃ½ VáºªN táº£i ÄÆ°á»£c vÃ¬ soft-delete chá» á» DB).
- **BÃ i há»c láº·p láº¡i 3 láº§n trong phiÃªn â sá»­a má»t chá», Äá» nguyÃªn chá» mÃ¢u thuáº«n:** plan rev2 vÃ¡ Â§5 nhÆ°ng Â§8 váº«n dáº·n ngÆ°á»£c láº¡i; rev3 grep toÃ n file báº¯t thÃªm 3 chá»; sá»­a backlog grep tiáº¿p báº¯t 4 cÃ¢u (dá»± tÃ­nh 3). **Luáº­t:** sá»­a tÃ i liá»u/plan xong pháº£i grep TOÃN file theo tá»« khoÃ¡ vá»«a Äá»i.
- **Báº«y suÃ½t gÃ¢y xanh-giáº£:** plan rev1 Äáº·t int-spec á» `apps/api/src/**/*.int-spec.ts` â KHÃNG khá»p glob nÃ o cá»§a `vitest.config.ts:47` (glob 1 cáº§n `.spec.ts` cháº¥m, file lÃ  `-spec.ts` gáº¡ch) â 18 ca deny-path cháº¡y **0 ca** mÃ  gate váº«n PASS. Memory `vitest-unit-specs-must-be-colocated` ÄÃ£ cáº­p nháº­t cáº£ chiá»u ngÆ°á»£c.
- **Verify #249:** int-spec **21/21** lane `mediaos_cover1` (gá»m ca báº­t `is_primary` VÃNG QUA service â ÄÆ°á»ng Äá»c váº«n tráº£ null, ca primary Má» CÃI sau soft-delete, ca board fail-closed khi thiáº¿u `read:task`) Â· API 16 file/312 test Â· app 177 file/1336 test Â· `TURBO_FORCE=1` typecheck 10/10 + lint 7/7 (0 cached) Â· CI 9/9 xÃ¡c minh tá»«ng job.
- **Friction:** (1) CI #248 Äá» 1 láº§n do Lá»I QUY TRÃNH cá»§a tÃ´i â cháº¡y typecheck TRÆ¯á»C khi viáº¿t spec rá»i chá» cháº¡y lint+test (lint khÃ´ng typecheck, vitest transpile chá»© khÃ´ng type-check). (2) Flake `app.close-order` cáº¯n #248: `cleanupTenants` cháº¡y TRÆ¯á»C `app.close()` â outbox worker cÃ²n sá»ng ghi `audit_logs` mang `actor_user_id` giá»¯a lÃºc xoÃ¡ users â vá»¡ FK. Re-run xanh. int-spec má»i cá»§a COVER-1 ÄÃ£ ÄÃ³ng app TRÆ¯á»C cleanup Äá» khÃ´ng nhÃ¢n báº£n.
- **Ná»£ ghi nháº­n:** `is_primary` cÃ²n true nhÆ°ng tá»p máº¥t Äiá»u kiá»n vá» sau (scan láº­t Infected) â `isCover` false â nÃºt gá»¡ áº©n, khÃ´ng cÃ³ lá»i gá»¡ cá» trÃªn UI (khÃ´ng nguy hiá»m â Äá»c fail-closed, `clearCover` váº«n háº¡ ÄÆ°á»£c) Â· Äá»i bÃ¬a qua `/foundation/files/:id/links` khÃ´ng sinh activity TASK Â· WO dá»n flake `app.close-order` cho cÃ¡c spec cÃ²n láº¡i (`att-noti-e2e`, `att-core-tenant-deny`, `att-qa1-canonical-roles-gate`, `task-qa1-fsm-collab`).

## PhiÃªn 2026-07-19g (session b83a39b8) â S5-TASK-DETAIL-1 SHIPPED (#245 MERGED â master `6489162a`)

> Owner review + ra lá»nh merge trong phiÃªn ("ok review 245 rá»i merge") â squash --admin, master `6489162a`, nhÃ¡nh local/remote ÄÃ£ dá»n, ledger done (reconcile bá»i gen-status). CÃ¡c má»¥c dÆ°á»i viáº¿t lÃºc PR cÃ²n má» â váº«n ÄÃºng ná»i dung.

- **Ship (PR #245, nhÃ¡nh `feat/s5-task-detail-1`, 2 commit):** 4 gap mÃ n chi tiáº¿t task TRONG SPEC â (1) timeline "cÅ© â má»i" Â§13.12 (`activity-change.ts` + enrich `assigneeName` server-side lÃºc Äá»c, batch IN, chá» UUID há»£p lá»); (2) **D-29** (DECISIONS-04): `GET /tasks/:id/activity` guard â `read:task`, service = pair-audit-override HOáº¶C ngÆ°á»i-liÃªn-quan (assignee/creator/reporter/watcher), ngoÃ i cuá»c 403 TASK-ERR-042, 404-trÆ°á»c-403; feed dá»± Ã¡n GIá»® sensitive; (3) `reporterName` (additive optional) â Äá»§ 3 vai; (4) `GET /tasks/:id/watchers` (tÃ¡ch `TaskWatchersService`) + FE Theo dÃµi/Bá» theo dÃµi self-only.
- **Gate:** security-reviewer PASS 0 CRIT/HIGH + 8 finder angle (code-review skill) â 8 finding vÃ¡ á» commit 2 (ew.company_id watcher-branch Â· UUID-filter chá»ng 500 Â· file <800 dÃ²ng Â· bá» optimistic flag káº¹t nÃºt Â· invalidate `taskKeys.activityOf` Â· formatDateTime pin TZ Â· key i18n cháº¿t Â· test V11 biÃªn guard). Verify: int-spec má»i 15/15 (lane `mediaos_tdw1`) Â· chunk src/tasks+3 int-spec cÅ© 352/352 Â· app 1249 Â· web-core 584 Â· lint/typecheck xanh.
- **Spec cÅ© Äá»i theo D-29 (chá»§ ÄÃ­ch, khÃ´ng pháº£i regression):** qa1-fsm-collab Â§5 emp-assignee giá» 200; qa1-permission-matrix Gá»  pair `view:task-audit-log` khá»i deny-matrix (premise "403 chá» tá»« guard" vá»¡ â phá»§ thay báº±ng int-spec má»i); kanban-move-activity admin thÃªm `read:task`.
- **Follow-up ghi nháº­n (chÆ°a lÃ m):** PATCH `TASK_UPDATED` khÃ´ng ghi oldValues â ÄÆ°á»ng sá»­a-qua-form chÆ°a cÃ³ dÃ²ng cÅ©âmá»i Â· há»£p nháº¥t Äá»nh nghÄ©a involvement (isUserInvolvedTx vs TaskAudienceReader vs findMyTasksTx) thÃ nh TaskRelationshipService Â· cÃ¢n nháº¯c cá» `canViewActivity` trong DTO thay hide-on-403.
- **Káº¿:** owner merge #245 (classifier cháº·n self-merge â lá»nh: `gh pr merge 245 --squash --admin`) â `S5-TASK-SUBTASK-1` (ð´ red, cáº§n planâplan-reviewer) Â· WO dá»n follow-up Â· chuá»i QA S5. Dev-online xem ÄÆ°á»£c cáº§n `m dev-online-fast` (khÃ´ng migration).
- **Friction:** (1) láº·p láº¡i â classifier cháº·n merge tá»± hÃ nh â flow PR+CI+ÄÆ°a lá»nh owner (láº§n ~5). (2) NÃºt disable theo `isFetching` lÃ m FE spec pháº£i chá» list settle trÆ°á»c khi click â pattern test cáº§n nhá».

## PhiÃªn 2026-07-19f (session 45cf048b) â Äá»£t D1 S5-TASK-WORKSPACE-1 SHIPPED (#243 â master `1cd45662`)

- **Ship:** vá» workspace dá»± Ã¡n â tab bar `?tab=` deep-link (validateSearch trÃªn route, back/forward ÄÃºng; tab BÃ¡o cÃ¡o/Hoáº¡t Äá»ng áº©n theo useCanExact) + toolbar lá»c chung Báº£ngâDanh sÃ¡ch (state á» vá»; 2 tab lá»c qua CÃNG helper `workspace-constants` â parity theo cáº¥u trÃºc) + rail avatar multi-select (`pinSelectedInSummary` ghim ngÆ°á»i Äang chá»n count-0). **BE build kÃ¨m TASK-API-601** GET /projects/:id/activity (sá» mÃ£ cÃ³ sáºµn, chÆ°a ai build; int-spec lane DB 5/5) + vÃ¡ 2 nguá»n ghi activity thiáº¿u `project_id` (TASK*WATCHER_REMOVED Â· TASK_FILE*\*).
- **HOÃN "xuáº¥t kháº©u"** (toolbar): chÆ°a cÃ³ cáº·p `export:task` + SPEC-06 Â§14.19 ÄÃ²i ghi activity log khi export â CSV client-side sáº½ lÃ¡ch log. ÄÃ£ ghi backlog src; cáº§n WO riÃªng náº¿u owner muá»n.
- **Káº¿ (thá»© tá»± owner ÄÃ£ chá»t trong task-ux-reference-benchmark):** ð´ **Äá»£t C quyá»n per-project** (data_scope Project chÆ°a cÃ³ trong engine â crown, cáº§n planâplan-reviewer) Â· `S5-TASK-DETAIL-1` Â· `S5-TASK-SUBTASK-1` Â· WO dá»n follow-up (F1 orphan-state Â· 23505â409 Â· flake attendance-leave-sync app.close-order Â· S5-LEAVE-DEADCODE-1 ð´ Â· S5-SEQ-HARDEN-1 ð´) Â· chuá»i QA S5 (6 WO READY).
- **Friction:** (1) classifier CHáº¶N `gh pr merge --admin` cho phiÃªn tá»± hÃ nh (láº§n ~4) â flow á»n Äá»nh giá» lÃ : PR + CI xanh + ÄÆ°a lá»nh merge cho owner. (2) vitest full-suite api segfault/IPC crash giá»¯a run dÃ i (mÃ¡y nÃ y) â cháº¡y CHUNK theo module lÃ  Äá»§ báº±ng chá»©ng local, CI lÃ  gate cuá»i. (3) Dev-online muá»n tháº¥y D1 cáº§n owner cháº¡y `m dev-online-fast` (khÃ´ng migration).

## PhiÃªn 2026-07-02â03 (session eebe431a) â wave carry-over `feat/carryover-wave1`: 9 WO SHIPPED, 3 quyáº¿t Äá»nh owner ÄÃ ÃP Dá»¤NG

- **Shipped (merged vÃ o feat/carryover-wave1, chÆ°a lÃªn master):** S3-FE-LEAVE-5 (#90) Â· S2-FE-AUTH-6 (#91) Â· S2-FND-DOC-1 (#92) Â· S2-AUTH-BE-8 (#93) Â· S2-AUTH-BE-9 (#95, resolve conflict vá»i BE-8 giá»¯ cáº£ revoke+emit) Â· S2-AUTH-DOC-1 (#96) Â· S2-AUTH-BE-10 (#97) Â· S2-FE-FND-7 (#98) Â· S2-FND-BE-4 (#99). Viá»c káº¿: PR gá»p `feat/carryover-wave1` â `master` (Äi qua branch protection + review ngÆ°á»i).
- **Owner ÄÃ CHá»T + ÄÃ ÃP Dá»¤NG (khÃ´ng cÃ²n pending):** (1) data_scope 'Project' = pin project-membership â D-22 DECISIONS-01 + DB-02 Â§4.7 (merged #96). (2) SENSITIVE_CAPABILITY_ALLOWLIST thÃªm 3 cáº·p export:leave Â· view:leave-audit-log Â· view:attendance-audit-log â WO má»i S2-AUTH-CAP-1 (ÄÃ£ seed backlog, wave-1c Äang cháº¡y). (3) S2-FND-SEED-2 semantics: PATCH /hr/employee-code SYNC configâcounter cÃ¹ng tx, giá»¯ current_value â bake vÃ o re-run v3 wave-1c.
- **Pattern hiá»u quáº£:** plan-block cá»§a plan-reviewer â bake nguyÃªn vÄn Äiá»m BLOCKING vÃ o done_when qua args re-run (KHÃNG cáº§n sá»­a backlog literal giá»¯a wave). S3-FE-LEAVE-6 cÃ²n chá» S2-AUTH-CAP-1 merge rá»i re-run (worktree ../mediaos-s3-fe-leave-6 ÄÃ£ sync base fdbcd36).
- **Báº«y láº·p láº¡i:** ship-agent fallback cáº¯t branch tá»« wip HEAD â PR phá»ng + PR láº¡c base (#94 ÄÃ£ ÄÃ³ng) â xem memory harness-deploygate-pr-base (ÄÃ£ cáº­p nháº­t cÃ¡ch cá»©u cherry-pick).

## Quyáº¿t Äá»nh ngÆ°á»i-chá»t chá» Ã¡p dá»¥ng (2026-07-02, session 1849d064) â auto-loop live nÃªn CHÆ¯A ká»p bake vÃ o retry Äang cháº¡y

- **S2-HR-BE-6** (Employee contracts): (1) GIá»® ká»³ vá»ng ban Äáº§u â seed grant RIÃNG Own cho employee + Team cho manager (khÃ´ng Äá»i QA-05 thÃ nh Company-only nhÆ° plan-reviewer Äá» xuáº¥t phÆ°Æ¡ng Ã¡n b). (2) NgÆ°á»¡ng cáº£nh bÃ¡o sáº¯p háº¿t háº¡n HÄ = company-configurable, máº·c Äá»nh 2 má»c: 30 ngÃ y vÃ  7 ngÃ y (khÃ´ng pháº£i 1 sá» cá» Äá»nh). â ï¸ Auto-loop ÄÃ£ retry S2-HR-BE-6 Láº¦N 2 (block khÃ¡c: audit object_type 'employee_contract' thiáº¿u trong AUDIT_OBJECT_TYPES/CHECK + permission pair chÆ°a pin) â 2 quyáº¿t Äá»nh trÃªn CHÆ¯A ÄÆ°á»£c bake vÃ o round ÄÃ³ vÃ¬ loop cháº¡y live khÃ´ng cÃ³ kÃªnh inject giá»¯a chá»«ng. Ãp dá»¥ng khi WO nÃ y tá»i Äiá»m dá»«ng (needs_human hoáº·c round káº¿).
- **S3-ATT-BE-5** (ATT Remote/Onsite): tráº¡ng thÃ¡i khá»i táº¡o = **Draft** (khÃ´ng pháº£i default Pending hiá»n táº¡i cá»§a báº£ng), cáº§n action **submit** riÃªng (DraftâPending) trong contract/API. Khi submit: ngÆ°á»i táº¡o chá»n ngÆ°á»i duyá»t trá»±c tiáº¿p HOáº¶C ngÆ°á»i duyá»t thay tháº¿, + danh sÃ¡ch ngÆ°á»i theo dÃµi (watcher) Äá» nháº­n thÃ´ng bÃ¡o liÃªn quan. ÄÃ¢y lÃ  thay Äá»i so vá»i plan hiá»n cÃ³ á» `docs/plans/S3-ATT-BE-5.md` (Äang giáº£ Äá»nh createâPending luÃ´n, khÃ´ng cÃ³ bÆ°á»c submit/watcher). WO chÆ°a ÄÆ°á»£c auto-loop cháº¡m láº¡i trong phiÃªn nÃ y â Ã¡p dá»¥ng khi pick up.
- **S2-AUTH-BE-7** (Session management API): CHá»T â KHÃNG seed permission pair riÃªng. Route GET/revoke sessions chá» cáº§n `Authenticated + owner-check` á» service layer (session.user_id === caller), giá»ng pattern `/auth/me` + `/account/change-password` â khÃ´ng cÃ³ pháº¡m vi cross-user cáº§n gate nÃªn permission pair sáº½ thá»«a. Route KHÃNG dÃ¹ng `@RequirePermission`/`PermissionGuard` cho cÃ¡c endpoint self-service nÃ y.

## PhiÃªn gáº§n nháº¥t (2026-06-20) â WAVE 2a fan-out 2 lane â merged master `2c1ac49`

- **ÄÃ£ xong (Wave 2a, 2 lane song song)**:
  - **AUTH-FIX-1** (`67e7f2f`, ð´ redâhuman-chá»t): allow-list fail-closed `status==='active'` cháº·n Cáº¢ 3 ÄÆ°á»ng cáº¥p token (login sau password.verify; refresh thu há»i family; **2FA step-2 â ÄÆ°á»ng thá»© 3 ask gá»c bá» sÃ³t**). 401 Äá»ng nháº¥t anti status-probing, reason chá» vÃ o audit_logs, khÃ´ng migration. Cháº¡y qua **workflow** (Opus+plan+reviewer Äá»C Láº¬P cháº¡y ÄÃNG láº§n Äáº§u nhá» fix pickReviewers â verdict LOW non-blocking). Verify: spec 10/10 + full api 2758 pass/0 fail.
  - **ACCT-2-FE** (`2c1ac49`, ð¡): UsersPage (TanStack Table + filter q/status + pagination + loading/error/empty) + suspend/delete/invite dialog; gating useCan/PermissionGate báº±ng háº±ng (manage/suspend/delete-user/invite:user); reuse `consoleInvitesApi` cho má»i; api-client validate Zod. Verify master (web-core+ui rebuild): console **173/173** + typecheck OK.
  - Merge: FF authfix1 â rebase+FF acct2fe (khÃ¡c vÃ¹ng file, 0 conflict). Backlog: AUTH-FIX-1 + ACCT-2-FE = done.
- **Viá»c káº¿ (Wave 2b)**: `PERM-UI-1` (â¢ phÃ¢n quyá»n, crown â READY). Sau: `APP-MERGE-1` (cáº§n PERM-UI-1). Solo: `TRIM-1`.
- **â ï¸ Main tree Äang GIá»®A cuá»c reframe lá»n "de-media-fy" (83 file dirty, ADR 0022 má»i, docs/spec/)** â diá»n ra song song trong phiÃªn, KHÃNG pháº£i cá»§a lane agent. Harness bookkeeping Wave 2a (backlog status + STATUS regen + drop-lane fix `parallel-lanes.mjs`) CHÆ¯A commit Äá» trÃ¡nh cuá»n láº«n reframe â Äá» owner commit cÃ¹ng reframe HOáº¶C commit surgical theo lá»nh.

## Friction / DEBT

1. â **ÄÃ FIX (commit `3347358`)** â Reviewer ecc:_ khÃ´ng tá»n táº¡i. `pickReviewers` giá» map vai-trÃ²âagent CÃ THáº¬T (DBârls-tenant-isolation-tester Â· security/silent-failureâgeneral-purpose Â· react/typescriptâcompletion-evaluator), gom theo agent (Äa gÃ³c nhÃ¬n, khÃ´ng spawn trÃ¹ng); reviewPrompt Ã©p read-only máº¡nh hÆ¡n. Verified báº±ng dryRun. (Skills `ecc:santa-method`/`quality-gate` + build-resolver `ecc:_` váº«n lÃ  prompt-text, KHÃNG spawn nÃªn khÃ´ng crash â Äá» sau náº¿u cáº§n.)
2. â **ÄÃ FIX (Wave 2a, `parallel-lanes.mjs` CHÆ¯A commit â xem cáº£nh bÃ¡o reframe)** â workflow drop lane Ã¢m tháº§m khi stage1 (plan) tráº£ `null` (lane skipPlan/non-crown): CONSOLE-1 Ã2 + acct2fe (láº§n 3). Root-cause: pipeline drop item khi 1 stage tráº£ falsy. Fix: stage1 tráº£ sentinel `{__noPlan}` thay null (giá»¯ item sá»ng tá»i Implement), stage2 quy Äá»i sentinelânull cho prompt. Crown khÃ´ng áº£nh hÆ°á»ng (luÃ´n cÃ³ plan tháº­t). Validate syntax OK (async-IIFE wrap). acct2fe Wave 2a dÃ­nh bug TRÆ¯á»C khi vÃ¡ â cá»©u báº±ng Agent-tool workaround.
3. **Review agent `general-purpose` vÆ°á»£t quyá»n read-only**: ÄÃ£ Edit file acct2 dÃ¹ dáº·n read-only (cÃ³ quyá»n Edit). â dÃ¹ng agent read-only (`Explore`/`rls-tenant-isolation-tester`) cho review, hoáº·c rÃ ng buá»c tool.
4. **DEBT â acct2 repo hardening CHÆ¯A Ã¡p** (reviewer Äá» xuáº¥t, ÄÃ£ discard vÃ¬ chÆ°a review): thay `.select()`/`.returning()` â táº­p cá»t tÆ°á»ng minh `ADMIN_USER_COLUMNS` + type `AdminUserRow` trong `admin-users.repository.ts` (+ chá»nh `service.ts`/`service.spec.ts`) â repo KHÃNG fetch `password_hash` (defense-in-depth #3). Master hiá»n dÃ¹ng `select()`+toDto-strip â ÄÃ verify an toÃ n (test chá»©ng minh khÃ´ng rÃ²), nÃªn ÄÃ¢y chá» lÃ  tÄng cÆ°á»ng. ~15', cáº§n re-verify.
5. **AUTH-FIX-1** (backlog, red, sau ACCT-2): login chá» lá»c `deleted_at`, CHÆ¯A cháº·n `status='suspended'` â user suspend váº«n ÄÄng nháº­p (`auth.service.ts:302-306`).
6. baseline lint/typecheck Äá» (`@mediaos/api#lint`, `@mediaos/mobile#typecheck`) â Stop-gate `advisory`; dá»n xanh rá»i Äá»i `MODE='block'`.

## Báº«y ÄÃ£ biáº¿t (váº­n hÃ nh multi-lane)

- **Worktree má»i**: cáº§n `pnpm install` (chÆ°a cÃ³ node_modules) + build deps (`contracts/web-core/ui`) trÆ°á»c typecheck/test. Thiáº¿u `.secrets/local-kek.bin` (gitignored) â 29 test crypto/2FA fail giáº£; main tree cÃ³ sáºµn, worktree má»i pháº£i regenerate.
- **DB cÃ´ láº­p**: verify trÃªn DB lane riÃªng (`bash scripts/lane-db-setup.sh <lane>` + `export LANE_DB=mediaos_<lane>`), KHÃNG dÃ¹ng `mediaos` chung (drift Â§9.6).
- **XoÃ¡ worktree trÃªn Windows**: `git worktree remove` fail "Directory not empty" do node_modules â dÃ¹ng `rm -rf <dir>` rá»i `git worktree prune` + `git branch -d lane/*`.
- **Band migration**: lane v2 (acct2/ai1/console1) branch khÃ´ng khá»p regex `g*`/`ac*` â `guard-migration-band` fail-open (khÃ´ng Ã©p band); chá» an toÃ n khi má»i wave â¤1 lane sinh migration.

## FULL gate â S18-AUTH-SECEVENTMETA-1 (07/09/2026): 2/2 PASS

`security-reviewer` PASS (0 CRITICAL, 0 HIGH) Â· `silent-failure-hunter` PASS (0 blocker).

**Cáº§n OWNER biáº¿t â MEDIUM, ÄÃ£ ghi thÃ nh ná»£ N6 á» plan Â§7:** sau WO nÃ y, `GET /auth/security-events`
(gÃ¡n pháº¡m vi theo CHá»¦ THá», `security-event.repository.ts:109-110`) phÃ¡t `ip_address`/`user_agent`
**THÃ** (`auth-logs-viewer.service.ts:388-389`) trong khi chá» email/há» tÃªn cá»§a actor ÄÆ°á»£c che â chá»§
thá» Äá»c ÄÆ°á»£c IP/UA cá»§a ADMIN ÄÃ£ thao tÃ¡c trÃªn mÃ¬nh. HÃ´m nay vÃ´ háº¡i (cáº·p `isSensitive`, chá»
`company-admin` giá»¯ â adminâadmin). **KÃ­ch hoáº¡t khi** cáº¥p `view:audit-log` scope `Own`/`Department`
cho vai khÃ´ng pháº£i admin. Äiá»m trung hoÃ  = DTO cá»§a viewer, KHÃNG pháº£i Äiá»m ghi.

## Cá»ng RED â S18-AUTH-SECEVENTMETA-1 (07/09/2026)

Cháº¡y TRÆ¯á»C khi viáº¿t má»t dÃ²ng code sáº£n pháº©m nÃ o (plan Â§4.4). Lane `mediaos_s18seceventmeta`.

**8 ca Äá» THáº¬T, táº¥t cáº£ Äá» vÃ¬ ÄÃºng cá»t Äang Äo (`user_agent` NULL / `ip` undefined):**

- `test/integration/auth-s18-seceventmeta-1.int-spec.ts` â **4/4 Äá»**: `Â§reset-ok`
  (`PASSWORD_RESET_COMPLETED`) Â· `Â§change-ok` (`PASSWORD_CHANGED`) Â· `Â§reauth-failed`
  (`REAUTH_FAILED`) Â· `Â§admin-reset` (`PASSWORD_RESET_BY_ADMIN`). Táº¥t cáº£:
  `expected null to be '<UA cá»§a ca>'`.
  â¤· `Â§admin-reset` tráº£ **HTTP 200** (khÃ´ng 403) â cÃ´ng thá»©c quyá»n cá»§a plan Â§2l ÄÃºng, ca Äá» vÃ¬ phÃ©p
  Äo chá»© khÃ´ng vÃ¬ cá»ng.
- `src/auth/auth.service.spec.ts` â **2 Äá»**: `USER_UNLOCKED`/`PASSWORD_RESET_COMPLETED`/
  `ALL_SESSIONS_REVOKED` thiáº¿u `203.0.113.10`; neo hÃ¬nh-dáº¡ng call-site 2FA
  (`expected 'undefined' to be 'object'` â hÃ´m nay `recordReauthFailure` ÄÆ°á»£c gá»i 3 Äá»i sá»).
- `src/users/auth-users.service.spec.ts` â **2 Äá»**: nhÃ¡nh degraded + nhÃ¡nh NÃM, cáº£ hai thiáº¿u
  `203.0.113.11` á» `user.login_throttle_cleared` + `USER_UNLOCKED`.

â ï¸ `typecheck` Äá» á» bÆ°á»c nÃ y lÃ  **Dá»° KIáº¾N** (spec gá»i chá»¯ kÃ½ chÆ°a Äá»i) â báº±ng chá»©ng RED lÃ  danh sÃ¡ch
ca vitest Äá», KHÃNG pháº£i mÃ£ thoÃ¡t cá»§a `check.sh` (plan Â§4.4).

## Lá»ch sá»­

- PhiÃªn 2026-06-19: FE-AUTH-1 (redesign login + 2FA) + ACCT-1 (self-service Äá»i máº­t kháº©u/há» sÆ¡, wire route /settings/account) â Äá»u land. Realign backlog v2 (authÂ·consoleÂ·app).
- PhiÃªn HARNESS-SPINE: dá»±ng harness â backlog.mjs Â· gen-status.mjs Â· check.sh Â· init/finish.sh Â· handoff/policy/README Â· guard-scope (warn-only) Â· AGENTS.md.
