import fs from "node:fs";
import path from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import mime from "mime-types";
import morgan from "morgan";

import config from "./config";
import HlsManager from "./hls-manager";
import VideoLibrary from "./library";
import type { HealthResponse, LibraryItem, PublicLibraryItem, VideosResponse } from "./types";

async function main(): Promise<void> {
  const app = express();
  const library = new VideoLibrary();
  const hlsManager = new HlsManager();

  await library.init();
  await hlsManager.sync(library.getItems());

  app.use(morgan("dev"));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use("/thumbs", express.static(config.thumbnailsPath, { fallthrough: false }));

  app.get("/api/videos", (_req: Request, res: Response<VideosResponse>) => {
    res.json({
      items: serializeItems(library.getItems(), hlsManager),
      status: library.getStatus()
    });
  });

  app.post("/api/rescan", async (_req: Request, res: Response<VideosResponse>, next: NextFunction) => {
    try {
      const items = await library.scan();
      await hlsManager.sync(items);
      res.json({
        items: serializeItems(items, hlsManager),
        status: library.getStatus()
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/health", (_req: Request, res: Response<HealthResponse>) => {
    res.json({
      ok: true,
      ...library.getStatus()
    });
  });

  app.get("/stream/:id", (req: Request<{ id: string }>, res: Response) => {
    const video = library.getItem(req.params.id);
    if (!video) {
      res.status(404).json({ error: "Video not found" });
      return;
    }

    serveRangeFile(video.path, res, req.headers.range);
  });

  app.get("/hls/:id/master.m3u8", async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    if (!config.hlsEnabled) {
      res.status(404).json({ error: "HLS is disabled" });
      return;
    }

    const video = library.getItem(req.params.id);
    if (!video) {
      res.status(404).json({ error: "Video not found" });
      return;
    }

    try {
      const { playlistPath } = await hlsManager.ensureReady(video);
      res.type("application/vnd.apple.mpegurl");
      fs.createReadStream(playlistPath).pipe(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "HLS playlist is not ready yet";
      const status = message.includes("not ready yet") ? 409 : 500;
      res.status(status).json({
        error: status === 409 ? "Fallback is still preparing" : "Internal server error",
        detail: message
      });
    }
  });

  app.get("/hls/:id/:segment", (req: Request<{ id: string; segment: string }>, res: Response) => {
    const baseDir = path.resolve(path.join(config.hlsPath, req.params.id));
    const segmentPath = path.resolve(baseDir, req.params.segment);
    if (!segmentPath.startsWith(baseDir)) {
      res.status(400).json({ error: "Invalid segment path" });
      return;
    }

    if (!fs.existsSync(segmentPath)) {
      res.status(404).json({ error: "Segment not found" });
      return;
    }

    res.type(path.extname(segmentPath) === ".m3u8" ? "application/vnd.apple.mpegurl" : "video/mp2t");
    fs.createReadStream(segmentPath).pipe(res);
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).json({
      error: "Internal server error",
      detail: error.message
    });
  });

  app.listen(config.port, () => {
    console.log(`Video server listening on http://localhost:${config.port}`);
    console.log(`Library path: ${config.videoLibraryPath}`);
  });
}

function serializeItems(items: LibraryItem[], hlsManager: HlsManager): PublicLibraryItem[] {
  return items.map((item) => {
    const fallbackStatus = hlsManager.getState(item);

    return {
      id: item.id,
      filename: item.filename,
      size: item.size,
      modifiedAt: item.modifiedAt,
      durationSeconds: item.durationSeconds,
      durationLabel: item.durationLabel,
      directPlaySupported: item.directPlaySupported,
      thumbnailUrl: item.thumbnailExists ? `/thumbs/${item.id}.jpg` : null,
      streamUrl: `/stream/${item.id}`,
      hlsUrl: config.hlsEnabled ? `/hls/${item.id}/master.m3u8` : null,
      fallbackStatus,
      fallbackReady: fallbackStatus === "ready" || fallbackStatus === "not_needed",
      fallbackPreparing: fallbackStatus === "preparing"
    };
  });
}

function serveRangeFile(filePath: string, res: Response, rangeHeader: string | undefined): void {
  const stat = fs.statSync(filePath);
  const contentType = mime.lookup(filePath) || "application/octet-stream";

  if (!rangeHeader) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const [startText, endText] = rangeHeader.replace(/bytes=/, "").split("-");
  const start = Number(startText);
  const end = endText ? Number(endText) : stat.size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
    res.status(416).set("Content-Range", `bytes */${stat.size}`).end();
    return;
  }

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Type": contentType
  });

  fs.createReadStream(filePath, { start, end }).pipe(res);
}

void main().catch((error: Error) => {
  console.error(error);
  process.exitCode = 1;
});
