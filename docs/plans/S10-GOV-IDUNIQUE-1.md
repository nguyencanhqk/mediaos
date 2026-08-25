# S10-GOV-IDUNIQUE-1 — cổng ép DUY NHẤT cho mã WO + số ADR (KI-079)

> Zone 🟡 · LIGHT gate · KHÔNG chạm code sản phẩm, KHÔNG migration, KHÔNG DB.
> Kế hoạch viết cùng lượt thi công (việc thường, không qua bước planner theo §6 CLAUDE.md).

## 1. Mức độ — phát biểu TRƯỚC

Đây là nợ **SỔ SÁCH**, KHÔNG phải lỗ bảo mật. Không rò dữ liệu, không hỏng runtime, không ai
leo quyền được từ nó. Giá trị duy nhất của WO này là chặn **sự BIẾN MẤT ÂM THẦM**:

- một Work Order thật không bao giờ được làm (không có cảnh báo nào phát ra), và
- hai quyết định kiến trúc mang cùng số hiệu ⇒ mọi trích dẫn về sau là mơ hồ.

Không được nới thành "cảnh báo" (xem §2 ca 1: hệ quả tầng ledger là mất việc, không phải nhiễu).

## 2. Hai ca bệnh THẬT (đã đo 2026-08-25, đều vá TAY, chưa có cổng)

**Ca 1 — mã WO trùng.** `harness/backlog.mjs` từng có ĐÚNG hai khối `id: "S10-QA-ROUTEHTTP-2"`
(khối ship 18/08 "12 route risk≥5" + khối seed KI-025 ngày 24/08). Trùng id là lỗi **HAI TẦNG**:

| Tầng | Cơ chế | Hệ quả đo được |
| --- | --- | --- |
| backlog | `gen-status` / `gen-plan-index` đếm & render theo `id` | hai dòng cùng mã, người đọc không phân biệt |
| **ledger** | `harness/lib/wo-state.mjs#statusOverlay()` trả `Map<woId, bucket>` ⇒ **khoá theo id** | dấu `finished` của khối ship áp lên khối seed ⇒ khối seed nằm trong "Đã xong" của STATUS và **KHÔNG BAO GIỜ** lọt `isReady` |

Vá tay: PR #417.

