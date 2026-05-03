# typora-web

A *Typora-style* WYSIWYG Markdown editor on **ProseMirror**.

## What works (try editing)

- inline marks: *em*, **strong**, `code`, ~~strike~~, ==highlight==, x^sup^, x~sub~
- autolinks: <https://prosemirror.net>
- task list:
  - [x] core inline marks
  - [x] tables
  - [ ] inline math (planned)

## Tables (click any cell)

| feature | status |
| --- | :---: |
| em / strong | ✅ |
| highlight | ✅ |
| math | ⏸️ |

## How we work

Every supported syntax has a **spec** — a sequence of input events plus expected pretty-printed output, ported from Typora's behavior. Browse the full catalog at [/specs](#/specs).

## Reporting

Found a Typora behavior we don't match? File an issue with a spec — seed text, event sequence, expected output. Same shape as ours.
