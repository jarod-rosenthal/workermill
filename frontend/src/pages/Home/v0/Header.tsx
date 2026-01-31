import { Link } from "react-router-dom"
import { Button } from "../../../components/ui/button"
import { ChevronDown } from "lucide-react"

const navItems = [
  { label: "Product", href: "#product", hasDropdown: true },
  { label: "Solutions", href: "#solutions", hasDropdown: true },
  { label: "Pricing", href: "#pricing" },
  { label: "Docs", href: "/docs" },
  { label: "Enterprise", href: "#enterprise" },
]

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="absolute inset-0 bg-[#0a0f1a]/70 backdrop-blur-xl border-b border-white/5" />
      <div className="container relative mx-auto flex h-16 items-center justify-between px-6 lg:px-8">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">WorkerMill</span>
        </Link>

        {/* Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => (
            item.href.startsWith('/') ? (
              <Link
                key={item.label}
                to={item.href}
                className="group flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-md hover:bg-white/5"
              >
                {item.label}
                {item.hasDropdown && (
                  <ChevronDown className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
                )}
              </Link>
            ) : (
              <a
                key={item.label}
                href={item.href}
                className="group flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-md hover:bg-white/5"
              >
                {item.label}
                {item.hasDropdown && (
                  <ChevronDown className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
                )}
              </a>
            )
          ))}
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
              Get Started
            </Button>
          </Link>
        </div>
      </div>
    </header>
  )
}
