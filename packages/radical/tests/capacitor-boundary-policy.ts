// Shared by Oxlint and the source scan. Keep the policy in ADR 0003 current.
export const capacitorScopes =
  "^@(?:capacitor|capacitor-community|capgo|capawesome)/";
export const capacitorAllowedFiles = [
  "packages/radical/src/core/plugins/internal-plugins.ts",
  "packages/radical/src/native/shared/native-project.ts",
  "packages/radical/src/native/assets/native-assets.ts",
];
