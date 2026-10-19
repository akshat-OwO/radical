import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

const OfflineRoute = () => {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>Offline route</h1>
      <p>
        Visit this URL online, then reload it offline. Query strings keep
        separate snapshots.
      </p>
      <button
        onClick={() => {
          setCount(count + 1);
        }}
        type="button"
      >
        Hydration check: {count}
      </button>
      <a href="/">Home</a>
    </main>
  );
};

export const Route = createFileRoute("/offline-route")({
  staticData: { offline: true },
  component: OfflineRoute,
});
