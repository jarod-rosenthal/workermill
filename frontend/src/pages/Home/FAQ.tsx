import { useState } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

interface FAQItem {
  question: string;
  answer: string;
}

const faqItems: FAQItem[] = [
  {
    question: "How does pricing work?",
    answer:
      "WorkerMill uses simple hours-based pricing. Each plan includes monthly compute hours - the actual container runtime for your tasks. A quick bug fix might use 10-15 minutes, while a larger feature could use 30-60 minutes. If you exceed your included hours, overage rates apply per hour. All plans include BYOK (Bring Your Own Keys) - use your own AI provider API keys and only pay WorkerMill for orchestration.",
  },
  {
    question: "What is Epic Mode and why is it the default?",
    answer:
      "Epic Mode is our intelligent task orchestration system that automatically decomposes complex tickets into smaller, parallelizable stories. When you add the 'workermill' label to a ticket, Epic Mode analyzes the requirements, creates a dependency graph, and executes stories in parallel with multiple expert workers. This results in faster completion times and better quality code. No special configuration needed - it just works.",
  },
  {
    question: "What is BYOK (Bring Your Own Keys)?",
    answer:
      "BYOK means you provide your own API keys for AI providers like Anthropic, OpenAI, Google, or self-hosted Ollama. You pay those providers directly at their rates, and WorkerMill only charges for orchestration (compute hours). This gives you full control over AI costs and lets you use self-hosted models at zero AI cost. Planning and review features work with all supported providers.",
  },
  {
    question: "What counts as a compute hour?",
    answer:
      "Compute hours measure actual container runtime, billed to the second (displayed in minutes for readability). When you submit a Jira or Linear ticket, WorkerMill spins up a container that clones your repo, analyzes the task, writes code, runs tests, and creates a PR. The clock runs from container start to completion. A typical bug fix uses 10-20 minutes, a medium feature 20-45 minutes. You pay only for exact time used - no rounding.",
  },
  {
    question: "How does WorkerMill access my code?",
    answer:
      "WorkerMill connects to your GitHub, GitLab, or BitBucket repository. Workers clone your repo into isolated, ephemeral environments that are destroyed after each task. We never store your source code on our servers - only task metadata and logs. Enterprise customers can use self-hosted SCM providers.",
  },
  {
    question: "What AI models power the workers?",
    answer:
      "WorkerMill supports all major AI providers including Anthropic Claude (Opus, Sonnet, Haiku), OpenAI (GPT-4o, o1), Google Gemini, and self-hosted Ollama. Choose the model that fits your needs - from high-capability frontier models for complex tasks to faster, cost-effective options for routine work. Use Jira labels like 'haiku', 'sonnet', or 'opus' to select specific models.",
  },
  {
    question: "What is the AI Support Agent?",
    answer:
      "The AI Support Agent automatically responds to support tickets using AI. When a customer submits a ticket, the agent analyzes the question, checks its confidence level, and either responds automatically or escalates to a human. You can configure which ticket categories are eligible for auto-response and set confidence thresholds. Available on all plans.",
  },
  {
    question: "What are the 'improve' and 'critic' labels?",
    answer:
      "The 'improve' label enables self-improvement mode, where the worker analyzes its completed work and generates insights for future tasks. The 'critic' label adds a Planner-Critic validation step before execution, where an AI critic reviews and improves the execution plan. Both are optional and available on all plans.",
  },
  {
    question: "How do workers interact with my production environment?",
    answer:
      "They don't - by design. Workers operate in completely isolated environments separate from your production systems. Each task runs in an ephemeral container with its own dev/staging resources. Workers create pull requests that require human approval - once approved, you control deployment via your own CI/CD pipelines.",
  },
  {
    question: "How do you handle sensitive data?",
    answer:
      "Workers operate in isolated Docker containers with no internet access except to your SCM and AI providers. Secrets are managed via environment variables that are never logged. We follow security best practices and offer enterprise deployment options for additional security requirements.",
  },
  {
    question: "What happens if a worker gets stuck?",
    answer:
      "WorkerMill monitors all active tasks. If a worker exceeds time limits or encounters repeated failures, the task is automatically cancelled and marked for retry or human intervention. You're notified via Slack or email when tasks need attention.",
  },
  {
    question: "What types of tasks work best?",
    answer:
      "Workers excel at well-defined, scoped tasks: bug fixes with clear reproduction steps, feature implementations with acceptance criteria, refactoring with specific patterns, and documentation updates. Very ambiguous or architecturally complex tasks may need to be broken down first.",
  },
  {
    question: "Can I customize worker behavior?",
    answer:
      "Yes! Each repository can have an agent.md file that provides project-specific context, coding standards, and instructions. Workers read this file before starting any task to understand your team's conventions and preferences.",
  },
  {
    question: "What code quality tools are supported?",
    answer:
      "WorkerMill supports BYOT (Bring Your Own Tools) for code quality. Connect your existing SonarQube, Snyk, or CodeQL instances to get quality metrics in your worker pipeline. Workers can run scans after code changes and optionally gate PR creation on quality thresholds. Configure your tool credentials in Settings → Integrations.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleItem = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="py-20 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-4">
            <HelpCircle className="w-6 h-6" />
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-muted-foreground text-lg">
            Everything you need to know about WorkerMill.
          </p>
        </div>

        <div className="space-y-3">
          {faqItems.map((item, index) => (
            <div
              key={index}
              className="bg-card border border-border rounded-xl overflow-hidden"
            >
              <button
                onClick={() => toggleItem(index)}
                className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/30 transition-colors"
              >
                <span className="font-medium text-foreground pr-4">
                  {item.question}
                </span>
                <div className="flex-shrink-0 text-muted-foreground">
                  {openIndex === index ? (
                    <ChevronUp className="w-5 h-5" />
                  ) : (
                    <ChevronDown className="w-5 h-5" />
                  )}
                </div>
              </button>
              {openIndex === index && (
                <div className="px-5 pb-5">
                  <p className="text-muted-foreground leading-relaxed">
                    {item.answer}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
