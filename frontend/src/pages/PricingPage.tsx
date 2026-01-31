import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground"
import { Header } from "./Home/v0/Header"
import { Pricing } from "./Home/Pricing"

export default function PricingPage() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <ImmersiveBackground />
      <div className="relative z-10">
        <Header />
        <div className="pt-16">
          <Pricing />
        </div>
      </div>
    </main>
  )
}
