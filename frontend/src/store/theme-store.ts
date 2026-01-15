import { create } from "zustand";

type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

// Get theme from localStorage only - single source of truth
const getStoredTheme = (): Theme => {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return "light";
};

// Apply theme to DOM using data-theme attribute (prevents class collision issues)
const applyThemeToDOM = (theme: Theme) => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  // Use data-theme attribute - single attribute, no collision possible
  root.setAttribute("data-theme", theme);

  // Update meta theme-color for mobile browsers
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", theme === "dark" ? "#0a0a0f" : "#e2e6ec");
  }
};

// Initialize theme on module load - sync DOM with localStorage
const initialTheme = getStoredTheme();
applyThemeToDOM(initialTheme);

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
      const newTheme = state.theme === "dark" ? "light" : "dark";
      localStorage.setItem("theme", newTheme);
      applyThemeToDOM(newTheme);
      return { theme: newTheme };
    });
  },
}));
