import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

loadLocalEnv(".env");
loadLocalEnv(".env.local");

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const redirectUri =
  process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI ??
  "http://127.0.0.1:8787/oauth2callback";
const scope = "https://www.googleapis.com/auth/drive.file";

if (!clientId || !clientSecret) {
  console.error(
    "Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in .env.local or your shell before running this script."
  );
  process.exit(1);
}

if (process.argv.includes("--check")) {
  console.log("OAuth client configuration found.");
  console.log(`Redirect URI: ${redirectUri}`);
  process.exit(0);
}

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  redirectUri
);
const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: [scope]
});

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", redirectUri);
    const code = requestUrl.searchParams.get("code");

    if (!code) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Missing OAuth code.");
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);

    response.writeHead(200, { "content-type": "text/plain" });
    response.end("Authorization complete. You can close this tab.");

    console.log("\nAdd this value to .env.local and Vercel:");
    console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token ?? ""}`);
    console.log("\nKeep this token private.");
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end("Authorization failed.");
    console.error(error instanceof Error ? error.message : error);
  } finally {
    server.close();
  }
});

server.listen(8787, "127.0.0.1", () => {
  console.log("Open this URL as the store owner:");
  console.log(authUrl);
});

function loadLocalEnv(fileName) {
  const filePath = path.join(process.cwd(), fileName);

  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripQuotes(rawValue);
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
