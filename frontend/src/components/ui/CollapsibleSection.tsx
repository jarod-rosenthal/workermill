import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  title: ReactNode;
  icon?: ReactNode;
  iconBgColor?: string;
  iconColor?: string;
  summary?: string;
  badge?: string;
  badgeColor?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  icon,
  iconBgColor = "bg-primary/20",
  iconColor = "text-primary",
  summary,
  badge,
  badgeColor = "bg-yellow-500/20 text-yellow-500",
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden bg-card">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {icon && (
            <div
              className={`w-8 h-8 rounded-lg ${iconBgColor} flex items-center justify-center ${iconColor}`}
            >
              {icon}
            </div>
          )}
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">{title}</h3>
              {badge && (
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${badgeColor}`}>
                  {badge}
                </span>
              )}
            </div>
            {!isOpen && summary && (
              <p className="text-sm text-muted-foreground mt-0.5">{summary}</p>
            )}
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="p-6 pt-2 border-t border-border/30">{children}</div>
      </div>
    </div>
  );
}
