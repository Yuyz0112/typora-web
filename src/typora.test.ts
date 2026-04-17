import { describe, expect, test } from "@voidzero-dev/vite-plus-test";

import { apply, pretty, setup } from "./test-utils.ts";

describe("typora: italic with single asterisks", () => {
  test("* — single asterisk, no mark", () => {
    expect(pretty(apply(setup(""), ["*"]))).toBe("*|");
  });

  test("*1 — typing inside a lone asterisk, still raw", () => {
    expect(pretty(apply(setup(""), ["*", "1"]))).toBe("*1|");
  });

  test("*1* — closing asterisk triggers italic; cursor inside mark shows gray delims", () => {
    expect(pretty(apply(setup(""), ["*", "1", "*"]))).toBe("<g>*</g><i>1</i><g>*</g>|");
  });

  test("*1*<space> — space exits mark; gray delims disappear", () => {
    expect(pretty(apply(setup(""), ["*", "1", "*", " "]))).toBe("<i>1</i> |");
  });
});
