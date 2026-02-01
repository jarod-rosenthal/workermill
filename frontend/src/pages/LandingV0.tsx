import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground"
import { Header } from "./Home/v0/Header"
import { Hero } from "./Home/v0/Hero"
import { StatsSection } from "./Home/v0/StatsSection"
import { FeaturesGrid } from "./Home/v0/FeaturesGrid"
import HowItWorks from "./Home/HowItWorks"
import Workers from "./Home/Workers"
import Features from "./Home/Features"
import { Pricing } from "./Home/Pricing"

export default function LandingV0() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <ImmersiveBackground />
      <div className="relative z-10">
        <Header />
        <Hero />
        <StatsSection />
        <FeaturesGrid />

        {/* Product Section */}
        <section id="product">
          <HowItWorks />
          <Workers />
        </section>

        {/* Solutions Section */}
        <section id="solutions">
          <Features />
        </section>

        {/* Pricing Section */}
        <section id="pricing">
          <Pricing />
        </section>
      </div>
    </main>
  )
}
