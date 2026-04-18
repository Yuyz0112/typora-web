import { describe, test } from "@voidzero-dev/vite-plus-test";

import { parse } from "./parser.ts";
import { serialize } from "./serializer.ts";

// Core invariant: parse(serialize(parse(md))) is structurally equal to parse(md).
// We do not assert md string equality (the serializer normalizes), only that
// parsing again yields the same tree — i.e. the doc round-trips losslessly.
function roundTripStable(md: string): void {
  const doc1 = parse(md);
  const md2 = serialize(doc1);
  const doc2 = parse(md2);
  if (!doc1.eq(doc2)) {
    throw new Error(
      `round-trip mismatch\n--- input md ---\n${md}\n--- serialized md ---\n${md2}\n--- doc1 ---\n${JSON.stringify(doc1.toJSON(), null, 2)}\n--- doc2 ---\n${JSON.stringify(doc2.toJSON(), null, 2)}`,
    );
  }
}

describe("round-trip: blocks", () => {
  test("paragraph", () => roundTripStable("hello world"));
  test("multiple paragraphs", () => roundTripStable("one\n\ntwo\n\nthree"));
  test("all heading levels", () =>
    roundTripStable("# h1\n\n## h2\n\n### h3\n\n#### h4\n\n##### h5\n\n###### h6"));
  test("blockquote single paragraph", () => roundTripStable("> quoted text"));
  test("blockquote multi paragraph", () => roundTripStable("> first\n>\n> second"));
  test("horizontal rule", () => roundTripStable("before\n\n---\n\nafter"));
  test("fenced code with lang", () => roundTripStable("```ts\nconst x = 1;\n```"));
  test("fenced code without lang", () => roundTripStable("```\nplain text\n```"));
  test("code block preserves internal newlines", () =>
    roundTripStable("```\nline 1\nline 2\nline 3\n```"));
});

describe("round-trip: lists", () => {
  test("bullet list", () => roundTripStable("- a\n- b\n- c"));
  test("ordered list default start", () => roundTripStable("1. a\n2. b"));
  test("ordered list with start", () => roundTripStable("5. a\n6. b"));
  test("nested bullet list", () => roundTripStable("- outer\n  - inner\n- next"));
  test("list item with multi-paragraph content", () =>
    roundTripStable("- first para\n\n  second para\n- next item"));
});

describe("round-trip: inline marks", () => {
  test("strong", () => roundTripStable("**bold**"));
  test("em", () => roundTripStable("*italic*"));
  test("strong (underscore)", () => roundTripStable("__bold__"));
  test("em (underscore)", () => roundTripStable("_italic_"));
  test("strong and em adjacent", () => roundTripStable("**bold** and *italic*"));
  test("nested strong+em", () => roundTripStable("***both***"));
  test("inline code", () => roundTripStable("run `npm test`"));
  // Backtick-fence upgrade (``…`…``) isn't covered by the Typora-pilot
  // parser yet — inline-parse recognises only single-backtick pairs.
  // Revisit when method-B expands to variable-length code fences.
  test.skip("inline code with backticks inside", () => roundTripStable("use `` ` `` as fence"));
  test("link without title", () => roundTripStable("see [site](https://example.com)"));
  test("link with title", () => roundTripStable('see [site](https://example.com "home")'));
  test("hard break", () => roundTripStable("line a  \nline b"));
  test("soft break (newline in paragraph)", () => roundTripStable("line a\nline b"));
});

describe("round-trip: escaping", () => {
  test("escaped markdown meta characters as literal text", () =>
    roundTripStable("literal \\*not italic\\*"));
  test("paragraph starting with heading-like char", () => roundTripStable("\\# not a heading"));
  test("paragraph starting with list-like char", () => roundTripStable("\\- not a bullet"));
  test("angle brackets", () => roundTripStable("a \\<b\\> c"));
  test("underscores inside word", () => roundTripStable("snake\\_case\\_ident"));
});

describe("round-trip: composite", () => {
  test("typical document", () => {
    const md = [
      "# Title",
      "",
      "Intro paragraph with **bold**, *italic*, and `code`.",
      "",
      "> A blockquote with a [link](https://example.com).",
      "",
      "- first item",
      "- second **item**",
      "",
      "1. one",
      "2. two",
      "",
      "```ts",
      "const x: number = 1;",
      "```",
      "",
      "---",
      "",
      "final paragraph",
    ].join("\n");
    roundTripStable(md);
  });
});
