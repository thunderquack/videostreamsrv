"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeDuration = probeDuration;
exports.ensureThumbnail = ensureThumbnail;
exports.spawnHls = spawnHls;
exports.parseFfmpegTimestampToSeconds = parseFfmpegTimestampToSeconds;
const node_child_process_1 = require("node:child_process");
function runProcess(command, args) {
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(command, args, {
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error(`${command} exited with code ${code}: ${stderr}`));
        });
    });
}
async function probeDuration(filePath) {
    try {
        const result = await runProcess("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            filePath
        ]);
        const duration = Number(result.stdout.trim());
        return Number.isFinite(duration) ? duration : null;
    }
    catch {
        return null;
    }
}
async function ensureThumbnail(inputPath, outputPath, timestamp) {
    await runProcess("ffmpeg", [
        "-y",
        "-ss",
        String(timestamp),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-1",
        outputPath
    ]);
}
function spawnHls(inputPath, outputPlaylistPath) {
    const child = (0, node_child_process_1.spawn)("ffmpeg", [
        "-y",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-preset",
        "veryfast",
        "-force_key_frames",
        "expr:gte(t,n_forced*6)",
        "-sc_threshold",
        "0",
        "-f",
        "hls",
        "-hls_time",
        "6",
        "-hls_list_size",
        "0",
        "-hls_playlist_type",
        "vod",
        "-hls_flags",
        "independent_segments",
        "-hls_segment_filename",
        outputPlaylistPath.replace("master.m3u8", "segment-%03d.ts"),
        "-progress",
        "pipe:1",
        "-nostats",
        outputPlaylistPath
    ], {
        stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
    });
    const done = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        });
    });
    return {
        process: child,
        done
    };
}
function parseFfmpegTimestampToSeconds(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    if (/^\d+$/.test(trimmed)) {
        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        if (trimmed.endsWith("000") && numeric > 1000000) {
            return numeric / 1000000;
        }
        return numeric / 1000000;
    }
    const match = trimmed.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (!match) {
        return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (![hours, minutes, seconds].every(Number.isFinite)) {
        return null;
    }
    return hours * 3600 + minutes * 60 + seconds;
}
