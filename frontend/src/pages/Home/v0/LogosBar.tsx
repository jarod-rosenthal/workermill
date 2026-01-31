const companies = [
  { name: "Vercel", logo: "▲ Vercel" },
  { name: "Stripe", logo: "stripe" },
  { name: "Linear", logo: "Linear" },
  { name: "Notion", logo: "Notion" },
  { name: "Figma", logo: "Figma" },
]

export function LogosBar() {
  return (
    <div className="py-12 border-t border-white/5">
      <div className="container mx-auto px-6 lg:px-8">
        <p className="text-center text-xs font-medium uppercase tracking-widest text-slate-600 mb-8">
          Trusted by engineering teams at
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
          {companies.map((company) => (
            <div
              key={company.name}
              className="text-slate-600 hover:text-slate-400 transition-colors"
            >
              <span className="text-lg font-semibold tracking-tight">{company.logo}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
