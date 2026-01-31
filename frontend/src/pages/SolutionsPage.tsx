import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground"
import { Header } from "./Home/v0/Header"
import Features from "./Home/Features"

export default function SolutionsPage() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <ImmersiveBackground />
      <div className="relative z-10">
        <Header />
        <div className="pt-16">
          <Features />
        </div>
      </div>
    </main>
  )
}
