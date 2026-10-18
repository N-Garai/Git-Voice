/**
 * Server-side voice confirmation (optional upgrade).
 * Without a key the widget speaks the confirmation with the browser-native
 * Web Speech API — zero cost, always available. With a key, this renders an
 * mp3 server-side and returns it inline.
 */
import { config } from "../config.js";

export interface TtsResult {
  audioBase64?: string;
  audioMime?: string;
  backend: "elevenlabs" | "web-speech";
}

export async function renderConfirmationAudio(
  spokenText: string,
  options: { allowHosted?: boolean } = {}
): Promise<TtsResult> {
  // Premium voice is a paid capability; free-tier accounts fall back to the
  // browser's own speech synthesis.
  if (options.allowHosted === false) return { backend: "web-speech" };
  const key = config.elevenlabs.apiKey;
  if (!key) return { backend: "web-speech" };

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenlabs.voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: spokenText,
          model_id: config.elevenlabs.modelId,
          voice_settings: { stability: 0.55, similarity_boost: 0.78 }
        }),
        signal: AbortSignal.timeout(30_000)
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[tts] Speech API responded ${res.status}: ${body.slice(0, 160)}`);
      return { backend: "web-speech" };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 2 * 1024 * 1024) {
      console.warn("[tts] Speech audio too large to inline; falling back to browser speech");
      return { backend: "web-speech" };
    }
    return { audioBase64: buf.toString("base64"), audioMime: "audio/mpeg", backend: "elevenlabs" };
  } catch (err) {
    console.warn("[tts] Speech synthesis failed, falling back to browser speech:", err instanceof Error ? err.message : err);
    return { backend: "web-speech" };
  }
}
