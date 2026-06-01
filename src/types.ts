export interface AppConfig {
  port: number;
  videoLibraryPath: string;
  cachePath: string;
  thumbnailsPath: string;
  hlsPath: string;
  thumbnailTimestamp: number;
  hlsEnabled: boolean;
}

export interface LibraryItem {
  id: string;
  filename: string;
  path: string;
  size: number;
  modifiedAt: string;
  durationSeconds: number | null;
  durationLabel: string | null;
  directPlaySupported: boolean;
  thumbnailExists: boolean;
}

export type FallbackStatus = "not_needed" | "preparing" | "ready" | "error";

export interface PublicLibraryItem {
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
  fallbackStatus: FallbackStatus;
  fallbackReady: boolean;
  fallbackPreparing: boolean;
}

export interface LibraryStatus {
  videoCount: number;
  lastScanAt: string | null;
}

export interface VideosResponse {
  items: PublicLibraryItem[];
  status: LibraryStatus;
}

export interface HealthResponse extends LibraryStatus {
  ok: true;
}

export interface HlsJob {
  ready: Promise<void>;
}

export interface HlsCacheMetadata {
  sourcePath: string;
  size: number;
  modifiedAt: string;
}
