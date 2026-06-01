# Video Stream Server

Simple local video streaming server for a small personal library.

## Features

- Reads video files from a single folder
- Generates thumbnails with `ffmpeg`
- Shows a small-card gallery in the browser
- Plays supported files directly
- Falls back to HLS transcoding for incompatible files

## Run with Docker

```bash
docker compose up --build
```

Open `http://localhost:3000`.

Put your videos into `./videos` or mount another folder in `docker-compose.yml`.

## Run locally

```bash
npm install
npm start
```

Environment variables:

- `PORT`
- `VIDEO_LIBRARY_PATH`
- `CACHE_PATH`
- `THUMBNAIL_TIMESTAMP`
- `HLS_ENABLED`
