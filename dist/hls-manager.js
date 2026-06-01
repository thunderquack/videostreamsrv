"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = __importDefault(require("./config"));
const ffmpeg_1 = require("./ffmpeg");
class HlsManager {
    jobs = new Map();
    async ensureReady(video) {
        const outputDir = node_path_1.default.join(config_1.default.hlsPath, video.id);
        const playlistPath = node_path_1.default.join(outputDir, "master.m3u8");
        await promises_1.default.mkdir(outputDir, { recursive: true });
        try {
            await promises_1.default.access(playlistPath);
            return { outputDir, playlistPath };
        }
        catch {
            // Start or await generation.
        }
        let job = this.jobs.get(video.id);
        if (!job) {
            job = this.createJob(video.path, playlistPath, video.id);
            this.jobs.set(video.id, job);
        }
        await job.ready;
        return { outputDir, playlistPath };
    }
    createJob(inputPath, playlistPath, id) {
        const child = (0, ffmpeg_1.spawnHls)(inputPath, playlistPath);
        const ready = waitForPlaylist(playlistPath, child);
        child.stderr.on("data", () => {
            // ffmpeg logs are intentionally suppressed during normal operation.
        });
        child.on("close", () => {
            this.jobs.delete(id);
        });
        return { ready };
    }
}
exports.default = HlsManager;
async function waitForPlaylist(playlistPath, child) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
        try {
            await promises_1.default.access(playlistPath);
            return;
        }
        catch {
            if (child.exitCode !== null && child.exitCode !== 0) {
                throw new Error("HLS generation failed");
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
    throw new Error("Timed out waiting for HLS playlist");
}
