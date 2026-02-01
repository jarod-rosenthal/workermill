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
    slug: "introducing-workermill",
    title: "Introducing WorkerMill: Mission Control for AI Coding Agents",
    excerpt:
      "Today we're launching WorkerMill, a real-time monitoring and orchestration system for AI workers that execute coding tasks. Think htop for AI workers.",
    date: "2025-01-15",
    category: "product-updates",
    author: authors.jarod,
    thumbnail:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&h=600&fit=crop&q=80",
    featured: true,
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
