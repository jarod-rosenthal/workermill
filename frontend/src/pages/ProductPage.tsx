import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground"
import { Header } from "./Home/v0/Header"
import HowItWorks from "./Home/HowItWorks"
import Workers from "./Home/Workers"

export default function ProductPage() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <ImmersiveBackground />
      <div className="relative z-10">
        <Header />
        <div className="pt-16">
          <HowItWorks />
          <Workers />
        </div>
      </div>
    </main>
  )
}
