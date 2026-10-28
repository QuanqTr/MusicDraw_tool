/* Geometry-only selection and recoloring. All coordinates are normalized. */
(function (root) {
  'use strict';
  const EPS = 1e-9;
  const finitePoint = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const samePoint = (a, b) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  const clamp01 = value => Math.max(0, Math.min(1, value));

  function preparePolygon(polygon) {
    if (!Array.isArray(polygon)) return null;
    const result = [];
    for (const point of polygon) {
      if (!finitePoint(point)) return null;
      const p = [point[0], point[1]];
      if (!result.length || !samePoint(p, result[result.length - 1])) result.push(p);
    }
    if (result.length > 1 && samePoint(result[0], result[result.length - 1])) result.pop();
    if (result.length < 3) return null;
    // Even-odd polygons may self-intersect and have zero signed area. Only reject
    // a wholly collinear polygon, rather than rejecting legitimate freehand lassos.
    const a = result[0], b = result[1];
    if (!result.slice(2).some(c => Math.abs(cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1])) > EPS)) return null;
    return result;
  }

  function onSegment(point, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= EPS * EPS) return samePoint(point, a);
    const area = cross(point[0] - a[0], point[1] - a[1], dx, dy);
    if (Math.abs(area) > EPS * Math.max(1, Math.sqrt(lengthSquared))) return false;
    const dot = (point[0] - a[0]) * dx + (point[1] - a[1]) * dy;
    return dot >= -EPS && dot <= lengthSquared + EPS;
  }

  function containsPrepared(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      if (onSegment(point, a, b)) return true;
      if ((a[1] > point[1]) !== (b[1] > point[1]) &&
          point[0] < a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
    }
    return inside;
  }

  function contains(point, polygon) {
    const prepared = preparePolygon(polygon);
    return !!(prepared && finitePoint(point) && containsPrepared(point, prepared));
  }

  function intersectionParameters(a, b, polygon) {
    const rx = b[0] - a[0], ry = b[1] - a[1], lengthSquared = rx * rx + ry * ry;
    const parameters = [];
    if (lengthSquared <= EPS * EPS) return parameters;
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const sx = q[0] - p[0], sy = q[1] - p[1];
      const px = p[0] - a[0], py = p[1] - a[1];
      const denominator = cross(rx, ry, sx, sy);
      if (Math.abs(denominator) > EPS) {
        const t = cross(px, py, sx, sy) / denominator;
        const u = cross(px, py, rx, ry) / denominator;
        if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) parameters.push(clamp01(t));
      } else if (Math.abs(cross(px, py, rx, ry)) <= EPS) {
        // A run along the lasso boundary belongs to the selection. Add both ends
        // of the overlap, including vertex/parallel cases, without division by zero.
        const t0 = (px * rx + py * ry) / lengthSquared;
        const t1 = ((q[0] - a[0]) * rx + (q[1] - a[1]) * ry) / lengthSquared;
        const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
        if (lo <= hi + EPS) { parameters.push(clamp01(lo), clamp01(hi)); }
      }
    }
    return parameters;
  }

  function intersectsPath(points, polygon) {
    const prepared = preparePolygon(polygon);
    if (!prepared || !Array.isArray(points) || !points.length || points.some(p => !finitePoint(p))) return false;
    if (points.some(p => containsPrepared(p, prepared))) return true;
    for (let i = 1; i < points.length; i++) if (intersectionParameters(points[i - 1], points[i], prepared).length) return true;
    return false;
  }

  function copyPath(path, points, instrument) {
    const copy = { ...path, points: points.map(p => [p[0], p[1]]) };
    if (instrument !== undefined) copy.instrument = instrument;
    // Geometry may have been split. The app JSON exporter must regenerate cells.
    delete copy.cells;
    return copy;
  }

  function recolor(paths, polygon, instrument) {
    const prepared = preparePolygon(polygon);
    if (!prepared) throw new Error('Vùng chọn cần ít nhất ba điểm không thẳng hàng.');
    if (!Array.isArray(paths)) throw new Error('Danh sách nét không hợp lệ.');
    if (typeof instrument !== 'string' || !instrument.trim()) throw new Error('Hãy chọn một nhạc cụ trước khi đổi màu.');
    const output = [];
    let changedSegments = 0;
    for (const path of paths) {
      if (!path || !Array.isArray(path.points) || path.points.some(p => !finitePoint(p))) throw new Error('Một nét chứa tọa độ không hợp lệ.');
      const points = path.points;
      if (path.tool === 'ERASER' || !points.length || path.instrument === instrument) {
        output.push(copyPath(path, points)); continue;
      }
      const allSame = points.every(p => samePoint(p, points[0]));
      if (allSame) {
        const selected = containsPrepared(points[0], prepared);
        output.push(copyPath(path, points, selected ? instrument : path.instrument));
        if (selected) changedSegments++;
        continue;
      }
      const pieces = [];
      let active = null, didChange = false;
      const append = (a, b, selected) => {
        const color = selected ? instrument : path.instrument;
        if (selected) didChange = true;
        if (!active || active.instrument !== color || !samePoint(active.points[active.points.length - 1], a)) {
          active = copyPath(path, [a, b], color); pieces.push(active);
        } else if (!samePoint(active.points[active.points.length - 1], b)) active.points.push([b[0], b[1]]);
      };
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (samePoint(a, b)) continue;
        const cuts = [0, 1].concat(intersectionParameters(a, b, prepared)).sort((x, y) => x - y);
        const unique = cuts.filter((t, index) => !index || t - cuts[index - 1] > EPS);
        for (let j = 1; j < unique.length; j++) {
          const from = unique[j - 1], to = unique[j];
          if (to - from <= EPS) continue;
          const at = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          append(at(from), at(to), containsPrepared(at((from + to) / 2), prepared));
        }
      }
      if (!didChange) { output.push(copyPath(path, points)); continue; }
      // Join the two ends of a split closed curve when their instruments match.
      if (pieces.length > 1 && samePoint(points[0], points[points.length - 1]) &&
          pieces[0].instrument === pieces[pieces.length - 1].instrument) {
        const first = pieces[0], last = pieces.pop();
        first.points = last.points.concat(first.points.slice(1));
      }
      for (const piece of pieces) {
        output.push(piece);
        if (piece.instrument !== path.instrument) changedSegments++;
      }
    }
    return { paths: output, changedSegments };
  }

  function distanceSquared(point, a, b, width, height) {
    const px = point[0] * width, py = point[1] * height;
    const ax = a[0] * width, ay = a[1] * height;
    const dx = (b[0] - a[0]) * width, dy = (b[1] - a[1]) * height;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSquared) : 0;
    return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
  }

  function nearestPath(paths, point, width, height, maxDistancePx) {
    if (!Array.isArray(paths) || !finitePoint(point) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const limit = maxDistancePx === undefined ? 14 : Number(maxDistancePx);
    if (!(limit >= 0)) return null;
    let best = limit * limit, index = -1;
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p], points = path && path.points;
      if (path && path.tool === 'ERASER' || !Array.isArray(points) || !points.length || points.some(v => !finitePoint(v))) continue;
      let distance = Infinity;
      if (points.length === 1) distance = distanceSquared(point, points[0], points[0], width, height);
      else for (let i = 1; i < points.length; i++) distance = Math.min(distance, distanceSquared(point, points[i - 1], points[i], width, height));
      // Last drawn stroke wins an exact tie, matching its visual stacking order.
      if (distance <= best) { best = distance; index = p; }
    }
    return index < 0 ? null : { index, distance: Math.sqrt(best) };
  }

  root.RegionTools = Object.freeze({ recolor, contains, intersectsPath, nearestPath, version: '1.0.0' });
})(typeof globalThis !== 'undefined' ? globalThis : window);
