import { useState } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

interface FAQItem {
  question: string;
  answer: string;
}

const faqItems: FAQItem[] = [
  {
    question: "How does WorkerMill access my code?",
    answer:
      "WorkerMill connects to your GitHub repository via OAuth. Workers clone your repo into isolated, ephemeral environments that are destroyed after each task. We never store your source code on our servers - only task metadata and logs.",
  },
  {
    question: "What AI models power the workers?",
    answer:
      "Workers are powered by Anthropic's Claude models. You can choose between Claude Opus 4.5 (highest capability), Claude Sonnet 4 (balanced), or Claude Haiku (fastest/cheapest) depending on task complexity. The Virtual Manager uses the same model options for code review.",
  },
  {
    question: "Can workers break my production code?",
    answer:
      "No. Workers only create pull requests - they never push directly to protected branches. All changes go through your normal code review process. The Virtual Manager provides an additional AI review layer before PRs are marked ready for human review.",
  },
  {
    question: "How do you handle sensitive data?",
    answer:
      "Workers operate in isolated Docker containers with no internet access except to GitHub and the Claude API. Secrets are managed via environment variables that are never logged. We're SOC 2 Type II compliant and offer enterprise deployment options for additional security requirements.",
  },
  {
    question: "What happens if a worker gets stuck?",
    answer:
      "The Watcher service monitors all active tasks. If a worker exceeds time limits or encounters repeated failures, the task is automatically cancelled and marked for retry or human intervention. You're notified via Slack or email when tasks need attention.",
  },
  {
    question: "What types of tasks work best?",
    answer:
      "Workers excel at well-defined, scoped tasks: bug fixes with clear reproduction steps, feature implementations with acceptance criteria, refactoring with specific patterns, and documentation updates. Very ambiguous or architecturally complex tasks may need to be broken down first.",
  },
  {
    question: "Can I customize worker behavior?",
    answer:
      "Yes! Each repository can have a CLAUDE.md file that provides project-specific context, coding standards, and instructions. Workers read this file before starting any task to understand your team's conventions and preferences.",
  },
  {
    question: "How is pricing calculated?",
    answer:
      "WorkerMill pricing is based on tasks per month. AI model costs (Claude API usage) are billed separately based on actual token consumption. The dashboard shows real-time cost tracking so you always know what you're spending.",
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
