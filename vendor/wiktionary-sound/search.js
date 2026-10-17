import { resolveFiles } from "./resolve.js";

export async function findAudioFiles(word, language) {
  const files = [];
  let imcontinue = null;

  do {
    const url = new URL(`https://${language}.wiktionary.org/w/api.php`);

    url.searchParams.set("action", "query");
    url.searchParams.set("prop", "images");
    url.searchParams.set("format", "json");
    url.searchParams.set("titles", word);
    url.searchParams.set("origin", "*");
    url.searchParams.set("imlimit", "max");

    if (imcontinue) {
      url.searchParams.set("imcontinue", imcontinue);
    }

    const response = await fetch(url);

    const data = await response.json();

    for (const page of Object.values(data.query.pages)) {
      for (const image of page.images ?? []) {
        if (/\.(ogg|wav|mp3)$/i.test(image.title)) {
          files.push(image.title);
        }
      }
    }

    imcontinue = data.continue?.imcontinue ?? null;
  } while (imcontinue);

  return resolveFiles(files, language);
}
