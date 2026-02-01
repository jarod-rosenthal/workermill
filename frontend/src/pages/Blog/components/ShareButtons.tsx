import { useState } from "react";
import { Twitter, Linkedin, Link2, Check } from "lucide-react";

interface ShareButtonsProps {
  title: string;
  url?: string;
}

export function ShareButtons({ title, url }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const shareUrl = url || (typeof window !== "undefined" ? window.location.href : "");

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(shareUrl)}`;
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-500 mr-2">Share:</span>
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="p-2 rounded-lg bg-slate-800/50 border border-white/5 hover:border-teal-500/30 hover:bg-slate-700/50 transition-all duration-200 group"
        title="Share on Twitter"
      >
        <Twitter className="w-4 h-4 text-slate-400 group-hover:text-teal-400 transition-colors" />
      </a>
      <a
        href={linkedinUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="p-2 rounded-lg bg-slate-800/50 border border-white/5 hover:border-teal-500/30 hover:bg-slate-700/50 transition-all duration-200 group"
        title="Share on LinkedIn"
      >
        <Linkedin className="w-4 h-4 text-slate-400 group-hover:text-teal-400 transition-colors" />
      </a>
      <button
        onClick={handleCopyLink}
        className="p-2 rounded-lg bg-slate-800/50 border border-white/5 hover:border-teal-500/30 hover:bg-slate-700/50 transition-all duration-200 group"
        title={copied ? "Copied!" : "Copy link"}
      >
        {copied ? (
          <Check className="w-4 h-4 text-teal-400" />
        ) : (
          <Link2 className="w-4 h-4 text-slate-400 group-hover:text-teal-400 transition-colors" />
        )}
      </button>
    </div>
  );
}
