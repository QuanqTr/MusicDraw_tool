import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createHarness, pause, until } from './helpers/app-harness.mjs';

async function using(options, run) {
  const app = createHarness(options);
  try { await run(app); }
  finally { await app.close(); }
}

test('app baseline renders the original Fish project and exposes its valid JSON', async () => {
  await using({}, async app => {
    const fish = app.readProject();
    assert.equal(fish.title, 'Fish');
    assert.equal(fish.strokes.length, 13);
    assert.equal(app.$('noteCount').textContent, '55');
    assert.equal(app.$('pointCount').textContent, '541');
    assert.equal(app.$('palette').children.length, 13);
    assert.deepEqual(Array.from(app.window.MusicFormat.validateProject(fish).errors), []);
    const pixels = app.canvas(app.$('resultCanvas')).native.getContext('2d').getImageData(0, 0, 680, 660).data;
    let ink = 0;
    for (let index = 0; index < pixels.length; index += 4) if (Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 240) ink++;
    assert(ink > 5000, 'result canvas should contain actual rendered geometry');
    assert.deepEqual(app.consoleErrors, []);
  });
});

test('Ctrl+V image event is consumed, automatically traced, and exports multiple instrument colors', async () => {
  await using({}, async app => {
    assert(app.$('autoColors')?.checked, 'automatic source colors should be enabled by default');
    assert(app.$('pasteBtn'), 'clipboard button should be available');
    const event = app.paste({ file: app.imageFile() });
    assert.equal(event.defaultPrevented, true);
    await until(() => app.imageDecodes > 0, 'Pasted image was not decoded');
    await until(() => app.readProject().title !== 'Fish', 'Pasted image did not replace the source');
    await app.waitIdle();
    const project = app.readProject();
    assert(project.strokes.length >= 3, 'the three separate outline loops should remain visible');
    assert(new Set(project.strokes.map(stroke => stroke.instrument)).size >= 3, 'image colors must survive into exported instrument identifiers');
    assert.deepEqual(Array.from(app.window.MusicFormat.validateProject(project).errors), []);
    assert(project.strokes.every(stroke => stroke.points.every(point => point.length === 2 && point.every(value => value >= 0 && value <= 1))));
    app.$('exportBtn').click();
    assert.equal(app.downloads.length, 1);
    const exported = JSON.parse(await app.downloads[0].blob.text());
    assert(new Set(exported.strokes.map(stroke => stroke.instrument)).size >= 3);
    assert.deepEqual(exported.strokes, project.strokes);
    assert.deepEqual(app.networkCalls, []);
    assert.deepEqual(app.consoleErrors, []);
  });
});

test('clipboard.files fallback accepts a PNG when clipboard.items is empty', async () => {
  await using({}, async app => {
    const event = app.paste({ files: [app.imageFile('files-fallback.png')], items: [] });
    assert.equal(event.defaultPrevented, true);
    await until(() => app.$('sourceName').textContent.includes('files-fallback'), 'clipboard.files fallback did not load');
    await app.waitIdle();
    assert(app.readProject().strokes.length > 0);
    assert.deepEqual(app.consoleErrors, []);
  });
});

test('normal text paste in the title stays native and arbitrary text URLs are never fetched', async () => {
  await using({}, async app => {
    const original = app.readProject();
    const title = app.$('projectTitle'); title.value = 'A title being edited';
    const event = app.paste({ text: 'https://example.invalid/private-image.png', target: title });
    assert.equal(event.defaultPrevented, false, 'text paste must not be intercepted');
    assert.equal(title.value, 'A title being edited', 'handler must leave text insertion to the browser');
    await pause(30);
    assert.deepEqual(app.readProject().strokes, original.strokes);
    assert.equal(app.imageDecodes, 0);
    assert.deepEqual(app.networkCalls, []);
    assert.deepEqual(app.consoleErrors, []);
  });
});

