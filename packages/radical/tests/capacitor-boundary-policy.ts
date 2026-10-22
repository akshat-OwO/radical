// Shared by Oxlint and the source scan. Keep the policy in ADR 0003 current.
export const capacitorScopes =
  "^@(?:capacitor|capacitor-community|capgo|capawesome)/";
export const capacitorAllowedFiles = [
  "packages/radical/src/internal-plugins.ts",
  "packages/radical/src/native-project.ts",
  "packages/radical/src/native-assets.ts",
];
