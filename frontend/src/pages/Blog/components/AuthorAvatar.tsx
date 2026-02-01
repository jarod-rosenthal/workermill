import type { Author } from "../../../types/blog";

interface AuthorAvatarProps {
  author: Author;
  size?: "sm" | "md" | "lg";
  showInfo?: boolean;
}

const sizeClasses = {
  sm: "w-6 h-6 text-xs",
  md: "w-8 h-8 text-sm",
  lg: "w-12 h-12 text-base",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getGradient(name: string): string {
  const gradients = [
    "from-teal-500 to-cyan-500",
    "from-purple-500 to-pink-500",
    "from-orange-500 to-yellow-500",
    "from-green-500 to-emerald-500",
    "from-blue-500 to-indigo-500",
    "from-rose-500 to-red-500",
  ];
  const index =
    name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) %
    gradients.length;
  return gradients[index];
}

export function AuthorAvatar({
  author,
  size = "md",
  showInfo = false,
}: AuthorAvatarProps) {
  const avatar = (
    <div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br ${getGradient(author.name)} flex items-center justify-center font-medium text-white shrink-0`}
    >
      {author.avatar ? (
        <img
          src={author.avatar}
          alt={author.name}
          className="w-full h-full rounded-full object-cover"
        />
      ) : (
        getInitials(author.name)
      )}
    </div>
  );

  if (!showInfo) {
    return avatar;
  }

  return (
    <div className="flex items-center gap-3">
      {avatar}
      <div>
        <p className="text-sm font-medium text-white">{author.name}</p>
        <p className="text-xs text-slate-500">{author.role}</p>
      </div>
    </div>
  );
}
