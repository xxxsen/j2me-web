#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CACHE_ROOT="$PROJECT_ROOT/.cache/upstream"
OUTPUT_ROOT="$PROJECT_ROOT/public/runtime"
MINIJVM_REPOSITORY="${MINIJVM_REPOSITORY:-https://github.com/xxxsen/miniJVM.git}"
MINIJVM_COMMIT="${MINIJVM_COMMIT:-86909d6532961ea261758cf27e35a84f0174afe0}"
FREEJ2ME_REPOSITORY="${FREEJ2ME_REPOSITORY:-https://github.com/xxxsen/freej2meOnMinijvm.git}"
FREEJ2ME_COMMIT="${FREEJ2ME_COMMIT:-74b4ce5d61dadb30970783ba419b0aa4281c9802}"
FREEJ2ME_PLUS_REPOSITORY="${FREEJ2ME_PLUS_REPOSITORY:-https://github.com/xxxsen/freej2me-plus.git}"
FREEJ2ME_PLUS_COMMIT="${FREEJ2ME_PLUS_COMMIT:-fdafeb69cba129086c3f8fe9c84e8ddba50d432b}"
TINYSOUNDFONT_REPOSITORY="https://github.com/schellingb/TinySoundFont.git"
TINYSOUNDFONT_COMMIT="853a0a171759f1ddba0de1442133a75912bbeffa"
SOUNDFONT_URL="https://raw.githubusercontent.com/musescore/musescore-old/0c1f25dc3cdd2f9332118fa221a344eb8f6ee702/mscore/share/sound/TimGM6mb.sf2"
SOUNDFONT_SHA256="c5378b62028c920cb11e4803327983fee2f2cdff5dc89c708e39da417e51c854"
JDK_IMAGE="eclipse-temurin:8-jdk-jammy"
EMSCRIPTEN_IMAGE="emscripten/emsdk:3.1.46"

command -v docker >/dev/null || {
  echo "Docker is required to build the Java and WebAssembly runtimes." >&2
  exit 1
}

mkdir -p "$CACHE_ROOT" "$OUTPUT_ROOT"

ensure_cache() {
  local repository=$1
  local destination=$2
  local commit=$3

  if [[ ! -d "$destination/.git" ]]; then
    mkdir -p "$destination"
    git -C "$destination" init --quiet
    git -C "$destination" remote add origin "$repository"
  fi
  git -C "$destination" remote set-url origin "$repository"
  if ! git -C "$destination" cat-file -e "$commit^{commit}" 2>/dev/null; then
    git -C "$destination" fetch --depth 1 --no-tags origin "$commit"
  fi
  # Keep the fetched, pinned commit reachable so local cache clones include it
  # even when it is not the repository's default branch.
  git -C "$destination" update-ref refs/heads/j2me-web-build "$commit"
}

ensure_cache "$MINIJVM_REPOSITORY" "$CACHE_ROOT/miniJVM" "$MINIJVM_COMMIT"
ensure_cache "$FREEJ2ME_REPOSITORY" "$CACHE_ROOT/freej2meOnMinijvm" "$FREEJ2ME_COMMIT"
ensure_cache "$FREEJ2ME_PLUS_REPOSITORY" "$CACHE_ROOT/freej2me-plus" "$FREEJ2ME_PLUS_COMMIT"
ensure_cache "$TINYSOUNDFONT_REPOSITORY" "$CACHE_ROOT/TinySoundFont" "$TINYSOUNDFONT_COMMIT"

SOUNDFONT_CACHE="$CACHE_ROOT/TimGM6mb.sf2"
if [[ ! -f "$SOUNDFONT_CACHE" ]] || ! echo "$SOUNDFONT_SHA256  $SOUNDFONT_CACHE" | sha256sum --check --status; then
  command -v curl >/dev/null || {
    echo "curl is required to download the pinned General MIDI SoundFont." >&2
    exit 1
  }
  SOUNDFONT_DOWNLOAD="$SOUNDFONT_CACHE.download"
  curl --fail --location --silent --show-error "$SOUNDFONT_URL" --output "$SOUNDFONT_DOWNLOAD"
  echo "$SOUNDFONT_SHA256  $SOUNDFONT_DOWNLOAD" | sha256sum --check --status || {
    rm -f -- "$SOUNDFONT_DOWNLOAD"
    echo "The downloaded SoundFont checksum did not match." >&2
    exit 1
  }
  mv "$SOUNDFONT_DOWNLOAD" "$SOUNDFONT_CACHE"
fi

