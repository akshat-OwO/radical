import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/online-route")({
  component: () => (
    <main>
      <h1>Network required</h1>
      <p>This route has no offline snapshot.</p>
      <a href="/">Home</a>
    </main>
  ),
});
