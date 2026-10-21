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
  pluginOptions: { Echo: { prefix: "Native: " } },
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
