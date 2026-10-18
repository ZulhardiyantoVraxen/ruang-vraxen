/** One fenced code block found in an agent's markdown output, ready to become a file. */
export interface ExtractedCodeBlock {
  language: string;
  code: string;
  /** Best-guess filename, built from any ```lang hint and position - models rarely name files explicitly. */
  filename: string;
}

/**
 * Maps a fence's language tag to a file extension. Only languages worth
 * treating as "real source code" are listed - plain ```text or an
 * unrecognized tag means "not code", not "unknown extension", so output
 * that merely happens to use code fences for formatting (a config snippet
 * inside a report, say) doesn't get committed to GitHub as if it were a
 * deliverable.
 */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: "js",
  js: "js",
  jsx: "jsx",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  python: "py",
  py: "py",
  java: "java",
  go: "go",
  rust: "rs",
  rs: "rs",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  php: "php",
  ruby: "rb",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  bash: "sh",
  shell: "sh",
  sh: "sh",
  dockerfile: "Dockerfile",
};

/**
 * Pulls every fenced code block with a recognized language out of markdown
 * text. Returns [] for ordinary prose/report output - that's the signal the
 * worker uses to decide whether a task's result is "source code worth
 * committing to GitHub" at all.
 */
export function extractCodeBlocks(markdown: string): ExtractedCodeBlock[] {
  const fence = /```([a-zA-Z0-9+#]*)\n([\s\S]*?)```/g;
  const blocks: ExtractedCodeBlock[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = fence.exec(markdown)) !== null) {
    const rawLang = match[1].trim().toLowerCase();
    const ext = LANGUAGE_EXTENSIONS[rawLang];
    if (!ext) continue; // unrecognized/empty tag - treat as non-code formatting, not a deliverable

    const code = match[2].replace(/\s+$/, "");
    if (!code.trim()) continue;

    index += 1;
    blocks.push({
      language: rawLang,
      code,
      filename: ext === "Dockerfile" ? "Dockerfile" : `snippet-${index}.${ext}`,
    });
  }

  return blocks;
}
