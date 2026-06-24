---
name: skill-smith
description: Đóng băng một thủ tục lặp lại hoặc ma sát tái diễn thành một skill Claude Code tái dùng (hoặc cập nhật skill có sẵn). Dùng khi cùng một chuỗi thao tác tay đã làm ≥3 lần, khi harness/handoff.md ghi cùng một "Friction" ≥2 lần, hoặc khi người dùng nói "nhớ cách làm X" / "biến cái này thành skill". Harness lớn lên từ ma sát thật, KHÔNG từ phỏng đoán.
---

# skill-smith — biến ma sát thành skill

Bạn tạo & bảo trì `.claude/skills/` của MediaOS. **KHÔNG bịa skill suy đoán** — chỉ đóng băng việc đã lặp lại có bằng chứng. Mục tiêu là chống phình harness: thêm skill là thay đổi hành vi agent, phải xứng đáng.

## Khi nào hành động (cần ≥1 điều kiện)

- Một thủ tục đã làm tay **≥3 lần**, hoặc
- `harness/handoff.md` ghi **cùng một "Friction" ≥2 lần**, hoặc
- Người dùng yêu cầu rõ ràng đóng băng một quy trình.

Không đạt điều kiện → **dừng và nói rõ** đây là one-off; thêm skill lúc này là entropy.

## Các bước

1. **Xác nhận pattern là thật.** Grep `harness/handoff.md` (mục *Friction*) + nhìn lại các bước trong transcript. Một lần lẻ → dừng.
2. **Tìm trước khi tạo.** Liệt kê `.claude/skills/`. Nếu đã có skill phủ việc này → **CẬP NHẬT** nó, đừng tạo bản trùng.
3. **Viết skill.** Tạo `.claude/skills/<kebab-name>/SKILL.md` với frontmatter:
   - `name`: kebab-case.
   - `description`: một dòng nêu LÀM GÌ + KHI NÀO dùng (đây là cách model tự chọn skill — phải chính xác về trigger).
   Thân: thủ tục tối thiểu, có thứ tự, chạy-được (lệnh thật hơn văn xuôi). Ghi tiền-điều-kiện + bước verify.
4. **Gọn.** Skill là đơn vị tái dùng nhỏ nhất, không phải sổ tay. Link tới doc (`AGENTS.md` · `harness/policy.md` · `CLAUDE.md`) thay vì chép lại.
5. **Tôn trọng zone/gate.** Nếu skill chạm vùng 🔴 (permission/RLS/secret/payroll/finance/audit/migration) → ghi rõ skill PHẢI đi qua FULL gate + người chốt (xem `harness/policy.md`); skill không được nới lỏng gate.
6. **Đề xuất, đừng ép.** Mở thay đổi như một PR: `feat(skills): add <name>`. Tự-động-hoá mới làm đổi hành vi agent là thay đổi cần review (không tự merge — `auto-merge` chỉ cho green/yellow).
7. **Ghi lại.** Thêm vào *Friction* của `harness/handoff.md`: skill nào được tạo/cập nhật và nó xoá ma sát gì.

## Anti-pattern phải từ chối

- Tạo skill cho việc mới làm **một lần**.
- Tạo bản trùng thay vì cập nhật skill đã có.
- Skill rộng tới mức `description` khớp **mọi** task (vô dụng cho auto-select).
- Skill "lách" gate đỏ hoặc giấu một bước nhạy cảm.
