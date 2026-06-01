const path = require("path");

const directExtensions = new Set([
  ".mp4",
  ".webm",
  ".ogg",
  ".ogv",
  ".m4v",
  ".mov"
]);

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "video";
}

function createVideoId(filename) {
  const parsed = path.parse(filename);
  const stamp = Buffer.from(filename).toString("base64url").slice(0, 10);
  return `${slugify(parsed.name)}-${stamp}`;
}

function isVideoFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return [
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
  ].includes(ext);
}

function supportsDirectPlay(filename) {
  return directExtensions.has(path.extname(filename).toLowerCase());
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
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

module.exports = {
  createVideoId,
  formatDuration,
  isVideoFile,
  supportsDirectPlay
};
