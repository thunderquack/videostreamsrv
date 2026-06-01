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
    queue = [];
    activeProcess = null;
    activeJobId = null;
    videos = new Map();
    async sync(videos) {
        const knownIds = new Set(videos.map((video) => video.id));
        const previousIds = new Set(this.videos.keys());
        this.videos = new Map(videos.map((video) => [video.id, video]));
        await this.cleanupRemovedEntries(knownIds);
        for (const video of videos) {
            await this.syncVideo(video);
        }
        for (const previousId of previousIds) {
            if (!knownIds.has(previousId)) {
                this.videos.delete(previousId);
            }
        }
        this.pumpQueue();
    }
    getState(video) {
        return this.states.get(video.id) || {
            status: "queued",
            progress: 0,
            error: null
        };
    }
    async ensureReady(video) {
        const outputDir = node_path_1.default.join(config_1.default.hlsPath, video.id);
        const playlistPath = node_path_1.default.join(outputDir, "master.m3u8");
        if (await this.isReady(video)) {
            this.setState(video.id, "ready", 100, null);
            return { outputDir, playlistPath };
        }
        await this.syncVideo(video);
        this.pumpQueue();
        const job = this.jobs.get(video.id);
        if (job) {
            await job.ready;
        }
        const state = this.getState(video);
        if (state.status === "error") {
            throw new Error(state.error || "HLS generation failed");
        }
        if (!(await this.isReady(video))) {
            throw new Error("HLS playlist is not ready yet");
        }
        this.setState(video.id, "ready", 100, null);
        return { outputDir, playlistPath };
    }
    async syncVideo(video) {
        const state = this.states.get(video.id);
        const ready = await this.isReady(video);
        if (ready) {
            this.dequeue(video.id);
            this.setState(video.id, "ready", 100, null);
            return;
        }
        if (this.activeJobId === video.id && state?.status === "preparing") {
            return;
        }
        if (state?.status === "queued") {
            return;
        }
        this.enqueue(video.id);
        this.setState(video.id, "queued", 0, null);
    }
    createJob(video, playlistPath) {
        const outputDir = this.getOutputDir(video.id);
        const { process, done } = (0, ffmpeg_1.spawnHls)(video.path, playlistPath);
        this.activeProcess = process;
        this.activeJobId = video.id;
        this.attachProgressListener(video, process);
        const ready = done
            .then(async () => {
            const playlist = await promises_1.default.readFile(playlistPath, "utf8");
            if (!playlist.includes("#EXT-X-ENDLIST")) {
                throw new Error("Generated HLS playlist is incomplete");
            }
            if (!this.videos.has(video.id)) {
                await promises_1.default.rm(outputDir, { recursive: true, force: true });
                return;
            }
            await this.writeMetadata(video);
            this.setState(video.id, "ready", 100, null);
        })
            .catch(async (error) => {
            if (!this.videos.has(video.id)) {
                await promises_1.default.rm(outputDir, { recursive: true, force: true });
                return;
            }
            this.setState(video.id, "error", 0, error instanceof Error ? error.message : "HLS generation failed");
            await promises_1.default.rm(outputDir, { recursive: true, force: true });
        })
            .finally(() => {
            this.jobs.delete(video.id);
            if (this.activeJobId === video.id) {
                this.activeJobId = null;
                this.activeProcess = null;
            }
            this.pumpQueue();
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
                if (this.activeJobId === entry.name && this.activeProcess) {
                    this.activeProcess.kill("SIGTERM");
                    this.activeJobId = null;
                    this.activeProcess = null;
                }
                this.dequeue(entry.name);
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
    enqueue(id) {
        if (!this.queue.includes(id)) {
            this.queue.push(id);
        }
    }
    dequeue(id) {
        this.queue = this.queue.filter((queuedId) => queuedId !== id);
    }
    pumpQueue() {
        if (this.activeJobId || !config_1.default.hlsEnabled) {
            return;
        }
        const nextId = this.queue.shift();
        if (!nextId) {
            return;
        }
        const video = this.videos.get(nextId);
        if (!video) {
            this.states.delete(nextId);
            this.pumpQueue();
            return;
        }
        void this.startJob(video);
    }
    async startJob(video) {
        const outputDir = this.getOutputDir(video.id);
        const playlistPath = this.getPlaylistPath(video.id);
        await promises_1.default.rm(outputDir, { recursive: true, force: true });
        await promises_1.default.mkdir(outputDir, { recursive: true });
        this.setState(video.id, "preparing", 0, null);
        const job = this.createJob(video, playlistPath);
        this.jobs.set(video.id, job);
    }
    attachProgressListener(video, process) {
        let buffer = "";
        const durationSeconds = video.durationSeconds;
        process.stdout.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";
            for (const line of lines) {
                const [key, ...valueParts] = line.split("=");
                const value = valueParts.join("=");
                if (!key || !value) {
                    continue;
                }
                if (key === "out_time_ms" || key === "out_time_us" || key === "out_time") {
                    const currentSeconds = (0, ffmpeg_1.parseFfmpegTimestampToSeconds)(value);
                    if (currentSeconds !== null &&
                        durationSeconds !== null &&
                        Number.isFinite(durationSeconds) &&
                        durationSeconds > 0) {
                        const progress = Math.max(0, Math.min(99, Math.round((currentSeconds / durationSeconds) * 100)));
                        this.setState(video.id, "preparing", progress, null);
                    }
                }
            }
        });
    }
    setState(id, status, progress, error) {
        this.states.set(id, {
            status,
            progress,
            error
        });
    }
}
exports.default = HlsManager;
