"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const rootDir = node_path_1.default.resolve(__dirname, "..");
function parseBoolean(value, defaultValue) {
    if (value === undefined) {
        return defaultValue;
    }
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}
const cacheRoot = node_path_1.default.resolve(process.env.CACHE_PATH || node_path_1.default.join(rootDir, "cache"));
const config = {
    port: Number(process.env.PORT || 3000),
    videoLibraryPath: node_path_1.default.resolve(process.env.VIDEO_LIBRARY_PATH || node_path_1.default.join(rootDir, "videos")),
    cachePath: cacheRoot,
    thumbnailsPath: node_path_1.default.resolve(cacheRoot, "thumbs"),
    hlsPath: node_path_1.default.resolve(cacheRoot, "hls"),
    thumbnailTimestamp: Number(process.env.THUMBNAIL_TIMESTAMP || 15),
    hlsEnabled: parseBoolean(process.env.HLS_ENABLED, true)
};
exports.default = config;
