import Hls from "hls.js/dist/hls.mjs";

interface PublicLibraryItem {
  id: string;
  filename: string;
  size: number;
  modifiedAt: string;
  durationSeconds: number | null;
  durationLabel: string | null;
  directPlaySupported: boolean;
  thumbnailUrl: string | null;
  streamUrl: string;
  hlsUrl: string | null;
  cacheStatus: "queued" | "preparing" | "ready" | "error";
  cacheProgress: number | null;
  playEnabled: boolean;
}

interface LibraryStatus {
  videoCount: number;
  lastScanAt: string | null;
}

interface VideosResponse {
  items: PublicLibraryItem[];
  status: LibraryStatus;
}

export {};

const gallery = getRequiredElement<HTMLDivElement>("gallery");
const statusBox = getRequiredElement<HTMLElement>("status");
const rescanButton = getRequiredElement<HTMLButtonElement>("rescanButton");
const modal = getRequiredElement<HTMLDivElement>("playerModal");
const closeButton = getRequiredElement<HTMLButtonElement>("closeButton");
const player = getRequiredElement<HTMLVideoElement>("player");
const playerTitle = getRequiredElement<HTMLElement>("playerTitle");
const playerMeta = getRequiredElement<HTMLElement>("playerMeta");
const playerMode = getRequiredElement<HTMLElement>("playerMode");

let currentHls: Hls | null = null;
let currentPlaybackRequest = 0;
let latestItems: PublicLibraryItem[] = [];
let pollingHandle: number | null = null;

async function loadVideos(): Promise<void> {
  const showLoading = latestItems.length === 0;
  if (showLoading) {
    setStatus("Loading library...");
  }

  const response = await fetch("/api/videos");
  const payload = (await response.json()) as VideosResponse;
  latestItems = payload.items;
  renderStatus(payload.status, payload.items.length);
  renderGallery(payload.items);
}

async function rescan(): Promise<void> {
  rescanButton.disabled = true;
  setStatus("Rescanning...");

  try {
    const response = await fetch("/api/rescan", { method: "POST" });
    const payload = (await response.json()) as VideosResponse;
    latestItems = payload.items;
    renderStatus(payload.status, payload.items.length);
    renderGallery(payload.items);
  } finally {
    rescanButton.disabled = false;
  }
}

function renderStatus(status: LibraryStatus, countOverride?: number): void {
  const count = typeof countOverride === "number" ? countOverride : status.videoCount;
  const scannedAt = status.lastScanAt ? new Date(status.lastScanAt).toLocaleString() : "never";
  statusBox.textContent = `${count} videos in library. Last scan: ${scannedAt}`;
}

function setStatus(text: string): void {
  statusBox.textContent = text;
}

function renderGallery(items: PublicLibraryItem[]): void {
  if (!items.length) {
    gallery.innerHTML =
      '<article class="card"><div class="card-content"><p class="card-meta">No video files found in the library folder.</p></div></article>';
    return;
  }

  gallery.innerHTML = items
    .map(
      (item) => `
    <article class="card">
      <div class="poster">
        ${
          item.thumbnailUrl
            ? `<img src="${item.thumbnailUrl}" alt="${escapeHtml(item.filename)}" loading="lazy" />`
            : '<div class="poster-placeholder">No thumbnail</div>'
        }
      </div>
      <div class="card-content">
        <h2 class="card-title">${escapeHtml(item.filename)}</h2>
        <p class="card-meta">${item.durationLabel || "Unknown duration"} • ${describeCacheStatus(item)}</p>
        <button class="play-button${item.playEnabled ? "" : " is-disabled"}" data-video-id="${item.id}" ${
          item.playEnabled ? "" : "disabled"
        }>${item.playEnabled ? "Play" : describePlayLabel(item)}</button>
      </div>
    </article>
  `
    )
    .join("");

  for (const button of gallery.querySelectorAll<HTMLButtonElement>("[data-video-id]")) {
    button.addEventListener("click", () => {
      const item = items.find((entry) => entry.id === button.dataset.videoId);
      if (item) {
        void openPlayer(item);
      }
    });
  }
}

async function openPlayer(item: PublicLibraryItem): Promise<void> {
  if (!item.playEnabled) {
    return;
  }

  currentPlaybackRequest += 1;
  destroyHls();
  player.pause();
  player.removeAttribute("src");
  player.load();

  playerTitle.textContent = item.filename;
  playerMeta.textContent = item.durationLabel || "Unknown duration";
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  if (item.directPlaySupported) {
    playerMode.textContent = "Trying direct play";
    player.src = item.streamUrl;

    try {
      await player.play();
      playerMode.textContent = "Playing original file";
      return;
    } catch {
      if (!item.hlsUrl) {
        playerMode.textContent = "Direct play failed";
        return;
      }
    }
  }

  if (!item.hlsUrl) {
    playerMode.textContent = "No compatible playback mode available";
    return;
  }

  playerMode.textContent = "Starting HLS fallback";
  await startHls(item.hlsUrl);
}

async function startHls(url: string): Promise<void> {
  if (Hls.isSupported()) {
    const hls = new Hls();
    currentHls = hls;
    hls.loadSource(url);
    hls.attachMedia(player);
    hls.on(Hls.Events.MANIFEST_PARSED, async () => {
      await player.play();
      playerMode.textContent = "Playing HLS fallback";
    });
    return;
  }

  if (player.canPlayType("application/vnd.apple.mpegurl")) {
    player.src = url;
    await player.play();
    playerMode.textContent = "Playing HLS fallback";
    return;
  }

  playerMode.textContent = "Browser does not support HLS playback";
}

function closePlayer(): void {
  currentPlaybackRequest += 1;
  destroyHls();
  player.pause();
  player.removeAttribute("src");
  player.load();
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function destroyHls(): void {
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
}

async function waitForFallbackReady(id: string, requestId: number): Promise<PublicLibraryItem | null> {
  const item = latestItems.find((entry) => entry.id === id);
  return requestId === currentPlaybackRequest ? item || null : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeCacheStatus(item: PublicLibraryItem): string {
  if (item.cacheStatus === "ready") {
    return "Cached";
  }

  if (item.cacheStatus === "error") {
    return "Cache error";
  }

  if (item.cacheStatus === "queued") {
    return "Queued";
  }

  if (item.cacheProgress !== null) {
    return `Caching ${item.cacheProgress}%`;
  }

  return "Caching";
}

function describePlayLabel(item: PublicLibraryItem): string {
  if (item.cacheStatus === "error") {
    return "Cache Error";
  }

  if (item.cacheStatus === "queued") {
    return "Queued";
  }

  if (item.cacheProgress !== null) {
    return `Caching ${item.cacheProgress}%`;
  }

  return "Caching";
}

function startPolling(): void {
  if (pollingHandle !== null) {
    return;
  }

  pollingHandle = window.setInterval(() => {
    void loadVideos().catch((error: unknown) => {
      console.error(error);
    });
  }, 2000);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getRequiredElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as TElement;
}

rescanButton.addEventListener("click", () => {
  void rescan();
});
closeButton.addEventListener("click", closePlayer);
modal.addEventListener("click", (event: MouseEvent) => {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset.closeModal) {
    closePlayer();
  }
});

void loadVideos().catch((error: unknown) => {
  console.error(error);
  setStatus("Failed to load library");
});
startPolling();
