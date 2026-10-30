import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import { Marked, type Token, type Tokens } from 'marked';
import { defineConfig, type Plugin } from 'vite';

/** GitHub's heading anchors: `Why the fallback should be 4` -> `why-the-fallback-should-be-4`. */
const slugify = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>|&[#\w]+;/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

/** Client libraries a code example can be written for, as ```ts tab=papi. The first tab in a group is shown. */
const TABS: Record<string, string> = { papi: 'PAPI', pjs: 'PJS (deprecated)' };

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('rust', rust);

/** A code block's HTML, highlighted at build time (`hljs-*` classes, styled in index.css) when its language is known. */
const codeBlock = (text: string, info: string | undefined, attributes = '') => {
  const language = info?.split(/\s/)[0];
  const known = language && hljs.getLanguage(language);
  const html = known ? hljs.highlight(text, { language }).value : escapeHtml(text);
  return `<pre${attributes}><code${language ? ` class="hljs language-${language}"` : ''}>${html}\n</code></pre>`;
};

const tabOf = (token: Token) => (token.type === 'code' ? /\btab=(\w+)/.exec(token.lang ?? '')?.[1] : undefined);

/** Consecutive tabbed code blocks become one tab group; GuidePage handles the switching. */
const tabGroup = (blocks: Tokens.Code[], group: number) => {
  const ids = blocks.map((block) => {
    const tab = tabOf(block)!;
    if (!TABS[tab]) throw new Error(`Unknown code tab "${tab}"`);
    return { tab, id: `code-${group}-${tab}` };
  });
  const buttons = ids
    .map(
      ({ tab, id }, i) =>
        `<button type="button" role="tab" id="${id}-tab" aria-controls="${id}" aria-selected="${i === 0}" ` +
        `tabindex="${i === 0 ? 0 : -1}" data-tab="${tab}">${TABS[tab]}</button>`,
    )
    .join('');
  const panels = blocks
    .map((block, i) => {
      const { tab, id } = ids[i];
      return codeBlock(
        block.text,
        block.lang,
        ` role="tabpanel" id="${id}" aria-labelledby="${id}-tab" data-tab="${tab}"${i === 0 ? '' : ' hidden'}`,
      );
    })
    .join('');
  return `<div class="code-tabs"><div role="tablist" aria-label="Client library">${buttons}</div>${panels}</div>\n`;
};

/**
 * Turns `docs/*.md` imports into rendered HTML strings at build time, so the guides ship inside the
 * static site. Links to another guide (`other-guide.md#anchor`) become `?guide=other-guide#anchor`.
 */
const markdownGuides = (): Plugin => {
  let groups = 0;
  const marked = new Marked({
    hooks: {
      processAllTokens(tokens) {
        const result: Token[] = [];
        for (let i = 0; i < tokens.length; i++) {
          if (!tabOf(tokens[i])) {
            result.push(tokens[i]);
            continue;
          }
          const blocks: Tokens.Code[] = [];
          let next = i;
          while (next < tokens.length && (tabOf(tokens[next]) || tokens[next].type === 'space')) {
            if (tokens[next].type === 'code') blocks.push(tokens[next] as Tokens.Code);
            next++;
          }
          const html = tabGroup(blocks, groups++);
          result.push({ type: 'html', block: true, pre: false, raw: html, text: html });
          i = next - 1;
        }
        return result;
      },
    },
    walkTokens: (token) => {
      if (token.type !== 'link') return;
      const match = /^(?:\.\/)?([\w-]+)\.md(#.*)?$/.exec(token.href);
      if (match) token.href = `?guide=${match[1]}${match[2] ?? ''}`;
    },
    renderer: {
      code({ text, lang }) {
        return `${codeBlock(text, lang)}\n`;
      },
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        return `<h${depth} id="${slugify(html)}">${html}</h${depth}>\n`;
      },
    },
  });
  return {
    name: 'markdown-guides',
    transform(source, id) {
      if (!id.endsWith('.md')) return;
      this.addWatchFile(id);
      const html = marked.parse(source, { async: false });
      return { code: `export default ${JSON.stringify(html)};`, map: null };
    },
  };
};

export default defineConfig({
  // Relative asset paths so dist/ works from any host path (GitHub Pages, IPFS, DotNS).
  base: './',
  plugins: [markdownGuides(), react(), tailwindcss()],
});
