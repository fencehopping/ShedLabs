const BACKEND_ORIGIN = "https://shedlabs.onrender.com";
const audio = document.querySelector("#backgroundAudio");
const EQ_FREQUENCIES = [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000];

const engine = {
  tracks: [],
  currentTrackId: "",
  loadedTrackId: "",
  sessionId: "",
  shuffle: false,
  repeat: false,
  sourceMode: "likes",
  stationRevision: 0,
  stationMode: "automatic",
  stationDj: null,
  stationSyncing: false,
  stationLastSyncAt: 0,
  shuffleQueue: [],
  shuffleHistory: [],
  hls: null,
  isLoading: false,
  error: "",
  audioContext: null,
  analyser: null,
  frequencyData: null,
  eqEnabled: false,
  eqValues: Array(11).fill(0),
  preampNode: null,
  eqFilters: []
};

function currentTrack() {
  return engine.tracks.find((track) => track.id === engine.currentTrackId) || null;
}

function destroyHls() {
  if (!engine.hls) return;
  engine.hls.destroy();
  engine.hls = null;
}

function clearSource() {
  destroyHls();
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  engine.loadedTrackId = "";
}

function shuffledTrackIds(excludedId = engine.currentTrackId) {
  const ids = engine.tracks.map((track) => track.id).filter((id) => id !== excludedId);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  return ids;
}

function playbackSnapshot() {
  if (engine.analyser && engine.frequencyData && !audio.paused) {
    engine.analyser.getByteFrequencyData(engine.frequencyData);
  }
  return {
    trackId: engine.currentTrackId,
    positionMs: Math.max(0, (Number(audio.currentTime) || 0) * 1000),
    durationMs: Number.isFinite(audio.duration)
      ? audio.duration * 1000
      : Number(currentTrack()?.duration) || 0,
    isPlaying: !audio.paused && !audio.ended,
    isLoading: engine.isLoading,
    volume: Math.round(audio.volume * 100),
    shuffle: engine.shuffle,
    repeat: engine.repeat,
    shuffleQueue: [...engine.shuffleQueue],
    shuffleHistory: engine.shuffleHistory.slice(-100),
    sourceMode: engine.sourceMode,
    stationRevision: engine.stationRevision,
    stationMode: engine.stationMode,
    stationDj: engine.stationDj,
    frequencyData: engine.frequencyData ? Array.from(engine.frequencyData) : [],
    error: engine.error
  };
}

function broadcastState() {
  chrome.runtime.sendMessage({
    type: "chromeamp:offscreenPlaybackState",
    target: "background",
    playback: playbackSnapshot()
  }).catch(() => {});
}

async function backendFetch(path) {
  const headers = new Headers({ Accept: "application/json; charset=utf-8" });
  if (engine.sessionId) headers.set("Authorization", `Bearer ${engine.sessionId}`);
  const response = await fetch(`${BACKEND_ORIGIN}${path}`, { headers });
  const updatedSessionId = response.headers.get("X-Cloud-Llama-Session");
  if (updatedSessionId && updatedSessionId !== engine.sessionId) {
    engine.sessionId = updatedSessionId;
    chrome.runtime.sendMessage({
      type: "chromeamp:sessionUpdated",
      target: "background",
      sessionId: updatedSessionId
    }).catch(() => {});
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Cloud Llama server returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function transcodingRank(transcoding) {
  const protocol = transcoding.format?.protocol || "";
  const mimeType = transcoding.format?.mime_type || "";
  const preset = transcoding.preset || "";
  if (protocol === "hls" && mimeType.includes("mp4") && preset.includes("aac_160")) return 0;
  if (protocol === "hls" && mimeType.includes("mp4")) return 1;
  if (protocol === "progressive" && mimeType.includes("mpeg")) return 2;
  if (protocol === "hls") return 3;
  if (protocol === "progressive") return 4;
  return 5;
}

async function resolveStream(track) {
  const identifier = track.urn || track.id;
  const stream = await backendFetch(`/api/tracks/${encodeURIComponent(identifier)}/streams`);
  const candidates = [
    [stream.hls_aac_160_url, "hls", "audio/mp4"],
    [stream.hls_aac_96_url, "hls", "audio/mp4"],
    [stream.http_mp3_128_url || stream.http_mp3_128, "progressive", "audio/mpeg"],
    [stream.hls_mp3_128_url, "hls", "audio/mpeg"]
  ];
  const [streamUrl, protocol, mimeType] = candidates.find(([candidate]) => typeof candidate === "string" && candidate.startsWith("https://")) || [];
  if (streamUrl) return { url: streamUrl, protocol, mimeType };

  const preferred = [...(track.media?.transcodings || [])]
    .filter((item) => item?.url)
    .sort((left, right) => transcodingRank(left) - transcodingRank(right))[0];
  if (preferred) {
    const resolved = await backendFetch(`/api/transcoding?url=${encodeURIComponent(preferred.url)}`);
    if (resolved.url) {
      return {
        url: resolved.url,
        protocol: preferred.format?.protocol || "",
        mimeType: preferred.format?.mime_type || ""
      };
    }
  }
  throw new Error("This track has no SoundCloud stream available for off-platform playback");
}

async function attachStream(stream) {
  clearSource();
  const isHls = stream.protocol === "hls" || /\.m3u8(?:$|\?)/i.test(stream.url);
  if (!isHls) {
    audio.src = stream.url;
    return;
  }
  if (globalThis.Hls?.isSupported()) {
    const ticket = await backendFetch(`/api/media-ticket?url=${encodeURIComponent(stream.url)}`);
    if (!ticket.path) throw new Error("Cloud Llama could not create a SoundCloud media ticket");
    const hls = new Hls({ enableWorker: false, lowLatencyMode: false });
    engine.hls = hls;
    await new Promise((resolve, reject) => {
      hls.on(Hls.Events.MANIFEST_PARSED, resolve);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        reject(new Error(`SoundCloud stream failed: ${data.error?.message || data.details || data.type}`));
      });
      hls.attachMedia(audio);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(`${BACKEND_ORIGIN}${ticket.path}`));
    });
    return;
  }
  if (audio.canPlayType("application/vnd.apple.mpegurl")) {
    audio.src = stream.url;
    return;
  }
  throw new Error("This Chrome version cannot play SoundCloud's AAC stream");
}

