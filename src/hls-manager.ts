import fs from "node:fs/promises";
import path from "node:path";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import config from "./config";
import { parseFfmpegTimestampToSeconds, spawnHls } from "./ffmpeg";
import type { CacheState, HlsCacheMetadata, HlsJob, LibraryItem } from "./types";

export default class HlsManager {
  private jobs = new Map<string, HlsJob>();

  private states = new Map<string, CacheState>();

  private queue: string[] = [];

  private activeProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;

  private activeJobId: string | null = null;

  private videos = new Map<string, LibraryItem>();

  async sync(videos: LibraryItem[]): Promise<void> {
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

  getState(video: LibraryItem): CacheState {
    return this.states.get(video.id) || {
      status: "queued",
      progress: 0,
      error: null
    };
  }

  async ensureReady(video: LibraryItem): Promise<{ outputDir: string; playlistPath: string }> {
    const outputDir = path.join(config.hlsPath, video.id);
    const playlistPath = path.join(outputDir, "master.m3u8");

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

  private async syncVideo(video: LibraryItem): Promise<void> {
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

  private createJob(video: LibraryItem, playlistPath: string): HlsJob {
    const outputDir = this.getOutputDir(video.id);
    const { process, done } = spawnHls(video.path, playlistPath);
    this.activeProcess = process;
    this.activeJobId = video.id;
    this.attachProgressListener(video, process);

    const ready = done
      .then(async () => {
        const playlist = await fs.readFile(playlistPath, "utf8");
        if (!playlist.includes("#EXT-X-ENDLIST")) {
          throw new Error("Generated HLS playlist is incomplete");
        }

        if (!this.videos.has(video.id)) {
          await fs.rm(outputDir, { recursive: true, force: true });
          return;
        }

        await this.writeMetadata(video);
        this.setState(video.id, "ready", 100, null);
      })
      .catch(async (error: unknown) => {
        if (!this.videos.has(video.id)) {
          await fs.rm(outputDir, { recursive: true, force: true });
          return;
        }

        this.setState(video.id, "error", 0, error instanceof Error ? error.message : "HLS generation failed");
        await fs.rm(outputDir, { recursive: true, force: true });
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

  private async cleanupRemovedEntries(validIds: Set<string>): Promise<void> {
    const entries = await fs.readdir(config.hlsPath, { withFileTypes: true });

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
        await fs.rm(path.join(config.hlsPath, entry.name), { recursive: true, force: true });
        this.states.delete(entry.name);
        this.jobs.delete(entry.name);
      }
    }
  }

  private async isReady(video: LibraryItem): Promise<boolean> {
    const playlistPath = this.getPlaylistPath(video.id);
    const metadataPath = this.getMetadataPath(video.id);

    try {
      const [playlist, metadataRaw] = await Promise.all([
        fs.readFile(playlistPath, "utf8"),
        fs.readFile(metadataPath, "utf8")
      ]);
      const metadata = JSON.parse(metadataRaw) as HlsCacheMetadata;

      return (
        metadata.sourcePath === video.path &&
        metadata.size === video.size &&
        metadata.modifiedAt === video.modifiedAt &&
        playlist.includes("#EXT-X-ENDLIST")
      );
    } catch {
      return false;
    }
  }

  private async writeMetadata(video: LibraryItem): Promise<void> {
    const metadata: HlsCacheMetadata = {
      sourcePath: video.path,
      size: video.size,
      modifiedAt: video.modifiedAt
    };

    await fs.writeFile(this.getMetadataPath(video.id), JSON.stringify(metadata), "utf8");
  }

  private getOutputDir(id: string): string {
    return path.join(config.hlsPath, id);
  }

  private getPlaylistPath(id: string): string {
    return path.join(this.getOutputDir(id), "master.m3u8");
  }

  private getMetadataPath(id: string): string {
    return path.join(this.getOutputDir(id), "source.json");
  }

  private enqueue(id: string): void {
    if (!this.queue.includes(id)) {
      this.queue.push(id);
    }
  }

  private dequeue(id: string): void {
    this.queue = this.queue.filter((queuedId) => queuedId !== id);
  }

  private pumpQueue(): void {
    if (this.activeJobId || !config.hlsEnabled) {
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

  private async startJob(video: LibraryItem): Promise<void> {
    const outputDir = this.getOutputDir(video.id);
    const playlistPath = this.getPlaylistPath(video.id);

    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });
    this.setState(video.id, "preparing", 0, null);
    const job = this.createJob(video, playlistPath);
    this.jobs.set(video.id, job);
  }

  private attachProgressListener(
    video: LibraryItem,
    process: ChildProcessByStdio<null, Readable, Readable>
  ): void {
    let buffer = "";
    const durationSeconds = video.durationSeconds;

    process.stdout.on("data", (chunk: Buffer) => {
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
          const currentSeconds = parseFfmpegTimestampToSeconds(value);
          if (
            currentSeconds !== null &&
            durationSeconds !== null &&
            Number.isFinite(durationSeconds) &&
            durationSeconds > 0
          ) {
            const progress = Math.max(0, Math.min(99, Math.round((currentSeconds / durationSeconds) * 100)));
            this.setState(video.id, "preparing", progress, null);
          }
        }
      }
    });
  }

  private setState(id: string, status: CacheState["status"], progress: number | null, error: string | null): void {
    this.states.set(id, {
      status,
      progress,
      error
    });
  }
}
