"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const gallery = getRequiredElement("gallery");
const statusBox = getRequiredElement("status");
const rescanButton = getRequiredElement("rescanButton");
const modal = getRequiredElement("playerModal");
const closeButton = getRequiredElement("closeButton");
const player = getRequiredElement("player");
const playerTitle = getRequiredElement("playerTitle");
const playerMeta = getRequiredElement("playerMeta");
const playerMode = getRequiredElement("playerMode");
let currentHls = null;
let currentPlaybackRequest = 0;
async function loadVideos() {
    setStatus("Loading library...");
    const response = await fetch("/api/videos");
    const payload = (await response.json());
    renderStatus(payload.status, payload.items.length);
    renderGallery(payload.items);
}
async function rescan() {
    rescanButton.disabled = true;
    setStatus("Rescanning...");
    try {
        const response = await fetch("/api/rescan", { method: "POST" });
        const payload = (await response.json());
        renderStatus(payload.status, payload.items.length);
        renderGallery(payload.items);
    }
    finally {
        rescanButton.disabled = false;
    }
}
function renderStatus(status, countOverride) {
    const count = typeof countOverride === "number" ? countOverride : status.videoCount;
    const scannedAt = status.lastScanAt ? new Date(status.lastScanAt).toLocaleString() : "never";
    statusBox.textContent = `${count} videos in library. Last scan: ${scannedAt}`;
}
function setStatus(text) {
    statusBox.textContent = text;
}
function renderGallery(items) {
    if (!items.length) {
        gallery.innerHTML =
            '<article class="card"><div class="card-content"><p class="card-meta">No video files found in the library folder.</p></div></article>';
        return;
    }
    gallery.innerHTML = items
        .map((item) => `
    <article class="card">
      <div class="poster">
        ${item.thumbnailUrl
        ? `<img src="${item.thumbnailUrl}" alt="${escapeHtml(item.filename)}" loading="lazy" />`
        : '<div class="poster-placeholder">No thumbnail</div>'}
      </div>
      <div class="card-content">
        <h2 class="card-title">${escapeHtml(item.filename)}</h2>
        <p class="card-meta">${item.durationLabel || "Unknown duration"}${item.directPlaySupported
        ? " • Direct play"
        : item.fallbackPreparing
            ? " • Preparing HLS"
            : item.fallbackStatus === "error"
                ? " • HLS error"
                : " • HLS fallback"}</p>
        <button class="play-button" data-video-id="${item.id}">Play</button>
      </div>
    </article>
  `)
        .join("");
    for (const button of gallery.querySelectorAll("[data-video-id]")) {
        button.addEventListener("click", () => {
            const item = items.find((entry) => entry.id === button.dataset.videoId);
            if (item) {
                void openPlayer(item);
            }
        });
    }
}
async function openPlayer(item) {
    currentPlaybackRequest += 1;
    const requestId = currentPlaybackRequest;
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
        }
        catch {
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
    if (!item.fallbackReady) {
        playerMode.textContent = item.fallbackPreparing
            ? "Preparing full video for seeking..."
            : "Waiting for HLS fallback to become ready...";
        const readyItem = await waitForFallbackReady(item.id, requestId);
        if (!readyItem) {
            return;
        }
        playerMode.textContent = "Starting HLS fallback";
        await startHls(readyItem.hlsUrl || item.hlsUrl);
        return;
    }
    playerMode.textContent = "Starting HLS fallback";
    await startHls(item.hlsUrl);
}
async function startHls(url) {
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
function closePlayer() {
    currentPlaybackRequest += 1;
    destroyHls();
    player.pause();
    player.removeAttribute("src");
    player.load();
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
}
function destroyHls() {
    if (currentHls) {
        currentHls.destroy();
        currentHls = null;
    }
}
async function waitForFallbackReady(id, requestId) {
    while (requestId === currentPlaybackRequest && !modal.classList.contains("hidden")) {
        const response = await fetch("/api/videos");
        const payload = (await response.json());
        const item = payload.items.find((entry) => entry.id === id);
        if (!item) {
            playerMode.textContent = "Video is no longer available";
            return null;
        }
        if (item.fallbackStatus === "error") {
            playerMode.textContent = "Failed to prepare fallback video";
            return null;
        }
        if (item.fallbackReady && item.hlsUrl) {
            return item;
        }
        await delay(2000);
    }
    return null;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
function getRequiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required element: ${id}`);
    }
    return element;
}
rescanButton.addEventListener("click", () => {
    void rescan();
});
closeButton.addEventListener("click", closePlayer);
modal.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.closeModal) {
        closePlayer();
    }
});
void loadVideos().catch((error) => {
    console.error(error);
    setStatus("Failed to load library");
});
