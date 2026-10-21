import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { radical } from "radical/tanstack-start";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    tanstackStart(),
    radical({
      appId: "dev.radical.example",
      name: "Radical",
      android: {
        name: "Radical Android",
        packageId: "dev.radical.example.android",
      },
      ios: { name: "Radical iOS", bundleId: "dev.radical.example.ios" },
      icon: "./assets/icon.png",
      splash: { image: "./assets/splash.png", backgroundColor: "#241044" },
      plugins: [{ manifest: "./plugins/echo.ts" }],
      pluginOptions: { Echo: { prefix: "Native: " } },
      devHost: "localhost",
    }),
    react(),
  ],
});
