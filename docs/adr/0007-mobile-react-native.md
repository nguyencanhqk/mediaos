# ADR-0007 — Mobile = React Native

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** Trung bình
- **Liên quan:** [0006](0006-frontend-vite-react-spa.md), [0010](0010-permission-engine-4-tier.md), [0012](0012-backend-nestjs-modular-monolith.md)

## Bối cảnh

Cần app mobile (tasks, chat, approval, attendance, payslip, push) sau khi web ổn.

## Quyết định

**React Native**, làm sau (G5i). Push qua FCM.

## Lý do

Tái dùng kiến thức React + một phần logic/contracts (Zod). 1 codebase 2 nền tảng. Team đã React.

## Hệ quả

Cần bộ custom `react-native-*` (ECC chưa có reviewer RN riêng). Masking/permission vẫn ép ở server như web.

## Phương án đã loại

- Flutter (ngôn ngữ khác, không tái dùng được React/contracts).
- Native riêng iOS+Android (gấp đôi công).