async function ensureAnalyser() {
  if (engine.analyser) return;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  await context.resume().catch(() => {});
  if (context.state !== "running") {
    await context.close().catch(() => {});
    return;
  }
  const source = context.createMediaElementSource(audio);
  const preampNode = context.createGain();
  const eqFilters = EQ_FREQUENCIES.map((frequency) => {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = frequency;
    filter.Q.value = 1.15;
    return filter;
  });
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.87;
  source.connect(preampNode);
  let output = preampNode;
  for (const filter of eqFilters) {
    output.connect(filter);
    output = filter;
  }
  output.connect(analyser);
  analyser.connect(context.destination);
  engine.audioContext = context;
  engine.analyser = analyser;
  engine.frequencyData = new Uint8Array(analyser.frequencyBinCount);
  engine.preampNode = preampNode;
  engine.eqFilters = eqFilters;
  applyEqualizer();
}

function applyEqualizer() {
  if (!engine.audioContext || !engine.preampNode) return;
  const now = engine.audioContext.currentTime;
  const preampDb = engine.eqEnabled ? Number(engine.eqValues[0] || 0) : 0;
  engine.preampNode.gain.setTargetAtTime(Math.pow(10, preampDb / 20), now, 0.018);
  engine.eqFilters.forEach((filter, index) => {
    const gain = engine.eqEnabled ? Number(engine.eqValues[index + 1] || 0) : 0;
    filter.gain.setTargetAtTime(gain, now, 0.018);
  });
}

async function playTrack(trackId, positionMs = 0) {
  const track = engine.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error("The selected SoundCloud track is no longer available");
  if (track.access === "blocked") throw new Error("This track is blocked from off-platform playback");
  engine.currentTrackId = track.id;
  engine.isLoading = true;
  engine.error = "";
  broadcastState();
  try {
    const stream = await resolveStream(track);
    await attachStream(stream);
    engine.loadedTrackId = track.id;
    if (positionMs > 0) {
      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
        await Promise.race([
          new Promise((resolve) => audio.addEventListener("loadedmetadata", resolve, { once: true })),
          new Promise((resolve) => setTimeout(resolve, 2500))
        ]);
      }
      try { audio.currentTime = positionMs / 1000; } catch {}
    }
    await audio.play();
    await ensureAnalyser().catch(() => {});
  } catch (error) {
    engine.error = error.message || "Could not play this track";
    throw error;
  } finally {
    engine.isLoading = false;
    broadcastState();
  }
}

async function playNext() {
  if (engine.sourceMode === "station") {
    await syncStation(true);
    return;
  }
  if (!engine.tracks.length) return;
  if (engine.repeat) {
    audio.currentTime = 0;
    await audio.play();
    return;
  }
  let nextId;
  if (engine.shuffle && engine.tracks.length > 1) {
    if (!engine.shuffleQueue.length) engine.shuffleQueue = shuffledTrackIds();
    nextId = engine.shuffleQueue.shift();
    if (engine.currentTrackId) {
      engine.shuffleHistory.push(engine.currentTrackId);
      if (engine.shuffleHistory.length > 100) engine.shuffleHistory.shift();
    }
  } else {
    const index = engine.tracks.findIndex((track) => track.id === engine.currentTrackId);
    nextId = engine.tracks[(index + 1) % engine.tracks.length]?.id;
  }
  if (nextId) await playTrack(nextId, 0);
}

