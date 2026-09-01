export const VIDEO_SCALING_MODES = Object.freeze([
  "INTEGER_NEAREST",
  "SHARP_FIT",
  "SCALE2X"
]);

export function validScalingMode(value) {
  return VIDEO_SCALING_MODES.includes(value);
}

export function computePresentationSize(viewport, availableWidth, availableHeight, mode) {
  if (!validScalingMode(mode) || !positive(viewport?.width) || !positive(viewport?.height) ||
    !positive(availableWidth) || !positive(availableHeight)) {
    throw new TypeError("J2ME_SCALING_INPUT_INVALID");
  }
  const fit = Math.min(availableWidth / viewport.width, availableHeight / viewport.height);
  const scale = mode === "INTEGER_NEAREST" && fit >= 1 ? Math.max(1, Math.floor(fit)) : fit;
  return {
    width: Math.max(1, Math.floor(viewport.width * scale)),
    height: Math.max(1, Math.floor(viewport.height * scale))
  };
}

export function scale2xPixels(source, width, height, output = new Uint32Array(width * height * 4)) {
  if (!(source instanceof Uint32Array) || !(output instanceof Uint32Array) ||
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
    source.length < width * height || output.length < width * height * 4) {
    throw new TypeError("J2ME_SCALE2X_INPUT_INVALID");
  }
  const pixel = (x, y) => source[Math.max(0, Math.min(height - 1, y)) * width +
    Math.max(0, Math.min(width - 1, x))];
  const outputWidth = width * 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = pixel(x, y);
      const top = pixel(x, y - 1);
      const left = pixel(x - 1, y);
      const right = pixel(x + 1, y);
      const bottom = pixel(x, y + 1);
      let topLeft = center;
      let topRight = center;
      let bottomLeft = center;
      let bottomRight = center;
      if (top !== bottom && left !== right) {
        if (left === top) topLeft = left;
        if (top === right) topRight = right;
        if (left === bottom) bottomLeft = left;
        if (bottom === right) bottomRight = right;
      }
      const offset = y * 2 * outputWidth + x * 2;
      output[offset] = topLeft;
      output[offset + 1] = topRight;
      output[offset + outputWidth] = bottomLeft;
      output[offset + outputWidth + 1] = bottomRight;
    }
  }
  return output;
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}
