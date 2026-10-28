/* Draw Music 1.8 project format. Classic script; no DOM or package dependencies.
 * Display colors/program metadata follow the user's custom target palette.
 * Format evidence: y1/f grid and horizontal runs; DrawMusicView.o Bresenham;
 * a2/g import/export. Geometry stays continuous; only playback cells are quantized.
 */
(function (root) {
  'use strict';

  const STEPS = 24;
  const ROWS = 32;
  const PALETTE = Object.freeze([
    ['SOFT_KEY', 'Soft Key', '#FFB6D2', 4, true],
    ['MARIMBA', 'Marimba', '#FFF0A8', 12, true],
    ['WARM_SYNTH', 'Warm Synth', '#FFCBA4', 88, true],
    ['BELLS', 'Bells', '#B8E8D0', 14, true],
    ['PLUCK', 'Pluck', '#C5D9B8', 24, true],
    ['FLUTE', 'Flute', '#AEBBFF', 73, true],
    ['STRINGS', 'Strings', '#FF9FAE', 48, false],
    ['CHIME', 'Chime', '#BFDFFF', 10, false],
    ['BASS', 'Bass', '#C8B6FF', 38, false],
    ['EIGHT_BIT', '8 bit', '#FFF4D6', 80, false],
    ['ELECTRONIC_BASS', 'Electronic Bass', '#A8E6E3', 39, false],
    ['GUITAR', 'Guitar', '#E6C8FF', 25, false],
    ['SAXOPHONE', 'Saxophone', '#83D4F7', 65, false]
  ].map(([id, label, color, midiProgram, isFree]) => Object.freeze({ id, label, color, midiProgram, isFree })));
  const INSTRUMENTS = new Set(PALETTE.map(item => item.id));
  const COLORS = Object.fromEntries(PALETTE.map(item => [item.id, item.color]));
  const SCALES = Object.freeze({
    PENTATONIC: [0, 2, 4, 7, 9],
    MAJOR: [0, 2, 4, 5, 7, 9, 11],
    MINOR: [0, 2, 3, 5, 7, 8, 10],
    BLUES: [0, 3, 5, 6, 7, 10],
    CHROMATIC: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    MINOR_PENTATONIC: [0, 3, 5, 7, 10],
    HARMONIC_MINOR: [0, 2, 3, 5, 7, 8, 11],
    DORIAN: [0, 2, 3, 5, 7, 9, 10],
    PHRYGIAN: [0, 1, 3, 5, 7, 8, 10],
    LYDIAN: [0, 2, 4, 6, 7, 9, 11],
    MIXOLYDIAN: [0, 2, 4, 5, 7, 9, 10]
  });
  Object.values(SCALES).forEach(Object.freeze);
  const BEAT_KEYS = Object.freeze([
    'bass', 'drum', 'arpeggio', 'kick', 'snare', 'clap', 'hiHat',
    'hiHatEighths', 'openHat', 'tom'
  ]);
  const TOOLS = new Set(['BRUSH', 'ERASER']);
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const integer = value => Number.isSafeInteger(value);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const all = (array, predicate) => {
    for (const value of array) if (!predicate(value)) return false;
    return true;
  };

  function validPoint(point) {
    return Array.isArray(point) && point.length === 2 &&
      finite(point[0]) && point[0] >= 0 && point[0] <= 1 &&
      finite(point[1]) && point[1] >= 0 && point[1] <= 1;
  }

  function dimensions(steps, rows) {
    if (record(steps)) return dimensions(steps.steps ?? STEPS, steps.rows ?? ROWS);
    if (!integer(steps) || !integer(rows) || steps < 1 || rows < 1 || steps * rows > 1000000) {
      throw new RangeError('Grid dimensions must be positive integers with at most 1,000,000 cells.');
    }
    return [steps, rows];
  }

  function cellsForPoints(points, steps = STEPS, rows = ROWS) {
    [steps, rows] = dimensions(steps, rows);
    if (!Array.isArray(points) || points.length > 100000 || !all(points, validPoint)) {
      throw new TypeError('points must contain at most 100,000 normalized [x, y] pairs.');
    }
    const cells = new Set();
    let previous = null;
    for (const point of points) {
      const x1 = clamp(Math.floor(point[0] * steps), 0, steps - 1);
      const y1 = clamp(Math.floor(point[1] * rows), 0, rows - 1);
      if (previous) {
        let [x0, y0] = previous;
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let error = dx - dy;
        while (true) {
          cells.add(y0 * steps + x0);
          if (x0 === x1 && y0 === y1) break;
          const twice = error * 2;
          if (twice > -dy) { error -= dy; x0 += sx; }
          if (twice < dx) { error += dx; y0 += sy; }
        }
      }
      cells.add(y1 * steps + x1);
      previous = [x1, y1];
    }
    return Array.from(cells);
  }

  function uuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID().toLowerCase();
    }
    const bytes = new Uint8Array(16);
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      root.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function makeProject(paths, options = {}) {
    if (!Array.isArray(paths)) throw new TypeError('paths must be an array.');
    if (!record(options)) throw new TypeError('options must be an object.');
    const now = Date.now();
    const project = {
      version: 1,
      id: options.id ?? uuid(),
      title: options.title ?? 'Outline to Music',
      createdAt: options.createdAt ?? now,
      updatedAt: options.updatedAt ?? now,
      steps: options.steps ?? STEPS,
      rows: options.rows ?? ROWS,
      bpm: options.bpm ?? 120,
      rootMidi: options.rootMidi ?? 48,
      scale: options.scale ?? 'PENTATONIC',
      beats: options.beats ?? { bass: false, drum: false, arpeggio: false },
      showFilledCells: options.showFilledCells ?? false,
      selectedInstrument: options.selectedInstrument ?? options.instrument ?? 'SOFT_KEY',
      selectedTool: options.selectedTool ?? 'BRUSH',
      drawingBackground: options.drawingBackground ?? null,
      strokes: paths.map((path, index) => {
        if (!record(path)) throw new TypeError(`paths[${index}] must be an object.`);
        return {
          instrument: path.instrument ?? options.instrument ?? projectInstrument(options),
          tool: path.tool ?? 'BRUSH',
          points: path.points,
          cells: cellsForPoints(path.points, STEPS, ROWS)
        };
      })
    };
    const result = validateProject(project);
    if (result.errors.length) throw new TypeError(result.errors.join('\n'));
    return result.project;
  }

  function projectInstrument(options) {
    return options.selectedInstrument ?? 'SOFT_KEY';
  }

  function validateProject(value) {
    const errors = [];
    const warnings = [];
    const error = message => { if (errors.length < 80) errors.push(message); };
    const warn = message => { if (warnings.length < 80) warnings.push(message); };
    const unknownFields = (object, known, path) => {
      for (const key of Object.keys(object)) {
        if (!known.includes(key)) warn(`${path}.${key}: field is outside the Draw Music project schema and was omitted.`);
      }
    };
    try {
      if (typeof value === 'string') {
        try { value = JSON.parse(value); }
        catch (_) { return { project: null, errors: ['Invalid JSON.'], warnings }; }
      }
      if (!record(value)) return { project: null, errors: ['Project must be a JSON object.'], warnings };
      if (value.version !== 1) error('version must be 1.');
      if (value.steps !== STEPS || value.rows !== ROWS) error('The supported grid is exactly 24 steps by 32 rows.');
      if (typeof value.id !== 'string' || !UUID.test(value.id)) error('id must be a lowercase UUID.');
      if (typeof value.title !== 'string') error('title must be a string.');
      for (const key of ['createdAt', 'updatedAt']) {
        if (!integer(value[key]) || value[key] < 0) error(`${key} must be a nonnegative safe integer timestamp in milliseconds.`);
      }
      if (integer(value.createdAt) && integer(value.updatedAt) && value.updatedAt < value.createdAt) {
        warn('updatedAt precedes createdAt.');
      }
      if (!finite(value.bpm) || value.bpm <= 0 || value.bpm > 1000) error('bpm must be a finite number greater than 0 and at most 1000.');
      else if (value.bpm < 60 || value.bpm > 200) warn('The Android playback engine clamps tempo to 60–200 BPM.');
      if (!integer(value.rootMidi) || value.rootMidi < 0 || value.rootMidi > 127) error('rootMidi must be an integer from 0 to 127.');
      if (typeof value.scale !== 'string' || !own(SCALES, value.scale)) error('scale must be an official Draw Music scale identifier.');
      if (typeof value.showFilledCells !== 'boolean') error('showFilledCells must be boolean.');
      if (!INSTRUMENTS.has(value.selectedInstrument)) error('selectedInstrument must be one of the 13 official instrument identifiers.');
      if (!TOOLS.has(value.selectedTool)) error('selectedTool must be BRUSH or ERASER.');

      const beats = {};
      if (!record(value.beats)) error('beats must be an object.');
      else {
        for (const key of BEAT_KEYS) {
          if (own(value.beats, key) && typeof value.beats[key] !== 'boolean') error(`beats.${key} must be boolean.`);
          const fallback = ['kick', 'snare', 'hiHat'].includes(key) && value.beats.drum === true;
          beats[key] = own(value.beats, key) ? value.beats[key] : fallback;
        }
        unknownFields(value.beats, BEAT_KEYS, 'beats');
      }

      const strokes = [];
      if (!Array.isArray(value.strokes)) error('strokes must be an array.');
      else if (value.strokes.length > 10000) error('strokes may contain at most 10,000 strokes.');
      else {
        for (let index = 0; index < value.strokes.length; index++) {
          const stroke = value.strokes[index];
          const path = `strokes[${index}]`;
          if (!record(stroke)) { error(`${path} must be an object.`); continue; }
          if (!INSTRUMENTS.has(stroke.instrument)) error(`${path}.instrument is not an official instrument identifier.`);
          if (!TOOLS.has(stroke.tool)) error(`${path}.tool must be BRUSH or ERASER.`);
          let pointsOK = true;
          if (!Array.isArray(stroke.points) || stroke.points.length > 100000) {
            pointsOK = false;
            error(`${path}.points must be an array of at most 100,000 points.`);
          } else if (!all(stroke.points, validPoint)) {
            pointsOK = false;
            error(`${path}.points must contain finite normalized [x, y] pairs in [0, 1].`);
          }
          let cellsOK = true;
          if (!Array.isArray(stroke.cells) || stroke.cells.length > STEPS * ROWS ||
              !all(stroke.cells, cell => integer(cell) && cell >= 0 && cell < STEPS * ROWS)) {
            cellsOK = false;
            error(`${path}.cells must be an array of at most 768 integer cell IDs in [0, 767].`);
          }
          const cells = cellsOK ? Array.from(new Set(stroke.cells)) : [];
          if (cellsOK && cells.length !== stroke.cells.length) warn(`${path}.cells: duplicate IDs were removed, as by Android's LinkedHashSet.`);
          if (pointsOK && cellsOK) {
            const calculated = cellsForPoints(stroke.points);
            if (calculated.length !== cells.length || calculated.some((cell, cellIndex) => cell !== cells[cellIndex])) {
              warn(`${path}.cells differs from rerasterized points; stored cells were preserved because Android imports them as playback data.`);
            }
            if (!stroke.points.length && cells.length) warn(`${path}: playback cells exist without visible geometry.`);
          }
          unknownFields(stroke, ['instrument', 'tool', 'points', 'cells'], path);
          strokes.push({ instrument: stroke.instrument, tool: stroke.tool,
            points: pointsOK ? stroke.points.map(point => [point[0], point[1]]) : [], cells });
        }
      }

      let drawingBackground = null;
      if (value.drawingBackground !== undefined && value.drawingBackground !== null) {
        const background = value.drawingBackground;
        if (!record(background)) error('drawingBackground must be null or a background object.');
        else {
          const allowed = ['color', 'gradient', 'radial', 'asset_photo', 'local_photo'];
          if (!allowed.includes(background.type)) error('drawingBackground.type is not supported.');
          const opacity = background.opacity ?? 1;
          if (!finite(opacity) || opacity < 0 || opacity > 1) error('drawingBackground.opacity must be in [0, 1].');
          drawingBackground = { type: background.type, opacity };
          const intColor = key => {
            if (!integer(background[key]) || background[key] < -2147483648 || background[key] > 2147483647) {
              error(`drawingBackground.${key} must be an Android signed 32-bit color integer.`);
            }
            drawingBackground[key] = background[key];
          };
          if (background.type === 'color') {
            intColor('color');
            if (own(background, 'custom') && typeof background.custom !== 'boolean') error('drawingBackground.custom must be boolean.');
            drawingBackground.custom = background.custom ?? false;
          } else if (background.type === 'gradient' || background.type === 'radial') {
            intColor('startColor'); intColor('endColor');
          } else if (background.type === 'asset_photo' || background.type === 'local_photo') {
            const path = background.path;
            const validPath = typeof path === 'string' && (background.type === 'asset_photo'
              ? path.startsWith('background/') && !path.split('/').includes('..')
              : /^backgrounds\/[a-f0-9-]{36}\.png$/.test(path));
            if (!validPath) error('drawingBackground.path does not match the Android background path format.');
            drawingBackground.path = path;
            warn('The imported photo backdrop is metadata only; this local renderer does not load Android asset or device photo paths.');
          }
        }
      }
      unknownFields(value, [
        'version', 'id', 'title', 'createdAt', 'updatedAt', 'steps', 'rows', 'bpm',
        'rootMidi', 'scale', 'beats', 'showFilledCells', 'selectedInstrument',
        'selectedTool', 'drawingBackground', 'strokes'
      ], 'project');
      if (errors.length) return { project: null, errors, warnings };
      return { project: {
        version: 1, id: value.id, title: value.title, createdAt: value.createdAt,
        updatedAt: value.updatedAt, steps: STEPS, rows: ROWS, bpm: value.bpm,
        rootMidi: value.rootMidi, scale: value.scale, beats,
        showFilledCells: value.showFilledCells, selectedInstrument: value.selectedInstrument,
        selectedTool: value.selectedTool, drawingBackground, strokes
      }, errors, warnings };
    } catch (_) {
      error('Project contains unreadable or non-JSON data.');
      return { project: null, errors, warnings };
    }
  }

  function bounds(input) {
    const paths = record(input) && Array.isArray(input.strokes) ? input.strokes : input;
    if (!Array.isArray(paths)) return null;
    const normalizedPaths = paths.length && validPoint(paths[0]) ? [{ points: paths }] : paths;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const path of normalizedPaths) {
      if (!record(path) || !Array.isArray(path.points) || path.tool === 'ERASER') continue;
      for (const point of path.points) {
        if (!validPoint(point)) continue;
        minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
      }
    }
    return minX === Infinity ? null : {
      minX, minY, maxX, maxY, x: minX, y: minY, width: maxX - minX, height: maxY - minY
    };
  }

  function notesForProject(value) {
    const validation = validateProject(value);
    if (!validation.project) throw new TypeError(validation.errors.join('\n'));
    const project = validation.project;
    const grid = Array(STEPS * ROWS).fill(null);
    for (const stroke of project.strokes) {
      for (const cell of stroke.cells) grid[cell] = stroke.tool === 'ERASER' ? null : stroke.instrument;
    }
    const notes = [];
    for (let row = 0; row < ROWS; row++) {
      let col = 0;
      while (col < STEPS) {
        const instrument = grid[row * STEPS + col];
        if (instrument === null) { col++; continue; }
        let length = 1;
        while (col + length < STEPS && grid[row * STEPS + col + length] === instrument) length++;
        notes.push({ startStep: col, lengthSteps: length, row, instrument });
        col += length;
      }
    }
    return { notes, grid, warnings: validation.warnings, stats: {
      strokeCount: project.strokes.length,
      pointCount: project.strokes.reduce((total, stroke) => total + stroke.points.length, 0),
      occupiedCells: grid.reduce((total, cell) => total + (cell !== null ? 1 : 0), 0),
      noteCount: notes.length,
      instruments: Array.from(new Set(notes.map(note => note.instrument))),
      loopSeconds: STEPS * 60 / (3 * clamp(project.bpm, 60, 200)),
      bounds: bounds(project)
    } };
  }

  function androidColor(number) {
    const rgba = number >>> 0;
    return `rgba(${(rgba >>> 16) & 255},${(rgba >>> 8) & 255},${rgba & 255},${(rgba >>> 24) / 255})`;
  }

  function renderProject(ctx, value, options = {}) {
    if (!ctx || typeof ctx.save !== 'function') throw new TypeError('A 2D canvas context is required.');
    const validation = validateProject(value);
    if (!validation.project) throw new TypeError(validation.errors.join('\n'));
    const project = validation.project;
    const width = options.width ?? (ctx.canvas && ctx.canvas.width);
    const height = options.height ?? (ctx.canvas && ctx.canvas.height);
    const strokeWidth = options.strokeWidth ?? 6;
    const opacity = options.opacity ?? 200 / 255;
    if (!finite(width) || !finite(height) || width <= 0 || height <= 0 || !finite(strokeWidth) || strokeWidth <= 0) {
      throw new RangeError('Canvas width, height, and strokeWidth must be positive finite numbers.');
    }
    if (!finite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('opacity must be in [0, 1].');
    ctx.save();
    try {
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const stroke of project.strokes) {
        if (stroke.tool === 'ERASER') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#000';
          for (const cell of stroke.cells) {
            const col = cell % STEPS, row = Math.floor(cell / STEPS);
            ctx.fillRect(col * width / STEPS, row * height / ROWS, width / STEPS, height / ROWS);
          }
          continue;
        }
        const points = stroke.points;
        if (!points.length) continue;
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = COLORS[stroke.instrument]; ctx.fillStyle = COLORS[stroke.instrument];
        ctx.beginPath();
        if (points.length === 1 || (points.length === 2 && points[0][0] === points[1][0] && points[0][1] === points[1][1])) {
          ctx.arc(points[0][0] * width, points[0][1] * height, strokeWidth / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.moveTo(points[0][0] * width, points[0][1] * height);
          for (let index = 1; index < points.length; index++) ctx.lineTo(points[index][0] * width, points[index][1] * height);
          ctx.stroke();
        }
      }
      // Android clears an isolated stroke layer; paint the backdrop behind that layer.
      if (options.background !== null) {
        ctx.globalCompositeOperation = 'destination-over'; ctx.globalAlpha = 1;
        const background = project.drawingBackground;
        if (!own(options, 'background') && background && ['color', 'gradient', 'radial'].includes(background.type)) {
          ctx.globalAlpha = background.opacity;
          if (background.type === 'color') ctx.fillStyle = androidColor(background.color);
          else {
            const gradient = background.type === 'radial'
              ? ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.min(width, height) / 2)
              : ctx.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, androidColor(background.startColor));
            gradient.addColorStop(1, androidColor(background.endColor));
            ctx.fillStyle = gradient;
          }
          ctx.fillRect(0, 0, width, height);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = options.background ?? '#fff'; ctx.fillRect(0, 0, width, height);
      }
    } finally { ctx.restore(); }
    return { bounds: bounds(project), warnings: validation.warnings };
  }

  root.MusicFormat = Object.freeze({
    PALETTE, SCALES, BEAT_KEYS, STEPS, ROWS,
    makeProject, validateProject, cellsForPoints, bounds, notesForProject, renderProject
  });
})(globalThis);
