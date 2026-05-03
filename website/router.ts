// Hash-based router. Three lines of essence: parse `location.hash`,
// pick the matching route, swap the contents of `root`. Returns
// nothing — the cleanup of one route happens before the next mounts.
//
// Each route handler returns its own cleanup callback; the router
// invokes it on every navigation. Routes own their event listeners,
// timers, and PM views so they don't leak across navigations.

export type RouteHandler = (root: HTMLElement) => () => void;

export type Route = {
  path: string; // e.g. "/" or "/specs"
  handler: RouteHandler;
};

export function startRouter(root: HTMLElement, routes: Route[]): void {
  let cleanup: (() => void) | null = null;

  function render(): void {
    const path = location.hash.replace(/^#/, "") || "/";
    cleanup?.();
    cleanup = null;
    root.innerHTML = "";
    const route = routes.find((r) => r.path === path) ?? routes[0]!;
    cleanup = route.handler(root);
    // Hint to AT readers; harmless for sighted users.
    root.scrollIntoView({ block: "start", behavior: "instant" });
  }

  window.addEventListener("hashchange", render);
  render();
}
