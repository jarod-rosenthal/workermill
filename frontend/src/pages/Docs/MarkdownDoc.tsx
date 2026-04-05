import { useMemo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";

// Highlight.js dark theme for code blocks
import "highlight.js/styles/github-dark.css";

// Bulk-import all platform docs at build time as raw strings.
const docModules = import.meta.glob("../../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Map slug → raw markdown content
const docs = Object.fromEntries(
  Object.entries(docModules).map(([path, content]) => {
    const name = path.split("/").pop()?.replace(".md", "") ?? "";
    return [name, content];
  }),
);

// -------- Table of contents --------

type TocEntry = { id: string; text: string; level: number };

function extractToc(markdown: string): TocEntry[] {
  const lines = markdown.split("\n");
  const toc: TocEntry[] = [];
  let inCodeBlock = false;
  const seen = new Set<string>();

  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (!match) continue;

    const level = match[1].length;
    const text = match[2].replace(/`/g, "").trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");

    let uniqueId = id;
    let counter = 1;
    while (seen.has(uniqueId)) {
      uniqueId = `${id}-${counter}`;
      counter += 1;
    }
    seen.add(uniqueId);

    toc.push({ id: uniqueId, text, level });
  }

  return toc;
}

function TableOfContents({ toc }: { toc: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (toc.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 },
    );

    const ids = toc.map((t) => t.id);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [toc]);

  if (toc.length < 2) return null;

  return (
    <nav className="sticky top-4 hidden lg:block w-56 flex-shrink-0 self-start">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        On this page
      </div>
      <ul className="space-y-1 border-l border-border">
        {toc.map((entry) => {
          const isActive = activeId === entry.id;
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                className={`block py-1 text-sm border-l-2 -ml-px transition-colors ${
                  isActive
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                style={{ paddingLeft: entry.level === 2 ? "0.75rem" : "1.5rem" }}
              >
                {entry.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// -------- Main component --------

interface MarkdownDocProps {
  slug: string;
  /** GitHub path for "Edit this page" link. Defaults to docs/<slug>.md */
  githubPath?: string;
}

export default function MarkdownDoc({ slug, githubPath }: MarkdownDocProps) {
  const content = useMemo(() => docs[slug] ?? null, [slug]);

  const toc = useMemo(() => (content ? extractToc(content) : []), [content]);

  // Scroll to anchor on mount if URL has a hash
  useEffect(() => {
    if (!content) return;
    const hash = window.location.hash.slice(1);
    if (hash) {
      const tid = setTimeout(() => {
        const el = document.getElementById(hash);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      return () => clearTimeout(tid);
    }
  }, [content]);

  if (!content) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Doc not found</h1>
        <p className="text-muted-foreground">
          No doc with slug <code>{slug}</code>.
        </p>
      </div>
    );
  }

  const editPath = githubPath ?? `docs/${slug}.md`;

  return (
    <div className="flex gap-8">
      <div className="flex-1 min-w-0 space-y-4">
        <article
          className="prose prose-invert max-w-none
                     prose-headings:scroll-mt-20
                     prose-h1:text-3xl prose-h1:font-bold prose-h1:mb-4
                     prose-h2:text-2xl prose-h2:font-semibold prose-h2:mt-8 prose-h2:mb-4 prose-h2:border-b prose-h2:border-border prose-h2:pb-2
                     prose-h3:text-xl prose-h3:font-semibold prose-h3:mt-6 prose-h3:mb-3
                     prose-p:text-muted-foreground prose-p:leading-relaxed
                     prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                     prose-strong:text-foreground
                     prose-code:text-primary prose-code:bg-muted/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-[''] prose-code:after:content-['']
                     prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-border prose-pre:p-0
                     prose-table:text-sm
                     prose-th:text-foreground prose-th:font-semibold
                     prose-td:text-muted-foreground
                     prose-li:text-muted-foreground
                     prose-hr:border-border
                     prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground"
        >
          <ReactMarkdown
            rehypePlugins={[rehypeSlug, rehypeHighlight]}
            components={{
              pre: ({ children, ...props }) => (
                <pre
                  className="overflow-x-auto p-4 rounded-lg"
                  style={{ backgroundColor: "#0d1117" }}
                  {...props}
                >
                  {children}
                </pre>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </article>

        <div className="pt-8 mt-8 border-t border-border text-xs text-muted-foreground">
          <a
            href={`https://github.com/jarod-rosenthal/workermill/blob/main/${editPath}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Edit this page on GitHub →
          </a>
        </div>
      </div>

      <TableOfContents toc={toc} />
    </div>
  );
}
