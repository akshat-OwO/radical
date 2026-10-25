import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/online-route")({
  staticData: { radical: { navigation: "hidden" } },
  component: () => (
    <main>
      <h1>Network required</h1>
      <p>This route has no offline snapshot and hides section navigation.</p>
      <a href="/">Home</a>
    </main>
  ),
});
