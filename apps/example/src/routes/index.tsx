import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useDeviceInfo } from "radical/react";

const readNativeContext = createServerFn({ method: "GET" }).handler(
  ({ context }) => context.nativeContext
);

const Home = () => {
  const device = useDeviceInfo();
  const nativeContext = Route.useLoaderData();
  return (
    <main>
      <h1>Radical example</h1>
      <a href="/offline-route">Offline route</a>{" "}
      <a href="/online-route">Network required</a>
      <Link to="/details">Slide to details</Link>{" "}
      <Link to="/about">Fade to about</Link>
      <h2>Device info</h2>
      <pre data-testid="device-info">
        {device.loading
          ? "Loading device info..."
          : JSON.stringify(device.error ?? device.value, null, 2)}
      </pre>
      <h2>Native context</h2>
      <pre>{JSON.stringify(nativeContext, null, 2)}</pre>
      <p>
        <a href="/?navigation=allowed">Navigate within the shell</a>
      </p>
      <p>
        <a href="https://example.com/">Navigate outside the allowlist</a>
      </p>
    </main>
  );
};

export const Route = createFileRoute("/")({
  staticData: { radical: { transition: "slide" } },
  loader: async () => await readNativeContext(),
  component: Home,
});
