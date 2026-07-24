import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Dáng viên thuốc `rounded-full` GIỮ theo MediaOS (LMS dùng rounded-md — S5-LMS-UI-2 đổi theo).
 * Các biến thể brand/success/warning/danger/muted là bổ sung RIÊNG của MediaOS, KHÔNG có ở
 * shadcn gốc — port stock đè lên là mất sạch. Xem docs/plans/S5-FND-UI-GEN-1.md §5.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        brand: "border-transparent bg-brand-muted text-brand [a&]:hover:bg-brand-muted/80",
        outline: "border-border text-foreground [a&]:hover:bg-accent",
        success: "border-transparent bg-success-muted text-success [a&]:hover:bg-success-muted/80",
        warning: "border-transparent bg-warning-muted text-warning [a&]:hover:bg-warning-muted/80",
        danger: "border-transparent bg-danger-muted text-danger [a&]:hover:bg-danger-muted/80",
        muted: "border-transparent bg-muted text-muted-foreground [a&]:hover:bg-muted/80",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
