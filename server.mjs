import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const webRoot = join(projectRoot, "web");
const runtimeRoot = join(projectRoot, "public", "runtime");
const fixtureRoot = join(projectRoot, "fixture", "J2ME");
const port = Number.parseInt(process.env.PORT || "4173", 10);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".data", "application/octet-stream"],
  [".html", "text/html; charset=utf-8"],
  [".jar", "application/java-archive"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".worker.js", "text/javascript; charset=utf-8"]
]);

function setIsolationHeaders(response) {
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-store");
}

function safePath(root, pathname) {
  const candidate = resolve(root, `.${normalize(`/${pathname}`)}`);
  return relative(root, candidate).startsWith("..") ? null : candidate;
}

async function sendFile(response, root, pathname) {
  const filePath = safePath(root, pathname);
  if (!filePath) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    response.setHeader("Content-Type", mimeTypes.get(extname(filePath)) || "application/octet-stream");
    response.setHeader("Content-Length", fileStat.size);
    response.writeHead(200);
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

async function listFixtures(response) {
  try {
    const entries = await readdir(fixtureRoot, { withFileTypes: true });
    const games = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"))
      .map(async (entry) => {
        const bytes = await readFile(join(fixtureRoot, entry.name));
        return {
          name: entry.name,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.byteLength,
          url: `/fixtures/${encodeURIComponent(entry.name)}`
        };
      }));
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.writeHead(200).end(JSON.stringify(games));
  } catch {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.writeHead(200).end("[]");
  }
}

createServer(async (request, response) => {
  setIsolationHeaders(response);
  let pathname;
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/api/fixtures") return listFixtures(response);
  if (pathname.startsWith("/runtime/")) return sendFile(response, runtimeRoot, pathname.slice(9));
  if (pathname.startsWith("/fixtures/")) return sendFile(response, fixtureRoot, pathname.slice(10));
  if (pathname === "/") return sendFile(response, webRoot, "index.html");
  return sendFile(response, webRoot, pathname.slice(1));
}).listen(port, "127.0.0.1", () => {
  console.log(`J2ME Web test page: http://127.0.0.1:${port}`);
});
