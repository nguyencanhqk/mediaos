import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";

/**
 * Test render helper: wraps the UI in a fresh QueryClient with retries OFF (so a mocked rejection
 * surfaces immediately instead of being retried). Auth is mocked per-test via jest.mock on
 * `../auth/auth-context`, so no AuthProvider is needed here.
 */
export function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
