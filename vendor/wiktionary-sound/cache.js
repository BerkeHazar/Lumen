const cache = new Map();

export function getCached(key) {
  return cache.get(key);
}

export function setCached(key, value) {
  cache.set(key, value);
}

export function hasCached(key) {
  return cache.has(key);
}
