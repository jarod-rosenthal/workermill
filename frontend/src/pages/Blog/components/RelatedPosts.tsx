import { Link } from "react-router-dom";
import { ArrowRight, Brain, Code2, Rocket, Sparkles } from "lucide-react";
import type { BlogPost, BlogCategory } from "../../../types/blog";
import { categoryLabels } from "../../../types/blog";
import { formatDate } from "../utils";
import { AuthorAvatar } from "./AuthorAvatar";

interface RelatedPostsProps {
  posts: BlogPost[];
}

const categoryIcons: Record<BlogCategory, React.ReactNode> = {
  "ai-automation": <Brain className="w-5 h-5" />,
  engineering: <Code2 className="w-5 h-5" />,
  devops: <Rocket className="w-5 h-5" />,
  "product-updates": <Sparkles className="w-5 h-5" />,
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

export function RelatedPosts({ posts }: RelatedPostsProps) {
  if (posts.length === 0) {
    return null;
  }

  return (
    <section className="mt-16">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-1 h-6 bg-gradient-to-b from-teal-500 to-cyan-500 rounded-full" />
        <h2 className="text-xl font-semibold text-white">Continue Reading</h2>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {posts.map((post) => {
          const hasImage = post.thumbnail && post.thumbnail.startsWith("http");

          return (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              className="group block"
            >
              <article className="bg-slate-900/60 backdrop-blur-sm rounded-xl border border-white/5 hover:border-teal-500/20 hover:bg-slate-800/60 hover:-translate-y-1 hover:shadow-lg hover:shadow-teal-500/5 transition-all duration-300 overflow-hidden h-full flex flex-col">
                {/* Thumbnail */}
                <div className="aspect-[16/9] bg-slate-800 relative overflow-hidden">
                  {hasImage ? (
                    <>
                      <img
                        src={post.thumbnail}
                        alt={post.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent" />
                    </>
                  ) : (
                    <>
                      <div
                        className={`absolute inset-0 bg-gradient-to-br ${categoryGradients[post.category]}`}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                          <span className={categoryIconColors[post.category]}>
                            {categoryIcons[post.category]}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="p-5 flex flex-col flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-medium text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-500/20">
                      {categoryLabels[post.category]}
                    </span>
                  </div>

                  <h3 className="text-base font-semibold text-white mb-2 group-hover:text-teal-400 transition-colors line-clamp-2">
                    {post.title}
                  </h3>

                  <p className="text-sm text-slate-400 leading-relaxed mb-4 flex-1 line-clamp-2">
                    {post.excerpt}
                  </p>

                  <div className="flex items-center justify-between pt-3 border-t border-white/5">
                    <div className="flex items-center gap-2">
                      <AuthorAvatar author={post.author} size="sm" />
                      <span className="text-xs text-slate-500">
                        {formatDate(post.date)}
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-teal-400 group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </article>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
