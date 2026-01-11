import { create } from "zustand";

type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  isInitialized: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  initialize: () => void;
}

// Get current theme from DOM (set by inline script in index.html)
const getCurrentTheme = (): Theme => {
  if (typeof document !== "undefined") {
    // Check what class is actually on the document
    if (document.documentElement.classList.contains("dark")) return "dark";
    if (document.documentElement.classList.contains("light")) return "light";
    // Fallback to localStorage or system preference
    const stored = localStorage.getItem("theme") as Theme | null;
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getCurrentTheme(),
  isInitialized: false,

  setTheme: (theme: Theme) => {
    // Update localStorage first
    localStorage.setItem("theme", theme);

    // Update document classes atomically - remove both, then add the correct one
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);

    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", theme === "dark" ? "***REMOVED***0a0a0f" : "***REMOVED***e2e6ec");
    }

    set({ theme });
  },

  toggleTheme: () => {
    const newTheme = get().theme === "dark" ? "light" : "dark";
    get().setTheme(newTheme);
  },

  initialize: () => {
    // Read the theme that was set by the inline script in index.html
    // Don't change anything, just sync React state with DOM state
    const currentTheme = getCurrentTheme();
    set({ theme: currentTheme, isInitialized: true });
  },
}));
