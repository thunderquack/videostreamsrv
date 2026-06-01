const gallery = document.getElementById("gallery");
const statusBox = document.getElementById("status");
const rescanButton = document.getElementById("rescanButton");
const modal = document.getElementById("playerModal");
const closeButton = document.getElementById("closeButton");
const player = document.getElementById("player");
const playerTitle = document.getElementById("playerTitle");
const playerMeta = document.getElementById("playerMeta");
const playerMode = document.getElementById("playerMode");

let currentHls = null;

async function loadVideos() {
  setStatus("Loading library...");
  const response = await fetch("/api/videos");
  const payload = await response.json();
  renderStatus(payload.status, payload.items.length);
  renderGallery(payload.items);
}

async function rescan() {
  rescanButton.disabled = true;
  setStatus("Rescanning...");

  try {
    const response = await fetch("/api/rescan", { method: "POST" });
    const payload = await response.json();
    renderStatus(payload.status, payload.items.length);
    renderGallery(payload.items);
  } finally {
    rescanButton.disabled = false;
  }
}

function renderStatus(status, countText) {
  const count = typeof countText === "number" ? countText : status.videoCount;
  const scannedAt = status.lastScanAt ? new Date(status.lastScanAt).toLocaleString() : "never";
  statusBox.textContent = `${count} videos in library. Last scan: ${scannedAt}`;
}

function setStatus(text) {
  statusBox.textContent = text;
}

function renderGallery(items) {
  if (!items.length) {
    gallery.innerHTML = '<article class="card"><div class="card-content"><p class="card-meta">No video files found in the library folder.</p></div></article>';
    return;
  }

  gallery.innerHTML = items.map((item) => `
    <article class="card">
      <div class="poster">
        ${item.thumbnailUrl
          ? `<img src="${item.thumbnailUrl}" alt="${escapeHtml(item.filename)}" loading="lazy" />`
          : '<div class="poster-placeholder">No thumbnail</div>'}
      </div>
      <div class="card-content">
        <h2 class="card-title">${escapeHtml(item.filename)}</h2>
        <p class="card-meta">${item.durationLabel || "Unknown duration"}${item.directPlaySupported ? " • Direct play" : " • HLS fallback"}</p>
        <button class="play-button" data-video-id="${item.id}">Play</button>
      </div>
    </article>
  `).join("");

  for (const button of gallery.querySelectorAll("[data-video-id]")) {
    button.addEventListener("click", () => {
      const item = items.find((entry) => entry.id === button.dataset.videoId);
      if (item) {
        openPlayer(item);
      }
    });
  }
}

async function openPlayer(item) {
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

async function startHls(url) {
  if (window.Hls && window.Hls.isSupported()) {
    currentHls = new window.Hls();
    currentHls.loadSource(url);
    currentHls.attachMedia(player);
    currentHls.on(window.Hls.Events.MANIFEST_PARSED, async () => {
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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

rescanButton.addEventListener("click", rescan);
closeButton.addEventListener("click", closePlayer);
modal.addEventListener("click", (event) => {
  if (event.target.dataset.closeModal) {
    closePlayer();
  }
});

loadVideos().catch((error) => {
  console.error(error);
  setStatus("Failed to load library");
});
