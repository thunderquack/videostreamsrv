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
}

interface LibraryStatus {
  videoCount: number;
  lastScanAt: string | null;
}

interface VideosResponse {
  items: PublicLibraryItem[];
  status: LibraryStatus;
}

interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(media: HTMLVideoElement): void;
  on(event: string, handler: () => void | Promise<void>): void;
  destroy(): void;
}

interface HlsConstructor {
  new (): HlsInstance;
  isSupported(): boolean;
  Events: {
    MANIFEST_PARSED: string;
  };
}

declare global {
  interface Window {
    Hls?: HlsConstructor;
  }
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

let currentHls: HlsInstance | null = null;

async function loadVideos(): Promise<void> {
  setStatus("Loading library...");
  const response = await fetch("/api/videos");
  const payload = (await response.json()) as VideosResponse;
  renderStatus(payload.status, payload.items.length);
  renderGallery(payload.items);
}

async function rescan(): Promise<void> {
  rescanButton.disabled = true;
  setStatus("Rescanning...");

  try {
    const response = await fetch("/api/rescan", { method: "POST" });
    const payload = (await response.json()) as VideosResponse;
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
        <p class="card-meta">${item.durationLabel || "Unknown duration"}${
          item.directPlaySupported ? " • Direct play" : " • HLS fallback"
        }</p>
        <button class="play-button" data-video-id="${item.id}">Play</button>
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
  const Hls = window.Hls;

  if (Hls && Hls.isSupported()) {
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
