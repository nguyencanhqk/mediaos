# ADR-0006 — Frontend = Vite + React SPA (1 trust boundary)

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** Trung bình
- **Liên quan:** [0010](0010-permission-engine-4-tier.md), [0012](0012-backend-nestjs-modular-monolith.md), [0015](0015-ui-shadcn-tanstack.md)

## Bối cảnh

Admin nội bộ xử lý dữ liệu nhạy cảm (lương, secret). Cần ranh giới tin cậy rõ.

## Quyết định

**Vite + React 19 SPA**, 1 trust boundary (browser ↔ API). TanStack Router + Query + Zustand. **Không Next.js cho admin.**

## Lý do

SPA tách bạch: server là sự thật, client chỉ render cái server cho phép → masking ở SERVER (client không nhận thì không render được). Next.js SSR có thể vô tình render dữ liệu nhạy cảm phía server và rò qua HTML/RSC payload.

## Hệ quả

Masking dữ liệu nhạy cảm là việc của server. `<PermissionGate>` + `useCan()` chỉ là UX, không phải kiểm soát thật. SEO không cần (app nội bộ).

## Phương án đã loại

- **Next.js admin** — SSR rò dữ liệu nhạy cảm, nhiều trust boundary.
- CRA — Vite nhanh hơn, hệ sinh thái tốt hơn.
