const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function parseBoolean(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  videoLibraryPath: path.resolve(process.env.VIDEO_LIBRARY_PATH || path.join(rootDir, "videos")),
  cachePath: path.resolve(process.env.CACHE_PATH || path.join(rootDir, "cache")),
  thumbnailsPath: path.resolve(process.env.CACHE_PATH || path.join(rootDir, "cache"), "thumbs"),
  hlsPath: path.resolve(process.env.CACHE_PATH || path.join(rootDir, "cache"), "hls"),
  thumbnailTimestamp: Number(process.env.THUMBNAIL_TIMESTAMP || 15),
  hlsEnabled: parseBoolean(process.env.HLS_ENABLED, true)
};
