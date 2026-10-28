'use strict';
importScripts('vectorizer.js');
self.onmessage = function (event) {
  const { id, imageData, options } = event.data;
  try { self.postMessage({ id, result: OutlineVectorizer.vectorize(imageData, options) }); }
  catch (error) { self.postMessage({ id, error: String(error.message || error) }); }
};
