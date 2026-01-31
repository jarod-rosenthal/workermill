const stats = [
  { value: "90%", label: "Cost reduction vs. premium models" },
  { value: "10x", label: "Faster than manual coding" },
  { value: "99.2%", label: "Task completion rate" },
  { value: "24/7", label: "Autonomous operation" },
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
