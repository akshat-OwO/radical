import { registerOffline } from "@akshatowo/radical/client";
import { StartClient } from "@tanstack/react-start/client";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { config } from "virtual:radical/config";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>
  );
});

const register = () => {
  void registerOffline({
    mode: config.mode,
    production: import.meta.env.PROD,
    base: import.meta.env.BASE_URL,
  });
};

if (document.readyState === "complete") {
  register();
} else {
  window.addEventListener("load", register, { once: true });
}
