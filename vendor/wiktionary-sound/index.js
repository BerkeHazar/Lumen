import { findAudioFiles } from "./search.js";
import { resolveFiles } from "./resolve.js";
import { selectBest } from "./selector.js";
import { hasCached, getCached, setCached } from "./cache.js";

export async function getSound(word, options = {}) {
  const language = options.language || "en";

  const cacheKey = `${language}:${word}`;

  // Return cached result if available
  if (options.cache !== false && hasCached(cacheKey)) {
    return getCached(cacheKey);
  }

  // Step 1: Find audio filenames
  const audioFiles = await findAudioFiles(word, language);

  if (audioFiles.length === 0) {
    throw new Error(`No pronunciation found for "${word}" (${language})`);
  }

  // Step 2: Resolve Wikimedia URLs
  const files = await resolveFiles(audioFiles, language);

  if (files.length === 0) {
    throw new Error(`No downloadable audio found for "${word}"`);
  }

  // Step 3: Pick best pronunciation
  const best = selectBest(files, options);

  return {
    word,
    sourceLanguage: language,
    files,
    best,
  };

  // Save result
  if (options.cache !== false) {
    setCached(cacheKey, result);
  }

  return result;
}

export { findAudioFiles, resolveFiles, selectBest };
