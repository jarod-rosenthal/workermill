import { ArrowRight } from "lucide-react";
import { Button } from "./ui/button";

interface CTAFooterProps {
  /** Optional custom headline */
  headline?: string;
  /** Optional custom subtext */
  subtext?: string;
  /** Optional custom CTA button text */
  ctaText?: string;
  /** Optional callback when CTA is clicked */
  onCTAClick?: () => void;
}

export function CTAFooter({
  headline = "Ready to accelerate your engineering team?",
  subtext = "Open source. Run locally or in the cloud.",
  ctaText = "View on GitHub",
  onCTAClick,
}: CTAFooterProps) {
  const handleClick = () => {
    if (onCTAClick) {
      onCTAClick();
    } else {
      window.open("https://github.com/jarod-rosenthal/workermill", "_blank");
    }
  };

  return (
    <section className="relative overflow-hidden">
      {/* Background with gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-secondary via-background to-secondary" />

      {/* Decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/4 w-1/2 h-full bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -right-1/4 w-1/2 h-full bg-accent/5 rounded-full blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <div className="text-center">
          {/* Headline */}
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground tracking-tight">
            {headline}
          </h2>

          {/* Subtext */}
          <p className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
            {subtext}
          </p>

          {/* CTA Button */}
          <div className="mt-8">
            <Button
              size="lg"
              onClick={handleClick}
              className="group bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-background font-semibold px-8 py-6 text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300"
            >
              {ctaText}
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>

          {/* Trust indicator */}
          <p className="mt-6 text-sm text-muted-foreground">
            Free and open source. Apache 2.0 license.
          </p>
        </div>
      </div>
    </section>
  );
}
