# Cloud Llama API

The public OAuth and SoundCloud playback service for the Cloud Llama Chrome extension. The service uses only Node.js built-ins and keeps the SoundCloud Client Secret out of the extension package.

## Deploy on Render

Create a **Web Service** from the `fencehopping/ShedLabs` repository with these settings:

- Root Directory: `cloudllama-api`
- Runtime: Node
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/health`

Add these secret environment variables in Render:

- `SOUNDCLOUD_CLIENT_ID`
- `SOUNDCLOUD_CLIENT_SECRET`

Cloud Llama Radio defaults to the public Likes at `https://soundcloud.com/thesoundoftrees/likes`, with `https://soundcloud.com/jgilla-1` authorized to take the station live. Override either source with these optional variables:

```text
CLOUD_LLAMA_DJ_PROFILE_URL=https://soundcloud.com/jgilla-1
CLOUD_LLAMA_STATION_FALLBACK_URL=https://soundcloud.com/thesoundoftrees/likes
```

Render supplies `RENDER_EXTERNAL_URL`, `PORT`, and `RENDER`. Cloud Llama uses those values automatically, so no host, port, or callback environment variable is needed.

After the first deploy, register this exact redirect URI with SoundCloud:

```text
https://YOUR-RENDER-SERVICE.onrender.com/auth/soundcloud/callback
```

The `/health` response reports the callback URI the service is using. Do not add a trailing slash when registering it with SoundCloud.

## Local development

Copy `.env.example` to `.env`, supply the SoundCloud credentials, and run:

```sh
npm start
```

The local callback defaults to `http://127.0.0.1:8787/auth/soundcloud/callback`.

## Operational note

Live DJ state and short-lived media tickets are held in memory, so run a single service instance. OAuth sessions use restart-safe encrypted tokens; live DJ playback safely returns to automatic rotation after a restart or redeploy.
