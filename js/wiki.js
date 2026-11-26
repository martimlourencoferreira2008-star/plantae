// Fotografias reais de plantas obtidas em tempo real da Wikipédia (Wikimedia Commons).
// Sem chave de API. Devolve null se não houver imagem (a UI mostra um ícone).
const LS = 'plantae_wiki_v1';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(LS) || '{}'); } catch { cache = {}; }
const inflight = new Map();

function persist() {
  try { localStorage.setItem(LS, JSON.stringify(cache)); } catch { /* quota */ }
}

async function fetchOne(title) {
  for (const lang of ['pt', 'en']) {
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.type === 'disambiguation') continue;
      const thumb = j.thumbnail && j.thumbnail.source;
      if (!thumb) continue;
      return {
        thumb,
        extract: j.extract || '',
        page: (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || '',
        title: j.title || title,
        lang,
      };
    } catch { /* tenta a próxima língua */ }
  }
  return null;
}

export function wikiInfo(title) {
  const key = String(title || '').trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  if (cache[key]) return Promise.resolve(cache[key]);
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchOne(title.trim()).then((out) => {
    inflight.delete(key);
    if (out) { cache[key] = out; persist(); }
    return out;
  });
  inflight.set(key, p);
  return p;
}