BUILD_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/j2me-web-build.XXXXXX")
cleanup() {
  docker run --rm \
    -v "$BUILD_ROOT:/build" \
    "$JDK_IMAGE" \
    chown -R "$(id -u):$(id -g)" /build >/dev/null 2>&1 || true
  rm -rf -- "$BUILD_ROOT"
}
trap cleanup EXIT

git clone --quiet --no-checkout --shared "$CACHE_ROOT/miniJVM" "$BUILD_ROOT/miniJVM"
git -C "$BUILD_ROOT/miniJVM" checkout --quiet --detach "$MINIJVM_COMMIT"
git -C "$CACHE_ROOT/TinySoundFont" show "$TINYSOUNDFONT_COMMIT:tsf.h" \
  > "$BUILD_ROOT/miniJVM/desktop/glfw_gui/c/tsf.h"
git -C "$CACHE_ROOT/TinySoundFont" show "$TINYSOUNDFONT_COMMIT:tml.h" \
  > "$BUILD_ROOT/miniJVM/desktop/glfw_gui/c/tml.h"

mkdir -p "$BUILD_ROOT/dist/lib"
cp "$SOUNDFONT_CACHE" "$BUILD_ROOT/dist/lib/TimGM6mb.sf2"

git clone --quiet --no-checkout --shared "$CACHE_ROOT/freej2meOnMinijvm" "$BUILD_ROOT/freej2meOnMinijvm"
git -C "$BUILD_ROOT/freej2meOnMinijvm" checkout --quiet --detach "$FREEJ2ME_COMMIT"

git clone --quiet --no-checkout --shared "$CACHE_ROOT/freej2me-plus" "$BUILD_ROOT/freej2me-plus"
git -C "$BUILD_ROOT/freej2me-plus" checkout --quiet --detach "$FREEJ2ME_PLUS_COMMIT"

echo "[1/3] Building miniJVM and FreeJ2ME Java libraries"
docker run --rm \
  -v "$BUILD_ROOT:/build" \
  -v "$PROJECT_ROOT:/project:ro" \
  -w /build \
  "$JDK_IMAGE" \
  bash -lc '
set -euo pipefail

compile_jar() {
  local source_root=$1
  local output_jar=$2
  local boot_classpath=$3
  local classpath=$4
  local classes_dir=$5

  mkdir -p "$classes_dir" "$(dirname "$output_jar")"
  find "$source_root/java" -name "*.java" -print > "$classes_dir/sources.txt"
  javac -source 8 -target 8 -encoding UTF-8 \
    -bootclasspath "$boot_classpath" -cp "$classpath" \
    -d "$classes_dir" @"$classes_dir/sources.txt"
  if [[ -d "$source_root/resource" ]]; then
    cp -R "$source_root/resource/." "$classes_dir/"
  fi
  jar cf "$output_jar" -C "$classes_dir" .
}

MINI=/build/miniJVM
APP=/build/freej2meOnMinijvm
PLUS=/build/freej2me-plus
DIST=/build/dist
mkdir -p "$DIST/lib"

compile_jar "$MINI/minijvm/java/src/main" "$DIST/lib/minijvm_rt.jar" . . /build/classes/minijvm
compile_jar "$MINI/desktop/glfw_gui/java/src/main" "$DIST/lib/glfw_gui.jar" "$DIST/lib/minijvm_rt.jar" . /build/classes/glfw
compile_jar "$MINI/extlib/xgui/src/main" "$DIST/lib/xgui.jar" "$DIST/lib/minijvm_rt.jar" "$DIST/lib/glfw_gui.jar" /build/classes/xgui

# Build FreeJ2ME-Plus from the pinned fork source with the full JDK 8 API. The
# miniJVM adapter supplies the AWT and Java Sound implementations at runtime.
mkdir -p /build/classes/freej2me-plus
find "$PLUS/src" -name "*.java" ! -path "$PLUS/src/libretro/*" -print > /build/classes/freej2me-plus/sources.txt
javac -source 8 -target 8 -encoding UTF-8 \
  -d /build/classes/freej2me-plus @/build/classes/freej2me-plus/sources.txt
cp -R "$PLUS/resources/." /build/classes/freej2me-plus/
cp -R "$PLUS/META-INF/." /build/classes/freej2me-plus/META-INF/
jar cf "$DIST/lib/freej2me-plus.jar" -C /build/classes/freej2me-plus .
java -cp /build/classes/freej2me-plus org.recompile.mobile.MiniJvmPlatformPlayerTest

