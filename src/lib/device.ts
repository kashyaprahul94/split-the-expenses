import "server-only";
import { cookies } from "next/headers";

/**
 * Reads the device key that middleware.ts issues.
 *
 * This is the only place identity comes from. Server actions never accept a
 * device key or a member id as an argument: if the client could name the actor,
 * anyone could attribute their edits to someone else, and the activity log —
 * the whole point of which is answering "why did this number change?" — would
 * be worse than useless.
 */

export const DEVICE_COOKIE = "ste_device";

export async function getDeviceKey(): Promise<string | null> {
  const store = await cookies();
  return store.get(DEVICE_COOKIE)?.value ?? null;
}
