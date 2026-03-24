import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "../../../components/ui/button";
import { Menu, X } from "lucide-react";

const navItems: Array<{ label: string; href: string; isRoute?: boolean }> = [
  { label: "Showcase", href: "#showcase" },
  { label: "Demos", href: "#demos" },
  { label: "Downloads", href: "#downloads" },
  { label: "Docs", href: "/docs", isRoute: true },
  { label: "Blog", href: "/blog", isRoute: true },
];

function scrollToSection(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault();
  const id = href.replace("#", "");
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth" });
  }
}

export function Header() {
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="absolute inset-0 bg-[#0a0f1a]/70 backdrop-blur-xl border-b border-white/5" />
      <div className="container relative mx-auto flex h-16 items-center justify-between px-6 lg:px-8">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">WorkerMill</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) =>
            item.isRoute ? (
              <Link
                key={item.label}
                to={item.href}
                className="px-3 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-md hover:bg-white/5"
              >
                {item.label}
              </Link>
            ) : isHomePage ? (
              <a
                key={item.label}
                href={item.href}
                onClick={(e) => scrollToSection(e, item.href)}
                className="px-3 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-md hover:bg-white/5 cursor-pointer"
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.label}
                to={`/${item.href}`}
                className="px-3 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-md hover:bg-white/5"
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="hidden sm:inline-flex text-sm font-medium text-slate-400 hover:text-white transition-colors px-3 py-2"
          >
            Sign in
          </Link>
          <Link to="/signup">
            <Button
              size="sm"
              className="bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white rounded-lg px-4 h-9 text-sm font-medium shadow-lg shadow-teal-500/20 border-0"
            >
              Join the Waitlist
            </Button>
          </Link>
          {/* Mobile menu toggle */}
          <button
            className="lg:hidden p-2 text-slate-400 hover:text-white transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <nav className="relative lg:hidden border-t border-white/5 bg-[#0a0f1a]/95 backdrop-blur-xl">
          <div className="container mx-auto px-6 py-3 flex flex-col gap-1">
            {navItems.map((item) =>
              item.isRoute ? (
                <Link
                  key={item.label}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-md hover:bg-white/5"
                >
                  {item.label}
                </Link>
              ) : isHomePage ? (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={(e) => {
                    scrollToSection(e, item.href);
                    setMobileMenuOpen(false);
                  }}
                  className="px-3 py-2.5 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-md hover:bg-white/5 cursor-pointer"
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.label}
                  to={`/${item.href}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-md hover:bg-white/5"
                >
                  {item.label}
                </Link>
              ),
            )}
            <Link
              to="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2.5 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-md hover:bg-white/5 sm:hidden"
            >
              Sign in
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
