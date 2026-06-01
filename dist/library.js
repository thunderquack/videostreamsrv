"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = __importDefault(require("./config"));
const ffmpeg_1 = require("./ffmpeg");
const video_utils_1 = require("./video-utils");
class VideoLibrary {
    items = [];
    byId = new Map();
    lastScanAt = null;
    async init() {
        await promises_1.default.mkdir(config_1.default.cachePath, { recursive: true });
        await promises_1.default.mkdir(config_1.default.thumbnailsPath, { recursive: true });
        await promises_1.default.mkdir(config_1.default.hlsPath, { recursive: true });
        await promises_1.default.mkdir(config_1.default.videoLibraryPath, { recursive: true });
        await this.scan();
    }
    async scan() {
        const entries = await promises_1.default.readdir(config_1.default.videoLibraryPath, { withFileTypes: true });
        const files = entries.filter((entry) => entry.isFile() && (0, video_utils_1.isVideoFile)(entry.name));
        const items = [];
        for (const file of files) {
            const absolutePath = node_path_1.default.join(config_1.default.videoLibraryPath, file.name);
            const stats = await promises_1.default.stat(absolutePath);
            const id = (0, video_utils_1.createVideoId)(file.name);
            const thumbnailPath = node_path_1.default.join(config_1.default.thumbnailsPath, `${id}.jpg`);
            const durationSeconds = await (0, ffmpeg_1.probeDuration)(absolutePath);
            const thumbnailTimestamp = getThumbnailTimestamp(durationSeconds);
            if (await shouldGenerateThumbnail(thumbnailPath, stats.mtimeMs)) {
                try {
                    await (0, ffmpeg_1.ensureThumbnail)(absolutePath, thumbnailPath, thumbnailTimestamp);
                }
                catch {
                    // Keep the item even if thumbnail generation fails.
                }
            }
            items.push({
                id,
                filename: file.name,
                path: absolutePath,
                size: stats.size,
                modifiedAt: stats.mtime.toISOString(),
                durationSeconds,
                durationLabel: (0, video_utils_1.formatDuration)(durationSeconds),
                directPlaySupported: (0, video_utils_1.supportsDirectPlay)(file.name),
                thumbnailExists: await fileExists(thumbnailPath)
            });
        }
        items.sort((left, right) => left.filename.localeCompare(right.filename, undefined, { sensitivity: "base" }));
        this.items = items;
        this.byId = new Map(items.map((item) => [item.id, item]));
        this.lastScanAt = new Date().toISOString();
        return this.getItems();
    }
    getItems() {
        return this.items.map((item) => ({ ...item }));
    }
    getItem(id) {
        return this.byId.get(id) || null;
    }
    getStatus() {
        return {
            videoCount: this.items.length,
            lastScanAt: this.lastScanAt
        };
    }
}
exports.default = VideoLibrary;
async function fileExists(filePath) {
    try {
        await promises_1.default.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function shouldGenerateThumbnail(thumbnailPath, sourceMtimeMs) {
    try {
        const thumbnailStats = await promises_1.default.stat(thumbnailPath);
        return thumbnailStats.mtimeMs < sourceMtimeMs;
    }
    catch {
        return true;
    }
}
function getThumbnailTimestamp(durationSeconds) {
    if (Number.isFinite(durationSeconds) && durationSeconds !== null && durationSeconds > 0) {
        return Math.max(1, durationSeconds / 2);
    }
    return config_1.default.thumbnailTimestamp;
}
