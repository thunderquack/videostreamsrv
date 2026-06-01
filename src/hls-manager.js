const fs = require("fs/promises");
const path = require("path");

const config = require("./config");
const { spawnHls } = require("./ffmpeg");

class HlsManager {
  constructor() {
    this.jobs = new Map();
  }

  async ensureReady(video) {
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

  createJob(inputPath, playlistPath, id) {
    const child = spawnHls(inputPath, playlistPath);
    const ready = waitForPlaylist(playlistPath, child);

    child.stderr.on("data", () => {
      // ffmpeg logs are intentionally suppressed during normal operation.
    });

    child.on("close", () => {
      this.jobs.delete(id);
    });

    return { child, ready };
  }
}

async function waitForPlaylist(playlistPath, child) {
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

module.exports = HlsManager;
