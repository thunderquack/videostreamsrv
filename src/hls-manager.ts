import fs from "node:fs/promises";
import path from "node:path";

import config from "./config";
import { spawnHls } from "./ffmpeg";
import type { FallbackStatus, HlsCacheMetadata, HlsJob, LibraryItem } from "./types";

export default class HlsManager {
  private jobs = new Map<string, HlsJob>();

  private states = new Map<string, FallbackStatus>();

  async sync(videos: LibraryItem[]): Promise<void> {
    const knownIds = new Set(videos.map((video) => video.id));
    await this.cleanupRemovedEntries(knownIds);

    for (const video of videos) {
      if (video.directPlaySupported || !config.hlsEnabled) {
        this.states.set(video.id, "not_needed");
        continue;
      }

      await this.ensurePrepared(video);
    }
  }

  getState(video: LibraryItem): FallbackStatus {
    if (!config.hlsEnabled || video.directPlaySupported) {
      return "not_needed";
    }

    return this.states.get(video.id) || "preparing";
  }

  async ensureReady(video: LibraryItem): Promise<{ outputDir: string; playlistPath: string }> {
    const outputDir = path.join(config.hlsPath, video.id);
    const playlistPath = path.join(outputDir, "master.m3u8");

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

  private async ensurePrepared(video: LibraryItem): Promise<void> {
    const outputDir = this.getOutputDir(video.id);
    const playlistPath = this.getPlaylistPath(video.id);

    if (await this.isReady(video)) {
      this.states.set(video.id, "ready");
      return;
    }

    let job = this.jobs.get(video.id);
    if (!job) {
      await fs.rm(outputDir, { recursive: true, force: true });
      await fs.mkdir(outputDir, { recursive: true });
      this.states.set(video.id, "preparing");
      job = this.createJob(video, playlistPath);
      this.jobs.set(video.id, job);
    }
  }

  private createJob(video: LibraryItem, playlistPath: string): HlsJob {
    const outputDir = this.getOutputDir(video.id);
    const { process, done } = spawnHls(video.path, playlistPath);

    const ready = done
      .then(async () => {
        const playlist = await fs.readFile(playlistPath, "utf8");
        if (!playlist.includes("#EXT-X-ENDLIST")) {
          throw new Error("Generated HLS playlist is incomplete");
        }

        await this.writeMetadata(video);
        this.states.set(video.id, "ready");
      })
      .catch(async (error: unknown) => {
        this.states.set(video.id, "error");
        await fs.rm(outputDir, { recursive: true, force: true });
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

  private async cleanupRemovedEntries(validIds: Set<string>): Promise<void> {
    const entries = await fs.readdir(config.hlsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (!validIds.has(entry.name)) {
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
}
