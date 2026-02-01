import { useState, useEffect } from "react";
import { Header } from "../Home/v0/Header";
import { Footer } from "../../components/Footer";
import { BlogCard } from "./components/BlogCard";
import { FeaturedPost } from "./components/FeaturedPost";
import { CategoryFilter } from "./components/CategoryFilter";
import {
  getFeaturedPost,
  getPostsByCategory,
} from "../../content/blog/posts";

export function BlogList() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const featuredPost = getFeaturedPost();
  const filteredPosts = getPostsByCategory(selectedCategory).filter(
    (post) => !post.featured || selectedCategory !== "all"
  );

  useEffect(() => {
    document.title = "Blog | WorkerMill";
  }, []);

  return (
    <div className="min-h-screen bg-[***REMOVED***0a0f1a] flex flex-col">
      <Header />

      <main className="pt-24 pb-24 flex-1">
        <div className="container mx-auto px-6 lg:px-8">
          {/* Hero section */}
          <div className="max-w-2xl mx-auto text-center mb-16">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-teal-500" />
              <p className="text-sm font-medium text-teal-400 tracking-wide">
                BLOG
              </p>
              <div className="w-8 h-0.5 bg-gradient-to-l from-transparent to-teal-500" />
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-4">
              Latest from WorkerMill
            </h1>
            <p className="text-lg text-slate-400 leading-relaxed">
              Insights on AI-powered development, automation, and engineering
              best practices.
            </p>
          </div>

          {featuredPost && selectedCategory === "all" && (
            <FeaturedPost post={featuredPost} />
          )}

          <CategoryFilter
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
          />

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredPosts.map((post) => (
              <BlogCard key={post.slug} post={post} />
            ))}
          </div>

          {filteredPosts.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  className="w-8 h-8 text-slate-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path
                    d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-slate-400 mb-2">
                No posts found in this category.
              </p>
              <button
                onClick={() => setSelectedCategory("all")}
                className="text-sm text-teal-400 hover:text-teal-300 transition-colors"
              >
                View all posts
              </button>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
