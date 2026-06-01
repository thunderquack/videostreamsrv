"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVideoId = createVideoId;
exports.isVideoFile = isVideoFile;
exports.supportsDirectPlay = supportsDirectPlay;
exports.formatDuration = formatDuration;
const node_path_1 = __importDefault(require("node:path"));
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
function slugify(name) {
    return (name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "video");
}
function createVideoId(filename) {
    const parsed = node_path_1.default.parse(filename);
    const stamp = Buffer.from(filename).toString("base64url").slice(0, 10);
    return `${slugify(parsed.name)}-${stamp}`;
}
function isVideoFile(filename) {
    return videoExtensions.has(node_path_1.default.extname(filename).toLowerCase());
}
function supportsDirectPlay(filename) {
    return directExtensions.has(node_path_1.default.extname(filename).toLowerCase());
}
function formatDuration(seconds) {
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
