import { useSections } from "@akshatowo/radical/react";
import { createFileRoute, Link } from "@tanstack/react-router";

const About = () => {
  const { setBadge } = useSections();

  return (
    <main>
      <h1>About</h1>
      <p>This route uses a fade transition.</p>
      <button
        type="button"
        onClick={() => {
          void setBadge("home", 3);
        }}
      >
        Badge Home
      </button>
      <button
        type="button"
        onClick={() => {
          void setBadge("home", null);
        }}
      >
        Clear badge
      </button>
      <Link to="/">Home</Link>
    </main>
  );
};

export const Route = createFileRoute("/about")({
  staticData: { radical: { transition: "fade" } },
  component: About,
});
