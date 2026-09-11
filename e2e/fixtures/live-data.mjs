// Fetches real 17Lands / Scryfall data from Node, where CORS does not apply,
// and caches it on disk. The page cannot fetch 17Lands itself: the API sends no
// Access-Control-Allow-Origin header, so a browser request from draftmancer.com
// is blocked. The real userscript sidesteps that with GM_xmlhttpRequest, which
// Playwright has no equivalent of - so the tests fetch here and replay the
// response into the page via page.route().
//
// The cache means a full test run hits 17Lands at most once a day rather than
// once per test.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, '.cache');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Scryfall rejects requests that send a default HTTP-library User-Agent with a
// 400, and their API guidelines ask callers to identify themselves. 17Lands gets
// the same courtesy.
const USER_AGENT =
    'mtg-draft-gih-wr-overlay-e2e/1.0 (+https://github.com/cahrehn/userscripts)';

/** Be a good citizen: never issue back-to-back requests to the same host. */
const POLITE_DELAY_MS = 2000;
let lastFetchAt = 0;

async function politePause() {
    const since = Date.now() - lastFetchAt;
    if (lastFetchAt && since < POLITE_DELAY_MS) {
        await new Promise(r => setTimeout(r, POLITE_DELAY_MS - since));
    }
    lastFetchAt = Date.now();
}

function readCache(name) {
    const path = join(CACHE_DIR, name);
    if (!existsSync(path)) return null;
    if (Date.now() - statSync(path).mtimeMs > MAX_AGE_MS) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}

function writeCache(name, data) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, name), JSON.stringify(data));
}

/**
 * Real 17Lands card data for an expansion, cached for a day.
 * `colors` is optional and must already be in WUBRG order.
 */
export async function get17LandsData(expansion, colors = null) {
    const name = `17lands-${expansion}${colors ? `-${colors}` : ''}.json`;
    const cached = readCache(name);
    if (cached) return cached;

    let url = `https://www.17lands.com/api/card_data?expansion=${expansion}` +
              `&event_type=PremierDraft&time_period=ALL_TIME`;
    if (colors) url += `&colors=${colors}`;

    await politePause();
    const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }
    });
    if (!response.ok) {
        throw new Error(`17Lands returned ${response.status} for ${expansion}`);
    }

    const data = await response.json();
    writeCache(name, data);
    return data;
}

/** Real Scryfall names for a batch of ids, cached for a day. */
export async function getScryfallCards(ids) {
    // Key on the exact set of ids: Draftmancer requests a different batch per
    // pack, and a length-plus-first-id key would collide between them.
    const key = `scryfall-${createHash('sha1').update(ids.slice().sort().join(',')).digest('hex').slice(0, 16)}.json`;
    const cached = readCache(key);
    if (cached) return cached;

    await politePause();
    const response = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': USER_AGENT
        },
        body: JSON.stringify({ identifiers: ids.map(id => ({ id })) })
    });
    if (!response.ok) {
        throw new Error(`Scryfall returned ${response.status}`);
    }

    const data = await response.json();
    writeCache(key, data);
    return data;
}
