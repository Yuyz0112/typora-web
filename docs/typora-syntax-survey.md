# Typora 语法特性调研

用于维护测试用例的初版清单。只覆盖语法特性（块级 / 行内 / Typora 扩展 / HTML / 易错边界），不含编辑器交互行为。

来源：Typora 官方 Markdown Reference（https://support.typora.io/Markdown-Reference/）及通用 CommonMark / GFM 规范。

## 块级（Block）

### CommonMark 基础
- 段落、硬/软换行（行尾两空格 or `\`、Shift+Enter）
- 标题：ATX `#`~`######`；Setext `===` / `---`
- 引用 `>`（嵌套、可包含其它块）
- 无序列表 `-` `*` `+`；有序列表 `1.` `1)`；松/紧列表；任意起始序号
- 任务列表 `- [ ]` / `- [x]`（GFM）
- 缩进代码块（4 空格）
- 围栏代码块 ```` ``` ```` / `~~~`，带语言标签（语法高亮）
- 水平分隔线 `---` `***` `___`
- HTML 块

### GFM / 扩展块
- 表格（`|`，`:---:` 对齐）
- Fenced 代码含 info string
- 脚注定义 `[^id]: ...`

### Typora 专属块
- YAML Front Matter（文首 `---`）
- `[TOC]` 目录
- 数学块 `$$ … $$`
- Mermaid / Flowchart.js / js-sequence-diagrams / Vega / Vega-Lite 代码块（按语言标签渲染）
- 高亮 / Callouts（GitHub Alerts 风格，`> [!NOTE]` 等，需开启）

## 行内（Inline）

- Emphasis `*em*` / `_em_`；Strong `**s**` / `__s__`；组合嵌套
- 删除线 `~~s~~`（GFM）
- 行内代码 `` `code` ``（含反引号逃逸 ``` `` `x` `` ```）
- 链接：inline `[t](url "title")`、reference `[t][id]` / `[t]`、autolink `<url>`、裸 URL 自动识别
- 图片：`![alt](src "title")`、reference 形式、尺寸扩展 `=100x200`
- 锚点跳转 `[见](#heading)` / `[id]`
- 脚注引用 `[^id]`
- Emoji `:smile:`
- 行内数学 `$…$`
- 下标 `~x~`、上标 `^x^`、高亮 `==x==`（可选开关）
- 转义 `\*` `\_` `\\` 等

## HTML 直写

任意 HTML 标签透传。常用：

- `<u>`、`<kbd>`、`<mark>`、`<sub>` / `<sup>`
- `<br>`
- `<details>` / `<summary>`
- `<video>`、`<iframe>`
- `<img width=...>`、带 `style` / `class` 的标签

## 边界 / 易错用例

- 列表 + 代码块 + 引用的嵌套
- 表格中包含 `|`、换行、行内代码、HTML
- 代码块内的 `$`、`#`、列表符号不被解析
- 软换行 vs 硬换行的序列化差异
- 中英文混排下 emphasis 边界（CJK 非 word boundary）
- YAML 与 `[TOC]`、front matter 与首个标题的交互
- Setext 与紧邻段落 / 列表的歧义
