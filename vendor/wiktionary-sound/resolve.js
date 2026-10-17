"use strict";

function cleanUrl(url) {
  return url.split("?")[0];
}

function parseAudioMetadata(title) {
  const filename = title.replace("Fichier:", "");

  const lower = filename.toLowerCase();

  // LL-Q files:
  // LL-Q150 (fra)-LoquaxFR-chaussure.wav

  const llMatch = filename.match(/^LL-Q\d+\s+\(([^)]+)\)-([^-]+)-/);

  if (llMatch) {
    return {
      language: llMatch[1],
      speaker: llMatch[2],
      accent: null,
    };
  }

  // Normal files:
  // Fr-chaussure.ogg
  // En-us-hello.ogg

  const parts = filename.split("-");

  let language = null;
  let accent = null;

  if (parts.length >= 2) {
    language = parts[0].toLowerCase();

    if (parts[1].length === 2) {
      accent = parts[1].toLowerCase();
    }
  }

  return {
    language,
    speaker: null,
    accent,
  };
}

export async function resolveFiles(files, language) {
  const titles = files.map((file) =>
    typeof file === "string" ? file : file.title,
  );

  const url = new URL(`https://${language}.wiktionary.org/w/api.php`);

  url.searchParams.set("action", "query");

  url.searchParams.set("format", "json");

  url.searchParams.set("prop", "imageinfo");

  url.searchParams.set("iiprop", "url");

  url.searchParams.set("titles", titles.join("|"));

  url.searchParams.set("origin", "*");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Wikimedia error: ${response.status}`);
  }

  const data = await response.json();

  const results = [];

  for (const page of Object.values(data.query.pages)) {
    if (!page.imageinfo?.length) {
      continue;
    }

    const fileUrl = cleanUrl(page.imageinfo[0].url);

    const extension = page.title.split(".").pop().toLowerCase();

    const metadata = parseAudioMetadata(page.title);

    results.push({
      title: page.title,
      url: fileUrl,
      extension,
      ...metadata,
    });
  }

  return results;
}
