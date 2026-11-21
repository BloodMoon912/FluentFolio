# CMS content and Markdown editor

## English slugs

New content IDs are generated as lowercase English kebab-case slugs:

- If the title contains Latin words, those words are normalised and used.
- For a Chinese-only title, the generator does not invent a pinyin reading. It uses a collection prefix and date: `post-YYYYMMDD`, `chapter-YYYYMMDD`, `word-YYYYMMDD`, or `lore-YYYYMMDD`.
- To give a Chinese-titled item a meaningful English URL, fill in **英文 slug 關鍵字（選填）** with an English phrase. The slug remains editable until the user manually changes it; existing IDs are not rewritten.

## Markdown editor

The online editor provides:

- Editor-only, side-by-side, and preview-only modes.
- A toolbar for headings, emphasis, links, inline code, fenced code, quotes, lists, tasks, separators, and tables.
- `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+K`, `Ctrl/Cmd+S`, and `Ctrl/Cmd+Enter` shortcuts.
- `Tab` / `Shift+Tab` to indent or outdent selected lines.
- Smart Enter to continue bullet, task, and numbered lists, and leave an empty list item.
- Live character/line counts, Markdown lint feedback, and a focus-writing mode.
- Sanitised live preview using the same `.markdown-content` typography as published pages.
- `[[dictionary-id]]` preview links for dictionary entries already loaded by the CMS.
- Responsive tables and copy buttons for fenced code blocks in preview and published content.

Markdown is stored as plain text in the existing content body. The editor does not introduce a new content format or require data migration.
