import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { settingsApi } from "@/lib/settings-api";
import type { CompanySettingsDto, UpdateCompanySettingsRequest } from "@mediaos/contracts";
import { updateCompanySettingsSchema } from "@mediaos/contracts";

// Thứ Hai (1) … Chủ Nhật (0) — value khớp working_days_json (0..6, theo getDay()).
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
];

/** Khoá phản ánh trạng thái server hiện tại — đổi khi (và chỉ khi) giá trị server đổi. */
function serverStateKey(s: CompanySettingsDto): string {
  return [
    s.logoUrl ?? "",
    s.timezone,
    s.currency,
    s.language,
    s.workingDaysJson.days.join(","),
    s.payrollConfigJson.cutoffDay,
    s.payrollConfigJson.payDay,
  ].join("|");
}

// ── Container ───────────────────────────────────────────────────────────────────

export function CompanySettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", "company"],
    queryFn: settingsApi.getCompanySettings,
  });

  const update = useMutation({
    mutationFn: (payload: UpdateCompanySettingsRequest) =>
      settingsApi.updateCompanySettings(payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["settings", "company"] }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Cài đặt công ty</h1>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được cài đặt.</p>}

      {data && (
        <CompanySettingsForm
          // Remount khi dữ liệu server đổi (vd. sau khi save → refetch trả giá trị mới)
          // để form không giữ snapshot cũ; refetch trả y hệt → key không đổi → không wipe edit.
          key={serverStateKey(data)}
          initial={data}
          onSubmit={(payload) => update.mutate(payload)}
          isSaving={update.isPending}
          isSaved={update.isSuccess}
          isSaveError={update.isError}
        />
      )}
    </div>
  );
}

// ── Form (presentational — validate Zod phía client; mask/auth là việc server) ──

interface CompanySettingsFormProps {
  initial: CompanySettingsDto;
  onSubmit: (payload: UpdateCompanySettingsRequest) => void;
  isSaving?: boolean;
  isSaved?: boolean;
  isSaveError?: boolean;
}

export function CompanySettingsForm({
  initial,
  onSubmit,
  isSaving = false,
  isSaved = false,
  isSaveError = false,
}: CompanySettingsFormProps) {
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [timezone, setTimezone] = useState(initial.timezone);
  const [currency, setCurrency] = useState<CompanySettingsDto["currency"]>(initial.currency);
  const [language, setLanguage] = useState<CompanySettingsDto["language"]>(initial.language);
  const [workingDays, setWorkingDays] = useState<number[]>(initial.workingDaysJson.days);
  const [cutoffDay, setCutoffDay] = useState(String(initial.payrollConfigJson.cutoffDay));
  const [payDay, setPayDay] = useState(String(initial.payrollConfigJson.payDay));
  const [errors, setErrors] = useState<string[]>([]);

  const toggleDay = (value: number) =>
    setWorkingDays((days) =>
      days.includes(value)
        ? days.filter((d) => d !== value)
        : [...days, value].sort((a, b) => a - b),
    );

  const handleSubmit = () => {
    // Logo trống → null (xoá logo); có giá trị → validate là URL qua Zod.
    const payload = {
      logoUrl: logoUrl.trim() ? logoUrl.trim() : null,
      timezone: timezone.trim(),
      currency,
      language,
      workingDaysJson: { days: workingDays },
      payrollConfigJson: { cutoffDay: Number(cutoffDay), payDay: Number(payDay) },
    };

    const parsed = updateCompanySettingsSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    setErrors([]);
    onSubmit(parsed.data);
  };

  return (
    <div className="space-y-5 rounded-xl border border-border p-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tên công ty
        </p>
        <p className="text-sm font-medium">{initial.name}</p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Logo (URL)</span>
        <Input
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://… (link logo)"
        />
        {/* TODO(G5-FIX): thay bằng presigned upload R2/MinIO khi BE có endpoint; tạm dùng URL. */}
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Múi giờ</span>
        <Input
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Asia/Ho_Chi_Minh"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Tiền tệ</span>
        <Select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as CompanySettingsDto["currency"])}
        >
          <option value="VND">VND — Việt Nam Đồng</option>
          <option value="USD">USD — US Dollar</option>
        </Select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Ngôn ngữ</span>
        <Select
          value={language}
          onChange={(e) => setLanguage(e.target.value as CompanySettingsDto["language"])}
        >
          <option value="vi">Tiếng Việt</option>
          <option value="en">English</option>
        </Select>
      </label>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Ngày làm việc trong tuần</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((d) => (
            <label key={d.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={workingDays.includes(d.value)}
                onChange={() => toggleDay(d.value)}
                className="h-4 w-4"
              />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Kỳ lương</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Ngày chốt công (1–31)</span>
            <Input
              type="number"
              min={1}
              max={31}
              value={cutoffDay}
              onChange={(e) => setCutoffDay(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Ngày trả lương (1–31)</span>
            <Input
              type="number"
              min={1}
              max={31}
              value={payDay}
              onChange={(e) => setPayDay(e.target.value)}
            />
          </label>
        </div>
      </fieldset>

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="space-y-1">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button type="button" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? "Đang lưu…" : "Lưu cài đặt"}
        </Button>
        {isSaved && (
          <p role="status" className="text-sm text-green-600">
            Đã lưu thành công.
          </p>
        )}
        {isSaveError && (
          <p role="alert" className="text-sm text-destructive">
            Lưu thất bại.
          </p>
        )}
      </div>
    </div>
  );
}
