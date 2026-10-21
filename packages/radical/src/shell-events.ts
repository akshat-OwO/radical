/** Shared by both shells. Every event retains its latest value for late observers. */
export const shellEventPublisher = `(name, value) => {
  const radical = window.__radical ??= { latest: Object.create(null) };
  radical.latest[name] = value;
  window.dispatchEvent(new CustomEvent(name, { detail: value }));
}`;

/** Bundled CSS waits for mount; remote CSS waits for the SSR root to finish parsing. */
export const safeAreaUpdateScript = `((value) => {
  const apply = () => {
    const { style } = document.documentElement;
    for (const edge of ["top", "right", "bottom", "left"]) {
      const name = "--radical-safe-area-" + edge;
      const css = value[edge] + "px";
      if (style.getPropertyValue(name) !== css) style.setProperty(name, css);
    }
  };
  if (!window.__radicalBundled || window.__radicalMounted) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", apply, { once: true });
    } else {
      apply();
    }
  }
  (${shellEventPublisher})("radicalSafeArea", value);
})(`;
