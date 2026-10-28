/* Outline raster -> centerline polylines. Browser local; no network/dependencies. */
(function (root) {
  'use strict';
  const DX = [0, 1, 0, -1, 1, 1, -1, -1];
  const DY = [-1, 0, 1, 0, -1, 1, 1, -1];
  const REVERSE = [2, 3, 0, 1, 6, 7, 4, 5];

  function bounded(value, fallback, min, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function distanceToSegmentSquared(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let t = dx || dy ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy) : 0;
    t = Math.max(0, Math.min(1, t));
    return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
  }

  function simplifyOpen(points, epsilon) {
    if (points.length < 3 || epsilon <= 0) return points.slice();
    const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]];
    keep[0] = keep[points.length - 1] = 1;
    const tolerance = epsilon * epsilon;
    while (stack.length) {
      const [first, last] = stack.pop();
      let furthest = -1, maxDistance = tolerance;
      for (let i = first + 1; i < last; i++) {
        const d = distanceToSegmentSquared(points[i], points[first], points[last]);
        if (d > maxDistance) { maxDistance = d; furthest = i; }
      }
      if (furthest >= 0) {
        keep[furthest] = 1;
        if (furthest - first > 1) stack.push([first, furthest]);
        if (last - furthest > 1) stack.push([furthest, last]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }

  function simplifyPath(points, epsilon) {
    const end = points.length - 1;
    const closed = end > 2 && points[0][0] === points[end][0] && points[0][1] === points[end][1];
    if (!closed) return simplifyOpen(points, epsilon);
    // Simplify two open arcs. A closed curve must not collapse to coincident endpoints.
    let split = 1, farthest = -1;
    for (let i = 1; i < end; i++) {
      const d = (points[i][0] - points[0][0]) ** 2 + (points[i][1] - points[0][1]) ** 2;
      if (d > farthest) { farthest = d; split = i; }
    }
    const a = simplifyOpen(points.slice(0, split + 1), epsilon);
    const b = simplifyOpen(points.slice(split), epsilon);
    let result = a.slice(0, -1).concat(b);
    if (result.length < 4) {
      result = [points[0], points[Math.floor(end / 3)], points[Math.floor(2 * end / 3)], points[0]];
    }
    return result;
  }

  function removeSmallComponents(mask, stride, width, height, minimum) {
    if (minimum < 2) return 0;
    const visited = new Uint8Array(mask.length), queue = new Int32Array(width * height);
    let removed = 0;
    for (let y = 1; y <= height; y++) for (let x = 1; x <= width; x++) {
      const start = y * stride + x;
      if (!mask[start] || visited[start]) continue;
      let head = 0, tail = 1;
      queue[0] = start; visited[start] = 1;
      while (head < tail) {
        const pixel = queue[head++];
        for (let d = 0; d < 8; d++) {
          const next = pixel + DY[d] * stride + DX[d];
          if (mask[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
        }
      }
      if (tail < minimum) {
        removed += tail;
        for (let i = 0; i < tail; i++) mask[queue[i]] = 0;
      }
    }
    return removed;
  }

  function thin(mask, stride, minX, minY, maxX, maxY, maxIterations) {
    let changed = true, iteration = 0;
    const removals = [];
    while (changed && iteration < maxIterations) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        removals.length = 0;
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
          const p = y * stride + x;
          if (!mask[p]) continue;
          const a = mask[p - stride], b = mask[p - stride + 1], c = mask[p + 1];
          const d = mask[p + stride + 1], e = mask[p + stride], f = mask[p + stride - 1];
          const g = mask[p - 1], h = mask[p - stride - 1];
          const count = a + b + c + d + e + f + g + h;
          if (count < 2 || count > 6) continue;
          const transitions = (!a && b) + (!b && c) + (!c && d) + (!d && e) +
            (!e && f) + (!f && g) + (!g && h) + (!h && a);
          if (transitions !== 1) continue;
          if (pass === 0 ? (a * c * e || c * e * g) : (a * c * g || a * e * g)) continue;
          removals.push(p);
        }
        if (removals.length) changed = true;
        for (const pixel of removals) mask[pixel] = 0;
      }
      iteration++;
    }
    if (changed) throw new Error('Nét hoặc vùng tô quá dày để xử lý. Hãy dùng ảnh outline mảnh hơn hoặc giảm kích thước ảnh.');
    return iteration;
  }

  function vectorize(image, options) {
    const opt = options || {};
    const width = Number(image && image.width), height = Number(image && image.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 3000 || height > 3000 || width * height > 2250000) {
      throw new Error('Ảnh xử lý phải có kích thước hợp lệ và không quá 2,25 triệu pixel.');
    }
    if (!image.data || image.data.length !== width * height * 4) throw new Error('Dữ liệu ảnh RGBA không hợp lệ.');
    const threshold = bounded(opt.threshold, 180, 1, 254);
    const simplify = bounded(opt.simplify, 1, 0, 30);
    const minPathLength = bounded(opt.minPathLength, 8, 0, 200);
    const minComponentSize = bounded(opt.minComponentSize, 6, 0, 10000);
    const maxIterations = bounded(opt.maxIterations, 250, 1, 1000);
    const maxPaths = bounded(opt.maxPaths, 5000, 1, 50000);
    const maxPoints = bounded(opt.maxPoints, 150000, 100, 1000000);
    const warnings = [], stride = width + 2, mask = new Uint8Array((height + 2) * stride);
    let foregroundPixels = 0, minX = width + 1, minY = height + 1, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, alpha = image.data[i + 3] / 255;
      // Transparent pixels are white. Alpha-zero black does not become an outline.
      const luminance = (0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2]) * alpha + 255 * (1 - alpha);
      if (opt.invert ? luminance > 255 - threshold : luminance < threshold) {
        const px = x + 1, py = y + 1;
        mask[py * stride + px] = 1; foregroundPixels++;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
    }
    const stats = { inputWidth: width, inputHeight: height, foregroundPixels, removedPixels: 0, cleanedForegroundPixels: foregroundPixels, skeletonPixels: 0, pathCount: 0, pointCount: 0, iterations: 0 };
    if (!foregroundPixels) return { paths: [], stats, warnings: ['Không tìm thấy nét. Hãy tăng ngưỡng hoặc thử đảo màu.'] };
    if (foregroundPixels / (width * height) > 0.5) warnings.push('Ảnh chứa nhiều vùng tối. Ảnh outline nền sáng, nét mảnh thường cho kết quả tốt hơn.');
    stats.removedPixels = removeSmallComponents(mask, stride, width, height, minComponentSize);
    stats.cleanedForegroundPixels -= stats.removedPixels;
    if (!stats.cleanedForegroundPixels) return { paths: [], stats, warnings: ['Các nét quá nhỏ đã bị lọc. Hãy giảm lọc nhiễu.'] };
    stats.iterations = thin(mask, stride, minX, minY, maxX, maxY, maxIterations);
    const pixels = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (mask[y * stride + x]) pixels.push(y * stride + x);
    stats.skeletonPixels = pixels.length;
    const visitedEdges = new Uint8Array(mask.length), degree = new Uint8Array(mask.length);
    function hasEdge(pixel, direction) {
      const dx = DX[direction], dy = DY[direction];
      if (!mask[pixel + dy * stride + dx]) return false;
      // Suppress triangular diagonal shortcuts when an orthogonal route exists.
      if (dx && dy && (mask[pixel + dx] || mask[pixel + dy * stride])) return false;
      return true;
    }
    for (const pixel of pixels) for (let d = 0; d < 8; d++) if (hasEdge(pixel, d)) degree[pixel]++;
    const rawPaths = [];
    function trace(start, direction) {
      const path = [start];
      let current = start, dir = direction;
      while (true) {
        const next = current + DY[dir] * stride + DX[dir];
        visitedEdges[current] |= 1 << dir;
        visitedEdges[next] |= 1 << REVERSE[dir];
        path.push(next);
        if (next === start || degree[next] !== 2) break;
        let nextDirection = -1;
        for (let d = 0; d < 8; d++) if (hasEdge(next, d) && !(visitedEdges[next] & (1 << d))) { nextDirection = d; break; }
        if (nextDirection < 0) break;
        current = next; dir = nextDirection;
      }
      rawPaths.push(path);
      if (rawPaths.length > maxPaths * 3) throw new Error('Ảnh có quá nhiều nét rời. Hãy tăng lọc nhiễu hoặc dùng ảnh outline đơn giản hơn.');
    }
    // First split at endpoints/junctions, then recover closed degree-two cycles.
    for (const pixel of pixels) {
      if (!degree[pixel]) rawPaths.push([pixel]);
      else if (degree[pixel] !== 2) for (let d = 0; d < 8; d++) if (hasEdge(pixel, d) && !(visitedEdges[pixel] & (1 << d))) trace(pixel, d);
    }
    for (const pixel of pixels) for (let d = 0; d < 8; d++) if (hasEdge(pixel, d) && !(visitedEdges[pixel] & (1 << d))) trace(pixel, d);
    const paths = [];
    let droppedShortPaths = 0;
    for (const raw of rawPaths) {
      let length = 0;
      const points = raw.map(pixel => [pixel % stride - 1, Math.floor(pixel / stride) - 1]);
      for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      // Preserve isolated significant dots; preserve short junction connectors.
      const connector = degree[raw[0]] > 2 && degree[raw[raw.length - 1]] > 2;
      if (raw.length > 1 && length < minPathLength && !connector) { droppedShortPaths++; continue; }
      const simplified = simplifyPath(points, simplify);
      paths.push(simplified.map(p => [(p[0] + 0.5) / width, (p[1] + 0.5) / height]));
      stats.pointCount += simplified.length;
      if (paths.length > maxPaths || stats.pointCount > maxPoints) throw new Error('Kết quả có quá nhiều nét hoặc điểm. Hãy tăng đơn giản hóa và lọc nhiễu.');
    }
    stats.pathCount = paths.length;
    stats.droppedShortPaths = droppedShortPaths;
    if (!paths.length) warnings.push('Không còn nét sau khi lọc. Hãy giảm độ dài nét tối thiểu hoặc lọc nhiễu.');
    return { paths, stats, warnings };
  }

  root.OutlineVectorizer = Object.freeze({ vectorize, version: '1.0.0' });
})(typeof globalThis !== 'undefined' ? globalThis : window);
