// Top navigation. Two routes (Editor, Specs) + GitHub link. The
// `current` argument tells the bar which route to mark active so the
// router doesn't have to special-case CSS.

const GITHUB = "https://github.com/yuyz0112/typora-web";

export function mountNav(host: HTMLElement, current: string): void {
  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.innerHTML = `
    <a class="brand" href="#/">typora-web</a>
    <div class="nav-links">
      <a href="#/" data-route="/">Editor</a>
      <a href="#/specs" data-route="/specs">Specs</a>
    </div>
    <a class="ext" href="${GITHUB}" target="_blank" rel="noopener">GitHub</a>
  `;
  for (const a of nav.querySelectorAll<HTMLAnchorElement>("[data-route]")) {
    if (a.dataset.route === current) a.classList.add("active");
  }
  host.append(nav);
}
