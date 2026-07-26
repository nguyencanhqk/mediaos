# S6-GOV-1 — Scope Freeze & Release Governance (WS1)

> Work Order **S6-GOV-1** — Sprint 6 Workstream **WS1** (🟡 yellow / LIGHT gate · layer DOC).
> Nguồn: `IMPLEMENTATION-09` §8 (điều kiện đầu vào IMP09-IN-001…017) · §10 (WS1) · §16.2 (RC naming) ·
> `DEVOPS-02` §6 (branching) · `DEVOPS-12` §6–§7 (versioning/RC) · `QA-08` §9–§10 (severity/priority).
> Phụ thuộc: `S5-UAT-1` (đã ship — `333494be` + `dcf85eb0`).

---

## 1. Vì sao WO này tồn tại

Sprint 5 đóng ở trạng thái **CONDITIONAL GO** (`RELEASE-01` §1, 82,5/100). Ba thứ đang **trôi**, và
nếu không đóng băng thì Sprint 6 sẽ vừa ổn định hoá vừa bị bồi thêm scope mới:

| Cái đang trôi | Bằng chứng | Hậu quả nếu không đóng |
| --- | --- | --- |
| 4 nhánh ship ngoài 7 module MVP gốc (ME · GOAL · LMS · BRAND) | `RELEASE-04` §3 dòng "Scope" treo chờ owner | RC không biết phải test tới đâu; sign-off không biết ký cái gì |
| Thang severity dùng **2 hệ tên** — `S0…S4` (QA-08, RELEASE-01/02) vs `P0…P4` (IMPL-09 §11.2) | `RELEASE-01` §9 ghi "S2 Major", `IMPL-09` §11.2 ghi "P2 Major" | "P1" vừa nghĩa là *mức bug* vừa nghĩa là *độ ưu tiên flow* ⇒ triage sai |
| Chưa có **tag/version policy** thật — repo có 6 tag đều là `archive/*`, `backup/*` | `git tag` | RC không có gì để trỏ tới; rollback không có mốc |

WS1 không viết code. Đầu ra là **luật** cho 5 WO còn lại của Sprint 6.

## 2. Quyết định owner đã chốt (2026-07-26)

> **Scope freeze:** 7 module lõi + Foundation ở mức **P0/P1**, **ME** ở mức **P1**;
> **GOAL · LMS · BRAND** nằm TRONG release nhưng ở mức **P2** — lỗi của chúng **không chặn RC**,
> chỉ ghi known-issue.

Quyết định này đóng dòng "Scope" của `RELEASE-04` §3 và một phần `IMP09-IN-001`.

## 3. Đầu ra

| File | Nội dung | Ánh xạ deliverable |
| --- | --- | --- |
| `docs/plans/S6-GOV-1.md` | File này | — |
| `docs/RELEASE/RELEASE-05_Scope_Freeze_And_Release_Governance.md` | Scope freeze note · critical flow list · change-control rule + CR template · release board · severity matrix · version/tag policy · rà soát IMP09-IN-001…017 | `IMP09-DEL-WS1-001…005` |
| `docs/RELEASE/RELEASE-04` §3 (sửa 1 dòng) | Ghi nhận quyết định scope đã ký | `C4` một phần |

## 4. Cái WO này KHÔNG làm

- **Không ký thay owner** các ô sign-off còn lại (`D3`/`D1` rủi ro bảo mật, sign-off module) — vẫn ở
  `RELEASE-04`, vẫn chờ chữ ký thật.
- **Không tạo RC, không tag** — chỉ định *luật đặt tag*. Việc tag thuộc `S6-REL-1`.
- **Không sửa `DEVOPS-02`/`DEVOPS-12`** — hai doc đó là thiết kế gốc. Chỗ thực tế repo đi khác thiết kế
  (trunk `master` thay vì `develop`+`release/*`) được ghi **đối chiếu** ở RELEASE-05 §6.3, không sửa
  ngược doc thiết kế.

## 5. Cách verify

Doc-only, không chạm code:

```bash
bash harness/check.sh          # phải xanh (không đổi code ⇒ chỉ xác nhận không vỡ gì)
git diff --stat                # chỉ docs/RELEASE/** + docs/plans/S6-GOV-1.md
```

Tiêu chí đóng WO (`done_when` trong `harness/backlog.mjs`):

1. Scope MVP freeze văn bản hoá + danh sách flow P0/P1 chốt → RELEASE-05 §2 + §3.
2. Quy tắc change-control sau freeze §10.3 (chỉ nhận blocker release, có owner duyệt) → RELEASE-05 §4.
3. Deliverable §10.4 (release governance + version/tag policy) → RELEASE-05 §5 + §6.
4. IMP09-IN-001…017 rà soát, ghi trạng thái + blocker → RELEASE-05 §7.
