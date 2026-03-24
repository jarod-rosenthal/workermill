import { Play } from "lucide-react";
import { useState } from "react";

interface Demo {
  id: string;
  title: string;
  thumbnail: string;
  url: string;
}

const demos: Demo[] = [
  {
    id: "fLS1tWfItzY",
    title: "AI Agents Build a Full-Stack SaaS App in 5 Hours — 27,000 Lines of Code",
    thumbnail: "https://img.youtube.com/vi/fLS1tWfItzY/maxresdefault.jpg",
    url: "https://youtu.be/fLS1tWfItzY",
  },
  {
    id: "DoRqXG6zOI0",
    title: "AI Coding Agents Build a Full-Stack App in 4.5 Hours — 21,000 Lines of Code",
    thumbnail: "https://img.youtube.com/vi/DoRqXG6zOI0/maxresdefault.jpg",
    url: "https://youtu.be/DoRqXG6zOI0",
  },
  {
    id: "sa0lug-G-cg",
    title: "WorkerMill in Action — Autonomously plan, code, and ship a feature in real-time",
    thumbnail: "https://img.youtube.com/vi/sa0lug-G-cg/maxresdefault.jpg",
    url: "https://youtu.be/sa0lug-G-cg",
  },
];

export function Demos() {
  const [playingId, setPlayingId] = useState<string | null>(null);

  return (
    <section className="py-20 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            See It in Action
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Watch WorkerMill autonomously plan, build, and ship full-stack applications.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {demos.map((demo) => (
            <div
              key={demo.id}
              className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 transition-colors group"
            >
              {/* Video / Thumbnail */}
              <div className="relative aspect-video bg-muted">
                {playingId === demo.id ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${demo.id}?autoplay=1&rel=0`}
                    title={demo.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full"
                  />
                ) : (
                  <button
                    onClick={() => setPlayingId(demo.id)}
                    className="absolute inset-0 w-full h-full cursor-pointer"
                  >
                    <img
                      src={demo.thumbnail}
                      alt={demo.title}
                      className="w-full h-full object-cover"
                    />
                    {/* Play overlay */}
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/20 transition-colors">
                      <div className="w-14 h-14 rounded-full bg-primary/90 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Play className="w-6 h-6 text-primary-foreground ml-0.5" fill="currentColor" />
                      </div>
                    </div>
                  </button>
                )}
              </div>

              {/* Title */}
              <div className="p-4">
                <a
                  href={demo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-foreground hover:text-primary transition-colors line-clamp-2"
                >
                  {demo.title}
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <a
            href="https://www.youtube.com/@JarodRosenthal"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-primary hover:underline text-sm font-medium"
          >
            More videos on YouTube
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
