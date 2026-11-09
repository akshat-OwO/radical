import type { NativeContributions } from "../../vite/native-contributions.ts";

// An include switches Android from its default set to an allowlist. Preserve
// every default domain; noBackupFilesDir and caches remain platform-excluded.
const include = ["root", "file", "database", "sharedpref", "external"]
  .map((domain) => `<include domain="${domain}" path="." />`)
  .join("");

export const appStorageContributions: NativeContributions = {
  privacyAccessedApis: {
    NSPrivacyAccessedAPICategoryFileTimestamp: ["C617.1"],
  },
  androidApplicationAttributes: {
    "android:dataExtractionRules": "@xml/radical_data_extraction_rules",
    "android:fullBackupContent": "@xml/radical_backup_rules",
  },
  files: [
    {
      platform: "android",
      file: "android/app/src/main/res/xml/radical_backup_rules.xml",
      contents: `<?xml version="1.0" encoding="utf-8"?><full-backup-content>${include}</full-backup-content>`,
    },
    {
      platform: "android",
      file: "android/app/src/main/res/xml/radical_data_extraction_rules.xml",
      contents: `<?xml version="1.0" encoding="utf-8"?><data-extraction-rules><cloud-backup>${include}</cloud-backup><device-transfer>${include}</device-transfer></data-extraction-rules>`,
    },
  ],
};
