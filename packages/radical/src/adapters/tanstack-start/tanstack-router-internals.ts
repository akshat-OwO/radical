import type { AnyRouter } from "@tanstack/react-router";

/**
 * Compatibility boundary for react-router 1.170.45 / router-core 1.171.38.
 * Public events do not await listeners, and viewTransition options only wrap
 * document.startViewTransition. Native capture must delay the actual commit.
 * The contract test exercises the awaited callback and per-navigation opt-out.
 */
export const installRouterCommitHook = (
  router: Pick<AnyRouter, "startViewTransition" | "shouldViewTransition">,
  run: (commit: () => Promise<void>, enabled: boolean) => Promise<void>
) => {
  const original = router.startViewTransition;

  const start: typeof original = (commit) => {
    const enabled = router.shouldViewTransition !== false;
    router.shouldViewTransition = undefined;

    return run(commit, enabled);
  };

  router.startViewTransition = start;

  return () => {
    if (router.startViewTransition === start) {
      router.startViewTransition = original;
    }
  };
};
