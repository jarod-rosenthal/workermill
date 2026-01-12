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
    value: "~7 min",
    label: "Avg MTTR",
    sublabel: "Mean time to resolution",
    color: "text-primary",
  },
  {
    icon: <DollarSign className="w-8 h-8" />,
    value: "~$0.50",
    label: "Per Task",
    sublabel: "Transparent cost tracking",
    color: "text-accent",
  },
  {
    icon: <Target className="w-8 h-8" />,
    value: "~85%",
    label: "Success Rate",
    sublabel: "First-attempt completion",
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
            Real metrics from production workloads. No hidden costs, no surprises.
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
