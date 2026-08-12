"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Section } from "@/components/ui";
import { apiSend } from "@/lib/client-api";
import {
  BULK_EDIT_FIELDS,
  BULK_EDIT_FIELD_LABELS,
  MAX_BULK_RULES,
  type BulkEditField,
  type BulkEditResult,
} from "@/lib/bulk-edit";

/**
 * Sua hang loat: doi cung mot doan chu trong nhieu noi dung da chon.
 *
 * Luon phai XEM TRUOC roi moi ap dung duoc — nut "Áp dụng" chi song khi dang cam mot ban xem
 * truoc con hieu luc. Doi bat ky o nao trong khung (cap thay the, o van ban, cong tac, hay danh
 * sach noi dung dang chon) deu XOA ban xem truoc di: thu nguoi dung duyet phai dung la thu duoc
 * ghi xuong.
 */

interface BulkEditPanelProps {
  contentIds: number[];
  /** Goi sau khi ghi xong de trang cha nap lai danh sach. */
  onApplied: (message: string) => void;
}

/** Hang nhap co id rieng de them/bot hang khong lam React dung nham o cua hang khac. */
interface RuleRow {
  id: number;
  find: string;
  replace: string;
}

export function BulkEditPanel({ contentIds, onApplied }: BulkEditPanelProps) {
  const nextRuleId = useRef(1);
  const [rules, setRules] = useState<RuleRow[]>([{ id: 0, find: "", replace: "" }]);
  const [fields, setFields] = useState<BulkEditField[]>(["message"]);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includePendingPosts, setIncludePendingPosts] = useState(false);
  const [preview, setPreview] = useState<BulkEditResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Khung nhap vua doi thi ban xem truoc cu khong con mo ta dung viec sap lam nua. */
  const invalidatePreview = () => {
    setPreview(null);
    setError(null);
  };

  // Nguoi dung tick them/bot noi dung o danh sach ben duoi cung lam ban xem truoc cu het dung.
  useEffect(() => setPreview(null), [contentIds]);

  const editRule = (id: number, patch: Partial<RuleRow>) => {
    invalidatePreview();
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const addRule = () => {
    invalidatePreview();
    setRules((current) => [...current, { id: nextRuleId.current++, find: "", replace: "" }]);
  };

  const removeRule = (id: number) => {
    invalidatePreview();
    setRules((current) => current.filter((rule) => rule.id !== id));
  };

  const toggleField = (field: BulkEditField) => {
    invalidatePreview();
    setFields((current) =>
      current.includes(field) ? current.filter((f) => f !== field) : [...current, field],
    );
  };

  const send = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "apply");
    setError(null);
    try {
      const result = await apiSend<BulkEditResult>("/api/contents/bulk-edit", "POST", {
        contentIds,
        rules: rules
          .filter((rule) => rule.find !== "")
          .map(({ find, replace }) => ({ find, replace })),
        fields,
        caseSensitive,
        includePendingPosts,
        dryRun,
      });

      if (dryRun) {
        setPreview(result);
        return;
      }

      setPreview(null);
      setRules([{ id: nextRuleId.current++, find: "", replace: "" }]);
      onApplied(summarise(result));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const hasRule = rules.some((rule) => rule.find !== "");
  const canPreview = contentIds.length > 0 && hasRule && fields.length > 0 && busy === null;
  const hasChanges = preview !== null && preview.changedContents.length > 0;

  return (
    <Section
      title={`Sửa hàng loạt ${contentIds.length} nội dung đã chọn`}
      description="Đổi cùng một đoạn chữ lặp lại trong nhiều nội dung — số hotline, hashtag, tên chương trình, link…"
    >
      <div className="space-y-2">
        {rules.map((rule, index) => (
          <div key={rule.id} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              {index === 0 && (
                <label className="label" htmlFor={`find-${rule.id}`}>
                  Tìm đoạn này
                </label>
              )}
              <input
                id={`find-${rule.id}`}
                className="field"
                value={rule.find}
                onChange={(e) => editRule(rule.id, { find: e.target.value })}
                placeholder="VD: 0909 123 456"
              />
            </div>
            <div className="min-w-[180px] flex-1">
              {index === 0 && (
                <label className="label" htmlFor={`replace-${rule.id}`}>
                  Thay bằng
                </label>
              )}
              <input
                id={`replace-${rule.id}`}
                className="field"
                value={rule.replace}
                onChange={(e) => editRule(rule.id, { replace: e.target.value })}
                placeholder="Để trống = xoá đoạn đó"
              />
            </div>
            <button
              className="btn btn-ghost"
              disabled={rules.length === 1}
              onClick={() => removeRule(rule.id)}
              aria-label={`Bỏ cặp thay thế ${index + 1}`}
            >
              Bỏ
            </button>
          </div>
        ))}
      </div>

      <button
        className="btn btn-ghost mt-2"
        disabled={rules.length >= MAX_BULK_RULES}
        onClick={addRule}
      >
        + Thêm cặp thay thế
      </button>

      <div className="mt-4">
        <span className="label">Sửa ở ô nào</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {BULK_EDIT_FIELDS.map((field) => (
            <label key={field} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={fields.includes(field)}
                onChange={() => toggleField(field)}
              />
              {BULK_EDIT_FIELD_LABELS[field]}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={() => {
              invalidatePreview();
              setCaseSensitive((current) => !current);
            }}
          />
          Phân biệt chữ hoa / chữ thường
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={includePendingPosts}
            onChange={() => {
              invalidatePreview();
              setIncludePendingPosts((current) => !current);
            }}
          />
          <span>
            Sửa cả bài đã xếp lịch chưa gửi
            <span className="hint block">
              Bài đã đăng hoặc đã nằm trong lịch của Facebook thì không sửa được từ đây.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button className="btn btn-ghost" disabled={!canPreview} onClick={() => void send(true)}>
          {busy === "preview" ? "Đang dò…" : "Xem trước thay đổi"}
        </button>
        <button
          className="btn btn-primary"
          disabled={!hasChanges || busy !== null}
          onClick={() => void send(false)}
        >
          {busy === "apply" ? "Đang sửa…" : "Áp dụng"}
        </button>
        {preview === null && hasRule && (
          <p className="hint self-center">Xem trước rồi mới áp dụng được.</p>
        )}
      </div>

      {preview && <PreviewReport preview={preview} />}
    </Section>
  );
}

function summarise(result: BulkEditResult): string {
  const posts = result.changedPosts > 0 ? ` và ${result.changedPosts} bài đã xếp lịch` : "";
  return `Đã sửa ${result.changedContents.length} nội dung${posts} — tổng ${result.totalHits} chỗ.`;
}

function PreviewReport({ preview }: { preview: BulkEditResult }) {
  return (
    <div className="mt-4 space-y-3">
      {preview.changedContents.length === 0 ? (
        <Alert tone="info">
          Không tìm thấy đoạn nào khớp trong {preview.scannedContents} nội dung đã chọn.
        </Alert>
      ) : (
        <Alert tone="info">
          Sẽ sửa <strong>{preview.changedContents.length}</strong> / {preview.scannedContents} nội
          dung, tổng <strong>{preview.totalHits}</strong> chỗ
          {preview.changedPosts > 0 && <> · kèm {preview.changedPosts} bài đã xếp lịch chưa gửi</>}.
        </Alert>
      )}

      {preview.warnings.map((warning) => (
        <Alert key={warning} tone="warning">
          {warning}
        </Alert>
      ))}

      {preview.changedContents.length > 0 && (
        <ul className="space-y-2">
          {preview.changedContents.map((content) => (
            <li key={content.contentId} className="rounded-lg border px-3.5 py-3">
              <p className="mb-2 text-sm font-semibold">
                #{content.contentId} · {content.label}
                {content.pendingPosts > 0 && (
                  <span className="hint"> • {content.pendingPosts} bài đã xếp lịch đổi theo</span>
                )}
              </p>
              {content.changes.map((change) => (
                <div key={change.field} className="mb-2 last:mb-0">
                  <p className="hint">
                    {BULK_EDIT_FIELD_LABELS[change.field]} — {change.hits} chỗ
                  </p>
                  <p
                    className="line-clamp-3 text-sm whitespace-pre-wrap"
                    style={{ color: "var(--text-muted)", textDecoration: "line-through" }}
                  >
                    {change.before}
                  </p>
                  <p className="line-clamp-3 text-sm whitespace-pre-wrap">{change.after}</p>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
