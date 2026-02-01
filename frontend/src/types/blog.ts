export type BlogCategory =
  | "ai-automation"
  | "engineering"
  | "devops"
  | "product-updates";

export interface Author {
  name: string;
  role: string;
  avatar?: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  category: BlogCategory;
  author: Author;
  thumbnail?: string;
  featured?: boolean;
  readingTime: number;
  tags?: string[];
}

export const categoryLabels: Record<BlogCategory, string> = {
  "ai-automation": "AI Automation",
  "engineering": "Engineering",
  "devops": "DevOps",
  "product-updates": "Product Updates",
};
