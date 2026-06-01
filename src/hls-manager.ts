import fs from "node:fs/promises";
import path from "node:path";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import config from "./config";
import { spawnHls } from "./ffmpeg";
import type { HlsJob, LibraryItem } from "./types";

export default class HlsManager {
  private jobs = new Map<string, HlsJob>();

  async ensureReady(video: LibraryItem): Promise<{ outputDir: string; playlistPath: string }> {
    const outputDir = path.join(config.hlsPath, video.id);
    const playlistPath = path.join(outputDir, "master.m3u8");
    await fs.mkdir(outputDir, { recursive: true });

    try {
      await fs.access(playlistPath);
      return { outputDir, playlistPath };
    } catch {
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

  private createJob(inputPath: string, playlistPath: string, id: string): HlsJob {
    const child = spawnHls(inputPath, playlistPath);
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

async function waitForPlaylist(
  playlistPath: string,
  child: ChildProcessByStdio<null, Readable, Readable>
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    try {
      await fs.access(playlistPath);
      return;
    } catch {
      if (child.exitCode !== null && child.exitCode !== 0) {
        throw new Error("HLS generation failed");
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error("Timed out waiting for HLS playlist");
}
