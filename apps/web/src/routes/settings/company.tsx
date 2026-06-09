import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { settingsApi } from "@/lib/settings-api";
import type { UpdateCompanySettingsRequest } from "@mediaos/contracts";

export function CompanySettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", "company"],
    queryFn: settingsApi.getCompanySettings,
  });

  const [timezone, setTimezone] = useState("");
  const [currency, setCurrency] = useState<"VND" | "USD">("VND");
  const [language, setLanguage] = useState<"vi" | "en">("vi");

  useEffect(() => {
    if (data) {
      setTimezone(data.timezone);
      setCurrency(data.currency);
      setLanguage(data.language);
    }
  }, [data]);

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
        <div className="space-y-5 rounded-xl border border-border p-6">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tên công ty
            </p>
            <p className="text-sm font-medium">{data.name}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Múi giờ</label>
            <Input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Ho_Chi_Minh"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tiền tệ</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as "VND" | "USD")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="VND">VND — Việt Nam Đồng</option>
              <option value="USD">USD — US Dollar</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ngôn ngữ</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "vi" | "en")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={() => update.mutate({ timezone, currency, language })}
              disabled={update.isPending}
            >
              {update.isPending ? "Đang lưu…" : "Lưu cài đặt"}
            </Button>
            {update.isSuccess && (
              <p className="text-sm text-green-600">Đã lưu thành công.</p>
            )}
            {update.isError && (
              <p className="text-sm text-destructive">Lưu thất bại.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
