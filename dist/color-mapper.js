/* Sample the source outline and split polylines into official palette colors.
 * Geometry stays on the supplied polylines; colors never alter JSON schema.
 * Classic browser/Worker script, no dependencies or network access.
 */
(function (root) {
  'use strict';
  const EPS = 1e-10;
  const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
  const pointOK = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;
  const same = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
  const option = (value, fallback, min, max) => Number.isFinite(Number(value)) ? clamp(Number(value), min, max) : fallback;

  function hsv(rgb) {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
    let hue = 0;
    if (chroma) {
      if (max === r) hue = ((g - b) / chroma) % 6;
      else if (max === g) hue = (b - r) / chroma + 2;
      else hue = (r - g) / chroma + 4;
      hue = (hue * 60 + 360) % 360;
    }
    return { h: hue, s: max ? chroma / max : 0, v: max, c: chroma * 255 };
  }

  function paletteFor(value) {
    const input = value || root.MusicFormat?.PALETTE;
    if (!Array.isArray(input) || !input.length || input.length > 256) throw new Error('Cần bảng màu nhạc cụ hợp lệ để tự ghép màu.');
    return input.map(item => {
      if (!item || typeof item.id !== 'string' || !/^#[a-f\d]{6}$/i.test(item.color)) throw new Error('Bảng màu phải có id và mã màu #RRGGBB.');
      const color = [1, 3, 5].map(index => parseInt(item.color.slice(index, index + 2), 16));
      return { id: item.id, color, hsv: hsv(color) };
    });
  }

  function match(rgb, palette, neutralInstrument) {
    const source = hsv(rgb);
    if (source.c < 14 || source.s < .085) return { id: neutralInstrument, neutral: true };
    let nearest = palette[0], nearestDistance = Infinity;
    for (const item of palette) {
      let hue = Math.abs(source.h - item.hsv.h); hue = Math.min(hue, 360 - hue) / 180;
      // Hue dominates: vivid blue remains a blue instrument even though all
      // target colors are pastel. Saturation/value resolve similar pinks/blues.
      const distance = 12 * hue * hue + .1 * (source.s - item.hsv.s) ** 2 + .01 * (source.v - item.hsv.v) ** 2;
      if (distance < nearestDistance) { nearest = item; nearestDistance = distance; }
    }
    return { id: nearest.id, neutral: false };
  }

  function sourceColors(image, invert) {
    const bins = Array.from({ length: 36 }, () => ({ weight: 0, rgb: [0, 0, 0] }));
    for (let i = 0; i < image.data.length; i += 4) {
      const alpha = image.data[i + 3] / 255, background = invert ? 0 : 255;
      const rgb = [0, 1, 2].map(c => image.data[i + c] * alpha + background * (1 - alpha));
      const chroma = Math.max(...rgb) - Math.min(...rgb);
      if (chroma < 18) continue;
      const color = hsv(rgb), bin = bins[Math.round(color.h / 10) % bins.length];
      // Ink-colored core pixels dominate partially transparent/antialiased edges.
      const weight = (chroma / 255) ** 2;
      bin.weight += weight;
      for (let c = 0; c < 3; c++) bin.rgb[c] += rgb[c] * weight;
    }
    const largest = Math.max(...bins.map(bin => bin.weight));
    return bins.filter(bin => bin.weight > 0 && bin.weight >= largest * .005).map(bin => {
      const rgb = bin.rgb.map(value => value / bin.weight);
      return { rgb, hsv: hsv(rgb) };
    });
  }

  function compact(points) {
    const result = [];
    for (const p of points) {
      if (result.length && same(result[result.length - 1], p)) continue;
      if (result.length >= 2) {
        const a = result[result.length - 2], b = result[result.length - 1];
        const cross = (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]);
        const forward = (b[0] - a[0]) * (p[0] - b[0]) + (b[1] - a[1]) * (p[1] - b[1]);
        if (Math.abs(cross) < 1e-14 && forward >= 0) result.pop();
      }
      result.push([p[0], p[1]]);
    }
    return result;
  }

  function smoothIntervals(intervals, closed, minimum) {
    if (minimum <= 0 || intervals.length < 2) return;
    for (let pass = 0; pass < 3; pass++) {
      const runs = [];
      for (let i = 0; i < intervals.length; i++) {
        const last = runs[runs.length - 1], interval = intervals[i];
        if (last && last.id === interval.id) { last.indices.push(i); last.length += interval.length; }
        else runs.push({ id: interval.id, length: interval.length, indices: [i] });
      }
      if (closed && runs.length > 1 && runs[0].id === runs[runs.length - 1].id) {
        const last = runs.pop(); runs[0].indices = last.indices.concat(runs[0].indices); runs[0].length += last.length;
      }
      if (runs.length < 2) return;
      const replacements = [];
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i]; if (run.length >= minimum) continue;
        const before = i > 0 ? runs[i - 1] : closed ? runs[runs.length - 1] : null;
        const after = i + 1 < runs.length ? runs[i + 1] : closed ? runs[0] : null;
        let target;
        if (before && after && before.id === after.id) target = before;
        else if (!before) target = after;
        else if (!after) target = before;
        else target = before.length >= after.length ? before : after;
        // Do not let two tiny adjacent runs swap colors forever.
        if (target && (target.length >= minimum || target.length > run.length)) replacements.push([run.indices, target.id]);
      }
      if (!replacements.length) return;
      for (const [indices, id] of replacements) for (const index of indices) intervals[index].id = id;
    }
  }

  function colorize(paths, image, options) {
    const opt = options || {}, palette = paletteFor(opt.palette);
    if (!Array.isArray(paths) || paths.length > 10000) throw new Error('Danh sách nét để ghép màu không hợp lệ.');
    const width = image?.width, height = image?.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 2250000 || image.data?.length !== width * height * 4) throw new Error('Ảnh RGBA dùng để ghép màu không hợp lệ.');
    const neutralInstrument = palette.some(p => p.id === opt.neutralInstrument) ? opt.neutralInstrument : palette.some(p => p.id === 'BASS') ? 'BASS' : palette[0].id;
    const step = option(opt.sampleStep, 1, .5, 2), radius = Math.round(option(opt.sampleRadius, 2, 0, 5));
    const minimum = option(opt.minRunLength, 5, 0, 30), maxSamples = option(opt.maxSamples, 1500000, 100, 3000000);
    const sourcePalette = sourceColors(image, opt.invert);
    const stats = { inputPaths: paths.length, outputPaths: 0, splitCount: 0, sampledPoints: 0, neutralSamples: 0, uncertainSamples: 0, detectedSourceColors: sourcePalette.length, instrumentCounts: {} };
    const warnings = [], result = [];
    function sample(point) {
      if (++stats.sampledPoints > maxSamples) throw new Error('Quá nhiều điểm để ghép màu. Hãy giảm kích thước ảnh hoặc tăng giản lược đường.');
      const px = clamp(Math.floor(point[0] * width), 0, width - 1), py = clamp(Math.floor(point[1] * height), 0, height - 1);
      let best = null, strength = -Infinity;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || y < 0 || x >= width || y >= height || dx * dx + dy * dy > radius * radius + .1) continue;
        const offset = (y * width + x) * 4, alpha = image.data[offset + 3] / 255, background = opt.invert ? 0 : 255;
        const rgb = [0, 1, 2].map(c => image.data[offset + c] * alpha + background * (1 - alpha));
        const min = Math.min(...rgb), max = Math.max(...rgb), chroma = max - min;
        const contrast = opt.invert ? max : 255 - min;
        if (contrast < 16 && chroma < 14) continue;
        const score = (contrast + .35 * chroma) / (1 + .85 * (dx * dx + dy * dy));
        if (score > strength) { strength = score; best = rgb; }
      }
      if (!best) { stats.uncertainSamples++; return neutralInstrument; }
      const color = hsv(best);
      if (color.c >= 14 && color.s >= .085) {
        let closest = null, distance = 8;
        for (const candidate of sourcePalette) {
          let delta = Math.abs(color.h - candidate.hsv.h); delta = Math.min(delta, 360 - delta);
          if (delta < distance) { distance = delta; closest = candidate; }
        }
        // Reuse one source-color representative so antialiasing on a uniform
        // blue stroke cannot alternate between two nearly equal pastel choices.
        if (closest) best = closest.rgb;
      }
      const matched = match(best, palette, neutralInstrument);
      if (matched.neutral) stats.neutralSamples++;
      return matched.id;
    }
    function add(path) {
      path.points = compact(path.points);
      if (!path.points.length) return;
      result.push(path);
      stats.instrumentCounts[path.instrument] = (stats.instrumentCounts[path.instrument] || 0) + 1;
      if (result.length > 10000) throw new Error('Ghép màu tạo quá nhiều đoạn. Hãy tăng độ dài vùng màu tối thiểu.');
    }
    for (const value of paths) {
      const points = Array.isArray(value) ? value : value?.points;
      if (!Array.isArray(points) || points.length > 100000 || points.some(p => !pointOK(p))) throw new Error('Nét có tọa độ không hợp lệ khi ghép màu.');
      if (!points.length) continue;
      if (value?.tool === 'ERASER') { add({ points, instrument: value.instrument || neutralInstrument, tool: 'ERASER' }); continue; }
      if (points.length === 1 || points.every(p => same(p, points[0]))) {
        add({ points: [points[0]], instrument: sample(points[0]), tool: 'BRUSH' }); continue;
      }
      const intervals = [];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], length = Math.hypot((b[0] - a[0]) * width, (b[1] - a[1]) * height);
        if (length < EPS) continue;
        const count = Math.ceil(length / step), at = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for (let j = 0; j < count; j++) intervals.push({ a: at(j / count), b: at((j + 1) / count), length: length / count, id: sample(at((j + .5) / count)) });
      }
      const closed = same(points[0], points[points.length - 1]);
      smoothIntervals(intervals, closed, minimum);
      const pieces = [];
      for (const interval of intervals) {
        const last = pieces[pieces.length - 1];
        if (last && last.instrument === interval.id) last.points.push(interval.b);
        else pieces.push({ points: [interval.a, interval.b], instrument: interval.id, tool: 'BRUSH' });
      }
      if (closed && pieces.length > 1 && pieces[0].instrument === pieces[pieces.length - 1].instrument) {
        const last = pieces.pop(); pieces[0].points = last.points.concat(pieces[0].points.slice(1));
      }
      stats.splitCount += Math.max(0, pieces.length - 1);
      for (const piece of pieces) add(piece);
    }
    stats.outputPaths = result.length;
    if (stats.neutralSamples) warnings.push(`Màu đen/xám được ghép với ${neutralInstrument}; bảng màu app không có màu xám tương ứng.`);
    if (stats.uncertainSamples > Math.max(3, stats.sampledPoints * .03)) warnings.push('Một số đoạn quá nhạt để xác định màu; hãy kiểm tra lại bản xem trước.');
    return { paths: result, stats, warnings };
  }
  root.OutlineColors = Object.freeze({ colorize, version: '1.0.0' });
})(typeof globalThis !== 'undefined' ? globalThis : self);
