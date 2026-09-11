#!/usr/bin/env node
// Render coverage/coverage-summary.json as a markdown table.
//
// Writes to $GITHUB_STEP_SUMMARY when running in Actions (so the table shows on
// the run page and the PR's checks tab), and to stdout otherwise.

import { readFileSync, appendFileSync } from 'node:fs';
import { relative } from 'node:path';

const SUMMARY_PATH = 'coverage/coverage-summary.json';

let summary;
try {
    summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
} catch {
    // Vitest skips writing the report when the run fails, so this is the normal
    // state after a failing test. Exit 0 and say nothing useful-looking: the job
    // should fail on the test result, not on a missing summary that would bury
    // the real error.
    console.log(`No coverage summary at ${SUMMARY_PATH} (expected if the test run failed).`);
    process.exit(0);
}

const pct = (metric) => `${metric.pct.toFixed(1)}%`;
const ratio = (metric) => `${metric.covered}/${metric.total}`;

const { total } = summary;
const rows = Object.entries(summary)
    .filter(([file]) => file !== 'total')
    // Vitest reports absolute paths; show them relative to the repo so the table
    // does not leak whoever ran it.
    .map(([file, m]) => `| \`${relative(process.cwd(), file) || file}\` | ${pct(m.statements)} | ${pct(m.branches)} | ${pct(m.functions)} | ${pct(m.lines)} |`);

const md = [
    '## Coverage',
    '',
    '| File | Statements | Branches | Functions | Lines |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    `| **Total** | **${pct(total.statements)}** | **${pct(total.branches)}** | **${pct(total.functions)}** | **${pct(total.lines)}** |`,
    '',
    `Lines covered: ${ratio(total.lines)} · statements ${ratio(total.statements)}`,
    '',
    '> Most of this file builds DOM nodes and style strings, which the unit tests',
    '> deliberately do not assert on. Treat the number as a trend rather than a target.',
    ''
].join('\n');

const out = process.env.GITHUB_STEP_SUMMARY;
if (out) {
    appendFileSync(out, md + '\n');
    console.log('Coverage summary written to the job summary.');
}
console.log(md);
