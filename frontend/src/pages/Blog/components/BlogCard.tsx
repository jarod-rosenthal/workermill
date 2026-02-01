import { Link } from "react-router-dom";
import { ArrowRight, Brain, Code2, Rocket, Sparkles } from "lucide-react";
import type { BlogPost, BlogCategory } from "../../../types/blog";
import { categoryLabels } from "../../../types/blog";
import { formatDate } from "../utils";
import { AuthorAvatar } from "./AuthorAvatar";

interface BlogCardProps {
  post: BlogPost;
}

const categoryIcons: Record<BlogCategory, React.ReactNode> = {
  "ai-automation": <Brain className="w-6 h-6" />,
  engineering: <Code2 className="w-6 h-6" />,
  devops: <Rocket className="w-6 h-6" />,
  "product-updates": <Sparkles className="w-6 h-6" />,
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

export function BlogCard({ post }: BlogCardProps) {
  const hasImage = post.thumbnail && post.thumbnail.startsWith("http");

  return (
    <Link to={`/blog/${post.slug}`} className="group block">
      <article className="relative bg-slate-900/60 backdrop-blur-sm rounded-xl border border-white/5 hover:border-teal-500/20 hover:bg-slate-800/60 hover:-translate-y-1 hover:shadow-xl hover:shadow-teal-500/10 transition-all duration-300 overflow-hidden h-full flex flex-col">
        {/* Accent bar */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-teal-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="aspect-video bg-slate-800 relative overflow-hidden">
          {hasImage ? (
            <>
              <img
                src={post.thumbnail}
                alt={post.title}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              {/* Overlay for better text readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent" />
            </>
          ) : (
            <>
              <div
                className={`absolute inset-0 bg-gradient-to-br ${categoryGradients[post.category]}`}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center">
                  <span className={categoryIconColors[post.category]}>
                    {categoryIcons[post.category]}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-6 flex flex-col flex-1">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-medium text-teal-400 bg-teal-500/10 px-2.5 py-1 rounded-full border border-teal-500/20">
              {categoryLabels[post.category]}
            </span>
            <span className="text-xs text-slate-500">
              {formatDate(post.date)}
            </span>
          </div>

          <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-teal-400 transition-colors line-clamp-2">
            {post.title}
          </h3>

          <p className="text-sm text-slate-400 leading-relaxed mb-4 flex-1 line-clamp-3">
            {post.excerpt}
          </p>

          <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <div className="flex items-center gap-2">
              <AuthorAvatar author={post.author} size="sm" />
              <span className="text-xs text-slate-500">{post.author.name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-teal-400 group-hover:text-teal-300 transition-colors">
              Read
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
