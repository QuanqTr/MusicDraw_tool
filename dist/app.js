(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const F = globalThis.MusicFormat, R = globalThis.RegionTools;
  const clone = value => JSON.parse(JSON.stringify(value));
  const state = { project: null, source: null, sourceName: '', width: 680, height: 660, padding: 0, fitRect: [0, 0, 1, 1], instrument: 'MARIMBA', tool: 'select', selected: new Set(), polygon: null, drawing: false, undo: [], redo: [], busy: false, serialized: '', stats: null };
  let toastTimer, raster = null, worker = null, jobId = 0, loadGeneration = 0;

  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5200);
  }
  function status(message, error = false) {
    $('statusText').textContent = message;
    $('statusDot').style.background = error ? '#b57555' : '#668255';
  }
  function fail(error) { console.error(error); const message = String(error.message || error); status(message, true); toast(message); }
  function metadata() {
    return { ...(state.project || {}), title: $('projectTitle').value.trim() || 'Outline', bpm: Math.max(60, Math.min(200, Number($('bpm').value) || 120)), rootMidi: Math.max(0, Math.min(127, Math.round(Number($('rootMidi').value) || 0))), scale: $('scale').value || 'PENTATONIC', selectedInstrument: state.instrument, selectedTool: 'BRUSH', showFilledCells: false, updatedAt: Date.now() };
  }
  function setPaths(paths) { state.project = F.makeProject(paths, metadata()); }
  function snapshot() { return { project: clone(state.project), width: state.width, height: state.height, padding: state.padding, fitRect: state.fitRect.slice() }; }
  function remember() {
    if (!state.project) return;
    state.undo.push(snapshot()); if (state.undo.length > 30) state.undo.shift(); state.redo = [];
  }
  function restore(value) {
    state.project = value.project; state.width = value.width; state.height = value.height; state.padding = value.padding; state.fitRect = value.fitRect;
    $('padding').value = value.padding; $('canvasW').value = state.width; $('canvasH').value = state.height;
    syncMetadata(); prepareRaster(); clearSelection(false); refresh();
  }
  function undo() { if (!state.undo.length || state.busy) return; state.redo.push(snapshot()); restore(state.undo.pop()); status('Đã hoàn tác.'); }
  function redo() { if (!state.redo.length || state.busy) return; state.undo.push(snapshot()); restore(state.redo.pop()); status('Đã làm lại.'); }
  function syncMetadata() {
    const p = state.project;
    $('projectTitle').value = p.title; $('bpm').value = Math.max(60, Math.min(200, p.bpm)); $('rootMidi').value = p.rootMidi; $('scale').value = p.scale;
  }
  function layoutCanvases() {
    for (const id of ['sourceCanvas', 'resultCanvas', 'selectionCanvas']) {
      const c = $(id); if (c.width !== state.width) c.width = state.width; if (c.height !== state.height) c.height = state.height;
    }
    for (const id of ['sourceWell', 'resultWell']) $(id).style.aspectRatio = `${state.width}/${state.height}`;
    $('sourceSize').textContent = `${state.width} × ${state.height}`;
  }
  function prepareRaster() {
    layoutCanvases();
    const ctx = $('sourceCanvas').getContext('2d'); ctx.fillStyle = $('invert').checked ? '#000' : '#fff'; ctx.fillRect(0, 0, state.width, state.height);
    if (!state.source) { raster = null; $('sourcePlaceholder').hidden = false; return; }
    $('sourcePlaceholder').hidden = true;
    const sw = state.source.naturalWidth || state.source.width, sh = state.source.naturalHeight || state.source.height;
    const padding = state.padding / 100;
    const scale = Math.min(state.width * (1 - padding * 2) / sw, state.height * (1 - padding * 2) / sh);
    const w = sw * scale, h = sh * scale, x = (state.width - w) / 2, y = (state.height - h) / 2;
    state.fitRect = [x / state.width, y / state.height, w / state.width, h / state.height];
    ctx.drawImage(state.source, x, y, w, h);
    const downscale = Math.min(1, 1000 / Math.max(state.width, state.height));
    const work = document.createElement('canvas'); work.width = Math.max(1, Math.round(state.width * downscale)); work.height = Math.max(1, Math.round(state.height * downscale));
    const wctx = work.getContext('2d', { willReadFrequently: true }); wctx.drawImage($('sourceCanvas'), 0, 0, work.width, work.height);
    raster = wctx.getImageData(0, 0, work.width, work.height);
    $('sourceName').textContent = state.sourceName;
  }
  function updateDimensions() {
    if (state.busy) return;
    const oldRect = state.fitRect.slice(); remember();
    state.padding = Math.max(0, Math.min(25, Number($('padding').value) || 0)); $('padding').value = state.padding;
    state.width = Math.max(240, Math.min(2400, Math.round(Number($('canvasW').value) || 720)));
    state.height = Math.max(240, Math.min(2400, Math.round(Number($('canvasH').value) || 700)));
    $('canvasW').value = state.width; $('canvasH').value = state.height;
    prepareRaster();
    const next = state.fitRect;
    if (state.source && state.project && state.project.strokes.length && oldRect.some((value, index) => Math.abs(value - next[index]) > 1e-10)) {
      const paths = state.project.strokes.map(path => ({ ...path, points: path.points.map(p => [Math.max(0, Math.min(1, next[0] + (p[0] - oldRect[0]) / oldRect[2] * next[2])), Math.max(0, Math.min(1, next[1] + (p[1] - oldRect[1]) / oldRect[3] * next[3]))]) }));
      setPaths(paths);
    }
    clearSelection(false); refresh(); status('Đã căn nét theo kích thước canvas.');
  }
  function drawBlackSource(project, width, height) {
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const ctx = c.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000';
    for (const stroke of project.strokes) {
      if (stroke.tool === 'ERASER') {
        ctx.globalCompositeOperation = 'destination-out';
        for (const cell of stroke.cells) ctx.fillRect((cell % 24) * width / 24, Math.floor(cell / 24) * height / 32, width / 24, height / 32);
        continue;
      }
      if (!stroke.points.length) continue;
      ctx.globalCompositeOperation = 'source-over'; ctx.beginPath();
      if (stroke.points.length === 1 || stroke.points.every(p => p[0] === stroke.points[0][0] && p[1] === stroke.points[0][1])) {
        ctx.arc(stroke.points[0][0] * width, stroke.points[0][1] * height, 3, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.moveTo(stroke.points[0][0] * width, stroke.points[0][1] * height);
        for (const p of stroke.points.slice(1)) ctx.lineTo(p[0] * width, p[1] * height);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    return c;
  }
  function newId() { return F.makeProject([]).id; }
  function loadProject(value, name) {
    if (state.busy) return toast('Đợi chuyển ảnh hoàn tất rồi nhập JSON.');
    const result = F.validateProject(value);
    if (!result.project) throw new Error(result.errors.slice(0, 3).join(' · '));
    loadGeneration++; state.project = result.project; state.project.id = newId(); state.project.updatedAt = Date.now(); state.project.showFilledCells = false;
    state.source = drawBlackSource(state.project, state.width, state.height); state.sourceName = name;
    state.padding = 0; $('padding').value = 0; $('invert').checked = false; state.undo = []; state.redo = [];
    syncMetadata(); prepareRaster(); clearSelection(false); refresh();
    status(`${name} · ${state.stats.strokeCount} nét · ${state.stats.noteCount} nốt · JSON hợp lệ.`);
    if (result.warnings.length) toast(result.warnings.slice(0, 2).join(' · '));
  }
  function demo() {
    if (state.busy) return;
    state.width = 680; state.height = 660; $('canvasW').value = 680; $('canvasH').value = 660;
    loadProject(globalThis.FISH_SAMPLE, 'Mẫu Fish · JSON gốc');
  }
  function updatePalette() {
    const counts = {};
    for (const p of state.project?.strokes || []) if (p.tool === 'BRUSH') counts[p.instrument] = (counts[p.instrument] || 0) + 1;
    for (const button of $('palette').children) {
      const active = button.dataset.instrument === state.instrument;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      button.querySelector('.palette-count').textContent = counts[button.dataset.instrument] || '—';
    }
    $('chosenName').textContent = F.PALETTE.find(p => p.id === state.instrument).label;
  }
  function refresh() {
    if (!state.project) return;
    state.project = { ...state.project, ...metadata() };
    state.serialized = JSON.stringify(state.project);
    // Render the serialized export, not a parallel vector model.
    const decoded = JSON.parse(state.serialized);
    layoutCanvases();
    const options = decoded.drawingBackground ? {} : { background: '#F7F6EE' };
    F.renderProject($('resultCanvas').getContext('2d'), decoded, options);
    state.stats = F.notesForProject(decoded).stats;
    $('strokeCount').textContent = state.stats.strokeCount.toLocaleString('vi-VN');
    $('pointCount').textContent = state.stats.pointCount.toLocaleString('vi-VN');
    $('noteCount').textContent = state.stats.noteCount.toLocaleString('vi-VN');
    $('loopTime').textContent = `${state.stats.loopSeconds.toFixed(2)}s`;
    $('undoBtn').disabled = !state.undo.length; $('redoBtn').disabled = !state.redo.length;
    $('exportBtn').disabled = !state.stats.strokeCount; $('pngBtn').disabled = !state.stats.strokeCount;
    updatePalette(); updateSelection();
  }
  function drawPolyline(ctx, points) {
    if (!points.length) return;
    ctx.beginPath(); ctx.moveTo(points[0][0] * state.width, points[0][1] * state.height);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0] * state.width, points[i][1] * state.height);
    if (points.length === 1) { ctx.lineTo(points[0][0] * state.width + 0.01, points[0][1] * state.height); }
    ctx.stroke();
  }
  function regionCount() { return state.polygon ? state.project.strokes.filter(p => p.tool !== 'ERASER' && R.intersectsPath(p.points, state.polygon)).length : 0; }
  function updateSelection() {
    const count = state.polygon ? regionCount() : state.selected.size;
    $('selectedCount').textContent = state.polygon ? `Vùng chạm ${count} nét` : count ? `Đã chọn ${count} nét` : 'Chưa chọn nét';
    $('applyColorBtn').disabled = !count; $('deleteBtn').disabled = !count;
    $('selectionHint').textContent = state.tool === 'lasso' ? (state.polygon ? 'Chọn màu rồi áp dụng cho vùng' : 'Kéo một vòng quanh phần muốn đổi màu') : (state.selected.size ? 'Shift + bấm để chọn thêm nét' : 'Bấm vào nét để chọn');
    const ctx = $('selectionCanvas').getContext('2d'); ctx.clearRect(0, 0, state.width, state.height);
    if ($('overlaySource').checked && state.source) { ctx.globalAlpha = 0.18; ctx.drawImage($('sourceCanvas'), 0, 0); ctx.globalAlpha = 1; }
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#71985a88'; ctx.lineWidth = 16;
    for (const index of state.selected) if (state.project.strokes[index]) drawPolyline(ctx, state.project.strokes[index].points);
    if (state.polygon?.length) {
      ctx.beginPath(); state.polygon.forEach((p, i) => i ? ctx.lineTo(p[0] * state.width, p[1] * state.height) : ctx.moveTo(p[0] * state.width, p[1] * state.height));
      ctx.closePath(); ctx.fillStyle = '#8eaa5e22'; ctx.fill('evenodd'); ctx.strokeStyle = '#65824d'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.stroke();
    }
    ctx.restore();
  }
  function clearSelection(render = true) { state.selected.clear(); state.polygon = null; state.drawing = false; if (render && state.project) updateSelection(); }
  function setTool(tool) {
    state.tool = tool; clearSelection();
    $('selectTool').classList.toggle('active', tool === 'select'); $('lassoTool').classList.toggle('active', tool === 'lasso');
    $('selectTool').setAttribute('aria-pressed', String(tool === 'select')); $('lassoTool').setAttribute('aria-pressed', String(tool === 'lasso'));
  }
  function point(event) {
    const rect = $('selectionCanvas').getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  }
  function applyColor() {
    if (!state.project || $('applyColorBtn').disabled) return;
    remember();
    if (state.polygon) {
      const result = R.recolor(state.project.strokes, state.polygon, state.instrument);
      if (result.paths.length > 10000) { state.undo.pop(); throw new Error('Vùng tạo quá nhiều đoạn; hãy khoanh một vùng đơn giản hơn.'); }
      setPaths(result.paths); status(`Đã đổi màu ${result.changedSegments} đoạn trong vùng, giữ nguyên phần bên ngoài.`);
    } else {
      const paths = state.project.strokes.map((p, i) => state.selected.has(i) ? { ...p, instrument: state.instrument } : p);
      setPaths(paths); status(`Đã đổi màu ${state.selected.size} nét.`);
    }
    clearSelection(false); refresh();
  }
  function deleteSelection() {
    if ($('deleteBtn').disabled) return;
    remember();
    const paths = state.polygon ? R.recolor(state.project.strokes, state.polygon, '__REMOVE__').paths.filter(p => p.instrument !== '__REMOVE__') : state.project.strokes.filter((p, i) => !state.selected.has(i));
    setPaths(paths); clearSelection(false); refresh(); status('Đã xóa phần được chọn. Có thể hoàn tác.');
  }
  function vectorizeLocally(imageData, options) {
    const result = OutlineVectorizer.vectorize(imageData, options);
    if (!options.autoColors) return result;
    const colors = OutlineColors.colorize(result.paths, imageData, { palette: F.PALETTE, invert: options.invert });
    return { ...result, coloredPaths: colors.paths, colorStats: colors.stats, warnings: [...result.warnings, ...colors.warnings] };
  }
  async function runVectorizer(imageData, options) {
    if (location.protocol === 'file:') return vectorizeLocally(imageData, options);
    if (!worker) {
      try { worker = new Worker('worker.js'); }
      catch (_) { return vectorizeLocally(imageData, options); }
    }
      const id = ++jobId;
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { worker?.terminate(); worker = null; reject(new Error('Ảnh quá phức tạp. Hãy giảm kích thước hoặc tăng mức bỏ đốm nhỏ.')); }, 45000);
        worker.onmessage = event => { if (event.data.id !== id) return; clearTimeout(timeout); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
        worker.onerror = () => { clearTimeout(timeout); worker?.terminate(); worker = null; try { resolve(vectorizeLocally(imageData, options)); } catch (e) { reject(e); } };
        worker.postMessage({ id, imageData, options });
      });
  }
  async function trace() {
    if (state.busy) return;
    if (!state.source) { $('imageInput').click(); return; }
    loadGeneration++; prepareRaster(); state.busy = true; document.body.classList.add('busy'); $('traceBtn').disabled = true; $('importBtn').disabled = true; $('exportBtn').disabled = true; $('pasteBtn').disabled = true; status($('autoColors').checked ? 'Đang tìm đường tâm, nhận diện màu và dựng JSON…' : 'Đang tìm đường tâm và dựng JSON…');
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      const autoColors = $('autoColors').checked;
      const result = await runVectorizer(raster, { threshold: Number($('threshold').value), invert: $('invert').checked, simplify: Number($('simplify').value), minComponentSize: Number($('noise').value), minPathLength: Number($('minLength').value), colorAware: autoColors, autoColors, palette: F.PALETTE });
      if (!result.paths.length) throw new Error('Chưa tìm thấy nét. Thử tăng ngưỡng nét tối, giảm bỏ đốm hoặc bật đảo nền.');
      const paths = autoColors ? result.coloredPaths : result.paths.map(points => ({ points, instrument: state.instrument, tool: 'BRUSH' }));
      remember(); setPaths(paths);
      clearSelection(false); refresh();
      const colorCount = new Set(paths.map(p => p.instrument)).size;
      status(autoColors ? `Đã tách ${paths.length} nét · tự ghép ${colorCount} màu gần nhất · có thể chọn vùng để chỉnh thêm.` : `Đã tách ${paths.length} nét · ${state.stats.pointCount} điểm · có thể bắt đầu chọn màu.`);
      if (result.warnings.length) toast(result.warnings.join(' · '));
      $('traceHint').textContent = `${raster.width} × ${raster.height} px xử lý · ${result.stats.skeletonPixels.toLocaleString('vi-VN')} pixel đường tâm`;
    } catch (error) { fail(error); }
    finally { state.busy = false; document.body.classList.remove('busy'); $('traceBtn').disabled = false; $('importBtn').disabled = false; $('pasteBtn').disabled = false; $('exportBtn').disabled = !state.project?.strokes.length; }
  }
  async function loadImage(file, options = {}) {
    if (state.busy) return toast('Đợi chuyển ảnh hoàn tất rồi chọn ảnh khác.');
    if (!file) return;
    const generation = ++loadGeneration;
    if (file.size > 20 * 1024 * 1024) throw new Error('Ảnh vượt quá 20 MB. Hãy dùng ảnh nhỏ hơn.');
    if (!/\.(png|jpe?g|webp|svg)$/i.test(file.name) && !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) throw new Error('Hãy chọn ảnh PNG, JPG, WEBP hoặc SVG.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Không đọc được ảnh. Thử xuất lại dưới dạng PNG.')); image.src = url; });
      if (generation !== loadGeneration || state.busy) return;
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) throw new Error('Ảnh quá lớn. Hãy giảm về dưới 50 megapixel.');
      state.source = image; state.sourceName = options.name || file.name; state.width = 720; state.height = Math.max(240, Math.min(2400, Math.round(720 * image.naturalHeight / image.naturalWidth)));
      $('canvasW').value = state.width; $('canvasH').value = state.height; state.padding = 3; $('padding').value = 3;
      state.project = F.makeProject([], { title: (options.name || file.name).replace(/\.[^.]+$/, ''), selectedInstrument: state.instrument });
      state.undo = []; state.redo = []; syncMetadata(); prepareRaster(); clearSelection(false); refresh();
      status('Đã đọc ảnh. Bấm “Chuyển ảnh thành nét” để tạo JSON.');
    } finally { URL.revokeObjectURL(url); }
    if (options.autoTrace && generation === loadGeneration && !state.busy) await trace();
  }
  function clipboardImage(clipboard) {
    if (!clipboard) return null;
    for (const item of Array.from(clipboard.items || [])) {
      if (item.kind === 'file' && /^image\//i.test(item.type || '')) {
        const file = item.getAsFile?.(); if (file) return file;
      }
    }
    return Array.from(clipboard.files || []).find(file => /^image\//i.test(file.type || '')) || null;
  }
  async function pasteClipboard() {
    if (state.busy) return toast('Đợi chuyển ảnh hoàn tất rồi dán ảnh mới.');
    if (!navigator.clipboard?.read || !window.isSecureContext) return toast('Bấm vào trang rồi nhấn Ctrl+V để dán ảnh chụp màn hình.');
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find(value => /^image\//i.test(value));
        if (!type) continue;
        const blob = await item.getType(type);
        const suffix = type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'png';
        await loadImage(new File([blob], `clipboard.${suffix}`, { type }), { name: 'Ảnh clipboard', autoTrace: true });
        return;
      }
      toast('Clipboard chưa có ảnh. Chụp/copy ảnh rồi nhấn Ctrl+V trên trang.');
    } catch (error) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') toast('Chưa được phép đọc clipboard. Bạn vẫn có thể dán bằng Ctrl+V trên trang.');
      else throw error;
    }
  }
  async function loadJson(file) {
    if (state.busy) return toast('Đợi chuyển ảnh hoàn tất rồi nhập JSON.');
    if (!file) return;
    const generation = ++loadGeneration;
    if (file.size > 15 * 1024 * 1024) throw new Error('JSON vượt quá 15 MB.');
    let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('File không phải JSON hợp lệ.'); }
    if (generation !== loadGeneration || state.busy) return;
    loadProject(data, file.name);
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function exportJson() {
    if (!state.project?.strokes.length) return toast('Hãy tạo nét vẽ trước khi xuất JSON.');
    refresh(); const result = F.validateProject(state.serialized); if (!result.project) throw new Error(result.errors.join(' · '));
    download(new Blob([JSON.stringify(result.project, null, 2)], { type: 'application/json' }), `${result.project.id}.json`);
    status(`Đã xuất JSON · ${state.stats.strokeCount} nét · ${state.stats.noteCount} nốt.`); toast('Đã tải JSON. Tên file dùng UUID tương ứng với id của dự án.');
  }
  function showJson() {
    refresh(); const text = JSON.stringify(JSON.parse(state.serialized), null, 2);
    $('jsonPreview').textContent = text.length > 90000 ? text.slice(0, 90000) + '\n… Bản xem trước rút gọn. File tải xuống và bản sao chép vẫn đầy đủ.' : text;
    $('jsonDialog').showModal();
  }
  function safe(fn) { return event => { try { Promise.resolve(fn(event)).catch(fail); } catch (error) { fail(error); } }; }
  function bind() {
    for (const p of F.PALETTE) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'palette-item'; b.dataset.instrument = p.id; b.title = `${p.label} · ${p.color}`; b.setAttribute('aria-label', `Màu ${p.label}`); b.setAttribute('aria-pressed', 'false');
      const swatch = document.createElement('span'); swatch.className = 'swatch'; swatch.style.background = p.color;
      const name = document.createElement('span'); name.textContent = p.label;
      const count = document.createElement('span'); count.className = 'palette-count';
      b.append(swatch, name, count); b.onclick = () => { state.instrument = p.id; updatePalette(); }; $('palette').appendChild(b);
    }
    const scaleNames = { PENTATONIC: 'Ngũ cung trưởng', MAJOR: 'Trưởng', MINOR: 'Thứ', BLUES: 'Blues', CHROMATIC: 'Chromatic', MINOR_PENTATONIC: 'Ngũ cung thứ', HARMONIC_MINOR: 'Thứ hòa âm', DORIAN: 'Dorian', PHRYGIAN: 'Phrygian', LYDIAN: 'Lydian', MIXOLYDIAN: 'Mixolydian' };
    for (const scale of Object.keys(F.SCALES)) { const option = document.createElement('option'); option.value = scale; option.textContent = scaleNames[scale]; $('scale').appendChild(option); }
    $('uploadBtn').onclick = () => $('imageInput').click(); $('importBtn').onclick = () => $('jsonInput').click(); $('pasteBtn').onclick = safe(pasteClipboard);
    $('imageInput').onchange = safe(async e => { await loadImage(e.target.files[0]); e.target.value = ''; });
    $('jsonInput').onchange = safe(async e => { await loadJson(e.target.files[0]); e.target.value = ''; });
    $('demoBtn').onclick = safe(demo); $('traceBtn').onclick = safe(trace); $('exportBtn').onclick = safe(exportJson); $('dialogExportBtn').onclick = safe(exportJson);
    $('jsonBtn').onclick = safe(showJson); $('copyJsonBtn').onclick = safe(async () => {
      refresh(); const text = JSON.stringify(JSON.parse(state.serialized), null, 2);
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = 0; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); if (!ok) throw new Error('Trình duyệt không cho sao chép. Hãy tải file JSON.'); }
      toast('Đã sao chép toàn bộ JSON.');
    });
    $('pngBtn').onclick = safe(() => { refresh(); $('resultCanvas').toBlob(blob => { if (blob) download(blob, `${state.project.title.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'outline'}.png`); }, 'image/png'); });
    for (const id of ['helpBtn', 'helpFooter']) $(id).onclick = () => $('helpDialog').showModal();
    document.querySelectorAll('.close-dialog').forEach(b => b.onclick = () => b.closest('dialog').close());
    for (const id of ['threshold', 'simplify', 'noise']) $(id).oninput = () => { $(`${id}Out`).textContent = $(id).value + (id === 'threshold' ? '' : ' px'); };
    for (const id of ['canvasW', 'canvasH', 'padding']) $(id).onchange = safe(updateDimensions);
    $('fitBtn').onclick = safe(() => { if (!state.source) return; const w = state.source.naturalWidth || state.source.width, h = state.source.naturalHeight || state.source.height; $('canvasW').value = 720; $('canvasH').value = Math.max(240, Math.min(2400, Math.round(720 * h / w))); updateDimensions(); });
    for (const id of ['bpm', 'rootMidi', 'scale', 'projectTitle']) $(id).onchange = safe(() => { remember(); refresh(); status('Đã cập nhật thiết lập dự án.'); });
    $('selectTool').onclick = () => setTool('select'); $('lassoTool').onclick = () => setTool('lasso'); $('clearSelectionBtn').onclick = () => clearSelection();
    $('overlaySource').onchange = () => updateSelection(); $('invert').onchange = () => { prepareRaster(); updateSelection(); }; $('undoBtn').onclick = safe(undo); $('redoBtn').onclick = safe(redo);
    $('applyColorBtn').onclick = safe(applyColor); $('deleteBtn').onclick = safe(deleteSelection);
    $('selectAllBtn').onclick = () => { state.polygon = null; state.selected = new Set(state.project.strokes.map((p, i) => p.tool === 'BRUSH' ? i : -1).filter(i => i >= 0)); updateSelection(); };
    const overlay = $('selectionCanvas');
    overlay.onpointerdown = safe(event => {
      if (state.busy || !state.project || event.button !== 0) return; event.preventDefault(); overlay.focus();
      const p = point(event);
      if (state.tool === 'lasso') { state.selected.clear(); state.polygon = [p]; state.drawing = true; overlay.setPointerCapture(event.pointerId); }
      else {
        state.polygon = null; const rect = overlay.getBoundingClientRect(); const hit = R.nearestPath(state.project.strokes, p, rect.width, rect.height, 12);
        if (!event.shiftKey) state.selected.clear();
        if (hit) state.selected.has(hit.index) ? state.selected.delete(hit.index) : state.selected.add(hit.index);
      }
      updateSelection();
    });
    overlay.onpointermove = event => {
      if (!state.drawing) return; const p = point(event), last = state.polygon[state.polygon.length - 1], rect = overlay.getBoundingClientRect();
      if (Math.hypot((p[0] - last[0]) * rect.width, (p[1] - last[1]) * rect.height) > 4 && state.polygon.length < 180) { state.polygon.push(p); updateSelection(); }
    };
    const finish = event => { if (!state.drawing) return; state.drawing = false; if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId); if (state.polygon.length < 3) state.polygon = null; updateSelection(); };
    overlay.onpointerup = finish; overlay.onpointercancel = () => { state.drawing = false; state.polygon = null; updateSelection(); };
    document.addEventListener('keydown', safe(event => {
      if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (event.key === 'Escape') clearSelection();
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); $('selectAllBtn').click(); }
    }));
    document.addEventListener('paste', safe(async event => {
      // A normal text paste (e.g. into the project title) stays with the browser.
      // Image data comes only from the user's paste event; HTML image URLs are never fetched.
      const file = clipboardImage(event.clipboardData);
      if (!file || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (state.busy) return toast('Đợi chuyển ảnh hoàn tất rồi dán ảnh mới.');
      await loadImage(file, { name: `Ảnh clipboard · ${file.name || 'screenshot.png'}`, autoTrace: true });
    }));
    document.addEventListener('dragover', event => { event.preventDefault(); $('uploadBtn').classList.add('dragover'); });
    document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('uploadBtn').classList.remove('dragover'); });
    document.addEventListener('drop', safe(async event => { event.preventDefault(); $('uploadBtn').classList.remove('dragover'); if (state.busy) return; const f = event.dataTransfer.files[0]; if (!f) return; /\.json$/i.test(f.name) ? await loadJson(f) : await loadImage(f); }));
  }
  try { bind(); demo(); } catch (error) { fail(error); }
})();
