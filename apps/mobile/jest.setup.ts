/**
 * Global jest setup for the mobile app.
 * Mocks the native Expo modules so unit tests never touch the device keychain / native config.
 * Network is never hit: api modules are mocked per-test (see app/__tests__/*).
 */

// In-memory SecureStore so token-storage works deterministically in tests.
jest.mock("expo-secure-store", () => {
  const mem = new Map<string, string>();
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => {
      mem.set(k, v);
    }),
    getItemAsync: jest.fn(async (k: string) => mem.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => {
      mem.delete(k);
    }),
  };
});

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: "http://localhost:3100/api/v1" } } },
}));
