import { defineConfig } from "blume";
import { orama } from "blume/search";

export default defineConfig({
  title: "Radical",
  description:
    "Run your web app in Android and iOS shells with native capabilities.",
  logo: { image: "/logo.svg", text: "Radical" },
  content: { root: "content" },
  theme: {
    accent: { dark: "#ff6a33", light: "#c93d0b" },
    fonts: {
      body: { name: "Host Grotesk" },
      display: { name: "Host Grotesk" },
      mono: { name: "Atkinson Hyperlegible Mono" },
    },
    mode: "system",
  },
  search: orama(),
  seo: { og: { enabled: true, logo: "/logo.svg" } },
});
