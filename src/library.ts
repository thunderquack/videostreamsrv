import fs from "node:fs/promises";
import path from "node:path";

import config from "./config";
import { ensureThumbnail, probeDuration } from "./ffmpeg";
import type { LibraryItem, LibraryStatus } from "./types";
import { createVideoId, formatDuration, isVideoFile, supportsDirectPlay } from "./video-utils";

export default class VideoLibrary {
  private items: LibraryItem[] = [];

  private byId = new Map<string, LibraryItem>();

  private lastScanAt: string | null = null;

  async init(): Promise<void> {
    await fs.mkdir(config.cachePath, { recursive: true });
    await fs.mkdir(config.thumbnailsPath, { recursive: true });
    await fs.mkdir(config.hlsPath, { recursive: true });
    await fs.mkdir(config.videoLibraryPath, { recursive: true });
    await this.scan();
  }

  async scan(): Promise<LibraryItem[]> {
    const entries = await fs.readdir(config.videoLibraryPath, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && isVideoFile(entry.name));
    const items: LibraryItem[] = [];

    for (const file of files) {
      const absolutePath = path.join(config.videoLibraryPath, file.name);
      const stats = await fs.stat(absolutePath);
      const id = createVideoId(file.name);
      const thumbnailPath = path.join(config.thumbnailsPath, `${id}.jpg`);
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
    return this.getItems();
  }

  getItems(): LibraryItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  getItem(id: string): LibraryItem | null {
    return this.byId.get(id) || null;
  }

  getStatus(): LibraryStatus {
    return {
      videoCount: this.items.length,
      lastScanAt: this.lastScanAt
    };
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
