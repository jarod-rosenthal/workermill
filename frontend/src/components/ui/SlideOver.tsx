import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

interface SlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  iconBgColor?: string;
  children: ReactNode;
}

export function SlideOver({
  isOpen,
  onClose,
  title,
  icon,
  iconBgColor = "bg-primary/20",
  children,
}: SlideOverProps) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-card border-l border-border shadow-2xl transform transition-transform duration-300 ease-out">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            {icon && (
              <div className={`w-10 h-10 rounded-lg ${iconBgColor} flex items-center justify-center`}>
                {icon}
              </div>
            )}
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto h-[calc(100%-80px)]">{children}</div>
      </div>
    </div>
  );
}
