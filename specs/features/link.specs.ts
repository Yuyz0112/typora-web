import type { FeatureSpecs } from "../_types.ts";

export const linkSpecs: FeatureSpecs = {
  name: "link",
  renderCases: {
    // Single owner for the `<a>` tag — both link and autolink emit `<a>`,
    // and renderCases is a tag→handler map so we'd otherwise collide.
    // Dispatch on `data-autolink` (set by autolink's toDOM): autolink
    // → <a:url>...</a>, regular link → <l:url>...</l>.
    a: (children, el) => {
      const href = el.getAttribute("href") ?? "";
      if (el.hasAttribute("data-autolink")) return `<a:${href}>${children}</a>`;
      return `<l:${href}>${children}</l>`;
    },
  },
  cases: [
    {
      id: "inline-link",
      label: "[a](b) — link fires when the close `)` lands",
      seed: "",
      events: ["[", "a", "]", "(", "b", ")", " "],
      checkpoints: [
        { at: 3, expect: "[a]|" },
        // at 4: auto-pair on `(` puts `)` in place. Empty href `[a]()`
        // is now a valid link (regex allows empty href), so the link
        // fires immediately; cursor splits the close-delim gray span.
        { at: 4, expect: "<g>[</g><l:>a</l><g>](</g>|<g>)</g>" },
        // at 5: typing `b` completes `[a](b)` so the link fires; cursor
        // sits between `b` and the close `)`.
        { at: 5, expect: "<g>[</g><l:b>a</l><g>](b</g>|<g>)</g>" },
        // at 6: skip-over moves cursor past `)`; link span unchanged.
        { at: 6, expect: "<g>[</g><l:b>a</l><g>](b)</g>|" },
        // at 7: space pushes cursor past span → delims hidden.
        { at: 7, expect: "<l:b>a</l> |" },
      ],
    },
    {
      id: "empty-href",
      label: "[a]() — empty href is a valid link",
      seed: "",
      events: ["[", "a", "]", "(", ")"],
      checkpoints: [
        { at: 3, expect: "[a]|" },
        { at: 4, expect: "<g>[</g><l:>a</l><g>](</g>|<g>)</g>" },
        // at 5: skip-over moves cursor past `)`; cursor sits at span's
        // right edge so delims stay visible (same as inline-link at:6).
        { at: 5, expect: "<g>[</g><l:>a</l><g>]()</g>|" },
      ],
    },
    {
      id: "href-with-query",
      label: "[a](http://x.com/p?q=1&r=2) — query chars survive in href",
      seed: "[a](http://x.com/p?q=1&r=2) ",
      events: [],
      checkpoints: [
        { at: 0, expect: "<l:http://x.com/p?q=1&r=2>a</l> |" },
      ],
    },
    {
      id: "empty-link-stable",
      label: "[]() stable — empty text keeps delims visible",
      seed: "[]() ",
      events: [],
      checkpoints: [
        // cursor parked at end (after trailing space, outside span).
        // Empty text means delims stay gray instead of hiding, otherwise
        // the link would be invisible/uneditable.
        { at: 0, expect: "<g>[</g><g>]()</g> |" },
      ],
    },
    {
      id: "empty-text-only-href-stable",
      label: "[](url) stable — empty text promotes url to visible link text",
      seed: "[](http://x.com) ",
      events: [],
      checkpoints: [
        // text empty: `[`, `](`, `)` stay gray; href text inside the
        // close delim renders with link style, mirroring autolink form.
        {
          at: 0,
          expect:
            "<g>[</g><g>](</g><l:http://x.com>http://x.com</l><g>)</g> |",
        },
      ],
    },
    {
      id: "link-with-code-inside",
      label: "[`code`](url) — inline code nests inside link text",
      seed: "[`/specs`](https://x.com)",
      events: [],
      // The text segments split on mark coverage: the backticks carry
      // only the link mark (rendered as <a> wrapping a hidden delim
      // char, hence the visually-empty <l:url></l> spans); `/specs`
      // carries link + code, rendered with code on the outside per
      // PM's mark-order resolution.
      checkpoints: [
        {
          at: 0,
          expect:
            "<g>[</g><l:https://x.com></l><c><l:https://x.com>/specs</l></c><l:https://x.com></l><g>](https://x.com)</g>|",
        },
      ],
    },
    {
      id: "link-with-em-inside",
      label: "[*emph*](url) — em nests inside link text",
      seed: "[*emph*](https://x.com)",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            "<g>[</g><l:https://x.com></l><i><l:https://x.com>emph</l></i><l:https://x.com></l><g>](https://x.com)</g>|",
        },
      ],
    },
    {
      id: "empty-link",
      label: "[]() — empty text + empty href, all chars are delim",
      seed: "",
      events: ["[", "]", "("],
      checkpoints: [
        { at: 1, expect: "[|]" },
        { at: 2, expect: "[]|" },
        // at 3: doc is `[]()`, link mark covers all 4 chars (all delim).
        // open delim `[` and close delim `](...)` are emitted as separate
        // decorations (content is empty between them); cursor between `(`
        // and `)` splits the close-delim span.
        { at: 3, expect: "<g>[</g><g>](</g>|<g>)</g>" },
      ],
    },
  ],
};
