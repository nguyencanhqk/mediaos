import { Stack } from "expo-router";

/** Auth group layout — no tab bar, no header. */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
