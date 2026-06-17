import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { notificationApi } from "../api/notification-api";

/**
 * Logger shim — avoids console.log in production while keeping the hook testable.
 * Replace with a real structured logger (e.g. Sentry) when available.
 */
function logInfo(msg: string, ctx?: Record<string, unknown>): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.info(`[usePushNotifications] ${msg}`, ctx ?? "");
  }
}

function logWarn(msg: string, ctx?: Record<string, unknown>): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`[usePushNotifications] ${msg}`, ctx ?? "");
  }
}

export interface UsePushNotificationsResult {
  /** Call on logout to soft-delete the registered token server-side. */
  cleanup: () => Promise<void>;
}

/**
 * usePushNotifications — requests Expo push permission, obtains the push token,
 * and registers it with the MediaOS backend via POST /notifications/devices.
 *
 * Rules (G15-2):
 *   - Permission denied or API error → logged only, NEVER throws / crashes the app.
 *   - Token is NEVER logged (only token length is recorded).
 *   - cleanup() soft-deletes the token on logout (best-effort — failure is swallowed).
 *   - Web platform is skipped (Expo push is mobile-only).
 *   - FCM send is deferred — this hook only handles registration.
 */
export function usePushNotifications(): UsePushNotificationsResult {
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;

    let cancelled = false;

    async function register(): Promise<void> {
      try {
        // Dynamic import keeps expo-notifications out of web bundle and avoids
        // import-time errors on platforms where it is unavailable.
        const Notifications = await import("expo-notifications");

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== "granted") {
          logWarn("Push permission denied — skipping registration", { status: finalStatus });
          return;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync();
        const token = tokenData.data;

        if (cancelled) return;

        tokenRef.current = token;
        logInfo("Registering push token", { tokenLength: token.length });

        const platform: "ios" | "android" | "web" =
          Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

        await notificationApi.registerDevice({ token, platform });
        logInfo("Push token registered successfully", { tokenLength: token.length });
      } catch (err: unknown) {
        // Best-effort: permission failure, token fetch failure, or API failure.
        // NEVER propagate — push failure must not affect the rest of the app.
        logWarn("Push registration failed (non-fatal)", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    void register();

    return () => {
      cancelled = true;
    };
  }, []);

  async function cleanup(): Promise<void> {
    const token = tokenRef.current;
    if (!token) return;

    try {
      await notificationApi.unregisterDevice(token);
      logInfo("Push token unregistered", { tokenLength: token.length });
      tokenRef.current = null;
    } catch (err: unknown) {
      // Best-effort unregister — a stale token is harmless (server soft-delete idempotent).
      logWarn("Push token unregister failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { cleanup };
}
