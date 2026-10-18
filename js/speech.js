// ---- Listen: the device's own text-to-speech (free, offline, only when tapped) ----
export const speech = "speechSynthesis" in window ? window.speechSynthesis : null;
let speaking = false;
export const isSpeaking = () => speaking;
function bestVoice() {
  const voices = speech.getVoices().filter((v) => v.lang?.startsWith("en"));
  const prefer = [/premium|enhanced|natural|neural/i, /samantha|ava|zoe|daniel|karen|serena|google us english/i];
  for (const re of prefer) { const v = voices.find((x) => re.test(x.name)); if (v) return v; }
  return voices.find((v) => v.lang === "en-US") ?? voices[0] ?? null;
}
export function stopSpeaking() { if (speech) speech.cancel(); speaking = false; }
export function speak(parts, onEnd) {
  stopSpeaking();
  // Short utterances (one sentence each): long ones get cut off on iOS.
  const sentences = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const voice = bestVoice();
  speaking = true;
  sentences.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text.trim());
    if (voice) u.voice = voice;
    u.rate = 1.0;
    if (i === sentences.length - 1) u.onend = () => { speaking = false; onEnd(); };
    speech.speak(u);
  });
}
window.addEventListener("hashchange", stopSpeaking);
