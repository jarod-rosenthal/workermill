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
    <div className="min-h-screen bg-[***REMOVED***0a0f1a] flex flex-col">
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
                    ***REMOVED***{tag}
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
