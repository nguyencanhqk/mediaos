import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
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

type Tab = "profile" | "general";

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
    s.shortName ?? "",
    s.taxCode ?? "",
    s.businessType ?? "",
    s.companyCode ?? "",
    s.regNumber ?? "",
    s.regDate ?? "",
    s.regPlace ?? "",
    s.legalRepName ?? "",
    s.legalRepTitle ?? "",
    s.establishedDate ?? "",
    s.address ?? "",
    s.phone ?? "",
    s.fax ?? "",
    s.email ?? "",
    s.website ?? "",
  ].join("|");
}

// ── Container ───────────────────────────────────────────────────────────────────

export function CompanySettingsPage() {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
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
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">{t("company.pageTitle")}</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "profile"}
          onClick={() => setActiveTab("profile")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "profile"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("company.tabProfile")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "general"}
          onClick={() => setActiveTab("general")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "general"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("company.tabGeneral")}
        </button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("company.loadError")}</p>}

      {data && (
        <CompanySettingsForm
          // Remount khi dữ liệu server đổi (vd. sau khi save → refetch trả giá trị mới)
          key={serverStateKey(data)}
          initial={data}
          activeTab={activeTab}
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
  activeTab: Tab;
  onSubmit: (payload: UpdateCompanySettingsRequest) => void;
  isSaving?: boolean;
  isSaved?: boolean;
  isSaveError?: boolean;
}

export function CompanySettingsForm({
  initial,
  activeTab,
  onSubmit,
  isSaving = false,
  isSaved = false,
  isSaveError = false,
}: CompanySettingsFormProps) {
  const { t } = useTranslation("settings");

  // Thiết lập chung
  const [logoUrl] = useState(initial.logoUrl ?? ""); // chỉ-đọc (S5-BRAND-FE-1)
  const [timezone, setTimezone] = useState(initial.timezone);
  const [currency, setCurrency] = useState<CompanySettingsDto["currency"]>(initial.currency);
  const [language, setLanguage] = useState<CompanySettingsDto["language"]>(initial.language);
  const [workingDays, setWorkingDays] = useState<number[]>(initial.workingDaysJson.days);
  const [cutoffDay, setCutoffDay] = useState(String(initial.payrollConfigJson.cutoffDay));
  const [payDay, setPayDay] = useState(String(initial.payrollConfigJson.payDay));

  // Hồ sơ công ty — CS-5
  const [shortName, setShortName] = useState(initial.shortName ?? "");
  const [taxCode, setTaxCode] = useState(initial.taxCode ?? "");
  const [businessType, setBusinessType] = useState(initial.businessType ?? "");
  const [regNumber, setRegNumber] = useState(initial.regNumber ?? "");
  const [regDate, setRegDate] = useState(initial.regDate ?? "");
  const [regPlace, setRegPlace] = useState(initial.regPlace ?? "");
  const [legalRepName, setLegalRepName] = useState(initial.legalRepName ?? "");
  const [legalRepTitle, setLegalRepTitle] = useState(initial.legalRepTitle ?? "");
  const [establishedDate, setEstablishedDate] = useState(initial.establishedDate ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [fax, setFax] = useState(initial.fax ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [website, setWebsite] = useState(initial.website ?? "");

  const [errors, setErrors] = useState<string[]>([]);

  const toggleDay = (value: number) =>
    setWorkingDays((days) =>
      days.includes(value)
        ? days.filter((d) => d !== value)
        : [...days, value].sort((a, b) => a - b),
    );

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {
      // Thiết lập chung
      // S5-BRAND-FE-1: KHÔNG gửi logoUrl — màn này không còn sửa logo. Gửi lại giá trị cũ trong state
      // sẽ GHI ĐÈ fileId do /system/company vừa đặt (lost-update giữa 2 tab).
      timezone: timezone.trim(),
      currency,
      language,
      workingDaysJson: { days: workingDays },
      payrollConfigJson: { cutoffDay: Number(cutoffDay), payDay: Number(payDay) },
      // Hồ sơ công ty
      shortName: shortName.trim() || null,
      taxCode: taxCode.trim() || null,
      businessType: businessType.trim() || null,
      regNumber: regNumber.trim() || null,
      regDate: regDate.trim() || null,
      regPlace: regPlace.trim() || null,
      legalRepName: legalRepName.trim() || null,
      legalRepTitle: legalRepTitle.trim() || null,
      establishedDate: establishedDate.trim() || null,
      address: address.trim() || null,
      phone: phone.trim() || null,
      fax: fax.trim() || null,
      email: email.trim() || null,
      website: website.trim() || null,
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
    <div className="space-y-6">
      {/* ── Tab: Hồ sơ công ty ─────────────────────────────────────────────── */}
      {activeTab === "profile" && (
        <div className="space-y-5">
          {/* Thông tin chi tiết */}
          <section className="rounded-xl border border-border p-6 space-y-4">
            <h2 className="text-base font-semibold">{t("company.sectionDetail")}</h2>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("company.companyNameLabel")}
              </p>
              <p className="text-sm font-medium">{initial.name}</p>
            </div>

            {initial.companyCode && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("company.companyCodeLabel")}
                </p>
                <p className="text-sm font-mono text-muted-foreground">{initial.companyCode}</p>
              </div>
            )}

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.shortNameLabel")}</span>
              <Input
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="VD: MediaOS"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.taxCodeLabel")}</span>
              <Input
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value)}
                placeholder="0123456789 hoặc 0123456789-001"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.establishedDateLabel")}</span>
              <Input
                type="date"
                value={establishedDate}
                onChange={(e) => setEstablishedDate(e.target.value)}
              />
            </label>
          </section>

          {/* Đăng ký kinh doanh */}
          <section className="rounded-xl border border-border p-6 space-y-4">
            <h2 className="text-base font-semibold">{t("company.sectionReg")}</h2>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.regNumberLabel")}</span>
              <Input
                value={regNumber}
                onChange={(e) => setRegNumber(e.target.value)}
                placeholder="Số đăng ký kinh doanh"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.regDateLabel")}</span>
              <Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.regPlaceLabel")}</span>
              <Input
                value={regPlace}
                onChange={(e) => setRegPlace(e.target.value)}
                placeholder="VD: Sở KH&ĐT TP.HCM"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.legalRepNameLabel")}</span>
              <Input
                value={legalRepName}
                onChange={(e) => setLegalRepName(e.target.value)}
                placeholder="Họ và tên"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.legalRepTitleLabel")}</span>
              <Input
                value={legalRepTitle}
                onChange={(e) => setLegalRepTitle(e.target.value)}
                placeholder="VD: Giám đốc"
              />
            </label>
          </section>

          {/* Liên hệ */}
          <section className="rounded-xl border border-border p-6 space-y-4">
            <h2 className="text-base font-semibold">{t("company.sectionContact")}</h2>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.addressLabel")}</span>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Địa chỉ trụ sở chính"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">{t("company.phoneLabel")}</span>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0281 234 5678"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">{t("company.faxLabel")}</span>
                <Input value={fax} onChange={(e) => setFax(e.target.value)} placeholder="Số fax" />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.emailLabel")}</span>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@company.com"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.websiteLabel")}</span>
              <Input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://company.com"
              />
            </label>
          </section>

          {/* Mô hình */}
          <section className="rounded-xl border border-border p-6 space-y-4">
            <h2 className="text-base font-semibold">{t("company.sectionModel")}</h2>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("company.businessTypeLabel")}</span>
              <Input
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                placeholder="VD: Công ty TNHH, Công ty Cổ phần"
              />
            </label>
          </section>
        </div>
      )}

      {/* ── Tab: Thiết lập chung ────────────────────────────────────────────── */}
      {activeTab === "general" && (
        <div className="space-y-5 rounded-xl border border-border p-6">
          {/* S5-BRAND-FE-1 — GỠ ô nhập logoUrl URL thô (TODO G5-FIX đã đóng). Logo giờ upload qua
              presign ở /system/company (khối "Thương hiệu"). CỐ Ý chỉ-đọc: hai đường ghi cùng cột
              `companies.logo_url` mà một đường nhận URL tự do sẽ làm lệch trạng thái (fileId vs URL)
              và bỏ qua guard MIME/size/owner của branding endpoint. */}
          <div className="block space-y-1.5">
            <span className="text-sm font-medium">{t("company.logoUrlLabel")}</span>
            <p className="text-sm text-muted-foreground">
              {logoUrl ? t("company.logoManagedSet") : t("company.logoManagedEmpty")}
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("company.timezoneLabel")}</span>
            <Input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Ho_Chi_Minh"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("company.currencyLabel")}</span>
            <Select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CompanySettingsDto["currency"])}
            >
              <option value="VND">{t("company.currencyVnd")}</option>
              <option value="USD">USD — US Dollar</option>
            </Select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("company.languageLabel")}</span>
            <Select
              value={language}
              onChange={(e) => setLanguage(e.target.value as CompanySettingsDto["language"])}
            >
              <option value="vi">{t("company.languageVi")}</option>
              <option value="en">English</option>
            </Select>
          </label>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t("company.workingDaysLabel")}</legend>
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
            <legend className="text-sm font-medium">{t("company.payrollPeriodLabel")}</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">{t("company.cutoffDayLabel")}</span>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={cutoffDay}
                  onChange={(e) => setCutoffDay(e.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">{t("company.payDayLabel")}</span>
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
        </div>
      )}

      {/* Errors + actions (shared across both tabs) */}
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
          {isSaving ? t("common:saving") : t("company.saveButton")}
        </Button>
        {isSaved && (
          <p role="status" className="text-sm text-success">
            {t("company.saveSuccess")}
          </p>
        )}
        {isSaveError && (
          <p role="alert" className="text-sm text-destructive">
            {t("company.saveError")}
          </p>
        )}
      </div>
    </div>
  );
}