function configure(payload) {
  if (Array.isArray(payload.tracks)) engine.tracks = payload.tracks;
  if (typeof payload.sessionId === "string") engine.sessionId = payload.sessionId;
  if (typeof payload.trackId === "string" && payload.trackId) engine.currentTrackId = payload.trackId;
  engine.shuffle = Boolean(payload.shuffle);
  engine.repeat = Boolean(payload.repeat);
  if (payload.sourceMode === "station" || payload.sourceMode === "likes") engine.sourceMode = payload.sourceMode;
  if (Number.isFinite(payload.stationRevision)) engine.stationRevision = payload.stationRevision;
  engine.eqEnabled = Boolean(payload.eqEnabled);
  if (Array.isArray(payload.eqValues) && payload.eqValues.length === 11) engine.eqValues = payload.eqValues;
  if (Array.isArray(payload.shuffleQueue)) engine.shuffleQueue = payload.shuffleQueue;
  if (Array.isArray(payload.shuffleHistory)) engine.shuffleHistory = payload.shuffleHistory;
  if (Number.isFinite(payload.volume)) audio.volume = Math.max(0, Math.min(1, payload.volume / 100));
  applyEqualizer();
}

async function syncStation(forcePlay = false) {
  if (engine.sourceMode !== "station" || engine.stationSyncing) return;
  if (!forcePlay && Date.now() - engine.stationLastSyncAt < 5000) return;
  engine.stationLastSyncAt = Date.now();
  engine.stationSyncing = true;
  try {
    const payload = await backendFetch("/api/station");
    const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
    const trackId = typeof payload.currentTrackId === "string" ? payload.currentTrackId : "";
    const positionMs = Math.max(0, Number(payload.positionMs) || 0)
      + Math.max(0, Date.now() - (Number(payload.serverTimeMs) || Date.now()));
    const wasPlaying = !audio.paused && !audio.ended;
    const trackChanged = trackId && trackId !== engine.loadedTrackId;
    engine.tracks = tracks;
    engine.stationRevision = Number(payload.revision) || 0;
    engine.stationMode = payload.mode === "live" ? "live" : "automatic";
    engine.stationDj = payload.dj || null;

    if (!trackId) throw new Error("Cloud Llama Radio has no playable track");
    if (forcePlay || wasPlaying) {
      if (trackChanged || !audio.src || audio.ended) {
        await playTrack(trackId, positionMs);
      } else if (Math.abs((Number(audio.currentTime) || 0) * 1000 - positionMs) > 4000) {
        try { audio.currentTime = positionMs / 1000; } catch {}
      }
      if (forcePlay && audio.paused) await audio.play();
    } else {
      engine.currentTrackId = trackId;
    }
    engine.error = "";
  } catch (error) {
    engine.error = error.message || "Cloud Llama Radio could not sync";
    if (forcePlay) throw error;
  } finally {
    engine.stationSyncing = false;
    broadcastState();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;
  if (message.type === "chromeamp:getPlaybackState") {
    sendResponse({ ok: true, playback: playbackSnapshot() });
    return false;
  }
  if (message.type !== "chromeamp:playbackCommand") return false;

  (async () => {
    const payload = message.payload || {};
    if (message.command === "configure") configure(payload);
    if (message.command === "play") {
      configure(payload);
      if (engine.sourceMode === "station") await syncStation(true);
      else await playTrack(payload.trackId, payload.positionMs);
    }
    if (message.command === "pause") audio.pause();
    if (message.command === "stop") {
      audio.pause();
      try { audio.currentTime = 0; } catch {}
    }
    if (message.command === "disconnect") {
      clearSource();
      engine.tracks = [];
      engine.currentTrackId = "";
      engine.sessionId = "";
      engine.shuffleQueue = [];
      engine.shuffleHistory = [];
    }
    if (message.command === "seek") {
      try { audio.currentTime = Math.max(0, Number(payload.positionMs) || 0) / 1000; } catch {}
    }
    if (message.command === "volume") audio.volume = Math.max(0, Math.min(1, Number(payload.volume) / 100));
    broadcastState();
    sendResponse({ ok: true, playback: playbackSnapshot() });
  })().catch((error) => {
    engine.error = error.message || "Background playback failed";
    broadcastState();
    sendResponse({ ok: false, error: engine.error, playback: playbackSnapshot() });
  });
  return true;
});

audio.addEventListener("play", broadcastState);
audio.addEventListener("pause", broadcastState);
audio.addEventListener("timeupdate", broadcastState);
audio.addEventListener("durationchange", broadcastState);
audio.addEventListener("ended", () => playNext().catch((error) => {
  engine.error = error.message;
  broadcastState();
}));
audio.addEventListener("error", () => {
  if (audio.src && !engine.hls) engine.error = "The SoundCloud stream could not be played";
  broadcastState();
});

setInterval(() => {
  if (!audio.paused) {
    if (engine.sourceMode === "station") syncStation(false);
    broadcastState();
  }
}, 200);
