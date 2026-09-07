# Historical Google Drive OAuth Setup

New payment slips use private Vercel Blob. Keep this setup only while historical
unprefixed Drive references still need to be viewed or deleted by admins.

## Google Cloud

1. Enable the Google Drive API for the Google Cloud project.
2. Create an OAuth client ID.
3. Add this authorized redirect URI:
   `http://127.0.0.1:8787/oauth2callback`
4. Save the client ID and client secret.

## Local Refresh Token

1. Put the OAuth client values in your local shell or `.env.local`:
   `GOOGLE_DRIVE_CLIENT_ID`
   `GOOGLE_DRIVE_CLIENT_SECRET`
2. Run:
   `node scripts/create-drive-refresh-token.mjs`
3. Open the printed URL as the store owner.
4. Approve the Google Drive permission.
5. Copy the printed `GOOGLE_DRIVE_REFRESH_TOKEN` into `.env.local` and Vercel.

## Scope

The app requests `https://www.googleapis.com/auth/drive.file` so it can create
and manage files it creates for payment slips without requesting full Drive
access.

The historical reader uses each stored Drive file ID directly, so the old folder
ID is no longer required.