test('a paste during an active trace cannot replace the source or start a second decode', async () => {
  await using({ protocol: 'http:', workerMode: 'hold' }, async app => {
    app.paste({ file: app.imageFile('first-paste.png') });
    await until(() => app.workerCalls.some(call => call.action === 'post'), 'initial trace never reached the worker');
    assert(app.document.body.classList.contains('busy'));
    const decodes = app.imageDecodes;
    const event = app.paste({ file: app.imageFile('second-paste.png') });
    assert.equal(event.defaultPrevented, true, 'an image paste should not fall through while busy');
    await pause(30);
    assert.equal(app.imageDecodes, decodes, 'busy guard should reject before decoding');
    app.releaseWorkers();
    await app.waitIdle();
    assert.match(app.$('sourceName').textContent, /first-paste/);
    assert(!app.$('sourceName').textContent.includes('second-paste'));
    assert(app.readProject().strokes.length > 0);
    assert.deepEqual(app.consoleErrors, []);
  });
});

test('an unavailable Worker falls back to local tracing after an asynchronous worker error', async () => {
  await using({ protocol: 'http:', workerMode: 'error' }, async app => {
    app.paste({ file: app.imageFile('worker-error.png') });
    await until(() => app.workerCalls.some(call => call.action === 'post'), 'Worker was not used over HTTP');
    await app.waitIdle();
    assert(app.workerCalls.some(call => call.action === 'terminate'));
    assert(app.readProject().strokes.length >= 3);
    assert(new Set(app.readProject().strokes.map(stroke => stroke.instrument)).size >= 3);
    assert.deepEqual(app.consoleErrors, []);
  });
});

test('successful Worker processing and Worker construction fallback both retain automatic colors', async () => {
  for (const workerMode of ['success', 'construct-error']) await using({ protocol: 'http:', workerMode }, async app => {
    app.paste({ file: app.imageFile(`${workerMode}.png`) });
    await until(() => app.workerCalls.some(call => call.action === 'construct'), 'Worker was not constructed');
    await app.waitIdle();
    assert(app.readProject().strokes.length >= 3);
    assert(new Set(app.readProject().strokes.map(stroke => stroke.instrument)).size >= 3);
    assert.deepEqual(app.consoleErrors, []);
  });
});

test('disabling automatic colors uses the selected instrument and undo restores a recolor', async () => {
  await using({}, async app => {
    app.$('autoColors').checked = false;
    app.$('threshold').value = '245'; // Manual grayscale mode needs a higher threshold for a pastel source.
    app.document.querySelector('[data-instrument="GUITAR"]').click();
    app.paste({ file: app.imageFile() });
    await until(() => app.readProject().title !== 'Fish', 'image did not load');
    await app.waitIdle();
    let project=app.readProject();
    assert(project.strokes.length > 0);
    assert(project.strokes.every(stroke => stroke.instrument === 'GUITAR'));
    app.$('selectAllBtn').click(); app.document.querySelector('[data-instrument="CHIME"]').click(); app.$('applyColorBtn').click();
    assert(app.readProject().strokes.every(stroke => stroke.instrument === 'CHIME'));
    app.$('undoBtn').click();
    assert(app.readProject().strokes.every(stroke => stroke.instrument === 'GUITAR'));
    assert.deepEqual(app.consoleErrors, []);
  });
});

test('an optional private PNG fixture can be tested without committing it', { skip: !process.env.MUSICDRAW_PNG_FIXTURE }, async () => {
  await using({}, async app => {
    const file = new app.window.File([fs.readFileSync(process.env.MUSICDRAW_PNG_FIXTURE)], 'private-fixture.png', { type: 'image/png' });
    const event = app.paste({ file });
    assert(event.defaultPrevented);
    await until(() => app.$('sourceName').textContent.includes('private-fixture'), 'private fixture was not loaded');
    await app.waitIdle();
    const project = app.readProject();
    assert(project.strokes.length > 0);
    assert(new Set(project.strokes.map(stroke => stroke.instrument)).size > 1);
    assert.deepEqual(Array.from(app.window.MusicFormat.validateProject(project).errors), []);
    assert.deepEqual(app.consoleErrors, []);
  });
});
