"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const mime_types_1 = __importDefault(require("mime-types"));
const morgan_1 = __importDefault(require("morgan"));
const config_1 = __importDefault(require("./config"));
const hls_manager_1 = __importDefault(require("./hls-manager"));
const library_1 = __importDefault(require("./library"));
async function main() {
    const app = (0, express_1.default)();
    const library = new library_1.default();
    const hlsManager = new hls_manager_1.default();
    await library.init();
    app.use((0, morgan_1.default)("dev"));
    app.use(express_1.default.json());
    app.use(express_1.default.static(node_path_1.default.join(__dirname, "..", "public")));
    app.use("/thumbs", express_1.default.static(config_1.default.thumbnailsPath, { fallthrough: false }));
    app.get("/api/videos", (_req, res) => {
        res.json({
            items: library.getPublicItems(),
            status: library.getStatus()
        });
    });
    app.post("/api/rescan", async (_req, res, next) => {
        try {
            const items = await library.scan();
            res.json({
                items,
                status: library.getStatus()
            });
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/health", (_req, res) => {
        res.json({
            ok: true,
            ...library.getStatus()
        });
    });
    app.get("/stream/:id", (req, res) => {
        const video = library.getItem(req.params.id);
        if (!video) {
            res.status(404).json({ error: "Video not found" });
            return;
        }
        serveRangeFile(video.path, res, req.headers.range);
    });
    app.get("/hls/:id/master.m3u8", async (req, res, next) => {
        if (!config_1.default.hlsEnabled) {
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
            node_fs_1.default.createReadStream(playlistPath).pipe(res);
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/hls/:id/:segment", (req, res) => {
        const baseDir = node_path_1.default.resolve(node_path_1.default.join(config_1.default.hlsPath, req.params.id));
        const segmentPath = node_path_1.default.resolve(baseDir, req.params.segment);
        if (!segmentPath.startsWith(baseDir)) {
            res.status(400).json({ error: "Invalid segment path" });
            return;
        }
        if (!node_fs_1.default.existsSync(segmentPath)) {
            res.status(404).json({ error: "Segment not found" });
            return;
        }
        res.type(node_path_1.default.extname(segmentPath) === ".m3u8" ? "application/vnd.apple.mpegurl" : "video/mp2t");
        node_fs_1.default.createReadStream(segmentPath).pipe(res);
    });
    app.use((error, _req, res, _next) => {
        console.error(error);
        res.status(500).json({
            error: "Internal server error",
            detail: error.message
        });
    });
    app.listen(config_1.default.port, () => {
        console.log(`Video server listening on http://localhost:${config_1.default.port}`);
        console.log(`Library path: ${config_1.default.videoLibraryPath}`);
    });
}
function serveRangeFile(filePath, res, rangeHeader) {
    const stat = node_fs_1.default.statSync(filePath);
    const contentType = mime_types_1.default.lookup(filePath) || "application/octet-stream";
    if (!rangeHeader) {
        res.writeHead(200, {
            "Content-Length": stat.size,
            "Content-Type": contentType,
            "Accept-Ranges": "bytes"
        });
        node_fs_1.default.createReadStream(filePath).pipe(res);
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
    node_fs_1.default.createReadStream(filePath, { start, end }).pipe(res);
}
void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
