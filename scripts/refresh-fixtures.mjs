#!/usr/bin/env node
// Regenerate the committed API snapshots in e2e/fixtures/data/.
//
// Run this when the offline tests start failing because the shape of a response
// changed, or when moving the tests to a different set. It makes a handful of
// real API calls, so it is a manual command rather than anything CI does.
//
//   npm run fixtures:refresh            # default set
//   npm run fixtures:refresh -- FIN     # a different expansion

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { get17LandsData, getScryfallCards } from '../e2e/fixtures/live-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'e2e', 'fixtures', 'data');

// Only the fields the userscript actually reads, so the fixtures stay small and
// a change to something irrelevant does not churn the diff.
const CARD_FIELDS = [
    'name', 'mtga_id', 'arena_id', 'color', 'rarity',
    'ever_drawn_win_rate', 'win_rate', 'game_count'
];

const expansion = (process.argv[2] || 'HOB').toUpperCase();

function slimCards(payload) {
    return {
        copyright: payload.copyright,
        data: (payload.data || []).map(card => {
            const out = {};
            for (const field of CARD_FIELDS) {
                if (field in card) out[field] = card[field];
            }
            return out;
        })
    };
}

function write(name, value) {
    mkdirSync(DATA, { recursive: true });
    const path = join(DATA, name);
    writeFileSync(path, JSON.stringify(value, null, 0));
    console.log(`  ${name}  ${(readFileSync(path).length / 1024).toFixed(1)}KB`);
}

console.log(`Refreshing fixtures for ${expansion}...`);

console.log('17Lands:');
write(`17lands-${expansion}.json`, slimCards(await get17LandsData(expansion)));
write(`17lands-${expansion}-WU.json`, slimCards(await get17LandsData(expansion, 'WU')));

// Scryfall ids come from a real draft: the snapshot has to cover whatever cards
// Draftmancer actually opens, and there is no other way to know which those are.
console.log('Scryfall (opening a draft to collect card ids)...');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://draftmancer.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.locator('#bots').fill('7');
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Start', exact: true }).click();
await page.waitForSelector('#booster-controls', { timeout: 30000 });
await page.waitForTimeout(2500);

const ids = new Set();
// Walk a few picks so the snapshot covers more than one pack's worth of cards.
for (let pick = 0; pick < 6; pick++) {
    const found = await page.locator('.card.booster-card img[src*="cards.scryfall.io"]')
        .evaluateAll(imgs => imgs
            .map(img => (img.src.match(/\/([a-f0-9-]{36})\./) || [])[1])
            .filter(Boolean));
    found.forEach(id => ids.add(id));

    const card = page.locator('.card.booster-card').first();
    if (!(await card.count())) break;
    await card.dblclick();
    await page.waitForTimeout(3000);
}
await browser.close();

console.log(`  collected ${ids.size} card ids`);

// Merge into whatever is already there: each draft opens a different subset, so
// the snapshot accumulates coverage instead of churning every refresh.
const namesPath = join(DATA, 'scryfall-names.json');
const names = existsSync(namesPath) ? JSON.parse(readFileSync(namesPath, 'utf8')) : {};

const unknown = [...ids].filter(id => !names[id]);
if (unknown.length) {
    for (let i = 0; i < unknown.length; i += 75) {
        const batch = unknown.slice(i, i + 75);
        const response = await getScryfallCards(batch);
        for (const card of response.data || []) {
            names[card.id] = { id: card.id, name: card.name };
        }
    }
}

write('scryfall-names.json', Object.fromEntries(
    Object.keys(names).sort().map(id => [id, names[id]])));

console.log(`Done. ${unknown.length} new cards added.`);
