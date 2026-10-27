import nextEnv from "@next/env";
import { sealData } from "iron-session";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

nextEnv.loadEnvConfig(process.cwd());
const value = await sealData({ authenticated: true, expiresAt: Date.now() + 600000 }, {
  password: process.env.ADMIN_SESSION_SECRET.trim(), ttl: 600
});
const path = join(tmpdir(), `tripleo-data-check-${randomUUID()}.json`);
await writeFile(path, JSON.stringify({ cookies: [{
  name: "swagclub_admin_session", value, domain: "localhost", path: "/",
  expires: Math.floor(Date.now() / 1000) + 600, httpOnly: true, secure: false, sameSite: "Lax"
}], origins: [] }), { mode: 0o600 });
console.log(path);
