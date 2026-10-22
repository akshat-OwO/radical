import type { NativeContributions } from "../../vite/native-contributions.ts";
import { cameraAndroid } from "../camera/camera-build.ts";

export const videoStreamContributions = (options: {
  readonly usageDescription: string;
}): NativeContributions => ({
  android: cameraAndroid,
  plist: [
    {
      key: "NSCameraUsageDescription",
      value: options.usageDescription,
      composition: "unique-purpose",
      order: 1,
    },
  ],
});
