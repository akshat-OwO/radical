import { createFileRoute, Link } from "@tanstack/react-router";

const samples = [
  "radical-example://about",
  "radical-example://details?source=deep-links#details",
  "radical-example://online-route",
];

const DeepLinks = () => (
  <main>
    <h1>Deep links</h1>
    <p>
      Open these scheme links from outside the app, with the app closed or open.
    </p>
    <ul>
      {samples.map((url) => (
        <li key={url}>
          <a href={url}>{url}</a>
        </li>
      ))}
    </ul>
    <p>
      About and Details open in the app. The excluded online route opens in the
      browser.
    </p>
    <p>
      Verified links use the same paths on RADICAL_ORIGIN. Set an HTTPS origin
      and RADICAL_IOS_TEAM_ID or RADICAL_ANDROID_FINGERPRINT before generation
      to enable them. Without credentials, only scheme links are active.
    </p>
    <Link to="/">Home</Link>
  </main>
);

export const Route = createFileRoute("/deep-links")({
  component: DeepLinks,
});
