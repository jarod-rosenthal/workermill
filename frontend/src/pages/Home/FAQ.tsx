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
      "WorkerMill is open source and free to self-host. You bring your own API keys and run the full platform on your own infrastructure.",
  },
  {
    question: "What is Epic Mode and why is it the default?",
    answer:
      "Epic Mode is our intelligent task orchestration system that automatically decomposes complex tickets into smaller, parallelizable stories. When you add the 'workermill' label to a ticket, Epic Mode analyzes the requirements, creates a dependency graph, and executes stories in parallel with multiple expert workers. This results in faster completion times and better quality code. No special configuration needed - it just works.",
  },
  {
    question: "What is BYOK (Bring Your Own Keys)?",
    answer:
      "BYOK means you provide your own API keys for AI providers like Anthropic, OpenAI, Google, or self-hosted Ollama. You pay those providers directly at their rates. This gives you full control over AI costs and lets you use self-hosted models at zero AI cost. Planning and review features work with all supported providers.",
  },
  {
    question: "What does a task look like?",
    answer:
      "When you submit a Jira, Linear, or GitHub issue, WorkerMill spins up an isolated container that clones your repo, analyzes the task, writes code, runs tests, and creates a PR. A typical bug fix takes 10-20 minutes, a medium feature 20-45 minutes. You can watch progress in real-time via the dashboard's live terminal stream.",
  },
  {
    question: "How does WorkerMill access my code?",
    answer:
      "WorkerMill connects to your GitHub, GitLab, or BitBucket repository. Workers clone your repo into isolated, ephemeral environments that are destroyed after each task. We never store your source code on our servers - only task metadata and logs. Enterprise customers can use self-hosted SCM providers.",
  },
  {
    question: "What AI models power the workers?",
    answer:
      "WorkerMill supports all major AI providers: Anthropic Claude (Opus, Sonnet, Haiku), OpenAI, Google Gemini, and self-hosted Ollama. Choose the provider and model that fits your needs — from high-capability frontier models for complex tasks to faster, cost-effective options for routine work. Use labels like 'haiku', 'sonnet', or 'opus' to select specific models.",
  },
  {
    question: "Can I create custom personas?",
    answer:
      "Yes — Persona Studio lets you create custom expert personas with your own directives, scripts, and domain knowledge. Define personas like 'unity_game_dev' or 'shopify_expert' tailored to your stack. All default personas are included out of the box.",
  },
  {
    question: "What are the 'improve' and 'critic' labels?",
    answer:
      "The 'improve' label enables self-improvement mode, where the worker analyzes its completed work and generates insights for future tasks. The 'critic' label adds a Planner-Critic validation step before execution, where an AI critic reviews and improves the execution plan. Both are optional and available to all users.",
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
