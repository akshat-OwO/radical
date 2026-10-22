import { createFileRoute, Link } from "@tanstack/react-router";
import { useGoogleSignIn } from "radical/react";

const GoogleSignIn = () => {
  const google = useGoogleSignIn();

  return (
    <main>
      <h1>Google sign-in</h1>
      <Link to="/">Home</Link>
      <p>
        Supply Google Cloud OAuth clients before signing in on a device. Browser
        sign-in is unavailable.
      </p>
      <button
        type="button"
        disabled={google.loading}
        onClick={() => {
          google.signIn();
        }}
      >
        Sign in with Google
      </button>
      <output>
        {google.loading
          ? "Signing in..."
          : (google.error?._tag ??
            (google.value ? "Identity token received" : "Idle"))}
      </output>
    </main>
  );
};

export const Route = createFileRoute("/google-sign-in")({
  component: GoogleSignIn,
});
