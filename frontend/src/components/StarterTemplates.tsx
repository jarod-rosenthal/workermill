import { Layers } from "lucide-react";

interface StarterProjectOption {
  id: string;
  title: string;
  description: string;
  stackTemplate: string;
  complexity: string;
  estimatedStories: number;
  tags: string[];
}

interface StarterTemplateRowProps {
  projects: StarterProjectOption[];
  onSelect: (project: StarterProjectOption) => void;
}

export function StarterTemplateRow({
  projects,
  onSelect,
}: StarterTemplateRowProps) {
  if (projects.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap">
      {projects.map((project) => (
        <button
          key={project.id}
          onClick={() => onSelect(project)}
          className="flex-1 min-w-[180px] h-[120px] text-left px-4 py-3 rounded-lg bg-slate-900/40 backdrop-blur-sm border border-white/5 hover:border-teal-500/30 hover:bg-slate-900/60 transition-all group overflow-hidden"
        >
          <div className="font-medium text-sm text-white group-hover:text-teal-400 transition-colors">
            {project.title}
          </div>
          <div className="text-xs text-slate-400 mt-1 line-clamp-2">
            {project.description}
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-1 mt-1.5">
            <Layers className="w-3 h-3" />
            {project.estimatedStories} stories &middot; {project.complexity}
          </div>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {project.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-500"
              >
                {tag}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

export default StarterTemplateRow;
