import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { radical, tanstackStartOptions } from "radical/tanstack-start";
import type { RadicalConfig } from "radical/vite";
import { defineConfig } from "vite-plus";

const config = {
  appId: "dev.radical.example",
  name: "Radical",
  android: {
    name: "Radical Android",
    packageId: "dev.radical.example.android",
  },
  ios: { name: "Radical iOS", bundleId: "dev.radical.example.ios" },
  icon: { image: "./assets/icon.png", backgroundColor: "#6d28d9" },
  splash: { image: "./assets/splash.png", backgroundColor: "#241044" },
  plugins: [{ manifest: "./plugins/echo.ts" }],
  internalPlugins: { camera: true, filePicker: true, intents: true },
  pluginOptions: {
    Echo: { prefix: "Native: " },
    Camera: {
      photoLibraryUsageDescription:
        "Choose a photo to preview it in the Radical example.",
      usageDescription: "Take a photo to preview it in the Radical example.",
    },
  },
  devHost: "localhost",
  mode: "remote",
  origin: "http://localhost:4173",
} satisfies RadicalConfig;

export default defineConfig({
  plugins: [
    tanstackStart(tanstackStartOptions(config)),
    radical(config),
    react(),
  ],
});
