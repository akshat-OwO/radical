import { Effect } from "effect";

/** Native transition fixtures that ignore system back. */
export const ignoredBack = {
  setBack: () => Effect.void,
  exit: Effect.void,
  settle: Effect.void,
  onBack: () =>
    Effect.succeed(() => {
      // Nothing to unsubscribe.
    }),
};
