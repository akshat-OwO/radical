import { readdirSync } from "node:fs";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { Effect } from "effect";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite-plus";

const pages = Effect.runSync(
  Effect.sync(() =>
    readdirSync(new URL("content/docs", import.meta.url), {
      recursive: true,
      encoding: "utf-8",
    })
      .filter((file) => file.endsWith(".mdx"))
      .map((file) => ({
        path: `/docs/${file.replace(/(?:^|\/)index\.mdx$/u, "").replace(/\.mdx$/u, "")}`,
      }))
  )
);

export default defineConfig({
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      pages,
      prerender: { enabled: true, crawlLinks: false, concurrency: 2 },
    }),
    react(),
  ],
  server: { host: "127.0.0.1", port: 4317 },
});
