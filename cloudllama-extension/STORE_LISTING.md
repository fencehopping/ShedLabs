# Chrome Web Store listing copy

## Summary

Play your SoundCloud likes in a compact retro desktop-style player with EQ and audio-reactive visuals.

## Detailed description

Cloud Llama turns your SoundCloud likes into a compact toolbar music player inspired by classic desktop audio software.

Features:

- Connect securely to your own SoundCloud account.
- Sync and browse your liked tracks.
- Play, pause, seek, shuffle, repeat, and adjust volume.
- Shape playback with a functional ten-band equalizer and presets.
- Open an audio-reactive visualizer in the player stack or fullscreen.
- Follow direct links back to the uploader and original track on SoundCloud.

Cloud Llama is an independent project by Shed Design Labs. It is not affiliated with or endorsed by SoundCloud or Winamp. Playback availability is controlled by each SoundCloud uploader and SoundCloud's API.

## Single purpose

Play the signed-in user's SoundCloud liked tracks in a compact retro audio player.

## Permission justifications

- `storage`: Stores the opaque Cloud Llama session identifier, basic connected SoundCloud profile information, volume, and equalizer preferences locally in Chrome.
- `identity`: Opens SoundCloud's OAuth authorization screen and safely returns the result to the extension through Chrome's protected redirect flow.
- `https://shedlabs.onrender.com/*`: Connects to the Cloud Llama authentication and playback service. The service keeps the SoundCloud Client Secret out of the extension and proxies authenticated SoundCloud API and media requests.
- `https://*.sndcdn.com/*`: Allows playback of signed SoundCloud media URLs returned by the SoundCloud API when a progressive stream is available.

## Data disclosures

Cloud Llama handles the connected user's SoundCloud username, basic profile information, liked-track metadata, SoundCloud authentication tokens on the supporting service, an opaque session identifier in Chrome storage, and local player preferences. It does not collect browsing history, unrelated website content, passwords, payment information, personal communications, or precise location. It does not sell data or use it for advertising.

## Reviewer test instructions

1. Install the extension and pin Cloud Llama to the Chrome toolbar.
2. Open the popup and click **Sync with SoundCloud**.
3. Complete authorization with a SoundCloud account that has at least one liked, streamable track.
4. Return to Cloud Llama and verify that liked tracks load.
5. Play a track and test pause, seek, next, shuffle, volume, the EQ panel, and the VIZ panel.
6. Use **LIST OPTS** and choose **Disconnect** to delete the Cloud Llama session.

No separate Cloud Llama username or password is required. If the reviewer cannot use an existing SoundCloud account, provide dedicated test-account credentials only in the private Test Instructions field and never in the public listing.

## URLs

- Homepage: `https://shedlabs.studio/cloudllama/`
- Privacy policy: `https://shedlabs.studio/cloudllama/privacy/`
- Support: `https://shedlabs.studio/contact/`
