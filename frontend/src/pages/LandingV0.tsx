import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground"
import { Header } from "./Home/v0/Header"
import { Hero } from "./Home/v0/Hero"
import { LogosBar } from "./Home/v0/LogosBar"
import { StatsSection } from "./Home/v0/StatsSection"
import { FeaturesGrid } from "./Home/v0/FeaturesGrid"

export default function LandingV0() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <ImmersiveBackground />
      <div className="relative z-10">
        <Header />
        <Hero />
        <LogosBar />
        <StatsSection />
        <FeaturesGrid />
      </div>
    </main>
  )
}
