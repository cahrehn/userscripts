// Committed API fixtures, so the Draftmancer DOM tests can run on every PR
// without touching 17Lands or Scryfall at all.
//
// These tests exist to catch Draftmancer DOM drift. They need *some* plausible
// card data for badges to render, not today's win rates - so they get a
// snapshot. The live APIs are exercised separately by live-api.spec.mjs, which
// runs on a much slower schedule.
//
// Regenerate with: npm run fixtures:refresh

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');

const read = (name) => JSON.parse(readFileSync(join(DATA, name), 'utf8'));

/** 17Lands card data snapshot, optionally the colour-filtered variant. */
export function offline17LandsData(expansion, colors = null) {
    return read(`17lands-${expansion}${colors ? `-${colors}` : ''}.json`);
}

/**
 * Scryfall answers for an arbitrary batch of ids.
 *
 * Draftmancer asks for a different set of cards every draft, so the fixture is
 * an id -> name map rather than a saved response, and the reply is assembled to
 * match whatever was asked for. Ids the snapshot does not know about are simply
 * omitted, exactly as Scryfall does with `not_found`.
 */
export function offlineScryfallCards(ids) {
    const names = read('scryfall-names.json');
    const data = [];
    const notFound = [];

    for (const id of ids) {
        if (names[id]) data.push(names[id]);
        else notFound.push({ id });
    }

    return { object: 'list', not_found: notFound, data };
}

/** Expansions the committed snapshot covers. */
export const OFFLINE_EXPANSION = 'HOB';
