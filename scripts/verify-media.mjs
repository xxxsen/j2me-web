import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const port = Number(process.env.J2ME_MEDIA_TEST_PORT || 4195);
const baseUrl = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
// 250 ms AMR-NB excerpt from freej2me-web's d3theme.amr regression sample.
const amr = "IyFBTVIKPDL2e9KyYCIghkp/FARlMoAANLpnJbf8AAVdft/jpjA8IPyHNhk3EOAbjUribfll+IIbWk9ktmRxEy6Snk8lADw+WzDWsyQdQBuTeraWECXEn+Kp7BiQm/9gGlc1oSeQPAhsWj3WgkdAH966YTnnudNqsFerncEv/SildDam38A8JjNnt81qvqAe39p75IcEPYXVSl7kKMwnQTgGPCpSMDwJeXo/5+KNIB8oWuRx5RXwaMa86kWQomjHDrZLdc6gPCY9opXNe6NhKH0KFlvhR8vKf8xhabaCoNcPwzmyYbA8CXo0R6PlVGCX8Opi1bVRxAEFNVFphi+qq6+Sa1Q7cDwbeDo3R2AzoQ+terNlftXaJcuhm5Bm9pebFx+V0QMwPAgSOE+HClXgW36Ld02VdmLB9uoLAVSZPRm2sNEC5tA84XmoRx42DSA+oshK6MzX7asIqfpKk0oTjx+GXlDMgDwLe69Hb1TEwMI06jhXvPU2pCwFMEER0DS1fp8wL6fgPOATqEeigJrBLad6FqH8wPp0g6oYpEU2yFShYqF6TLA=";
// Deterministic 250 ms, 880 Hz AAC-LC/ADTS sample generated with FFmpeg 7.1.1.
const aac = "//FcQCLf/N4CAExhdmM2MS4xOS4xMDEAAkCvUNkUSxQlJ6If1H19vNdY38+2uKXUkxKhJIkiQ+A2radq2natpZ2dnZ/N5GfHDHCOjZ6NbRslGz07WsjVrbqfmrbr/5vInuFHVa5u1xsW24Ou2uuqZ02dNaitTZ02czGZKJKJKJKJKJKJKJKJKJKJKJKJKBgYGBgYGRIgY2bNyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy8D/8VxAIN/8AQCe2ot1tsxSwuzFLgTpuJ1qf2/1/39pd8ae+r1xr+3/x/j+ScaviSeP9f+3+n7xOtTWrx/4/8f7+1zXHGpYNp8E/Xy09rYM7Ozs5uzs7O3rv4qqeK766nJxiMeRyw95DvYIsU8Q5A60qsLoJkieOAfGJ6IogwRRREwcYoiYOMQIBIHy+WWIieCMGqqEAIKoAKVsIVAcxfQ+tfgdndcpalK5fi4BwV7u+ksoN80pGcTfeSWUF8z30oeZ9DUGee+n0ooee+n0oo8wxv6O0GM895/Tc9RQbnS89z8/0TRQ2aZw/kdPGNbkCDTxgpvp/nPlgYePTTLmmPYTTYTQQO/A//FcQBa//AEe95FwIraEVsWzrut19V/f8/2+v8fWtal6lyWuSOuXKuKlBaCgqrAr9aatGgrIVNVWVttsEjOKjBse/vCPj4bGf3IZPgD39yGT4bHv7kMnwYe/uBk+AM/uAGwPf3A+Pgw7fQD4zAWEBTkQPTRtw8TBIx4R3sr4UsvicSbdZ2x9ouox8TrBWgyfSU60Sy7pIzmtuOapAOSxWtErgOstyqt9wiXFA9W4kgoESxVFwP/xXEAZ3/wBODeAJMsjCKCj0Kh0RB0Ki0L/+G+Oa8+vO83qf/1v3/+ZzdjXjzvSoXWNa6FXQCJLSPUpBZcqIjp46rOF/VTm4EHZFrCoYAAAzSUSTSURRKiLKIkKiAJhPoGYAgjZkMQuAFLMYsg0xPOHAZic54cNDaUlbMAJfRgBJuTeU9cq3qV6u+71kuirYqYvckyC1KVELmw3hE5bnFFprj+MFR80Sx/+fyUjI3IaswvRGtVnOS0kyJxnUZ3iYRN32zVE11aJbjHnG8OA//FcQBOf/AEYV5F2pCCrQiHRCHTpx3lRmufaK//b+f8tyqq13JdpbqyVuQZbSjKJA5Rnj8cAGFRh4e3YAf8AAKRtcZ4nmPMdNtuRPhCACECpINhEI8whTtpHJJgc31mPNcXW+J0p5x+c/IeubMmA4jY2uDutrT0v5D/gADh4e24AAMM/+D5/0Kj7itwPkbeZUOIqEFRPme0TAAFe//FcQCI//AECn7KLMuxNlmWGabSfWWpdP9f+3/XXnjWtXq9Zz/6f9P++uta41NXp2f8fn/p+v1o1Nca1r8/9t/zUs4u9a4GdcTitpfrydbOi3odAUUloHiLDUPUUc+ujne+lFFHO9rooNzvfSiij6c730bZQsc6TfTW7QYc7aWfTWZdFCQlK2bm9xl0UOgWAJL5k7dqIP3HKwCsLm9NtFoW1dS2n2tHP8o5/lHP8lCef5QqE8/y+QE8/y+Q9u+/8/56Rvu/n/P+Yb16efB594YL1vXTB/k/IJFPwtAfEEYeHrgADDh4euAAMKHh7dgAAOPD1u9K5BA9eD414YYPof+Mwz+8I+PgJ94Rk+DJ99AAH//FcQAGf/AEYgbRw";
const mp3 = execFileSync("unzip", [
  "-p", fileURLToPath(new URL("../fixture/J2ME/恋爱物语－我的机器女友.jar", import.meta.url)),
  "sound/n_good.mp3"
]).toString("base64");
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "inherit", "inherit"]
});
let browser;

try {
  await waitForServer(baseUrl);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--no-sandbox"]
  });
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  const results = await page.evaluate(async (samples) => {
    const { createAudioTranscoder } = await import("/media-transcoder.js");
    const transcoder = createAudioTranscoder(`${location.origin}/runtime/`, window);
    const context = new AudioContext();
    const decoded = [];
    for (const [format, value] of Object.entries(samples)) {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const wave = await transcoder.transcode(bytes);
      const signature = new TextDecoder().decode(new Uint8Array(wave, 0, 4));
      const audio = await context.decodeAudioData(wave.slice(0));
      const channel = audio.getChannelData(0);
      let peak = 0;
      for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
      decoded.push({ format, signature, duration: audio.duration, peak, waveBytes: wave.byteLength });
    }
    const stats = transcoder.getStats();
    transcoder.close();
    await context.close();
    return { decoded, stats };
  }, { aac, amr, mp3 });

  assert.deepEqual(results.stats, { failures: 0, requests: 3, successes: 3 });
  for (const result of results.decoded) {
    assert.equal(result.signature, "RIFF", `${result.format} output must be PCM WAV`);
    assert.ok(result.duration >= 0.1, `${result.format} must contain decoded audio`);
    assert.ok(result.peak > 0.001, `${result.format} output must not be silent`);
    assert.ok(result.waveBytes > 44, `${result.format} output must contain PCM frames`);
  }
  console.log(`Media bridge verified in Chrome: ${results.decoded.map((result) =>
    `${result.format}=${result.duration.toFixed(3)}s/${result.waveBytes}B`).join(", ")}.`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

async function waitForServer(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`test server did not start at ${url}`);
}
