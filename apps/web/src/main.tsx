import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { configureApiBaseUrl } from "@mediaos/web-core";
import i18n from "@/i18n";
import { router } from "@/router";
import "@/index.css";

// Cấp base URL của API cho web-core (import.meta.env ở lại app Vite, không vào package dùng chung).
configureApiBaseUrl(import.meta.env.VITE_API_URL);

const queryClient = new QueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);
