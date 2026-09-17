import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { PAYROLL_SYS_REFS, type ValidateFormulaRequest } from "@mediaos/contracts";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import { cn } from "@mediaos/ui";
import {
  filterSuggestions,
  insertSuggestion,
  tokenizeFormula,
  wordAtCaret,
  type FormulaTokenKind,
} from "../formula-tokens";
import { formulaIssueText } from "../payroll-errors";

/** Chờ người dùng ngừng gõ rồi mới hỏi server — 048 là POST, không gọi mỗi phím. */
const VALIDATE_DEBOUNCE_MS = 400;

const TOKEN_CLASS: Readonly<Record<FormulaTokenKind, string>> = {
  component: "text-primary font-medium",
  system: "text-info",
  statutory: "text-warning",
  function: "text-foreground font-semibold",
  unknown: "text-danger underline decoration-wavy",
  number: "text-foreground",
  operator: "text-muted-foreground",
  space: "",
};

/**
 * PAY-SCREEN-009/010 — editor công thức lương (D3 của plan FE-2).
 *
 * - **Tô màu tham chiếu** ở dải bên dưới ô nhập (mã catalog · `SYS_` · `TL_/GT_` · hàm · mã LẠ gạch đỏ) —
 *   tokenizer FE chỉ để hiển thị, không quyết đúng/sai.
 * - **Gợi ý mã** theo từ đang gõ tại con trỏ (catalog + `SYS_*` của contracts). Bấm gợi ý = thay đúng từ đó.
 * - **Kiểm tại chỗ qua 048** (debounce), CHỈ khi `canValidate` — route gác CẶP GHI
 *   `manage:salary-component`; người chỉ giữ `manage:payroll-template` không gọi được nó, lỗi của họ về lúc
 *   LƯU (422 có chữ giải thích qua `payrollErrorText`).
 *
 * `context` truyền `kind`/`componentCode` để server kiểm VÒNG đúng như thể thành phần đó mang công thức này.
 */
export function FormulaEditor({
  value,
  onChange,
  knownCodes,
  canValidate,
  context,
  disabled = false,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  knownCodes: readonly string[];
  canValidate: boolean;
  context?: Omit<ValidateFormulaRequest, "formula">;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useTranslation("payroll");
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const knownSet = useMemo(() => new Set(knownCodes), [knownCodes]);
  const tokens = useMemo(() => tokenizeFormula(value, knownSet), [value, knownSet]);
  const candidates = useMemo(() => [...knownCodes, ...PAYROLL_SYS_REFS].sort(), [knownCodes]);
  const { word } = wordAtCaret(value, caret);
  const suggestions = disabled ? [] : filterSuggestions(candidates, word);

  const trimmed = debounced.trim();
  const validateQuery = useQuery({
    queryKey: [...payrollKeys.catalog.allOf(), "validate-formula", debounced, context ?? null],
    queryFn: () => payrollApi.validateFormula({ formula: debounced, ...(context ?? {}) }),
    enabled: canValidate && !disabled && trimmed.length > 0,
    staleTime: 30_000,
  });
  const result = validateQuery.data;
  const firstErrorPos = result && !result.valid ? result.errors[0]?.pos : undefined;

  const pickSuggestion = (code: string) => {
    const next = insertSuggestion(value, caret, code);
    onChange(next.formula);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const syncCaret = () => setCaret(textareaRef.current?.selectionStart ?? value.length);

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={inputId}
        ref={textareaRef}
        rows={3}
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="characters"
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        aria-describedby={`${inputId}-status`}
        className="flex w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={t("formulaEditor.suggestions")}>
          {suggestions.map((code) => (
            <button
              key={code}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickSuggestion(code)}
              className="rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs hover:bg-muted"
            >
              {code}
            </button>
          ))}
        </div>
      )}

      {value.length > 0 && (
        <div
          className="overflow-x-auto rounded-md border border-border/60 bg-muted/20 px-3 py-2 font-mono text-xs"
          data-testid="formula-token-strip"
        >
          {tokens.map((tok) => (
            <span
              key={tok.start}
              data-kind={tok.kind}
              className={cn(
                TOKEN_CLASS[tok.kind],
                firstErrorPos !== undefined &&
                  firstErrorPos >= tok.start &&
                  firstErrorPos < tok.start + tok.text.length &&
                  "rounded bg-danger-muted",
              )}
            >
              {tok.text}
            </span>
          ))}
        </div>
      )}

      <div id={`${inputId}-status`} className="text-xs" role="status" aria-live="polite">
        {!canValidate ? (
          <span className="text-muted-foreground">{t("formulaEditor.noLiveCheck")}</span>
        ) : trimmed.length === 0 ? null : validateQuery.isFetching && !result ? (
          <span className="text-muted-foreground">{t("formulaEditor.checking")}</span>
        ) : validateQuery.isError ? (
          <span className="text-muted-foreground">{t("formulaEditor.checkFailed")}</span>
        ) : result?.valid ? (
          <span className="text-success">
            {t("formulaEditor.valid", { count: result.refs.length })}
          </span>
        ) : result ? (
          <ul className="space-y-0.5 text-danger">
            {result.errors.map((issue, i) => (
              <li key={`${issue.kind}-${i}`}>{formulaIssueText(t, issue)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
