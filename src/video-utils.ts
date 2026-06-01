import path from "node:path";

const directExtensions = new Set([".mp4", ".webm", ".ogg", ".ogv", ".m4v", ".mov"]);
const videoExtensions = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".avi",
  ".webm",
  ".wmv",
  ".flv",
  ".mpeg",
  ".mpg",
  ".ts",
  ".m2ts",
  ".3gp",
  ".ogv"
]);

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "video"
  );
}

export function createVideoId(filename: string): string {
  const parsed = path.parse(filename);
  const stamp = Buffer.from(filename).toString("base64url").slice(0, 10);
  return `${slugify(parsed.name)}-${stamp}`;
}

export function isVideoFile(filename: string): boolean {
  return videoExtensions.has(path.extname(filename).toLowerCase());
}

export function supportsDirectPlay(filename: string): boolean {
  return directExtensions.has(path.extname(filename).toLowerCase());
}

export function formatDuration(seconds: number | null): string | null {
  if (!Number.isFinite(seconds) || seconds === null || seconds <= 0) {
    return null;
  }

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
