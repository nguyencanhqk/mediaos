/**
 * Jest config for the Expo mobile app (M1).
 * - `jest-expo` preset: babel-preset-expo transform + RN/Expo module whitelist.
 * - `@mediaos/contracts` is mapped to its TS source so Zod schemas resolve without a build step.
 * - jsdom is NOT used; jest-expo runs the React Native test environment.
 */
module.exports = {
  preset: "jest-expo",
  // RTL-native v13 ships its Jest matchers built-in (no extend-expect import needed).
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@mediaos/contracts$": "<rootDir>/../../packages/contracts/src/index.ts",
  },
  // pnpm nests packages under node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>, so the whitelist
  // must allow an optional `.pnpm/` prefix — otherwise RN/Expo Flow-typed source is left untransformed.
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/)?(?:(jest-)?react-native|@react-native|@react-native-community|expo|expo-.*|@expo|@expo-google-fonts|react-navigation|@react-navigation|@unimodules|unimodules|native-base|react-native-svg))",
  ],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "app/**/*.{ts,tsx}",
    "!**/*.test.{ts,tsx}",
    "!src/test-utils/**",
  ],
};
