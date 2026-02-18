const stats = [
  { value: "105", label: "Stories shipped in a single epic build" },
  { value: "$142", label: "Total cost for a full platform rebuild" },
  { value: "18hrs", label: "From spec to production-ready code" },
  { value: "24/7", label: "Executes your backlog while you sleep" },
]

export function StatsSection() {
  return (
    <section className="py-20 border-t border-white/5">
      <div className="container mx-auto px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {stats.map((stat, index) => (
            <div key={index} className="text-center lg:text-left">
              <div className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-2">
                {stat.value}
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
