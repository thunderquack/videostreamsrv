const fs = require("fs/promises");
const path = require("path");

const config = require("./config");
const { ensureThumbnail, probeDuration } = require("./ffmpeg");
const { createVideoId, formatDuration, isVideoFile, supportsDirectPlay } = require("./video-utils");

class VideoLibrary {
  constructor() {
    this.items = [];
    this.byId = new Map();
    this.lastScanAt = null;
  }

  async init() {
    await fs.mkdir(config.cachePath, { recursive: true });
    await fs.mkdir(config.thumbnailsPath, { recursive: true });
    await fs.mkdir(config.hlsPath, { recursive: true });
    await fs.mkdir(config.videoLibraryPath, { recursive: true });
    await this.scan();
  }

  async scan() {
    const entries = await fs.readdir(config.videoLibraryPath, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && isVideoFile(entry.name));
    const items = [];

    for (const file of files) {
      const absolutePath = path.join(config.videoLibraryPath, file.name);
      const stats = await fs.stat(absolutePath);
      const id = createVideoId(file.name);
      const thumbnailFilename = `${id}.jpg`;
      const thumbnailPath = path.join(config.thumbnailsPath, thumbnailFilename);
      const durationSeconds = await probeDuration(absolutePath);

      try {
        await fs.access(thumbnailPath);
      } catch {
        try {
          await ensureThumbnail(absolutePath, thumbnailPath, config.thumbnailTimestamp);
        } catch {
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
        durationLabel: formatDuration(durationSeconds),
        directPlaySupported: supportsDirectPlay(file.name),
        thumbnailExists: await fileExists(thumbnailPath)
      });
    }

    items.sort((left, right) => left.filename.localeCompare(right.filename, undefined, { sensitivity: "base" }));
    this.items = items;
    this.byId = new Map(items.map((item) => [item.id, item]));
    this.lastScanAt = new Date().toISOString();
    return this.getPublicItems();
  }

  getPublicItems() {
    return this.items.map((item) => ({
      id: item.id,
      filename: item.filename,
      size: item.size,
      modifiedAt: item.modifiedAt,
      durationSeconds: item.durationSeconds,
      durationLabel: item.durationLabel,
      directPlaySupported: item.directPlaySupported,
      thumbnailUrl: item.thumbnailExists ? `/thumbs/${item.id}.jpg` : null,
      streamUrl: `/stream/${item.id}`,
      hlsUrl: config.hlsEnabled ? `/hls/${item.id}/master.m3u8` : null
    }));
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = VideoLibrary;
