const { spawn } = require("child_process");

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

    return Number(result.stdout.trim());
  } catch {
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
  return spawn("ffmpeg", [
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
  ], {
    stdio: ["ignore", "ignore", "pipe"]
  });
}

module.exports = {
  ensureThumbnail,
  probeDuration,
  spawnHls
};
