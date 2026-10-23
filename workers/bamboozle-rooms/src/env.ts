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
  /** Enables the ops-only POST /api/tts fallback. Unset = 404. */
  TTS_API_TOKEN?: string;
  TTS_API_DAILY_CHARS?: string;
  TTS_API_IP_DAILY_CHARS?: string;
  MAX_SOCKETS_PER_IP?: string;
  MAX_SOCKETS_TOTAL?: string;
  MAX_TOTAL_ROOMS?: string;
  MAX_PLAYERS_PER_ROOM?: string;
  MAX_AUDIENCE_PER_ROOM?: string;
  MAX_STATE_BYTES?: string;
}

export const roomGraceMs = (env: Env): number => positiveInt(env.HOST_GRACE_MS, 60_000);
export const playerKickMs = (env: Env): number => positiveInt(env.PLAYER_KICK_MS, 60_000);
export const emptyRoomMs = (env: Env): number => positiveInt(env.EMPTY_ROOM_MS, 60_000);

export const ttsApiDailyChars = (env: Env): number => positiveInt(env.TTS_API_DAILY_CHARS, 50_000);
export const ttsApiIpDailyChars = (env: Env): number => positiveInt(env.TTS_API_IP_DAILY_CHARS, 5_000);
export const maxSocketsPerIp = (env: Env): number => positiveInt(env.MAX_SOCKETS_PER_IP, 12);
export const maxSocketsTotal = (env: Env): number => positiveInt(env.MAX_SOCKETS_TOTAL, 1_000);
export const maxTotalRooms = (env: Env): number => positiveInt(env.MAX_TOTAL_ROOMS, 500);
export const maxPlayersPerRoom = (env: Env): number => positiveInt(env.MAX_PLAYERS_PER_ROOM, 6);
export const maxAudiencePerRoom = (env: Env): number => positiveInt(env.MAX_AUDIENCE_PER_ROOM, 20);
export const maxStateBytes = (env: Env): number => positiveInt(env.MAX_STATE_BYTES, 128 * 1024);

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
