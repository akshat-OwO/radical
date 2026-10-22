import { useNetworkStatus } from "@akshatowo/radical/react";
import { createFileRoute, Link } from "@tanstack/react-router";

const Network = () => {
  const status = useNetworkStatus();

  return (
    <main>
      <h1>Network status</h1>
      <Link to="/">Home</Link>
      <div aria-live="polite">
        <p>
          Connected: {status.value ? String(status.value.connected) : "unknown"}
        </p>
        <p>Type: {status.value?.connectionType ?? "unknown"}</p>
        {status.loading && <p>Reading network status...</p>}
        {status.error && <p>{status.error._tag}</p>}
      </div>
    </main>
  );
};

export const Route = createFileRoute("/network")({ component: Network });
