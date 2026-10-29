import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function until(predicate, message = 'Condition did not become true', timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await pause(15);
  }
  throw new Error(message);
}

/** Real DOM events plus a native Canvas2D implementation; no app test hooks. */
export function createHarness({ protocol = 'file:', workerMode = 'error', clipboardRead } = {}) {
  const dist = path.join(REPO, 'dist');
  const url = protocol === 'file:'
    ? new URL(`file:///${dist.replaceAll('\\', '/')}/index.html`).href
    : 'http://localhost.test/index.html';
  const window = new Window({ url, settings: {
    disableCSSFileLoading: true, disableJavaScriptFileLoading: true,
    disableComputedStyleRendering: true
  } });
  const { document } = window;
  const canvases = new WeakMap();
  const blobs = new Map();
  const downloads = [];
  const consoleErrors = [];
  const networkCalls = [];
  const workerCalls = [];
  const heldWorkers = [];
  let nextImageGate = null;
  let imageDecodes = 0;
  window.console.error = (...values) => consoleErrors.push(values.map(value => value?.message || String(value)).join(' '));
  window.fetch = async (...args) => { networkCalls.push(args); throw new Error('Network access is not allowed in the local app tests'); };

  function canvas(element) {
    let existing = canvases.get(element);
    if (!existing || existing.width !== element.width || existing.height !== element.height) {
      const native = createCanvas(Math.max(1, element.width), Math.max(1, element.height));
      const context = native.getContext('2d');
      existing = { native, width: element.width, height: element.height };
      existing.context = new Proxy(context, {
        get(target, key) {
          if (key === 'drawImage') return (image, ...args) => target.drawImage(
            image instanceof window.HTMLCanvasElement ? canvas(image).native : image?._nativeImage || image,
            ...args
          );
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, key, value) { Reflect.set(target, key, value, target); return true; }
      });
      canvases.set(element, existing);
    }
    return existing;
  }
  window.HTMLCanvasElement.prototype.getContext = function (kind) { return kind === '2d' ? canvas(this).context : null; };
  window.HTMLCanvasElement.prototype.toBlob = function (callback, type = 'image/png') {
    callback(new window.Blob([canvas(this).native.toBuffer('image/png')], { type }));
  };
  window.HTMLCanvasElement.prototype.setPointerCapture = function (id) { this._pointerId = id; };
  window.HTMLCanvasElement.prototype.hasPointerCapture = function (id) { return this._pointerId === id; };
  window.HTMLCanvasElement.prototype.releasePointerCapture = function () { this._pointerId = null; };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return { left: 40, top: 50, right: 380, bottom: 380, width: 340, height: 330, x: 40, y: 50, toJSON() {} };
  };
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.URL.createObjectURL = blob => {
    const id = `blob:test-${blobs.size}`; blobs.set(id, blob); return id;
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ filename: this.download, blob: blobs.get(this.href) });
  };
  window.Image = class {
    set src(value) {
      this._src = value;
      const gate = nextImageGate; nextImageGate = null;
      Promise.resolve().then(async () => {
        imageDecodes++;
        if (gate) await gate;
        const blob = blobs.get(value);
        if (!blob) throw new Error('Unknown test image URL');
        this._nativeImage = await loadImage(Buffer.from(await blob.arrayBuffer()));
        this.naturalWidth = this.width = this._nativeImage.width;
        this.naturalHeight = this.height = this._nativeImage.height;
        this.onload?.();
      }).catch(error => this.onerror?.(error));
    }
    get src() { return this._src; }
  };
  window.Worker = class {
    constructor(script) {
      workerCalls.push({ action: 'construct', script });
      if (workerMode === 'construct-error') throw new Error('Worker blocked by policy');
    }
    postMessage(message) {
      workerCalls.push({ action: 'post', message });
      const respond = () => {
        if (this.terminated) return;
        if (workerMode === 'error' || workerMode === 'hold') this.onerror?.(new window.Event('error'));
        else {
          try {
            const result = window.OutlineVectorizer.vectorize(message.imageData, message.options);
            if (message.options.autoColors) {
              const colors = window.OutlineColors.colorize(result.paths, message.imageData, { palette: message.options.palette, invert: message.options.invert });
              result.coloredPaths = colors.paths; result.colorStats = colors.stats; result.warnings.push(...colors.warnings);
            }
            this.onmessage?.({ data: { id: message.id, result } });
          } catch (error) { this.onmessage?.({ data: { id: message.id, error: error.message } }); }
        }
      };
      if (workerMode === 'hold') heldWorkers.push(respond);
      else setTimeout(respond, 1);
    }
    terminate() { this.terminated = true; workerCalls.push({ action: 'terminate' }); }
  };
  if (clipboardRead) Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true, value: { read: clipboardRead }
  });

  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, ''));
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)) {
    const script = match[1];
    if (/^(?:https?:)?\/\//.test(script)) throw new Error('App unexpectedly requires a remote script');
    window.eval(fs.readFileSync(path.join(dist, script), 'utf8'));
  }
  const $ = id => document.getElementById(id);
  function readProject() {
    $('jsonBtn').click();
    const value = JSON.parse($('jsonPreview').textContent);
    $('jsonDialog').close();
    return value;
  }
  function imageFile(name = 'colored-outline.png') {
    const fixture = createCanvas(360, 240), context = fixture.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 360, 240);
    context.lineWidth = 7; context.lineCap = 'round'; context.lineJoin = 'round';
    const colors = ['#FFB6D2', '#AEBBFF', '#B8E8D0'];
    colors.forEach((color, index) => {
      context.strokeStyle = color;
      context.beginPath(); context.arc(65 + index * 115, 120, 42, 0, Math.PI * 2); context.stroke();
    });
    return new window.File([fixture.toBuffer('image/png')], name, { type: 'image/png' });
  }
  function paste({ file, files = file ? [file] : [], items, text = '', target = document } = {}) {
    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    const entries = items ?? (file ? [{ kind: 'file', type: file.type, getAsFile: () => file }] : [{ kind: 'string', type: 'text/plain', getAsString: callback => callback(text) }]);
    Object.defineProperty(event, 'clipboardData', { value: {
      items: entries, files, types: files.length ? ['Files'] : ['text/plain'],
      getData: type => type === 'text/plain' ? text : ''
    } });
    target.dispatchEvent(event);
    return event;
  }
  async function waitIdle() {
    await until(() => !document.body.classList.contains('busy') && !$('traceBtn').disabled, 'App remained busy');
    await pause(20);
  }
  return {
    window, document, $, canvas, downloads, consoleErrors, networkCalls, workerCalls,
    readProject, imageFile, paste, waitIdle,
    get imageDecodes() { return imageDecodes; },
    releaseWorkers() { for (const respond of heldWorkers.splice(0)) respond(); },
    blockNextImage() { let release; nextImageGate = new Promise(resolve => { release = resolve; }); return release; },
    async close() { await window.happyDOM.abort(); await window.happyDOM.close(); }
  };
}
