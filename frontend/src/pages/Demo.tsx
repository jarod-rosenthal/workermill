import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ControlCenter } from "./Home/v0/ControlCenter";
import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground";

export default function Demo() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <ImmersiveBackground />
      <div className="relative z-10">
        <div className="container mx-auto px-6 lg:px-8 py-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
          <div className="flex flex-col items-center gap-8">
            <div>
              <h1 className="text-3xl font-bold text-white text-center mb-2">
                Control Center Demo
              </h1>
              <p className="text-slate-400 text-center">
                Watch AI workers execute tasks in real-time.
              </p>
            </div>
            <ControlCenter />
          </div>
        </div>
      </div>
    </main>
  );
}