mkdir -p /build/classes/freej2me
find "$APP/src/main/java" -name "*.java" \
  ! -path "*/javax/microedition/m3g/MiniJvmGraphics3DFactory.java" \
  ! -path "*/com/mascotcapsule/micro3d/v3/MiniJvmMicro3dFactory.java" \
  ! -path "*/com/mascotcapsule/micro3d/v3/base/MiniJvmMicro3dGlBackend.java" \
  -print > /build/classes/freej2me/sources.txt
javac -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$DIST/lib/minijvm_rt.jar" \
  -cp "$DIST/lib/glfw_gui.jar:$DIST/lib/xgui.jar:$DIST/lib/freej2me-plus.jar" \
  -d /build/classes/freej2me @/build/classes/freej2me/sources.txt
cp -R "$APP/src/main/resource/." /build/classes/freej2me/
cp "$DIST/lib/freej2me-plus.jar" /build/classes/freej2me/lib/freej2me.jar
jar cf "$DIST/lib/freej2meonminijvm.jar" -C /build/classes/freej2me .

if [[ -d "$APP/src/test/java" ]]; then
  mkdir -p /build/classes/freej2me-tests
  find "$APP/src/test/java" -name "*.java" -print > /build/classes/freej2me-tests/sources.txt
  javac -source 8 -target 8 -encoding UTF-8 \
    -cp "/build/classes/freej2me:$DIST/lib/freej2me-plus.jar" \
    -d /build/classes/freej2me-tests @/build/classes/freej2me-tests/sources.txt
  java -cp "/build/classes/freej2me:/build/classes/freej2me-tests:$DIST/lib/freej2me-plus.jar" \
    com.ebsee.emu.audio.ExactLengthReaderTest
  java -cp "/build/classes/freej2me:/build/classes/freej2me-tests:$DIST/lib/freej2me-plus.jar" \
    com.ebsee.emu.audio.DeferredAudioHandleTest
fi

mkdir -p /build/classes/launcher
find /project/src/java -name "*.java" -print > /build/classes/launcher/sources.txt
javac -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$DIST/lib/minijvm_rt.jar" \
  -cp "$DIST/lib/glfw_gui.jar:$DIST/lib/xgui.jar" \
  -d /build/classes/launcher @/build/classes/launcher/sources.txt
jar cf "$DIST/lib/webj2me.jar" -C /build/classes/launcher .
'

echo "[2/3] Compiling miniJVM to WebAssembly"
mkdir -p "$BUILD_ROOT/wasm"
docker run --rm \
  -v "$BUILD_ROOT:/build" \
  -w /build/miniJVM \
  "$EMSCRIPTEN_IMAGE" \
  bash -lc '
set -euo pipefail
mapfile -t vm_sources < <(find minijvm/c -type f -name "*.c" ! -path "*/utils/sljit/*" ! -path "*/utils/mimalloc/*" ! -path "*/cmake-*" ! -path "*/.*")
mapfile -t gui_sources < <(find desktop/glfw_gui/c -type f -name "*.c" ! -path "*/glad/glad.c")

emcc -O3 -o /build/wasm/runtime.js \
  -D EMSCRIPTEN_WINAPP \
  -I desktop/glfw_gui/c/deps/include \
  -I minijvm/c/jvm -I minijvm/c/utils -I minijvm/c/utils/sljit \
  -I minijvm/c/utils/https -I minijvm/c/utils/https/mbedtls/include \
  "${vm_sources[@]}" "${gui_sources[@]}" \
  --preload-file /build/dist@/ \
  -pthread -lm -ldl -lglfw3 -lidbfs.js \
  -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=8 \
  -s USE_WEBGL2=1 -s USE_GLFW=3 -s MIN_WEBGL_VERSION=2 -s MAX_WEBGL_VERSION=2 \
  -s INITIAL_MEMORY=134217728 -s ALLOW_MEMORY_GROWTH=1 \
  -s FORCE_FILESYSTEM=1 -s EXIT_RUNTIME=0 \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createJ2meModule \
  -s EXPORTED_FUNCTIONS="[\"_main\",\"_malloc\",\"_free\"]" \
  -s EXPORTED_RUNTIME_METHODS="[\"ccall\",\"FS\",\"addRunDependency\",\"removeRunDependency\"]" \
  -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -s WARN_ON_UNDEFINED_SYMBOLS=0 \
  -s ENVIRONMENT=web,worker
'

echo "[3/3] Publishing runtime artifacts"
find "$OUTPUT_ROOT" -mindepth 1 -maxdepth 1 -type f ! -name .gitkeep -delete
cp "$BUILD_ROOT"/wasm/runtime.* "$OUTPUT_ROOT/"

echo "Runtime built in $OUTPUT_ROOT"
