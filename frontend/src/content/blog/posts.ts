import type { Author, BlogPost } from "../../types/blog";

const authors: Record<string, Author> = {
  jarod: {
    name: "Jarod Rosenthal",
    role: "Founder & CEO",
  },
  engineering: {
    name: "WorkerMill Engineering",
    role: "Engineering Team",
  },
};

export const blogPosts: BlogPost[] = [
  {
    slug: "ai-coding-agents-2026-honest-assessment",
    title: "Every AI Coding Agent Wants to Replace Your Developer. Here's What Actually Happens.",
    excerpt:
      "Devin, Kiro, Jules, Claude Code, Cursor, Copilot — the market is flooded with AI coding agents. We tested them all, spent real money, and shipped real code. Here's the honest breakdown of what works, what doesn't, and where the industry is headed.",
    date: "2026-03-23",
    category: "ai-automation",
    author: authors.jarod,
    thumbnail:
      "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=600&fit=crop&q=80",
    featured: true,
    readingTime: 14,
    tags: [
      "ai-agents",
      "comparison",
      "claude-code",
      "devin",
      "kiro",
      "cursor",
      "open-source",
      "multi-agent",
    ],
  },
  {
    slug: "ai-coding-governance-gap",
    title:
      "The Governance Layer Your AI Coding Agents Are Missing",
    excerpt:
      "AI agents are shipping real code now. But there's a gap between 'AI can write code' and 'AI can safely ship code in a regulated environment.' Most of the industry is focused on the first part. Almost nobody is working on the second.",
    date: "2026-03-16",
    category: "ai-automation",
    author: authors.jarod,
    thumbnail:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=600&fit=crop&q=80",
    readingTime: 9,
    tags: [
      "governance",
      "quality-gates",
      "compliance",
      "cost-controls",
      "enterprise",
      "ai-agents",
    ],
  },
  {
    slug: "why-open-source-ai-coding-infrastructure",
    title:
      "Why Open Source Is the Only Sane Bet in AI Coding Infrastructure",
    excerpt:
      "The AI coding landscape is moving so fast that closed, locked-in infrastructure is a liability. Open source isn't an ideological choice — it's a survival strategy. Here's what we've seen, why we open-sourced WorkerMill, and what it means.",
    date: "2026-03-08",
    category: "ai-automation",
    author: authors.jarod,
    thumbnail:
      "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=1200&h=600&fit=crop&q=80",
    readingTime: 12,
    tags: [
      "open-source",
      "ai-agents",
      "infrastructure",
      "vendor-lock-in",
      "agentic-coding",
    ],
  },
  {
    slug: "anatomy-of-a-one-shot-spec",
    title:
      "Anatomy of a One-Shot Spec: Designing Software That AI Agents Build Right the First Time",
    excerpt:
      "What does it take to write a specification so complete that an AI team builds an entire platform from it — no back-and-forth, no clarification rounds, no do-overs? We break down the science of one-shot specs using our next showcase project, FlagDeck, as a case study.",
    date: "2026-02-21",
    category: "engineering",
    author: authors.jarod,
    thumbnail:
      "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&h=600&fit=crop&q=80",
    readingTime: 14,
    tags: [
      "spec-driven-development",
      "ai-agents",
      "planning",
      "testing",
      "showcase",
      "flagdeck",
    ],
  },
  {
    slug: "dark-factory-level-5-agentic-coding",
    title: "Dark Factory: The Rise of Level 5 Agentic Coding",
    excerpt:
      "The manufacturing world has dark factories — fully automated plants that run with the lights off. Software development is next. Here's what Level 5 agentic coding looks like and why it's inevitable.",
    date: "2026-02-18",
    category: "ai-automation",
    author: authors.jarod,
    thumbnail:
      "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=1200&h=600&fit=crop&q=80",
    readingTime: 10,
    tags: ["dark-factory", "agentic-coding", "autonomous", "future", "ai-agents"],
  },
  {
    slug: "introducing-workermill",
    title: "Introducing WorkerMill: Mission Control for AI Coding Agents",
    excerpt:
      "Today we're launching WorkerMill, a real-time monitoring and orchestration system for AI workers that execute coding tasks. Think htop for AI workers.",
    date: "2025-01-15",
    category: "product-updates",
    author: authors.jarod,
    thumbnail:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&h=600&fit=crop&q=80",
    readingTime: 5,
    tags: ["launch", "product", "ai-agents"],
  },
  {
    slug: "tight-feedback-loops",
    title: "Why Tight Feedback Loops Beat Expensive Models",
    excerpt:
      "Continuous validation at every step makes cheaper models perform like expensive ones. Here's how WorkerMill's feedback architecture works.",
    date: "2025-01-10",
    category: "engineering",
    author: authors.engineering,
    thumbnail:
      "https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=1200&h=600&fit=crop&q=80",
    readingTime: 8,
    tags: ["architecture", "ai", "feedback"],
  },
  {
    slug: "ai-agents-enterprise-development",
    title: "AI Agents for Enterprise Development: Security, Compliance, and Control",
    excerpt:
      "How to deploy AI coding agents in enterprise environments while maintaining security posture, compliance requirements, and full audit trails.",
    date: "2025-01-05",
    category: "ai-automation",
    author: authors.jarod,
    thumbnail:
      "https://images.unsplash.com/photo-1563986768494-4dee2763ff3f?w=1200&h=600&fit=crop&q=80",
    readingTime: 10,
    tags: ["enterprise", "security", "compliance"],
  },
  {
    slug: "from-ticket-to-deployed",
    title: "From Ticket to Deployed: Automating Your Backlog with AI",
    excerpt:
      "A complete walkthrough of the WorkerMill workflow—from Jira ticket to merged PR to production deployment, with zero human intervention.",
    date: "2024-12-28",
    category: "devops",
    author: authors.engineering,
    thumbnail:
      "https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?w=1200&h=600&fit=crop&q=80",
    readingTime: 12,
    tags: ["automation", "devops", "workflow"],
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug);
}

export function getFeaturedPost(): BlogPost | undefined {
  return blogPosts.find((post) => post.featured);
}

export function getPostsByCategory(category: string): BlogPost[] {
  if (category === "all") return blogPosts;
  return blogPosts.filter((post) => post.category === category);
}
