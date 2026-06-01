import path from "node:path";

import type { AppConfig } from "./types";

const rootDir = path.resolve(__dirname, "..");

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

const cacheRoot = path.resolve(process.env.CACHE_PATH || path.join(rootDir, "cache"));

const config: AppConfig = {
  port: Number(process.env.PORT || 3000),
  videoLibraryPath: path.resolve(process.env.VIDEO_LIBRARY_PATH || path.join(rootDir, "videos")),
  cachePath: cacheRoot,
  thumbnailsPath: path.resolve(cacheRoot, "thumbs"),
  hlsPath: path.resolve(cacheRoot, "hls"),
  thumbnailTimestamp: Number(process.env.THUMBNAIL_TIMESTAMP || 15),
  hlsEnabled: parseBoolean(process.env.HLS_ENABLED, true)
};

export default config;
