import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const readNativeContext = createServerFn({ method: "GET" }).handler(
  ({ context }) => context.nativeContext
);

const Home = () => {
  const nativeContext = Route.useLoaderData();
  return (
    <main>
      <h1>Radical example</h1>
      <a href="/offline-route">Offline route</a>{" "}
      <a href="/online-route">Network required</a>
      <h2>Native context</h2>
      <pre>{JSON.stringify(nativeContext, null, 2)}</pre>
    </main>
  );
};

export const Route = createFileRoute("/")({
  loader: async () => await readNativeContext(),
  component: Home,
});
