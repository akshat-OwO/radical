import type { NativeContributions } from "../../vite/native-contributions.ts";

// Any include turns Android's default traversal into an allowlist. Leave the
// rules empty to retain credential- and device-protected data, and future
// platform domains. Android always omits noBackupFilesDir and cache directories.
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
      contents: '<?xml version="1.0" encoding="utf-8"?><full-backup-content/>',
    },
    {
      platform: "android",
      file: "android/app/src/main/res/xml/radical_data_extraction_rules.xml",
      contents:
        '<?xml version="1.0" encoding="utf-8"?><data-extraction-rules><cloud-backup/><device-transfer/></data-extraction-rules>',
    },
  ],
};
