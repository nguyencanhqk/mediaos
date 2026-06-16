import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "MediaOS",
  slug: "mediaos-mobile",
  version: "1.0.0",
  scheme: "mediaos",
  platforms: ["ios", "android"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  splash: {
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.mediaos.mobile",
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#ffffff",
    },
    package: "com.mediaos.mobile",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3100/api/v1",
  },
};

export default config;
