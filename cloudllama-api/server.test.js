const assert = require("node:assert/strict");
const test = require("node:test");

process.env.SOUNDCLOUD_CLIENT_ID ||= "test-client-id";
process.env.SOUNDCLOUD_CLIENT_SECRET ||= "test-client-secret";
process.env.SOUNDCLOUD_REDIRECT_URI ||= "http://127.0.0.1:8787/auth/soundcloud/callback";

const {
  allowedOrigin,
  config,
  createPkceChallenge,
  createServer,
  mediaRequestHeaders,
  rewriteHlsManifest,
  validateCompleteRedirect,
  validateMediaUrl,
  validateSoundCloudUrl
} = require("./server");

test("PKCE challenge uses SHA-256 base64url encoding", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(createPkceChallenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("CORS only accepts the extension and loopback development origins", () => {
  assert.equal(allowedOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop"), "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
  assert.equal(allowedOrigin("http://127.0.0.1:4173"), "http://127.0.0.1:4173");
  assert.equal(allowedOrigin("https://attacker.example"), "");
});

test("transcoding proxy only accepts HTTPS SoundCloud hosts", () => {
  assert.equal(validateSoundCloudUrl("https://api-v2.soundcloud.com/media/example"), true);
  assert.equal(validateSoundCloudUrl("http://api.soundcloud.com/media/example"), false);
  assert.equal(validateSoundCloudUrl("https://soundcloud.com.attacker.example/media"), false);
});

test("OAuth completion only accepts this extension's chromiumapp URL shape", () => {
  assert.equal(validateCompleteRedirect("https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/soundcloud"), true);
  assert.equal(validateCompleteRedirect("https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/other"), false);
  assert.equal(validateCompleteRedirect("https://attacker.example/soundcloud"), false);
});

test("HLS proxy only accepts SoundCloud media hosts", () => {
  assert.equal(validateMediaUrl("https://cf-hls-media.sndcdn.com/media/track.m3u8"), true);
  assert.equal(validateMediaUrl("https://api-v2.soundcloud.com/media/track"), true);
  assert.equal(validateMediaUrl("https://playback.media-streaming.soundcloud.cloud/track/aac_160k/playlist.m3u8"), true);
  assert.equal(validateMediaUrl("https://sndcdn.com.attacker.example/track.m3u8"), false);
  assert.equal(validateMediaUrl("https://soundcloud.cloud.attacker.example/track.m3u8"), false);
  assert.equal(validateMediaUrl("http://cf-hls-media.sndcdn.com/media/track.m3u8"), false);
});

test("media proxy authenticates only SoundCloud API hops", () => {
  const apiHeaders = mediaRequestHeaders("https://api.soundcloud.com/tracks/example/streams/id/hls", { Accept: "*/*" }, "test-token");
  assert.equal(apiHeaders.get("Authorization"), "OAuth test-token");

  const cdnHeaders = mediaRequestHeaders("https://playback.media-streaming.soundcloud.cloud/example/playlist.m3u8", { Authorization: "OAuth should-not-leak" }, "test-token");
  assert.equal(cdnHeaders.has("Authorization"), false);

  const legacyCdnHeaders = mediaRequestHeaders("https://cf-hls-media.sndcdn.com/example/playlist.m3u8", {}, "test-token");
  assert.equal(legacyCdnHeaders.has("Authorization"), false);
});

test("HLS manifests route playlists, segments, maps, and keys through localhost", () => {
  const source = [
    "#EXTM3U",
    "#EXT-X-MAP:URI=\"init.mp4\"",
    "#EXT-X-KEY:METHOD=AES-128,URI=\"https://cf-hls-media.sndcdn.com/key\"",
    "segment-1.m4s"
  ].join("\n");
  const rewritten = rewriteHlsManifest(source, "https://cf-hls-media.sndcdn.com/media/playlist.m3u8", "test-ticket");
  assert.match(rewritten, /\/media\/test-ticket\?url=/);
  assert.match(rewritten, /%2Fmedia%2Finit\.mp4/);
  assert.match(rewritten, /%2Fkey/);
  assert.match(rewritten, /%2Fmedia%2Fsegment-1\.m4s/);
  assert.equal(rewritten.includes("https://cf-hls-media.sndcdn.com/media/segment-1.m4s\n"), false);
});

test("health is public while API routes require an opaque session", async (context) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${origin}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    configured: Boolean(config.clientId && config.clientSecret && config.redirectUri),
    redirectUri: config.redirectUri
  });

  const unauthorizedResponse = await fetch(`${origin}/api/me`);
  assert.equal(unauthorizedResponse.status, 401);

  const unauthorizedTicket = await fetch(`${origin}/api/media-ticket?url=${encodeURIComponent("https://cf-hls-media.sndcdn.com/media/track.m3u8")}`);
  assert.equal(unauthorizedTicket.status, 401);

  const invalidMediaTicket = await fetch(`${origin}/media/not-a-ticket?url=${encodeURIComponent("https://cf-hls-media.sndcdn.com/media/track.m3u8")}`);
  assert.equal(invalidMediaTicket.status, 401);

  const untrustedStart = await fetch(`${origin}/auth/soundcloud/start`, { redirect: "manual" });
  assert.equal(untrustedStart.status, 400);

  const trustedStart = await fetch(
    `${origin}/auth/soundcloud/start?complete_redirect=${encodeURIComponent("https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/soundcloud")}`,
    { redirect: "manual" }
  );
  assert.equal(trustedStart.status, 302);
  const authorizeUrl = new URL(trustedStart.headers.get("location"));
  assert.equal(authorizeUrl.origin, "https://secure.soundcloud.com");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizeUrl.searchParams.get("redirect_uri"), config.redirectUri);
});
