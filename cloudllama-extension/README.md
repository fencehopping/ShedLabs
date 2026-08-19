# Cloud Llama Chrome extension

Cloud Llama is a Manifest V3 Chrome extension that plays an authenticated user's SoundCloud likes in a retro desktop-style player.

## Local testing

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Pin Cloud Llama, open the toolbar popup, and connect SoundCloud.

The distributed extension uses the production service at `https://shedlabs.onrender.com`. The SoundCloud Client Secret is kept on that service and is not included in this directory or the Web Store package.

## Package for the Chrome Web Store

Run:

```bash
./package-release.sh
```

The script creates an extension-only ZIP under `releases/`. It includes the manifest, popup, service worker, bundled HLS runtime, fonts, artwork, and icons. It excludes local credentials, server code, tests, and development dependencies.

Public information:

- [Cloud Llama homepage](https://shedlabs.studio/cloudllama/)
- [Cloud Llama privacy policy](https://shedlabs.studio/cloudllama/privacy/)
- [SoundCloud API attribution guidance](https://developers.soundcloud.com/docs/api/buttons-logos)

