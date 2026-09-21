/**
 * The minimum DOM three's loaders touch, so FBXLoader and GLTFLoader run under
 * Node. Both reach for `document`/`self` while resolving textures even when the
 * caller only wants animation clips, and throw before returning if they are
 * missing. Every stub here is deliberately inert: the clip pipeline discards
 * meshes and materials, so a texture that decodes to a 1x1 blank costs nothing.
 *
 * Import this module for its side effects before importing any three loader.
 */

class StubImage {
  constructor() {
    this.width = 1;
    this.height = 1;
  }

  set src(value) {
    this._src = value;
    if (this.onload) setTimeout(() => this.onload(), 0);
  }

  get src() {
    return this._src;
  }

  addEventListener(type, listener) {
    if (type === 'load') setTimeout(() => listener(), 0);
  }

  removeEventListener() {}
}

class StubCanvas {
  constructor() {
    this.width = 1;
    this.height = 1;
  }

  getContext() {
    return {
      fillRect() {},
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData() {},
      translate() {},
      scale() {},
      clearRect() {},
    };
  }

  toDataURL() {
    return 'data:image/png;base64,iVBORw0KGgo=';
  }
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return new StubCanvas();
      if (tag === 'img') return new StubImage();
      return { style: {}, setAttribute() {}, appendChild() {} };
    },
    createElementNS(namespace, tag) {
      return this.createElement(tag);
    },
  };
}

globalThis.self ??= globalThis;
globalThis.window ??= globalThis;
globalThis.Image ??= StubImage;
globalThis.HTMLCanvasElement ??= StubCanvas;
globalThis.URL.createObjectURL ??= () => 'blob:stub';
globalThis.URL.revokeObjectURL ??= () => {};
