import type { FeatureSpecs } from "../_types.ts";

export const autolinkSpecs: FeatureSpecs = {
  name: "autolink",
  cases: [
    {
      id: "url-autolink",
      label: "<https://x.com> — autolink fires when closing `>` lands",
      seed: "",
      events: [
        "<", "h", "t", "t", "p", "s", ":", "/", "/", "x", ".", "c", "o", "m",
        ">", " ",
      ],
      checkpoints: [
        { at: 1, expect: "<|" },
        { at: 2, expect: "<h|" },
        // Pre-close: text is plain `<https://x.com` — no match yet.
        { at: 14, expect: "<https://x.com|" },
        // Closing `>` completes the pattern; autolink mark applies. Cursor
        // sits at the right edge of the span so the gray delims show.
        {
          at: 15,
          expect: "<g><</g><a:https://x.com>https://x.com</a><g>></g>|",
        },
        // Space pushes the cursor past the span → delims hide.
        { at: 16, expect: "<a:https://x.com>https://x.com</a> |" },
      ],
    },
    {
      id: "email-autolink",
      label: "<a@b.com> — email gets `mailto:` href",
      seed: "<a@b.com> ",
      events: [],
      checkpoints: [
        { at: 0, expect: "<a:mailto:a@b.com>a@b.com</a> |" },
      ],
    },
    {
      id: "non-url-not-touched",
      label: "<not a url> — no scheme/email shape, stays plain text",
      seed: "<not a url> ",
      events: [],
      checkpoints: [
        { at: 0, expect: "<not a url> |" },
      ],
    },
  ],
};
