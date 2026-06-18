import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Tag } from "lucide-react";
import type { LabelDto } from "@mediaos/contracts";
import { cn } from "@/lib/utils";

interface LabelPickerProps {
  /** Tất cả nhãn của dự án. */
  allLabels: LabelDto[];
  /** Id nhãn đang gắn trên work item (để loại khỏi menu thêm). */
  selectedIds: Set<string>;
  /** Thêm nhãn (POST). */
  onAdd: (labelId: string) => void;
  disabled?: boolean;
}

/**
 * Menu "thêm nhãn" — nút mở dropdown liệt kê các nhãn dự án CHƯA gắn, click để thêm.
 * Đóng khi click ra ngoài hoặc Esc. Không phụ thuộc thư viện popover (house style nhẹ).
 */
export function LabelPicker({ allLabels, selectedIds, onAdd, disabled }: LabelPickerProps) {
  const { t } = useTranslation("projects");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const available = allLabels.filter((l) => !selectedIds.has(l.id));

  const close = () => setOpen(false);

  const onBlurCapture = (e: React.FocusEvent<HTMLDivElement>) => {
    // Đóng khi focus rời khỏi cả cụm (nút + menu) — không đóng khi chuyển focus nội bộ.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onBlurCapture={onBlurCapture}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors",
          "hover:border-brand/50 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Plus className="h-3 w-3" strokeWidth={2.5} />
        {t("labels.add")}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-60 w-56 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {available.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t("labels.noneAvailable")}
            </p>
          ) : (
            available.map((label) => (
              <button
                key={label.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onAdd(label.id);
                  close();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                  aria-hidden
                />
                <span className="truncate">{label.name}</span>
              </button>
            ))
          )}
          {allLabels.length === 0 && (
            <p className="flex items-center gap-1.5 px-2 py-3 text-center text-xs text-muted-foreground">
              <Tag className="h-3 w-3" />
              {t("labels.emptyHint")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
