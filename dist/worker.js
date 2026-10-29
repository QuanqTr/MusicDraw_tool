'use strict';
importScripts('vectorizer.js', 'color-mapper.js');
self.onmessage = function (event) {
  const { id, imageData, options } = event.data;
  try {
    const result = OutlineVectorizer.vectorize(imageData, options);
    if (options.autoColors) {
      const colors = OutlineColors.colorize(result.paths, imageData, { palette: options.palette, invert: options.invert });
      result.coloredPaths = colors.paths; result.colorStats = colors.stats;
      result.warnings.push(...colors.warnings);
    }
    self.postMessage({ id, result });
  }
  catch (error) { self.postMessage({ id, error: String(error.message || error) }); }
};
