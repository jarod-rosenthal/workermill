import { Link } from "react-router-dom";
import { ArrowRight, Brain, Code2, Rocket, Sparkles } from "lucide-react";
import type { BlogPost, BlogCategory } from "../../../types/blog";
import { categoryLabels } from "../../../types/blog";
import { formatDate } from "../utils";
import { AuthorAvatar } from "./AuthorAvatar";

interface FeaturedPostProps {
  post: BlogPost;
}

const categoryIcons: Record<BlogCategory, React.ReactNode> = {
  "ai-automation": <Brain className="w-12 h-12" />,
  engineering: <Code2 className="w-12 h-12" />,
  devops: <Rocket className="w-12 h-12" />,
  "product-updates": <Sparkles className="w-12 h-12" />,
};

const categoryGradients: Record<BlogCategory, string> = {
  "ai-automation": "from-teal-500/30 to-cyan-500/30",
  engineering: "from-purple-500/30 to-pink-500/30",
  devops: "from-orange-500/30 to-yellow-500/30",
  "product-updates": "from-green-500/30 to-emerald-500/30",
};

const categoryIconColors: Record<BlogCategory, string> = {
  "ai-automation": "text-teal-400",
  engineering: "text-purple-400",
  devops: "text-orange-400",
  "product-updates": "text-green-400",
};

export function FeaturedPost({ post }: FeaturedPostProps) {
  const hasImage = post.thumbnail && post.thumbnail.startsWith("http");

  return (
    <Link to={`/blog/${post.slug}`} className="group block mb-12">
      <article className="relative bg-slate-900/60 backdrop-blur-sm rounded-2xl border border-white/5 hover:border-teal-500/20 hover:bg-slate-800/60 transition-all duration-300 overflow-hidden hover:shadow-2xl hover:shadow-teal-500/10">
        {/* Glow effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-teal-500/5 via-transparent to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="grid lg:grid-cols-2 gap-0">
          <div className="aspect-video lg:aspect-auto lg:min-h-[360px] bg-slate-800 relative overflow-hidden">
            {hasImage ? (
              <>
                <img
                  src={post.thumbnail}
                  alt={post.title}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                {/* Overlay */}
                <div className="absolute inset-0 bg-gradient-to-r from-slate-900/30 to-transparent lg:bg-gradient-to-l" />
              </>
            ) : (
              <>
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${categoryGradients[post.category]}`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 to-transparent" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center">
                    <span className={categoryIconColors[post.category]}>
                      {categoryIcons[post.category]}
                    </span>
                  </div>
                </div>
              </>
            )}
            {/* Featured badge with pulse */}
            <div className="absolute top-4 left-4">
              <span className="relative inline-flex items-center text-xs font-semibold text-white bg-teal-500 px-3 py-1.5 rounded-full uppercase tracking-wide shadow-lg">
                <span className="absolute -inset-0 rounded-full bg-teal-500 animate-ping opacity-20" />
                Featured
              </span>
            </div>
          </div>

          <div className="p-8 lg:p-10 flex flex-col justify-center relative">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className="text-xs font-medium text-teal-400 bg-teal-500/10 px-2.5 py-1 rounded-full border border-teal-500/20">
                {categoryLabels[post.category]}
              </span>
              <span className="text-xs text-slate-500">
                {formatDate(post.date)}
              </span>
              <span className="text-xs text-slate-500">
                {post.readingTime} min read
              </span>
            </div>

            <h2 className="text-2xl lg:text-3xl font-bold text-white mb-4 group-hover:text-teal-400 transition-colors leading-tight">
              {post.title}
            </h2>

            <p className="text-base lg:text-lg text-slate-400 leading-relaxed mb-6">
              {post.excerpt}
            </p>

            {/* Author info */}
            <div className="flex items-center justify-between">
              <AuthorAvatar author={post.author} size="md" showInfo />

              <div className="flex items-center gap-2 text-base font-medium text-teal-400 group-hover:text-teal-300 transition-colors">
                Read article
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
