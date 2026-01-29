import { Clock, DollarSign, Target, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

interface MetricCard {
  icon: React.ReactNode;
  value: string;
  label: string;
  sublabel: string;
  color: string;
}

const metrics: MetricCard[] = [
  {
    icon: <Clock className="w-8 h-8" />,
    value: "10-30 min",
    label: "Typical MTTR",
    sublabel: "For well-scoped tasks",
    color: "text-primary",
  },
  {
    icon: <DollarSign className="w-8 h-8" />,
    value: "Varies",
    label: "Per Task Cost",
    sublabel: "Based on runtime + AI usage",
    color: "text-accent",
  },
  {
    icon: <Target className="w-8 h-8" />,
    value: "High",
    label: "Success Rate",
    sublabel: "With clear acceptance criteria",
    color: "text-purple-500",
  },
];

export function Metrics() {
  return (
    <section className="py-20 px-6 bg-card/50">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Performance You Can Measure
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Typical metrics for well-scoped tasks. Results vary based on task complexity and codebase size.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {metrics.map((metric, index) => (
            <div
              key={index}
              className="bg-card border border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors"
            >
              <div
                className={`inline-flex items-center justify-center w-16 h-16 rounded-full bg-current/10 ${metric.color} mb-6`}
              >
                {metric.icon}
              </div>
              <div className={`text-4xl font-bold mb-2 ${metric.color}`}>
                {metric.value}
              </div>
              <div className="text-lg font-medium text-foreground mb-1">
                {metric.label}
              </div>
              <div className="text-sm text-muted-foreground">
                {metric.sublabel}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link
            to="/docs/metrics"
            className="inline-flex items-center gap-2 text-primary hover:underline text-sm font-medium"
          >
            View detailed metrics documentation
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
