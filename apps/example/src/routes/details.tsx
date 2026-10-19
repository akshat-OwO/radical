import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

const Details = () => {
  const router = useRouter();
  return (
    <main>
      <h1>Details</h1>
      <p>This route uses a slide transition. Back reverses its direction.</p>
      <button
        onClick={() => {
          router.history.back();
        }}
        type="button"
      >
        Back
      </button>
      <Link to="/">Home</Link>
    </main>
  );
};

export const Route = createFileRoute("/details")({
  staticData: { radical: { transition: "slide" } },
  component: Details,
});
