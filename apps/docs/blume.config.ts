import { defineConfig } from "blume";
import { orama } from "blume/search";

export default defineConfig({
  title: "Radical",
  description:
    "Run your web app in Android and iOS shells with native capabilities.",
  logo: { image: "/logo.svg", text: "Radical" },
  content: { root: "content" },
  theme: { accent: "green", mode: "system" },
  search: orama(),
  seo: { og: { enabled: true, logo: "/logo.svg" } },
});
