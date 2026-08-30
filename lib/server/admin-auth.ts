import "server-only";

import { compare } from "bcryptjs";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AdminSessionData = {
  authenticated?: true;
  expiresAt?: number;
};

export function getAdminSessionOptions(secret = getAdminSessionSecret()): SessionOptions {
  return {
    cookieName: "kinggallery_admin_session",
    password: secret,
    ttl: ADMIN_SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    }
  };
}

export async function getAdminSession() {
  return getIronSession<AdminSessionData>(
    await cookies(),
    getAdminSessionOptions()
  );
}

export async function verifyAdminPassword(password: string, hash?: string) {
  const configuredHash = hash ?? process.env.ADMIN_PASSWORD_HASH?.trim() ?? "";

  if (!password || !configuredHash) {
    return false;
  }

  try {
    return await compare(password, configuredHash);
  } catch {
    return false;
  }
}

export function isAdminSessionValid(
  session: AdminSessionData,
  now = Date.now()
) {
  return (
    session.authenticated === true &&
    typeof session.expiresAt === "number" &&
    session.expiresAt > now
  );
}

export async function establishAdminSession(
  session: IronSession<AdminSessionData>,
  now = Date.now()
) {
  session.authenticated = true;
  session.expiresAt = now + ADMIN_SESSION_TTL_SECONDS * 1000;
  await session.save();
}

export async function hasValidAdminSession() {
  try {
    return isAdminSessionValid(await getAdminSession());
  } catch {
    return false;
  }
}

export async function destroyAdminSession() {
  const session = await getAdminSession();
  invalidateAdminSession(session);
}

export function invalidateAdminSession(
  session: Pick<IronSession<AdminSessionData>, "destroy">
) {
  session.destroy();
}

function getAdminSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? "";

  if (secret.length < 32) {
    throw new Error("Admin session configuration is unavailable.");
  }

  return secret;
}
