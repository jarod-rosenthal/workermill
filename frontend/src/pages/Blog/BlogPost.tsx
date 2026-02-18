import { useParams, Link, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft, Calendar, Clock, Tag } from "lucide-react";
import { Header } from "../Home/v0/Header";
import { Footer } from "../../components/Footer";
import { getPostBySlug } from "../../content/blog/posts";
import { categoryLabels } from "../../types/blog";
import { formatDate, getRelatedPosts } from "./utils";
import { AuthorAvatar } from "./components/AuthorAvatar";
import { ReadingProgress } from "./components/ReadingProgress";
import { ShareButtons } from "./components/ShareButtons";
import { RelatedPosts } from "./components/RelatedPosts";
import "./article.css";

// Content for each blog post
const postContent: Record<string, React.ReactNode> = {
  "dark-factory-level-5-agentic-coding": (
    <>
      <p className="article-lead">
        In manufacturing, a <strong>dark factory</strong> is a facility so fully
        automated that it operates with the lights off — no human workers on the
        floor, no manual intervention, just machines executing with precision
        around the clock. Software development is heading toward its own dark
        factory moment, and <strong>Level 5 agentic coding</strong> is the
        architecture that gets us there.
      </p>

      <h2>The Five Levels of Agentic Coding</h2>
      <p>
        Autonomous driving gave us a useful framework: five levels of
        automation, from driver assistance to full autonomy. The same
        progression is unfolding in software engineering — and understanding
        where we are on that curve separates organizations that will lead from
        those that will follow.
      </p>

      <h3>Level 0 — Manual Development</h3>
      <p>
        The developer writes every line. No AI involvement. This is where the
        industry lived for decades, and where most legacy organizations still
        operate. Every keystroke is human, every decision requires a person in
        the loop.
      </p>

      <h3>Level 1 — AI-Assisted Completion</h3>
      <p>
        Autocomplete on steroids. Tools like GitHub Copilot suggest the next
        line or function body. The developer remains firmly in control — the AI
        is a faster keyboard, not an independent thinker. Productivity gains are
        real but incremental: 10-30% faster for routine code.
      </p>

      <h3>Level 2 — AI-Assisted Task Execution</h3>
      <p>
        The developer describes what they want in natural language, and the AI
        generates a complete implementation — a function, a component, a test
        suite. But the human still reviews every output, integrates it manually,
        and handles the surrounding context. Think of this as "draft mode": the
        AI produces first drafts, the human edits and approves.
      </p>

      <h3>Level 3 — Supervised Autonomous Agents</h3>
      <p>
        This is where the paradigm shifts. AI agents receive a task — a Jira
        ticket, a GitHub issue, a product requirement — and independently plan
        the implementation, write the code, run the tests, and open a pull
        request. A human reviews the output and approves the merge.{" "}
        <strong>
          The human is no longer writing code. They are reviewing it.
        </strong>
      </p>

      <div className="article-callout">
        <strong>This is where WorkerMill operates today.</strong> Our agents
        decompose tasks into stories, assign specialized experts (backend,
        frontend, security, QA), execute in parallel, and deliver consolidated
        pull requests — all while streaming real-time progress to your
        dashboard.
      </div>

      <h3>Level 4 — Managed Autonomous Development</h3>
      <p>
        Agents handle entire features end-to-end: planning, implementation,
        testing, code review, deployment, and monitoring. Humans set priorities
        and define acceptance criteria. They intervene only on escalations —
        ambiguous requirements, architectural decisions, production incidents
        that require judgment. The daily standup becomes a review of what the
        agents shipped overnight.
      </p>

      <h3>Level 5 — The Dark Factory</h3>
      <p>
        Full autonomy. Agents interpret business objectives, decompose them
        into technical work, execute, deploy, monitor production metrics, and
        iterate based on real-world feedback. The backlog is consumed
        continuously. Deployments happen around the clock. The factory runs
        with the lights off.
      </p>
      <p>
        This doesn't mean humans disappear. It means humans operate at a
        fundamentally different altitude — setting strategy, defining product
        vision, making judgment calls that require understanding of customers,
        markets, and business context. The implementation layer is automated.
      </p>

      <h2>Why This Is Inevitable</h2>
      <p>
        Three converging forces make the dark factory not a question of{" "}
        <em>if</em>, but <em>when</em>:
      </p>

      <h3>1. The Economics Are Compelling</h3>
      <p>
        An AI agent that costs dollars per task versus a senior engineer who
        costs hundreds per hour isn't a marginal improvement — it's a
        structural shift in the cost of software production. Organizations that
        adopt agentic development will ship faster at lower cost, creating
        competitive pressure that forces the rest of the industry to follow.
      </p>

      <h3>2. The Models Keep Getting Better</h3>
      <p>
        Every six months, frontier models take a measurable leap in reasoning,
        code generation, and tool use. The gap between what an AI agent can do
        autonomously and what requires human intervention narrows with each
        generation. Tasks that required Level 2 human oversight a year ago now
        run reliably at Level 3.
      </p>

      <h3>3. The Infrastructure Is Maturing</h3>
      <p>
        Raw model capability was never enough. What was missing was the
        orchestration layer — the infrastructure to plan work, coordinate
        parallel execution, enforce quality gates, handle failures gracefully,
        and maintain security and compliance. That infrastructure is now being
        built. WorkerMill is building it.
      </p>

      <h2>What the Dark Factory Actually Looks Like</h2>
      <p>
        The dark factory isn't a single agent writing code in a loop. It's an
        orchestrated system of specialized agents, each with defined
        responsibilities, working in concert:
      </p>

      <ul>
        <li>
          <strong>A Planning Agent</strong> that decomposes requirements into
          discrete, implementable stories with clear acceptance criteria.
        </li>
        <li>
          <strong>A Critic Agent</strong> that validates plans before execution
          begins — catching scope issues, missing edge cases, and unrealistic
          file counts before a single line of code is written.
        </li>
        <li>
          <strong>Specialized Expert Agents</strong> — backend developers,
          frontend engineers, security auditors, QA engineers — each operating
          within their domain expertise, working in parallel on independent
          stories.
        </li>
        <li>
          <strong>A Coordination Layer</strong> that manages file locks,
          resolves merge conflicts, and ensures experts don't step on each
          other's work.
        </li>
        <li>
          <strong>A Review Agent</strong> that performs automated code review
          against security standards, project conventions, and acceptance
          criteria before any human sees the PR.
        </li>
      </ul>

      <p>
        This is not a theoretical architecture. This is how WorkerMill operates
        in production today.
      </p>

      <h2>The Role of the Human Engineer</h2>
      <p>
        The dark factory doesn't eliminate engineering roles — it elevates them.
        The most valuable skills shift from implementation to judgment:
      </p>

      <ul>
        <li>
          <strong>Architecture:</strong> Designing systems that agents can
          effectively work within — clear module boundaries, well-defined
          interfaces, comprehensive test suites.
        </li>
        <li>
          <strong>Requirements:</strong> Writing precise specifications that
          leave no room for misinterpretation. The quality of agent output is
          directly proportional to the quality of the input.
        </li>
        <li>
          <strong>Review:</strong> Evaluating agent work for correctness,
          security, and alignment with business intent — the same skill set
          that distinguishes senior engineers today.
        </li>
        <li>
          <strong>Strategy:</strong> Deciding what to build, when to build it,
          and how it fits into the broader product and business context.
        </li>
      </ul>

      <div className="article-callout">
        <strong>The engineers who thrive in this future</strong> are the ones
        who can clearly articulate what needs to be built and critically
        evaluate whether it was built correctly. Implementation speed becomes
        a commodity. Judgment does not.
      </div>

      <h2>Getting to Level 5: The Hard Problems</h2>
      <p>
        Full autonomy isn't here yet. Several hard problems remain between
        Level 3 (where we are) and Level 5 (where we're heading):
      </p>

      <ul>
        <li>
          <strong>Ambiguity resolution:</strong> Real-world requirements are
          messy. Agents need to know when to ask for clarification versus when
          to make a reasonable judgment call.
        </li>
        <li>
          <strong>Long-horizon planning:</strong> Multi-sprint features that
          span weeks of work require maintaining context and coherence across
          dozens of individual tasks.
        </li>
        <li>
          <strong>Production feedback loops:</strong> Connecting deployment
          outcomes (error rates, performance metrics, user behavior) back to
          the planning layer so agents learn from real-world results.
        </li>
        <li>
          <strong>Trust calibration:</strong> Organizations need confidence in
          agent output before they'll remove human checkpoints. This requires
          transparency, auditability, and a track record of reliable execution.
        </li>
      </ul>

      <p>
        These are engineering problems, not theoretical barriers. They will be
        solved incrementally, the same way autonomous driving is progressing —
        one capability at a time, validated in production, trust earned through
        demonstrated reliability.
      </p>

      <h2>The Timeline</h2>
      <p>
        Level 3 is production-ready now. Teams are using supervised autonomous
        agents to ship real features today.
      </p>
      <p>
        Level 4 — managed autonomy with minimal human intervention — is 12 to
        24 months away for well-structured codebases with comprehensive test
        coverage.
      </p>
      <p>
        Level 5 — the true dark factory — is a 3 to 5 year horizon. Not
        because the AI won't be capable, but because the surrounding
        infrastructure, tooling, and organizational trust need time to mature.
      </p>

      <div className="article-callout article-callout-success">
        <strong>The organizations that start at Level 3 today</strong> are the
        ones that will reach Level 5 first. Every task an agent completes,
        every feedback loop that's tightened, every failure that's learned from
        — it all compounds. The dark factory isn't built in a day. It's built
        one automated task at a time.
      </div>

      <h2>Start Building Your Dark Factory</h2>
      <p>
        WorkerMill is the orchestration layer for the dark factory. We handle
        the planning, coordination, execution, and monitoring so you can focus
        on the work that actually requires a human: deciding what to build and
        whether it was built right.
      </p>
      <p>
        The lights-out era of software development isn't coming. It's here. The
        only question is whether you'll be running the factory or competing
        against one.
      </p>
    </>
  ),
  "introducing-workermill": (
    <>
      <p className="article-lead">
        Today we're excited to launch WorkerMill, a real-time monitoring and
        orchestration system for AI workers that execute coding tasks. Think of
        it as <strong>htop for AI workers</strong>—complete visibility and
        control over your autonomous coding agents.
      </p>

      <h2>The Problem</h2>
      <p>
        As AI coding assistants become more capable, teams are increasingly
        looking to automate routine development work. But deploying autonomous
        AI agents in production raises critical questions:
      </p>
      <ul>
        <li>How do you know what the agent is doing?</li>
        <li>How do you control costs?</li>
        <li>How do you maintain security and compliance?</li>
      </ul>

      <h2>Our Approach</h2>
      <p>
        WorkerMill provides a central control plane for all your AI coding
        agents. Every task is tracked, every line of code is logged, and every
        decision is auditable.
      </p>

      <div className="article-callout">
        <strong>Key Insight:</strong> The most successful AI agent deployments
        aren't about the model—they're about the infrastructure around it.
      </div>

      <h3>Key Features</h3>
      <ul>
        <li>
          <strong>Real-time monitoring:</strong> Watch your workers execute
          tasks in real-time with full terminal output streaming.
        </li>
        <li>
          <strong>Cost tracking:</strong> Know exactly how much each task costs
          with per-token billing visibility.
        </li>
        <li>
          <strong>Git-native workflow:</strong> Workers operate directly in your
          repos, creating clean PRs with proper commits.
        </li>
        <li>
          <strong>Multi-provider support:</strong> Use Anthropic, OpenAI,
          Google, or even local Ollama models.
        </li>
      </ul>

      <h2>Getting Started</h2>
      <p>
        WorkerMill integrates with Jira, Linear, and GitHub Issues. Simply add
        the <code>workermill</code> label to any ticket, and our workers will
        pick it up automatically.
      </p>

      <p>
        We're excited to see what you build with WorkerMill. Sign up today and
        give your team an army of AI developers.
      </p>
    </>
  ),
  "tight-feedback-loops": (
    <>
      <p className="article-lead">
        One of the most counterintuitive findings in AI-assisted development is
        that <strong>model quality matters less than feedback quality</strong>.
        A cheaper model with tight feedback loops often outperforms an expensive
        model running in isolation.
      </p>

      <h2>The Feedback Hypothesis</h2>
      <p>
        When AI coding agents make mistakes, the cost isn't just the error
        itself—it's the compounding effect of building on top of flawed
        foundations. Every uncorrected mistake makes the next mistake more
        likely.
      </p>

      <div className="article-callout">
        <strong>The Math:</strong> An error rate of 5% per step compounds to 40%
        failure rate over 10 steps. Reduce to 1% per step, and you're at 10%
        failure rate.
      </div>

      <h2>How WorkerMill Implements Feedback</h2>
      <p>
        Our architecture is built around continuous validation at every step:
      </p>

      <h3>1. Planning Validation</h3>
      <p>
        Before any code is written, our Planning Agent validates the task
        breakdown. This catches requirement misunderstandings before they become
        expensive bugs.
      </p>

      <h3>2. Implementation Checkpoints</h3>
      <p>
        Workers validate their work incrementally. Type checking, linting, and
        tests run after each logical unit of work, not just at the end.
      </p>

      <h3>3. Tech Lead Review</h3>
      <p>
        Every PR gets reviewed by our AI Tech Lead agent, which checks for
        security issues, code quality, and adherence to project patterns.
      </p>

      <h2>The Results</h2>
      <p>
        In our testing, Claude Haiku with WorkerMill's feedback architecture
        achieves comparable results to Claude Opus running without structured
        feedback—at a fraction of the cost.
      </p>

      <div className="article-callout article-callout-success">
        <strong>Bottom Line:</strong> Invest in feedback infrastructure, not
        just bigger models.
      </div>
    </>
  ),
  "ai-agents-enterprise-development": (
    <>
      <p className="article-lead">
        Enterprise adoption of AI coding agents faces unique challenges. Unlike
        individual developers experimenting with GitHub Copilot, enterprise
        deployments must satisfy security teams, comply with regulations, and
        integrate with existing governance frameworks.
      </p>

      <h2>Security First</h2>
      <p>
        WorkerMill was designed with enterprise security requirements from day
        one:
      </p>

      <ul>
        <li>
          <strong>No code leaves your infrastructure:</strong> Workers run in
          your AWS account, processing code locally.
        </li>
        <li>
          <strong>Complete audit trails:</strong> Every action is logged with
          full attribution and timestamps.
        </li>
        <li>
          <strong>Role-based access control:</strong> Fine-grained permissions
          for who can approve what.
        </li>
      </ul>

      <h2>Compliance Considerations</h2>
      <p>
        For regulated industries, AI-generated code creates new compliance
        questions. WorkerMill helps answer them:
      </p>

      <h3>SOC 2</h3>
      <p>
        Full audit logs satisfy SOC 2 requirements for change management and
        access control.
      </p>

      <h3>GDPR</h3>
      <p>
        Data processing agreements available for organizations handling EU
        personal data.
      </p>

      <h3>HIPAA</h3>
      <p>
        Business Associate Agreements available for healthcare organizations.
      </p>

      <div className="article-callout">
        <strong>Enterprise Ready:</strong> WorkerMill supports SSO, audit
        logging, and custom data retention policies out of the box.
      </div>

      <h2>Integration Patterns</h2>
      <p>
        WorkerMill integrates with your existing toolchain: Jira for task
        management, GitHub/GitLab/Bitbucket for source control, and Slack for
        notifications.
      </p>
    </>
  ),
  "from-ticket-to-deployed": (
    <>
      <p className="article-lead">
        The promise of AI coding agents isn't just faster development—it's{" "}
        <strong>end-to-end automation</strong>. This guide walks through the
        complete WorkerMill workflow, from a Jira ticket to production
        deployment.
      </p>

      <h2>Step 1: Create the Ticket</h2>
      <p>
        Start with a well-written Jira ticket. Include acceptance criteria,
        relevant context, and any technical constraints. The better the ticket,
        the better the result.
      </p>

      <div className="article-callout">
        <strong>Pro Tip:</strong> Include links to relevant files, existing
        patterns to follow, and specific acceptance criteria. Context is
        everything.
      </div>

      <h2>Step 2: Add the Label</h2>
      <p>
        Add the <code>workermill</code> label to trigger processing. Optionally
        add model labels like <code>opus</code> for complex tasks or{" "}
        <code>haiku</code> for simple ones.
      </p>

      <h2>Step 3: Watch the Magic</h2>
      <p>
        The WorkerMill dashboard shows real-time progress. Watch as the Planning
        Agent breaks down the task, expert workers implement each component, and
        the Tech Lead reviews the result.
      </p>

      <h2>Step 4: Review and Approve</h2>
      <p>
        Once the PR is ready, you'll get a notification. Review the changes,
        provide feedback if needed, and approve when satisfied.
      </p>

      <h2>Step 5: Auto-Deploy (Optional)</h2>
      <p>
        Add the <code>deploy</code> label to enable auto-deployment. After PR
        approval, WorkerMill will merge and deploy automatically.
      </p>

      <div className="article-callout article-callout-success">
        <strong>The Result:</strong> What used to take hours of developer time
        now happens automatically. Your team focuses on architecture and review,
        while AI handles the implementation.
      </div>
    </>
  ),
};

export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getPostBySlug(slug) : undefined;

  useEffect(() => {
    if (post) {
      document.title = `${post.title} | WorkerMill Blog`;
    }
    window.scrollTo(0, 0);
  }, [post, slug]);

  if (!post) {
    return <Navigate to="/blog" replace />;
  }

  const content = postContent[post.slug];
  const relatedPosts = getRelatedPosts(post.slug, post.category, 3);

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex flex-col">
      <ReadingProgress />
      <Header />

      <main className="pt-24 pb-24 flex-1">
        <article className="container mx-auto px-6 lg:px-8">
          {/* Back link */}
          <div className="max-w-4xl mx-auto">
            <Link
              to="/blog"
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-teal-400 transition-colors mb-8 group"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              Back to Blog
            </Link>
          </div>

          {/* Hero section */}
          <header className="max-w-4xl mx-auto mb-12">
            {/* Meta info */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
              <span className="inline-flex items-center gap-1.5 text-sm text-teal-400 bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/20">
                <Tag className="w-3.5 h-3.5" />
                {categoryLabels[post.category]}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(post.date)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                <Clock className="w-3.5 h-3.5" />
                {post.readingTime} min read
              </span>
            </div>

            {/* Title */}
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-white mb-8 leading-[1.15]">
              {post.title}
            </h1>

            {/* Author */}
            <div className="mb-10">
              <AuthorAvatar author={post.author} size="lg" showInfo />
            </div>

            {/* Hero image */}
            {post.thumbnail && (
              <div className="aspect-[2/1] rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50">
                <img
                  src={post.thumbnail}
                  alt={post.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </header>

          {/* Article content wrapper */}
          <div className="max-w-3xl mx-auto">
            {/* Article box with prominent border */}
            <div className="bg-slate-900/70 rounded-2xl border-2 border-slate-700/80 p-10 lg:p-14 shadow-2xl">
              {/* Article content */}
              <div className="article-content">
                {content || (
                  <p className="text-slate-400">
                    Full article content coming soon.
                  </p>
                )}
              </div>
            </div>

            {/* Tags */}
            {post.tags && post.tags.length > 0 && (
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <span className="text-sm text-slate-500">Tags:</span>
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-sm text-slate-400 bg-slate-800/80 px-3 py-1.5 rounded-full border border-white/10 hover:border-teal-500/30 transition-colors"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Share and CTA */}
            <div className="mt-10 pt-8 border-t border-white/10">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <ShareButtons title={post.title} />

                <Link
                  to="/signup"
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 rounded-lg transition-all shadow-lg shadow-teal-500/25 hover:shadow-teal-500/40"
                >
                  Get started with WorkerMill
                </Link>
              </div>
            </div>

            {/* Related posts */}
            <RelatedPosts posts={relatedPosts} />

            {/* Back link */}
            <div className="mt-16 pt-10 border-t border-white/10">
              <Link
                to="/blog"
                className="inline-flex items-center gap-2 text-sm font-medium text-teal-400 hover:text-teal-300 transition-colors group"
              >
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                More articles
              </Link>
            </div>
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