**Ca 2 — số ADR trùng.** master trước đợt merge cao nhất `DECISIONS-09`. PR #414 thêm
`DECISIONS-10_Role_Membership_Absence_Signal.md`; PR #416 thêm
`DECISIONS-10_Catalog_FK_Company_Guard_Trigger.md`. **Khác tên file ⇒ git merge SẠCH**, không xung
đột, không ai thấy. Vá tay lúc merge (#414 → `DECISIONS-11`).

## 3. Việc làm

Một file duy nhất: **`harness/id-uniqueness.test.mjs`** (`node --test`, zero-dep, không DB, không
build ⇒ chạy được trên MỌI PR kể cả docs-only — đó là lý do đặt ở `harness/` chứ không phải
`apps/api/test/foundation/`).

| Cổng | Nguồn | Hàm thuần |
| --- | --- | --- |
| C1 | `backlog` import trực tiếp từ `harness/backlog.mjs` | `findDuplicates(entries)` |
| C2 | `fs.readdirSync(docs/DECISIONS)` | `parseAdrNumber(filename)` → **GIÁ TRỊ SỐ** |
| C3 | §1 "Bảng tổng hợp" của `RELEASE-02` | `parseKiIdsFromRegistry(markdown)` |

Ba luật viết cổng (đã trả học phí ở các WO trước):

1. **Ghim ĐỊNH NGHĨA, không ghim TÊN** — số ADR TRÍCH từ tên file bằng regex, không hard-code danh
   sách số đang có (hard-code ⇒ thêm ADR mới là đỏ oan). So sánh theo **giá trị số**, nên
   `DECISIONS-9` và `DECISIONS-09` đụng nhau.
2. **Mọi cổng có ca THỬ-NGƯỢC** gieo dữ liệu trùng ⇒ phải ĐỎ (không có thì cổng xanh-RỖNG).
3. **Chống xanh-RỖNG kiểu thứ hai** — nếu regex trích trượt HẾT thì tập rỗng cũng "không trùng" ⇒
   xanh vĩnh viễn. Mỗi cổng có thêm ca `*b`: số phần tử trích được **> 0** VÀ **không còn phần tử
   nào không trích được**.

Và bước dễ quên nhất: **đăng ký file test vào BA danh sách TƯỜNG MINH** (không glob) —
`.github/workflows/ci.yml` job `tooling`, `.github/workflows/api.yml` bước "Tooling tests",
`harness/check.sh` step `tooling-tests`. Quên ⇒ spec tồn tại mà không bao giờ chạy.

## 4. Phạm vi — khai rõ cái KHÔNG làm

- **`docs/plans/INDEX.md`: KHÔNG thêm cổng riêng.** File này **TỰ SINH** từ `backlog.mjs` bởi
  `harness/gen-plan-index.mjs`. Trùng ở đó là **hệ quả** của trùng id backlog, không phải nguồn độc
  lập ⇒ C1 đã phủ. Thêm cổng lên file sinh ra chỉ nhân đôi tiếng ồn khi C1 đã đỏ.
- **`KI-0NN` trong RELEASE-02: CÓ LÀM** (cổng C3). Cùng lớp danh tính, cùng hình dạng hàm thuần, chi
  phí gần bằng 0. Khác ca 2 ở chỗ nó nằm trong **một** file nên xác suất git bắt được cao hơn —
  cao hơn, **không phải chắc chắn**: hai hàng chèn ở hai vùng khác nhau của bảng vẫn merge sạch.
- **Tính ĐẦY ĐỦ** (KI có ở §2 mà thiếu hàng §1; ADR có số mà không ai trích dẫn) — đó là lớp
  "thiếu", khác lớp "trùng". Ngoài phạm vi.
- **Sửa lặng dữ liệu đang trùng**: không có gì để sửa — cổng chạy trên master hiện tại XANH (§5).

## 5. Số đo nghiệm thu (2026-08-25, master `3e32d4cb`)

| Đo | Kết quả |
| --- | --- |
| `node --test harness/id-uniqueness.test.mjs` trên master | **10/10 XANH** — đúng kỳ vọng: cả hai ca bệnh đã vá tay ở #417 và lúc merge #414 |
| Mã WO trong backlog | **398 id, 0 trùng** |
| File ADR | **11 file, số 01→11, 0 trùng, 0 file lệch quy ước tên** |
| Mã KI ở §1 RELEASE-02 | **78 mã, 001→078, 0 trùng, 0 hụt** |
| Toàn bộ danh sách `tooling-tests` sau khi thêm file | **169/169 XANH** |

**RED-proof (không phải "nhìn nó xanh")** — gieo trùng THẬT vào cả ba nguồn rồi chạy lại:

| Gieo | Kỳ vọng | Kết quả |
| --- | --- | --- |
| thêm khối `id: "S10-GOV-IDUNIQUE-1"` thứ hai vào `backlog.mjs` | C1 ĐỎ | ✅ C1 ĐỎ |
| `cp DECISIONS-11_Role_Membership_Absence_Signal.md DECISIONS-11_Duplicate_On_Purpose.md` | C2 ĐỎ | ✅ C2 ĐỎ |
| chèn hàng `\| **KI-078** \|` thứ hai vào §1 | C3 ĐỎ | ✅ C3 ĐỎ |
| (3 ca trên cùng lúc) | đúng **3 ĐỎ / 7 XANH**, các ca thử-ngược KHÔNG bị kéo theo | ✅ 3 fail / 7 pass |
| `touch docs/DECISIONS/ADR-nonconforming.md` | C2b ĐỎ (file lọt ngoài cổng) | ✅ C2b ĐỎ |
| đổi `## 1. Bảng tổng hợp` → `## Bảng tổng hợp` | C3b ĐỎ (cổng hoá xanh-rỗng) | ✅ C3b ĐỎ |

Mọi mutation đã hoàn nguyên; `git status` sạch trước khi commit.

## 6. Sổ

RELEASE-02: **mở và đóng KI-079 trong cùng WO**, dẫn chiếu hai ca bệnh gốc (#417 và lượt merge
#414) làm bằng chứng lớp lỗi có thật — không phải giả định.

## 7. Bẫy gặp khi thi công — gitleaks đỏ OAN vì tên TRƯỜNG

Commit đầu (`f62a6c6e`) làm `Secret scan (gitleaks)` ĐỎ: `leaks found: 1`. Không có secret nào.

**Nguyên nhân:** fixture của ca `C1-thử-ngược` đặt tên trường là `key`, nên dòng
dạng `key` + dấu hai chấm + mã WO trong ngoặc kép khớp đúng luật mặc định `generic-api-key` (từ khoá
`key|secret|token|api|password` + `:` hoặc `=` + literal ≥10 ký tự thuộc `[0-9a-zA-Z_.=-]`). Mã Work
Order là chuỗi công khai, nhưng luật không biết điều đó — nó chỉ nhìn HÌNH DẠNG.

**Chẩn đoán (không đoán mò):** `security.yml` trên master `3e32d4cb` XANH ⇒ leak đến từ đúng commit
của nhánh. Xác minh bằng cách chạy chính image CI tại chỗ:

```bash
docker run --rm -v "/c/dev 2/MediaOS:/repo" -w //repo zricethezav/gitleaks:v8.30.1 \
  detect --source=//repo --config=//repo/.gitleaks.toml --log-opts="3e32d4cb..<commit>" --no-banner
# f62a6c6e (bản đầu) → leaks found: 1
# d1d02214 (bản sửa) → no leaks found
```

**Bản sửa:** đổi tên trường `key` → `value` (và `byKey` → `byValue`). KHÔNG nới `.gitleaks.toml` —
allowlist là để chứa secret ephemeral đã biết, không phải để dạy nó bỏ qua một hình dạng chung; nới
ra là che luôn secret thật sau này. Trường này vốn không phải "khoá bí mật" nên tên `value` cũng
đúng nghĩa hơn.

**Và phải AMEND, không được vá bằng commit sau** — gitleaks quét **full history** với
`fetch-depth: 0`, nên chuỗi đã nằm trong lịch sử nhánh thì commit sửa ở sau không gỡ được nó
(`gitleaks-join-not-enough-amend-required`). Đã amend + force-push, master không bị đụng.
