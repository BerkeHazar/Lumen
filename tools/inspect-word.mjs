/**
 * Belirli bir kelimenin Kaikki kaydını bulup anlam/çeviri ilişkisini döker.
 * Kaynak dosya akış halinde taranır, belleğe alınmaz.
 *
 * Kullanım: node tools/inspect-word.mjs mature
 */
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

const SRC =
  'https://kaikki.org/dictionary/English/words/kaikki.org-dictionary-English-words.jsonl.gz';
const TARGET = (process.argv[2] || 'mature').toLowerCase();

const res = await fetch(SRC);
if (!res.ok) throw new Error('HTTP ' + res.status);

const rl = createInterface({
  input: Readable.fromWeb(res.body).pipe(createGunzip()),
  crlfDelay: Infinity,
});

let seen = 0;
let found = 0;

for await (const line of rl) {
  if (!line) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  seen++;
  if ((e.word || '').toLowerCase() !== TARGET) continue;

  found++;
  console.log('═'.repeat(72));
  console.log(`kayıt ${found}  |  pos: ${e.pos}  |  word: ${e.word}`);
  console.log('═'.repeat(72));

  console.log('\nANLAMLAR (senses):');
  (e.senses || []).slice(0, 12).forEach((s, i) => {
    const g = (s.glosses || [])[0] || '(gloss yok)';
    const tags = (s.tags || []).join(',');
    const trN = (s.translations || []).filter((t) => t.lang === 'Turkish').length;
    console.log(`  ${String(i).padStart(2)}. ${g.slice(0, 78)}`);
    console.log(`      tags:[${tags}]  icindeki TR ceviri: ${trN}`);
  });

  console.log('\nÇEVİRİLER (translations) — hangi anlama bağlı:');
  const rows = [];
  for (const s of e.senses || []) {
    for (const t of s.translations || []) {
      if (t.lang !== 'Turkish' && t.code !== 'tr') continue;
      rows.push({ sense: t.sense || '(sense yok)', word: t.word });
    }
  }
  for (const r of rows.slice(0, 30)) {
    console.log(`   sense="${r.sense.slice(0, 44).padEnd(44)}"  ->  ${r.word}`);
  }
  if (!rows.length) console.log('   (Türkçe çeviri yok)');
  console.log(`   toplam: ${rows.length}`);

  console.log('\nÜST DÜZEY translations var mı:', Array.isArray(e.translations) ? e.translations.length : 'yok');
  if (found >= 3) break;
}

console.log(`\n${seen.toLocaleString('tr-TR')} kayıt tarandı, ${found} eşleşme bulundu`);
