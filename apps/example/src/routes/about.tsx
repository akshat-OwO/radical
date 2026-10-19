import { createFileRoute, Link } from "@tanstack/react-router";

const About = () => (
  <main>
    <h1>About</h1>
    <p>This route uses a fade transition.</p>
    <Link to="/">Home</Link>
  </main>
);

export const Route = createFileRoute("/about")({
  staticData: { radical: { transition: "fade" } },
  component: About,
});
