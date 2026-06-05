# ADR-0015 — UI = shadcn/ui + Tailwind v4 + TanStack Table (loại MUI X/AG Grid)

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** Thấp
- **Liên quan:** [0006](0006-frontend-vite-react-spa.md)

## Bối cảnh

Cần component UI + data grid mạnh nhưng tránh bẫy license thương mại.

## Quyết định

**shadcn/ui + Tailwind v4 + React Hook Form + Zod**. Data grid = **TanStack Table v8 (headless)**. Workflow canvas = **React Flow / @xyflow/react**. Charts = **Recharts + Tremor**.

## Lý do

shadcn = own-the-code, không lock-in. TanStack Table headless miễn phí, đủ mạnh. Tránh **MUI X Pro / AG Grid Enterprise** (license trả phí, bẫy chi phí khi SaaS).

## Hệ quả

Tự build UI grid trên TanStack (công nhiều hơn nhưng không phí license). i18n + a11y áp dụng (`ecc:frontend-a11y`, `ecc:a11y-architect` cho canvas).

## Phương án đã loại

- **MUI X Pro / AG Grid Enterprise** (bẫy license).
- **Typesense** cho search (GPL-3) — loại.
