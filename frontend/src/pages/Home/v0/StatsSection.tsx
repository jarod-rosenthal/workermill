const stats = [
  {
    value: "500+",
    label: "Tasks completed",
    detail: "Across multiple repositories and organizations",
  },
  {
    value: "4+",
    label: "AI providers",
    detail: "Anthropic, OpenAI, Google, and self-hosted via Ollama",
  },
  {
    value: "~55 min",
    label: "Average story time",
    detail: "From task claim to mergeable PR",
  },
  {
    value: "24/7",
    label: "Async execution",
    detail: "Ships your backlog while you sleep",
  },
];

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
              <p className="text-sm font-medium text-slate-300 mb-1">
                {stat.label}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                {stat.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
