const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

const EDGE_TIMEOUT_MS = 60000;
const GOOGLE_CHUNK = 190;

async function edgeTTS(text, voice) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);

  return await new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => reject(new Error("Edge TTS timeout")), EDGE_TIMEOUT_MS);
    audioStream.on("data", (c) => chunks.push(c));
    audioStream.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    audioStream.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// Split long text at sentence / comma / word boundaries into <= limit pieces.
function chunkText(text, limit) {
  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf(". ", limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf("! ", limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf("? ", limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf(", ", limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf(" ", limit);
    if (cut <= 0) cut = limit;

    chunks.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function googleTTS(text, lang = "en") {
  const parts = chunkText(text, GOOGLE_CHUNK);
  const buffers = [];
  for (const part of parts) {
    const url =
      "https://translate.google.com/translate_tts" +
      `?ie=UTF-8&q=${encodeURIComponent(part)}&tl=${lang}&client=tw-ob`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://translate.google.com/",
      },
    });
    if (!res.ok) throw new Error("Google TTS " + res.status);
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(buffers);
}

function mp3(buffer, source) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
      "X-TTS-Source": source,
    },
    body: buffer.toString("base64"),
    isBase64Encoded: true,
  };
}

exports.handler = async (event) => {
  let voice = "en-US-BrianNeural";
  let text = "";

  // Accept POST (JSON body — preferred for long text) or GET (query — small text)
  if (event.httpMethod === "POST" && event.body) {
    try {
      const body = JSON.parse(event.body);
      voice = body.voice || voice;
      text = body.text || "";
    } catch {
      return { statusCode: 400, body: "Invalid JSON" };
    }
  } else {
    const q = event.queryStringParameters || {};
    voice = q.voice || voice;
    text = q.text || "";
  }

  if (!text.trim()) return { statusCode: 400, body: "Missing text" };

  const errors = [];

  // 1. Edge — neural, streams the whole text (no chunking needed)
  try {
    const buf = await edgeTTS(text, voice);
    if (buf.length > 0) return mp3(buf, "edge");
    errors.push("edge: empty buffer");
  } catch (e) {
    errors.push("edge: " + e.message);
  }

  // 2. Google — chunked and concatenated
  try {
    const lang = (voice.split("-")[0] || "en").toLowerCase();
    const buf = await googleTTS(text, lang);
    if (buf.length > 0) return mp3(buf, "google");
    errors.push("google: empty buffer");
  } catch (e) {
    errors.push("google: " + e.message);
  }

  return {
    statusCode: 500,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ errors, node: process.version }),
  };
};