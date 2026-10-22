import type { Env } from './env';

export type HostAuth = { allowed: boolean; userId?: string; reason?: string };

/**
 * Entitlement seam. Phase 1 runs with AUTH_MODE=none and trusts the hostId
 * supplied by the client, exactly like the Railway server did.
 *
 * Phase 2 will verify a short-lived token minted by a separate Supabase Edge
 * Function (HS256 with ROOM_TOKEN_SECRET, claims { sub, role: "host", exp }).
 * No payment or account code belongs in this Worker or in phase 1.
 */
export async function authorizeHost(
  _request: Request,
  data: { hostId: string; token?: string },
  env: Env,
): Promise<HostAuth> {
  if ((env.AUTH_MODE ?? 'none') === 'none') return { allowed: true, userId: data.hostId };
  return { allowed: false, reason: 'ENTITLEMENT_REQUIRED' };
}
