import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { radical } from "radical/tanstack-start";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    tanstackStart(),
    radical({ appId: "dev.radical.example", appName: "Radical example" }),
    react(),
  ],
});
