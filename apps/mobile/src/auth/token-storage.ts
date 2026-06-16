import * as SecureStore from "expo-secure-store";

/**
 * Token storage via expo-secure-store (AES-256 on Android Keystore / iOS Keychain).
 * INVARIANT §3: tokens NEVER stored in plaintext (AsyncStorage/MMKV forbidden for tokens).
 */

const KEY_ACCESS_TOKEN = "mediaos_access_token";
const KEY_REFRESH_TOKEN = "mediaos_refresh_token";

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_ACCESS_TOKEN, accessToken),
    SecureStore.setItemAsync(KEY_REFRESH_TOKEN, refreshToken),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_ACCESS_TOKEN);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_REFRESH_TOKEN);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS_TOKEN),
    SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN),
  ]);
}
