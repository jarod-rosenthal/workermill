import { create } from "zustand";

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

// Get system preference
const getSystemPreference = (): "light" | "dark" => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

// Get theme from localStorage only - single source of truth
const getStoredTheme = (): Theme => {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system"; // Default to system preference
};

// Resolve theme to actual light/dark value
const resolveTheme = (theme: Theme): "light" | "dark" => {
  if (theme === "system") return getSystemPreference();
  return theme;
};

// Apply theme to DOM using data-theme attribute (prevents class collision issues)
const applyThemeToDOM = (theme: Theme) => {
  if (typeof document === "undefined") return;

  const resolvedTheme = resolveTheme(theme);
  const root = document.documentElement;
  // Use data-theme attribute - single attribute, no collision possible
  root.setAttribute("data-theme", resolvedTheme);

  // Update meta theme-color for mobile browsers
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", resolvedTheme === "dark" ? "#0a0a0f" : "#e2e6ec");
  }
};

// Initialize theme on module load - sync DOM with localStorage
const initialTheme = getStoredTheme();
applyThemeToDOM(initialTheme);

// Listen for system preference changes
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const currentTheme = localStorage.getItem("theme") as Theme;
    if (currentTheme === "system") {
      applyThemeToDOM("system");
    }
  });
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,

  setTheme: (theme: Theme) => {
    // Save to localStorage
    localStorage.setItem("theme", theme);
    // Apply to DOM
    applyThemeToDOM(theme);
    // Update React state
    set({ theme });
  },

  toggleTheme: () => {
    set((state) => {
      // Cycle: system -> light -> dark -> system
      const themeOrder: Theme[] = ["system", "light", "dark"];
      const currentIndex = themeOrder.indexOf(state.theme);
      const newTheme = themeOrder[(currentIndex + 1) % themeOrder.length];
      localStorage.setItem("theme", newTheme);
      applyThemeToDOM(newTheme);
      return { theme: newTheme };
    });
  },
}));
