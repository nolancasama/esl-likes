import * as THREE from 'three';

const THUMBNAIL_WIDTH = 240;
const THUMBNAIL_HEIGHT = 150;

const titleCase = (value) => String(value).replace(/(^|[ -])\p{L}/gu,
  (letter) => letter.toUpperCase());

/** Builds the guide directly from the lesson roster, preserving roster order. */
export function deriveAnimalGuideEntries(vocabulary, japaneseNames) {
  return Object.freeze(vocabulary.map(({ id }) => Object.freeze({
    id,
    english: titleCase(id),
    japanese: japaneseNames[id] ?? '',
  })));
}

/** One lazy batch for the lifetime of a Zoo controller, including failures. */
export function createThumbnailCache(renderAll) {
  if (typeof renderAll !== 'function') throw new TypeError('thumbnail cache needs a renderer');
  let cached = null;
  let pending = null;

  return {
    load(entries) {
      if (cached) return Promise.resolve(cached);
      if (!pending) {
        pending = Promise.resolve()
          .then(() => renderAll(entries))
          .catch(() => new Map())
          .then((rendered) => {
            const result = new Map();
            for (const entry of entries) result.set(entry.id, rendered?.get?.(entry.id) ?? null);
            cached = result;
            return cached;
          });
      }
      return pending;
    },
    peek() {
      return cached;
    },
  };
}

function pixelsToDataUrl(pixels, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(width, height);
  const rowBytes = width * 4;
  for (let sourceY = 0; sourceY < height; sourceY += 1) {
    const targetY = height - sourceY - 1;
    image.data.set(pixels.subarray(sourceY * rowBytes, (sourceY + 1) * rowBytes), targetY * rowBytes);
  }
  context.putImageData(image, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  canvas.width = 1;
  canvas.height = 1;
  return dataUrl;
}

/**
 * Renders each loaded in-game model once through the existing WebGL renderer.
 * Missing or failed models return null so the name-only card remains useful.
 */
export function renderAnimalThumbnails({ renderer, entries, cloneModel }) {
  if (!renderer?.setRenderTarget || typeof cloneModel !== 'function') return new Map();

  const target = new THREE.WebGLRenderTarget(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.colorSpace = renderer.outputColorSpace ?? THREE.SRGBColorSpace;
  const previewScene = new THREE.Scene();
  const previewCamera = new THREE.PerspectiveCamera(32, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT, 0.01, 100);
  previewScene.add(new THREE.HemisphereLight(0xffffff, 0x678653, 2.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 7, 6);
  previewScene.add(sun);

  const previousTarget = renderer.getRenderTarget?.() ?? null;
  const previousViewport = renderer.getViewport?.(new THREE.Vector4()) ?? null;
  const previousScissor = renderer.getScissor?.(new THREE.Vector4()) ?? null;
  const previousScissorTest = renderer.getScissorTest?.() ?? false;
  const previousClearColor = renderer.getClearColor?.(new THREE.Color()) ?? new THREE.Color(0x000000);
  const previousClearAlpha = renderer.getClearAlpha?.() ?? 1;
  const previousAutoClear = renderer.autoClear;
  const previousXrEnabled = renderer.xr?.enabled;
  const pixels = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT * 4);
  const results = new Map();

  try {
    if (renderer.xr) renderer.xr.enabled = false;
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    renderer.setScissor(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    renderer.setScissorTest(false);
    renderer.setClearColor(0xeaf4dc, 1);

    for (const entry of entries) {
      let model = null;
      try {
        model = cloneModel(entry.id);
        if (!model) {
          results.set(entry.id, null);
          continue;
        }
        previewScene.add(model);
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const verticalFit = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(previewCamera.fov * 0.5)));
        const horizontalFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(previewCamera.fov * 0.5))
          * previewCamera.aspect);
        const horizontalFit = size.x / (2 * Math.tan(horizontalFov * 0.5));
        const distance = Math.max(verticalFit, horizontalFit, size.z) * 1.38;
        // Cube World animals face +z, so a +z camera shows their face.
        previewCamera.position.set(center.x + distance * 0.12, center.y + size.y * 0.06,
          bounds.max.z + distance);
        previewCamera.lookAt(center);
        previewCamera.updateMatrixWorld(true);
        renderer.clear();
        renderer.render(previewScene, previewCamera);
        renderer.readRenderTargetPixels(target, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, pixels);
        results.set(entry.id, pixelsToDataUrl(pixels, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT));
      } catch (error) {
        console.warn(`[zoo] Could not render the ${entry.id} guide thumbnail.`, error);
        results.set(entry.id, null);
      } finally {
        model?.removeFromParent();
      }
    }
  } finally {
    renderer.setRenderTarget(previousTarget);
    if (previousViewport) renderer.setViewport(previousViewport);
    if (previousScissor) renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
    if (renderer.xr) renderer.xr.enabled = previousXrEnabled;
    target.dispose();
  }
  return results;
}
