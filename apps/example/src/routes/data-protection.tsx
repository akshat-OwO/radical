import { createFileRoute, Link } from "@tanstack/react-router";
import { useDataProtection } from "radical/react";

const DataProtection = () => {
  const protection = useDataProtection();

  return (
    <main>
      <h1>Data protection</h1>
      <Link to="/">Home</Link>
      <button
        type="button"
        disabled={protection.loading}
        onClick={() => {
          protection.setEnabled(true);
        }}
      >
        Enable protection
      </button>
      <button
        type="button"
        disabled={protection.loading}
        onClick={() => {
          protection.setEnabled(false);
        }}
      >
        Disable protection
      </button>
      <p>
        Android blocks screenshots and recording. iOS obscures capture and the
        app switcher, but cannot block screenshots. Browsers cannot protect the
        screen.
      </p>
      <p>
        Clearing deletes this origin&apos;s accessible storage, cookies,
        databases and caches, plus native WebView data. Close other tabs and
        database connections first.
      </p>
      <button
        type="button"
        disabled={protection.loading}
        onClick={() => {
          protection.clearWebData();
        }}
      >
        Clear web data
      </button>
      <output>
        {protection.loading
          ? "Working..."
          : (protection.error?._tag ??
            JSON.stringify(protection.value ?? "Idle"))}
      </output>
    </main>
  );
};

export const Route = createFileRoute("/data-protection")({
  component: DataProtection,
});
