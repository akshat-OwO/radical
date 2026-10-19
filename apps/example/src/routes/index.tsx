import { createFileRoute } from "@tanstack/react-router";

const Home = () => (
  <main>
    <h1>Radical example</h1>
    <p>TanStack Start renders this app with the radical adapter registered.</p>
  </main>
);

export const Route = createFileRoute("/")({ component: Home });
