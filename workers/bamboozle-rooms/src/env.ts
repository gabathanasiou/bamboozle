export interface Env {
  ROOMS: DurableObjectNamespace;
  DIRECTORY: DurableObjectNamespace;
  TTS_KV: KVNamespace;
  GOOGLE_APPLICATION_CREDENTIALS_JSON?: string;
  AUTH_MODE?: string;
  GCS_BUCKET_NAME?: string;
  ALLOWED_ORIGINS?: string;
  HOST_GRACE_MS?: string;
  PLAYER_KICK_MS?: string;
  EMPTY_ROOM_MS?: string;
}

export const roomGraceMs = (env: Env): number => positiveInt(env.HOST_GRACE_MS, 60_000);
export const playerKickMs = (env: Env): number => positiveInt(env.PLAYER_KICK_MS, 60_000);
export const emptyRoomMs = (env: Env): number => positiveInt(env.EMPTY_ROOM_MS, 60_000);

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
