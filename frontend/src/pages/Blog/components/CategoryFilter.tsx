import { categoryLabels } from "../../../types/blog";
import { blogPosts } from "../../../content/blog/posts";

interface CategoryFilterProps {
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
}

function getCategoryCount(category: string): number {
  if (category === "all") return blogPosts.length;
  return blogPosts.filter((post) => post.category === category).length;
}

const categories: Array<{ value: string; label: string }> = [
  { value: "all", label: "All Posts" },
  ...Object.entries(categoryLabels).map(([value, label]) => ({
    value,
    label,
  })),
];

export function CategoryFilter({
  selectedCategory,
  onCategoryChange,
}: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-10">
      {categories.map((category) => {
        const isSelected = selectedCategory === category.value;
        const count = getCategoryCount(category.value);

        return (
          <button
            key={category.value}
            onClick={() => onCategoryChange(category.value)}
            className={`relative px-4 py-2 text-sm font-medium rounded-full border transition-all duration-200 overflow-hidden ${
              isSelected
                ? "bg-teal-500/20 text-teal-400 border-teal-500/30"
                : "text-slate-400 border-white/10 hover:border-white/20 hover:text-slate-300"
            }`}
          >
            {/* Accent bar for selected */}
            {isSelected && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-teal-400 rounded-full" />
            )}

            <span className="flex items-center gap-2">
              {category.label}
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  isSelected
                    ? "bg-teal-500/30 text-teal-300"
                    : "bg-slate-700/50 text-slate-500"
                }`}
              >
                {count}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
