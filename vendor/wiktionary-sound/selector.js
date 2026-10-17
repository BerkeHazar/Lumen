function normalizeLanguage(lang) {
  if (!lang) return null;

  const map = {
    fra: "fr",
    eng: "en",
    deu: "de",
    spa: "es",
  };

  return map[lang] || lang;
}

function score(file, options = {}) {
  let points = 0;

  const title = file.title.toLowerCase();

  // Prefer requested language
  if (
    options.language &&
    normalizeLanguage(file.language) === options.language
  ) {
    points += 100;
  }

  // Prefer native Wiktionary recordings
  if (!title.includes("ll-q")) {
    points += 50;
  }

  // Prefer ogg
  if (file.extension === "ogg") {
    points += 20;
  }

  // Preferred accent
  if (options.preferredAccent && file.accent === options.preferredAccent) {
    points += 200;
  }

  return points;
}

export function selectBest(files, options = {}) {
  if (!files.length) {
    return null;
  }

  return [...files].sort((a, b) => score(b, options) - score(a, options))[0];
}
