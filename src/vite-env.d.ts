/// <reference types="vite/client" />

/** Markdown files are rendered to HTML at build time (see `markdownGuides` in vite.config.ts). */
declare module '*.md' {
  const html: string;
  export default html;
}
