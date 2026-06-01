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
    states = new Map();
    async sync(videos) {
        const knownIds = new Set(videos.map((video) => video.id));
        await this.cleanupRemovedEntries(knownIds);
        for (const video of videos) {
            if (video.directPlaySupported || !config_1.default.hlsEnabled) {
                this.states.set(video.id, "not_needed");
                continue;
            }
            await this.ensurePrepared(video);
        }
    }
    getState(video) {
        if (!config_1.default.hlsEnabled || video.directPlaySupported) {
            return "not_needed";
        }
        return this.states.get(video.id) || "preparing";
    }
    async ensureReady(video) {
        const outputDir = node_path_1.default.join(config_1.default.hlsPath, video.id);
        const playlistPath = node_path_1.default.join(outputDir, "master.m3u8");
        if (await this.isReady(video)) {
            this.states.set(video.id, "ready");
            return { outputDir, playlistPath };
        }
        await this.ensurePrepared(video);
        const job = this.jobs.get(video.id);
        if (job) {
            await job.ready;
        }
        if (!(await this.isReady(video))) {
            throw new Error("HLS playlist is not ready yet");
        }
        this.states.set(video.id, "ready");
        return { outputDir, playlistPath };
    }
    async ensurePrepared(video) {
        const outputDir = this.getOutputDir(video.id);
        const playlistPath = this.getPlaylistPath(video.id);
        if (await this.isReady(video)) {
            this.states.set(video.id, "ready");
            return;
        }
        let job = this.jobs.get(video.id);
        if (!job) {
            await promises_1.default.rm(outputDir, { recursive: true, force: true });
            await promises_1.default.mkdir(outputDir, { recursive: true });
            this.states.set(video.id, "preparing");
            job = this.createJob(video, playlistPath);
            this.jobs.set(video.id, job);
        }
    }
    createJob(video, playlistPath) {
        const outputDir = this.getOutputDir(video.id);
        const { process, done } = (0, ffmpeg_1.spawnHls)(video.path, playlistPath);
        const ready = done
            .then(async () => {
            const playlist = await promises_1.default.readFile(playlistPath, "utf8");
            if (!playlist.includes("#EXT-X-ENDLIST")) {
                throw new Error("Generated HLS playlist is incomplete");
            }
            await this.writeMetadata(video);
            this.states.set(video.id, "ready");
        })
            .catch(async (error) => {
            this.states.set(video.id, "error");
            await promises_1.default.rm(outputDir, { recursive: true, force: true });
            throw error;
        })
            .finally(() => {
            this.jobs.delete(video.id);
        });
        process.stderr.on("data", () => {
            // ffmpeg logs are intentionally suppressed during normal operation.
        });
        return { ready };
    }
    async cleanupRemovedEntries(validIds) {
        const entries = await promises_1.default.readdir(config_1.default.hlsPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (!validIds.has(entry.name)) {
                await promises_1.default.rm(node_path_1.default.join(config_1.default.hlsPath, entry.name), { recursive: true, force: true });
                this.states.delete(entry.name);
                this.jobs.delete(entry.name);
            }
        }
    }
    async isReady(video) {
        const playlistPath = this.getPlaylistPath(video.id);
        const metadataPath = this.getMetadataPath(video.id);
        try {
            const [playlist, metadataRaw] = await Promise.all([
                promises_1.default.readFile(playlistPath, "utf8"),
                promises_1.default.readFile(metadataPath, "utf8")
            ]);
            const metadata = JSON.parse(metadataRaw);
            return (metadata.sourcePath === video.path &&
                metadata.size === video.size &&
                metadata.modifiedAt === video.modifiedAt &&
                playlist.includes("#EXT-X-ENDLIST"));
        }
        catch {
            return false;
        }
    }
    async writeMetadata(video) {
        const metadata = {
            sourcePath: video.path,
            size: video.size,
            modifiedAt: video.modifiedAt
        };
        await promises_1.default.writeFile(this.getMetadataPath(video.id), JSON.stringify(metadata), "utf8");
    }
    getOutputDir(id) {
        return node_path_1.default.join(config_1.default.hlsPath, id);
    }
    getPlaylistPath(id) {
        return node_path_1.default.join(this.getOutputDir(id), "master.m3u8");
    }
    getMetadataPath(id) {
        return node_path_1.default.join(this.getOutputDir(id), "source.json");
    }
}
exports.default = HlsManager;
