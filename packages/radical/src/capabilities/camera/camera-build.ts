import type { NativeContributions } from "../../vite/native-contributions.ts";
import { escapeXml } from "../../vite/native-contributions.ts";
import type { CameraConfigSchema } from "./camera-schema.ts";

export const cameraAndroid = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];
export const cameraContributions = (
  options: typeof CameraConfigSchema.Type
): NativeContributions => ({
  android: cameraAndroid,
  plist: [
    {
      key: "NSCameraUsageDescription",
      value: options.usageDescription,
      composition: "unique-purpose",
      order: 0,
    },
    {
      key: "NSPhotoLibraryUsageDescription",
      value: `<string>${escapeXml(options.photoLibraryUsageDescription)}</string>`,
    },
  ],
});
