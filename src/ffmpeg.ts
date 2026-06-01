import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

interface ProcessResult {
  stdout: string;
  stderr: string;
}

interface HlsProcess {
  process: ChildProcessByStdio<null, Readable, Readable>;
  done: Promise<void>;
}

function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
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

export async function probeDuration(filePath: string): Promise<number | null> {
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
  } catch {
    return null;
  }
}

export async function ensureThumbnail(inputPath: string, outputPath: string, timestamp: number): Promise<void> {
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

export function spawnHls(inputPath: string, outputPlaylistPath: string): HlsProcess {
  const child = spawn(
    "ffmpeg",
    [
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
    ],
    {
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const done = new Promise<void>((resolve, reject) => {
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

export function parseFfmpegTimestampToSeconds(value: string): number | null {
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
