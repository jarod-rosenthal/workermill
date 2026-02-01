import type { BlogCategory, BlogPost } from "../../types/blog";
import { blogPosts } from "../../content/blog/posts";

/**
 * Format date: "2025-01-15" → "January 15, 2025"
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Get related posts by category (excluding current post)
 */
export function getRelatedPosts(
  currentSlug: string,
  category: BlogCategory,
  limit: number = 3
): BlogPost[] {
  return blogPosts
    .filter((post) => post.slug !== currentSlug && post.category === category)
    .slice(0, limit);
}
