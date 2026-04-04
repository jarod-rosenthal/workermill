import { useParams, Navigate, Link } from "react-router-dom";
import { useMemo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import {
  TerminalSquare,
  BookOpen,
  Settings,
  Users,
  Zap,
  Wrench,
  LifeBuoy,
  Layers,
  Code,
} from "lucide-react";

// Highlight.js dark theme for code blocks
import "highlight.js/styles/github-dark.css";

// Bulk-import all CLI markdown docs at build time as raw strings.
// Vite resolves the glob and inlines the file contents.
const docModules = import.meta.glob("../../../../cli/docs/*.md", {
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

type DocMeta = {
  slug: string;
  title: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
};

const DOCS_ORDER: DocMeta[] = [
  { slug: "commands", title: "Commands", blurb: "Every slash command, subcommand, and flag", icon: TerminalSquare },
  { slug: "configuration", title: "Configuration", blurb: "Every field in ~/.workermill/cli.json", icon: Settings },
  { slug: "personas", title: "Personas", blurb: "Writing custom expert roles", icon: Users },
  { slug: "hooks-and-skills", title: "Hooks & Custom Commands", blurb: "Shell hooks, lifecycle events, custom slash commands", icon: Zap },
  { slug: "recipes", title: "Recipes", blurb: "Concrete workflows combining features", icon: BookOpen },
  { slug: "troubleshooting", title: "Troubleshooting", blurb: "Common issues and fixes", icon: LifeBuoy },
  { slug: "architecture", title: "Architecture", blurb: "How the CLI is put together", icon: Layers },
  { slug: "contributing", title: "Contributing", blurb: "Dev setup and PR guidelines", icon: Wrench },
];

// -------- Index page --------

export function CLIReferenceIndex() {
  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Code className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">CLI Reference</h1>
            <p className="text-muted-foreground">Deep reference material and extension guides</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Looking for a quick overview? See the{" "}
          <Link to="/docs/cli" className="text-primary hover:underline">
            CLI intro page
          </Link>
          . These docs go deeper on commands, configuration, and extension points.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {DOCS_ORDER.map((doc) => {
          const Icon = doc.icon;
          return (
            <Link
              key={doc.slug}
              to={`/docs/cli/reference/${doc.slug}`}
              className="group p-5 rounded-lg border border-border bg-card/50 hover:bg-card hover:border-primary/40 transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1 group-hover:text-primary transition-colors">{doc.title}</h3>
                  <p className="text-sm text-muted-foreground">{doc.blurb}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground pt-4 border-t border-border">
        These docs live in <code className="text-primary">cli/docs/</code> in the{" "}
        <a
          href="https://github.com/jarod-rosenthal/workermill/tree/main/cli/docs"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          WorkerMill repo
        </a>
        . Edit them there to contribute.
      </div>
    </div>
  );
}

// -------- Table of contents --------

type TocEntry = { id: string; text: string; level: number };

/**
 * Extract H2/H3 headings from raw markdown.
 * Produces the same slug format that rehype-slug uses (github-slugger compatible):
 * lowercase, spaces → hyphens, strip non-alphanumeric except hyphens.
 */
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
    let id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");

    // Deduplicate slugs the same way rehype-slug does
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
                className={`block pl-${entry.level === 2 ? "3" : "6"} py-1 text-sm border-l-2 -ml-px transition-colors ${
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

// -------- Individual doc page --------

export function CLIReferencePage() {
  const { slug } = useParams<{ slug: string }>();

  const content = useMemo(() => {
    if (!slug) return null;
    return docs[slug] ?? null;
  }, [slug]);

  const toc = useMemo(() => {
    return content ? extractToc(content) : [];
  }, [content]);

  // Scroll to anchor on mount if URL has a hash
  useEffect(() => {
    if (!content) return;
    const hash = window.location.hash.slice(1);
    if (hash) {
      // Delay so markdown has rendered and IDs are in the DOM
      const tid = setTimeout(() => {
        const el = document.getElementById(hash);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      return () => clearTimeout(tid);
    }
  }, [content]);

  if (!slug) {
    return <Navigate to="/docs/cli/reference" replace />;
  }

  if (!content) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Doc not found</h1>
        <p className="text-muted-foreground">
          No CLI doc with slug <code>{slug}</code>.
        </p>
        <Link to="/docs/cli/reference" className="text-primary hover:underline">
          Back to CLI reference
        </Link>
      </div>
    );
  }

  const meta = DOCS_ORDER.find((d) => d.slug === slug);

  return (
    <div className="flex gap-8">
      <div className="flex-1 min-w-0 space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/docs/cli" className="hover:text-foreground transition-colors">
            CLI
          </Link>
          <span>/</span>
          <Link to="/docs/cli/reference" className="hover:text-foreground transition-colors">
            Reference
          </Link>
          <span>/</span>
          <span className="text-foreground">{meta?.title ?? slug}</span>
        </div>

        {/* Rendered markdown */}
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
                     prose-hr:border-border"
        >
          <ReactMarkdown
            rehypePlugins={[rehypeSlug, rehypeHighlight]}
            components={{
              // Inline code stays themed; block code gets highlight.js classes
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

        {/* Footer */}
        <div className="pt-8 mt-8 border-t border-border text-xs text-muted-foreground">
          <a
            href={`https://github.com/jarod-rosenthal/workermill/blob/main/cli/docs/${slug}.md`}
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

export default CLIReferenceIndex;
