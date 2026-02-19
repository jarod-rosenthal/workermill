import {
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Beaker,
  BarChart3,
  Target,
  Lightbulb,
  Settings,
} from "lucide-react";

export default function DirectiveEffectiveness() {
  return (
    <div className="prose prose-invert max-w-none">
      <h1 className="flex items-center gap-3">
        <Target className="w-8 h-8 text-primary" />
        Directive Effectiveness
        <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-400 font-normal">
          Beta
        </span>
      </h1>

      <p className="lead text-muted-foreground">
        Track and optimize the performance of worker directives. Monitor success rates,
        identify underperforming directives, and run experiments to improve outcomes.
        This feature is in active development.
      </p>

      {/* Overview */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          Overview
        </h2>
        <p>
          Directives are instructions that guide how AI workers approach different types of tasks.
          Each persona has directives that define their behavior, coding standards, and decision-making
          patterns. The Directive Effectiveness dashboard helps you:
        </p>
        <ul>
          <li>Monitor directive performance across all personas</li>
          <li>Identify directives with low success rates</li>
          <li>Detect gaps where directives are missing or ineffective</li>
          <li>Run A/B experiments to compare directive versions</li>
          <li>Get recommendations for directive improvements</li>
        </ul>
      </section>

      {/* Key Metrics */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Key Metrics
        </h2>

        <div className="not-prose grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground mb-2">Total Directives</div>
            <div className="text-2xl font-bold text-foreground">&mdash;</div>
            <div className="text-xs text-muted-foreground mt-1">Per organization</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground mb-2">Avg Success Rate</div>
            <div className="text-2xl font-bold text-green-400">&mdash;</div>
            <div className="text-xs text-muted-foreground mt-1">Tracked per directive</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground mb-2">Running Experiments</div>
            <div className="text-2xl font-bold text-foreground">&mdash;</div>
            <div className="text-xs text-muted-foreground mt-1">A/B tests in progress</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-sm text-muted-foreground mb-2">Health Alerts</div>
            <div className="text-2xl font-bold text-yellow-400">&mdash;</div>
            <div className="text-xs text-muted-foreground mt-1">Actionable alerts</div>
          </div>
        </div>
      </section>

      {/* Directive Metrics */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          Directive Performance Metrics
        </h2>
        <p>
          Each directive is tracked with detailed metrics:
        </p>

        <div className="not-prose bg-muted/30 border border-border rounded-xl p-6 mt-4">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">usageCount</span>
              <span className="text-muted-foreground">Number of times this directive has been used</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">successRate</span>
              <span className="text-muted-foreground">Percentage of successful task completions</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">avgQualityScore</span>
              <span className="text-muted-foreground">Average code quality score (0-100)</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">avgAccuracyScore</span>
              <span className="text-muted-foreground">How well output matches task requirements</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-sm bg-primary/20 text-primary px-2 py-0.5 rounded">version</span>
              <span className="text-muted-foreground">Directive version number for tracking changes</span>
            </div>
          </div>
        </div>
      </section>

      {/* Health Status */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-500" />
          Health Status
        </h2>
        <p>
          Each directive receives a health status based on its performance:
        </p>

        <div className="not-prose grid gap-3 mt-4">
          <div className="flex items-center gap-4 p-3 bg-card border border-border rounded-lg">
            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">
              <CheckCircle className="w-3 h-3" />
              Healthy
            </span>
            <span className="text-sm text-muted-foreground">High success rate, good quality scores, no issues</span>
          </div>
          <div className="flex items-center gap-4 p-3 bg-card border border-border rounded-lg">
            <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs">
              <AlertTriangle className="w-3 h-3" />
              Warning
            </span>
            <span className="text-sm text-muted-foreground">Success rate below threshold or minor quality issues</span>
          </div>
          <div className="flex items-center gap-4 p-3 bg-card border border-border rounded-lg">
            <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
              <XCircle className="w-3 h-3" />
              Critical
            </span>
            <span className="text-sm text-muted-foreground">Very low success rate or consistently poor outcomes</span>
          </div>
          <div className="flex items-center gap-4 p-3 bg-card border border-border rounded-lg">
            <span className="flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground rounded text-xs">
              <AlertTriangle className="w-3 h-3" />
              Unknown
            </span>
            <span className="text-sm text-muted-foreground">Not enough data to assess (less than 5 uses)</span>
          </div>
        </div>

        <p className="mt-4">
          Directives in Warning or Critical status include:
        </p>
        <ul>
          <li><strong>Issues</strong> - Specific problems detected</li>
          <li><strong>Recommendations</strong> - Suggested improvements</li>
        </ul>
      </section>

      {/* Deprecation Candidates */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-500" />
          Deprecation Candidates
        </h2>
        <p>
          The system identifies directives that should potentially be deprecated:
        </p>

        <div className="not-prose bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-5 mt-4">
          <h3 className="font-medium text-foreground mb-3">Reasons for Deprecation</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
              Consistently low success rate (below 40%)
            </li>
            <li className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
              A newer version with significantly better performance exists
            </li>
            <li className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
              Not used for an extended period (stale)
            </li>
            <li className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
              Poor quality scores despite multiple uses
            </li>
          </ul>
          <p className="text-sm text-muted-foreground mt-4">
            Each candidate includes a confidence score and, when available, a reference
            to a better-performing alternative version.
          </p>
        </div>
      </section>

      {/* A/B Experiments */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Beaker className="w-5 h-5 text-primary" />
          A/B Experiments
        </h2>
        <p>
          Run controlled experiments to compare directive versions and find what works best.
        </p>

        <div className="not-prose bg-muted/30 border border-border rounded-xl p-6 mt-4">
          <h3 className="font-semibold text-foreground mb-4">Experiment Lifecycle</h3>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-medium text-sm">1</div>
              <div>
                <div className="font-medium text-foreground">Draft</div>
                <div className="text-sm text-muted-foreground">Configure experiment, select variants to test</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-medium text-sm">2</div>
              <div>
                <div className="font-medium text-foreground">Running</div>
                <div className="text-sm text-muted-foreground">Traffic split between variants, collecting samples</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center font-medium text-sm">3</div>
              <div>
                <div className="font-medium text-foreground">Completed</div>
                <div className="text-sm text-muted-foreground">Winner selected based on statistical significance</div>
              </div>
            </div>
          </div>
        </div>

        <h3 className="mt-6">Experiment Properties</h3>
        <ul>
          <li><strong>Variants</strong> - Different directive versions being compared</li>
          <li><strong>Sample Size</strong> - Number of tasks run with each variant</li>
          <li><strong>Progress</strong> - Percentage toward required sample size</li>
          <li><strong>Winner</strong> - Statistically best-performing variant</li>
        </ul>
      </section>

      {/* Directive Gaps */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-primary" />
          Gaps & Issues
        </h2>
        <p>
          The system identifies missing or problematic directives:
        </p>

        <div className="not-prose space-y-3 mt-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-foreground">frontend_developer</span>
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">high severity</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Missing TypeScript configuration directive. Workers are using inconsistent tsconfig settings.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              <strong>Recommendation:</strong> Create a directive for TypeScript project setup
            </p>
            <p className="text-xs text-muted-foreground mt-1">8 tasks affected</p>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-foreground">backend_developer</span>
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs">medium severity</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Database migration directive has outdated syntax examples.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              <strong>Recommendation:</strong> Update examples to use current TypeORM syntax
            </p>
          </div>
        </div>

        <h3 className="mt-6">Gap Types</h3>
        <ul>
          <li><strong>Missing Directive</strong> - No directive exists for a common task pattern</li>
          <li><strong>Outdated Content</strong> - Directive references deprecated APIs or patterns</li>
          <li><strong>Incomplete Coverage</strong> - Directive doesn't cover edge cases</li>
          <li><strong>Conflicting Instructions</strong> - Multiple directives give contradictory guidance</li>
        </ul>
      </section>

      {/* Best Practices */}
      <section className="mt-8">
        <h2>Best Practices</h2>

        <div className="not-prose grid gap-4 mt-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Monitor Weekly</h3>
            <p className="text-sm text-muted-foreground">
              Check directive health regularly. Address Warning status before it becomes Critical.
              Small adjustments compound into significant improvement.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Version Your Changes</h3>
            <p className="text-sm text-muted-foreground">
              When updating directives, increment the version number. This enables tracking
              performance changes and rolling back if needed.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Use Experiments for Major Changes</h3>
            <p className="text-sm text-muted-foreground">
              Before deploying significant directive changes to all tasks, run an A/B experiment
              to validate the improvement.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-foreground mb-2">Address Gaps Promptly</h3>
            <p className="text-sm text-muted-foreground">
              High-severity gaps affect multiple tasks. Prioritize creating or fixing directives
              for gaps that impact many workers.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
