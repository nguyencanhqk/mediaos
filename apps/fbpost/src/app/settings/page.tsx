"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Section, Spinner } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/client-api";
import { formatDateTime } from "@/lib/schedule";
import type { Account } from "@/lib/types";

/**
 * Quan ly cac tai khoan Facebook da ket noi.
 *
 * Ba cach ket noi, xep theo do de: bam nut dang nhap, dan URL tra ve
 * (khi app khong nhan dia chi localhost), va dan token tu Graph API Explorer.
 */

interface SettingsView {
  appId: string;
  appSecretMasked: string;
  hasAppSecret: boolean;
  loginConfigId: string;
  graphVersion: string;
  accountCount: number;
  pageCount: number;
  loginReady: boolean;
  loginAppId: string;
  /** Khac rong khi nut dang nhap dang muon app cua mot tai khoan da ket noi. */
  loginAppInheritedFrom: string;
}

const APPS_URL = "https://developers.facebook.com/apps";
const EXPLORER_URL = "https://developers.facebook.com/tools/explorer/";

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [origin, setOrigin] = useState("");

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [configId, setConfigId] = useState("");

  const [redirectedUrl, setRedirectedUrl] = useState("");
  const [explorerToken, setExplorerToken] = useState("");

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [settingsView, accountList] = await Promise.all([
        apiGet<SettingsView>("/api/settings"),
        apiGet<Account[]>("/api/accounts"),
      ]);
      setSettings(settingsView);
      setAccounts(accountList);
      setAppId((current) => current || settingsView.appId);
      setConfigId((current) => current || settingsView.loginConfigId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    // Dia chi tra ve phai lay tu trinh duyet vi phu thuoc cong dang chay.
    setOrigin(window.location.origin);
  }, [load]);

  // Ket qua cua luong dang nhap quay ve duoi dang tham so tren URL.
  useEffect(() => {
    const loginError = searchParams.get("loginError");
    const connected = searchParams.get("connected");
    if (!loginError && !connected) return;

    if (loginError) setError(loginError);
    if (connected) {
      const pages = searchParams.get("pages") ?? "0";
      const added = searchParams.get("added") ?? "0";
      setNotice(`Đã kết nối tài khoản "${connected}": ${pages} Page (thêm mới ${added}).`);
      const missing = searchParams.get("missingScopes");
      if (missing) setError(`Token thiếu quyền: ${missing}. Đăng nhập lại và cấp đủ quyền.`);
    }
    // Doc xong thi don URL cho sach.
    router.replace("/settings");
  }, [searchParams, router]);

  const saveApp = async () => {
    setBusy("saveApp");
    setError(null);
    setNotice(null);
    try {
      await apiSend("/api/settings", "PATCH", {
        appId: appId.trim(),
        // Bo trong nghia la giu nguyen secret da luu.
        ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
        loginConfigId: configId.trim(),
      });
      setAppSecret("");
      await load();
      setNotice("Đã lưu thông tin ứng dụng. Giờ bấm Đăng nhập bằng Facebook.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connectManual = async (endpoint: string, payload: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await apiSend<{
        account: Account;
        isNew: boolean;
        added: number;
        missingScopes: string[];
      }>(endpoint, "POST", payload);
      setRedirectedUrl("");
      setExplorerToken("");
      await load();
      setNotice(
        `${result.isNew ? "Đã thêm" : "Đã cập nhật"} tài khoản "${result.account.name}": ${
          result.account.pageCount
        } Page (thêm mới ${result.added}).`,
      );
      if (result.missingScopes.length > 0) {
        setError(
          `Token thiếu quyền: ${result.missingScopes.join(", ")}. Kết nối lại với đủ quyền.`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (account: Account) => {
    setBusy(`refresh-${account.id}`);
    setError(null);
    setNotice(null);
    try {
      const result = await apiSend<{
        outcomes: { accountName: string; added: number; updated: number; error: string | null }[];
      }>(`/api/pages?accountId=${account.id}`, "POST");
      await load();

      const outcome = result.outcomes[0];
      if (outcome?.error) {
        setError(`Tài khoản "${outcome.accountName}": ${outcome.error}`);
      } else {
        setNotice(
          `Đã đồng bộ "${account.name}": thêm mới ${outcome?.added ?? 0} Page, cập nhật ${outcome?.updated ?? 0} Page.`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (account: Account, force = false) => {
    setBusy(`delete-${account.id}`);
    setError(null);
    setNotice(null);
    try {
      const result = await apiSend<{ removedPages: number }>(
        `/api/accounts/${account.id}${force ? "?force=1" : ""}`,
        "DELETE",
      );
      await load();
      setNotice(
        `Đã gỡ tài khoản "${account.name}" cùng ${result.removedPages} Page thuộc tài khoản này.`,
      );
    } catch (e) {
      const message = (e as Error).message;
      // Server chan lan dau khi tai khoan con giu Page - hoi lai roi go that su.
      if (message.includes("đang giữ") && window.confirm(`${message}\n\nVẫn gỡ tài khoản này?`)) {
        await remove(account, true);
        return;
      }
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const rename = async (account: Account) => {
    const next = window.prompt("Tên hiển thị cho tài khoản này:", account.name);
    if (next === null || next.trim() === "" || next === account.name) return;

    setBusy(`rename-${account.id}`);
    setError(null);
    try {
      await apiSend(`/api/accounts/${account.id}`, "PATCH", { name: next.trim() });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!settings) {
    return (
      <div className="py-10">
        <Spinner label="Đang tải cài đặt…" />
      </div>
    );
  }

  const callbackUrl = origin ? `${origin}/api/auth/facebook/callback` : "";
  const appReady = settings.loginReady;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Tài khoản Facebook</h1>
        <p className="hint mt-1">
          Kết nối bao nhiêu tài khoản tuỳ ý. Page của tất cả tài khoản dồn chung vào một danh sách,
          soạn bài một lần là rải được lên hết.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {accounts.length === 0 ? (
        <Alert tone="warning">Chưa có tài khoản nào. Làm hai bước bên dưới để kết nối.</Alert>
      ) : (
        <Section
          title={`Đã kết nối ${accounts.length} tài khoản — tổng ${settings.pageCount} Page`}
          description="Bấm Đồng bộ khi bạn vừa thêm Page mới hoặc vừa cấp lại quyền cho tài khoản đó."
        >
          <ul className="space-y-2">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{account.name}</p>
                  <p className="hint">
                    {account.pageCount} Page • App ID {account.appId} • Token{" "}
                    {account.userTokenMasked}
                    {account.tokenExpiresAt > 0 &&
                      ` • hết hạn ${formatDateTime(account.tokenExpiresAt)}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    className="btn btn-ghost"
                    disabled={busy !== null}
                    onClick={() => void refresh(account)}
                  >
                    {busy === `refresh-${account.id}` ? "Đang đồng bộ…" : "Đồng bộ Page"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={busy !== null}
                    onClick={() => void rename(account)}
                  >
                    Đổi tên
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={busy !== null}
                    onClick={() => void remove(account)}
                  >
                    Gỡ
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <p className="hint mt-3">
            Xem và bật/tắt từng Page ở{" "}
            <Link href="/pages" className="font-semibold underline">
              trang Page
            </Link>
            .
          </p>
        </Section>
      )}

      <Section
        title="Bước 1 — Ứng dụng Facebook"
        description="Chỉ làm một lần. Ứng dụng này dùng chung cho mọi tài khoản bạn kết nối sau đó."
      >
        <div className="mb-4 rounded-lg border p-3.5" style={{ borderColor: "var(--border)" }}>
          <p className="mb-2 text-sm font-semibold">Chưa có App ID và App Secret?</p>
          <ol className="hint list-decimal space-y-1 pl-5">
            <li>
              Vào{" "}
              <a className="font-medium underline" href={APPS_URL} target="_blank" rel="noreferrer">
                developers.facebook.com/apps
              </a>{" "}
              → <strong>Create app</strong>. Miễn phí, không cần gửi duyệt.
            </li>
            <li>
              Đặt tên bất kỳ, chọn loại <strong>Business</strong>, thêm sản phẩm{" "}
              <strong>Facebook Login</strong>.
            </li>
            <li>
              Vào <em>App settings → Basic</em> để lấy <strong>App ID</strong> và{" "}
              <strong>App Secret</strong> (bấm <em>Show</em>).
            </li>
            <li>
              Vào <em>Facebook Login → Settings</em>, dán dòng dưới đây vào ô{" "}
              <strong>Valid OAuth Redirect URIs</strong> rồi Save:
              <code
                className="mt-1 block break-all rounded p-2"
                style={{ backgroundColor: "var(--surface-muted)" }}
              >
                {callbackUrl || "…"}
              </code>
            </li>
          </ol>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="appId">
              App ID
            </label>
            <input
              id="appId"
              className="field"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="1234567890123456"
            />
          </div>
          <div>
            <label className="label" htmlFor="appSecret">
              App Secret
            </label>
            <input
              id="appSecret"
              className="field"
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={settings.hasAppSecret ? settings.appSecretMasked : "Nhập App Secret"}
            />
          </div>
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">
            App của bạn dùng Facebook Login for Business?
          </summary>
          <div className="mt-2 max-w-md">
            <label className="label" htmlFor="configId">
              Configuration ID
            </label>
            <input
              id="configId"
              className="field"
              value={configId}
              onChange={(e) => setConfigId(e.target.value)}
              placeholder="Bỏ trống nếu dùng Facebook Login thường"
            />
            <p className="hint mt-1">
              Lấy trong <em>Facebook Login for Business → Configurations</em>. Chỉ cần khi app không
              có sản phẩm Facebook Login thường.
            </p>
          </div>
        </details>

        <button
          className="btn btn-ghost mt-4"
          onClick={() => void saveApp()}
          disabled={busy !== null || !appId.trim() || (!settings.hasAppSecret && !appSecret.trim())}
        >
          {busy === "saveApp" ? "Đang lưu…" : "Lưu thông tin ứng dụng"}
        </button>
      </Section>

      <Section
        title="Bước 2 — Đăng nhập"
        description="Đăng nhập Facebook bằng đúng tài khoản muốn kết nối, rồi bấm nút. Thêm tài khoản khác thì đăng nhập tài khoản đó rồi bấm lại."
      >
        {!appReady ? (
          <Alert tone="warning">Làm xong bước 1 rồi mới đăng nhập được.</Alert>
        ) : (
          <>
            <a className="btn btn-primary" href="/api/auth/facebook/start">
              Đăng nhập bằng Facebook
            </a>
            {settings.loginAppInheritedFrom && (
              <p className="hint mt-2">
                Đang dùng ứng dụng của tài khoản <strong>{settings.loginAppInheritedFrom}</strong>{" "}
                (App ID {settings.loginAppId}). Muốn dùng ứng dụng khác thì điền lại ở bước 1.
              </p>
            )}
          </>
        )}

        <p className="hint mt-3">
          Ở màn hình Facebook nhớ <strong>chọn tất cả các Page</strong> cần đăng — bỏ qua bước đó
          thì phần mềm không thấy Page nào.
        </p>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Facebook báo lỗi &quot;URL Blocked&quot; hoặc không nhận địa chỉ localhost?
          </summary>
          <div className="mt-2">
            <p className="hint mb-3">
              Dùng đường vòng này: đăng nhập qua địa chỉ chính chủ của Facebook, sau khi bấm Đồng ý
              trang sẽ hiện chữ &quot;Success&quot; — copy nguyên đường dẫn trên thanh địa chỉ rồi
              dán vào ô dưới.
            </p>
            <a
              className="btn btn-ghost"
              href="/api/auth/facebook/start?mode=desktop"
              target="_blank"
              rel="noreferrer"
            >
              Mở cửa sổ đăng nhập (tab mới)
            </a>
            <div className="mt-3">
              <label className="label" htmlFor="redirectedUrl">
                Đường dẫn trả về
              </label>
              <textarea
                id="redirectedUrl"
                className="field font-mono text-xs"
                rows={3}
                value={redirectedUrl}
                onChange={(e) => setRedirectedUrl(e.target.value)}
                placeholder="https://www.facebook.com/connect/login_success.html?code=..."
              />
            </div>
            <button
              className="btn btn-primary mt-3"
              disabled={busy !== null || !redirectedUrl.trim()}
              onClick={() =>
                void connectManual("/api/auth/facebook/manual", { redirectedUrl }, "manual")
              }
            >
              {busy === "manual" ? "Đang kết nối…" : "Kết nối tài khoản"}
            </button>
          </div>
        </details>

        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Cách thủ công: dán token từ Graph API Explorer
          </summary>
          <div className="mt-2">
            <p className="hint mb-3">
              Mở{" "}
              <a
                className="font-medium underline"
                href={EXPLORER_URL}
                target="_blank"
                rel="noreferrer"
              >
                Graph API Explorer
              </a>
              , chọn app của bạn, chọn <strong>User Token</strong>, tick 3 quyền{" "}
              <code>pages_show_list</code>, <code>pages_read_engagement</code>,{" "}
              <code>pages_manage_posts</code>, bấm Generate rồi copy chuỗi token.
            </p>
            <textarea
              className="field font-mono text-xs"
              rows={3}
              value={explorerToken}
              onChange={(e) => setExplorerToken(e.target.value)}
              placeholder="EAAG..."
            />
            <button
              className="btn btn-primary mt-3"
              disabled={busy !== null || !explorerToken.trim() || !appReady}
              onClick={() =>
                void connectManual(
                  "/api/accounts",
                  {
                    appId: appId.trim(),
                    appSecret: appSecret.trim() || undefined,
                    shortLivedToken: explorerToken.trim(),
                  },
                  "explorer",
                )
              }
            >
              {busy === "explorer" ? "Đang kết nối…" : "Kết nối bằng token"}
            </button>
            <p className="hint mt-2">
              Cách này cần điền lại App Secret ở bước 1 (ô mật khẩu không giữ lại giá trị đã lưu).
            </p>
          </div>
        </details>
      </Section>

      <Section
        title="Thông tin kỹ thuật"
        description="Chỉ đổi khi Facebook phát hành phiên bản Graph API mới."
      >
        <p className="hint">
          Phiên bản Graph API đang dùng: <strong>{settings.graphVersion}</strong>
        </p>
        <p className="hint mt-2">
          Toàn bộ App Secret và token được lưu trong file <code>data/fbpost.db</code> ngay trên máy
          bạn, không gửi đi đâu khác. Thư mục <code>data/</code> đã được loại khỏi git.
        </p>
      </Section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-10">
          <Spinner label="Đang tải…" />
        </div>
      }
    >
      <SettingsPageInner />
    </Suspense>
  );
}
