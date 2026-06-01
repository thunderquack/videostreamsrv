import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

interface ProcessResult {
  stdout: string;
  stderr: string;
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

export function spawnHls(
  inputPath: string,
  outputPlaylistPath: string
): ChildProcessByStdio<null, Readable, Readable> {
  return spawn(
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
      "-movflags",
      "+faststart",
      "-f",
      "hls",
      "-hls_time",
      "6",
      "-hls_list_size",
      "0",
      "-hls_segment_filename",
      outputPlaylistPath.replace("master.m3u8", "segment-%03d.ts"),
      outputPlaylistPath
    ],
    {
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
}
