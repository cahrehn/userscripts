#!/usr/bin/env node
// Jitter for scheduled workflows, without paying for it.
//
// GitHub cron has no randomness: every repo sharing a schedule fires on the same
// minute, which is both a thundering herd and, for an API that is not officially
// public, a predictable pattern of traffic. The obvious fix - `sleep $RANDOM` -
// works, but holds a runner for up to an hour doing nothing.
//
// Instead the workflow lists several scattered cron times, and this guard lets
// exactly one of them through per period. The winning slot comes from a hash of
// the period (today's date, or this week's number), so it is:
//
//   - different from one period to the next, which is the point
//   - stable within a period, so exactly one slot runs - never zero, never two
//   - independent of other repos, since the hash includes the repository name
//
// Usage:  node schedule-guard.mjs <daily|weekly> <slotCount>
//
// Writes `run=true|false` to $GITHUB_OUTPUT. A manual workflow_dispatch always
// passes, so a human asking for a run is never silently dropped.

import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const [period = 'daily', slotCountArg = '6'] = process.argv.slice(2);
const slotCount = Number(slotCountArg);

if (!['daily', 'weekly'].includes(period) || !Number.isInteger(slotCount) || slotCount < 1) {
    console.error('usage: schedule-guard.mjs <daily|weekly> <slotCount>');
    process.exit(1);
}

const emit = (run, reason) => {
    console.log(`${run ? 'RUN' : 'SKIP'}: ${reason}`);
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
    }
};

// A human asked for this explicitly - never second-guess that.
if (process.env.GITHUB_EVENT_NAME && process.env.GITHUB_EVENT_NAME !== 'schedule') {
    emit(true, `event is ${process.env.GITHUB_EVENT_NAME}, not a schedule`);
    process.exit(0);
}

const now = new Date();

/** ISO week number, so "this week" means the same thing across a year boundary. */
function isoWeek(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    // Thursday determines the ISO year the week belongs to
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${week}`;
}

const periodKey = period === 'weekly'
    ? isoWeek(now)
    : now.toISOString().slice(0, 10);

// Include the repo so two repos using this script do not pick the same slot.
const seed = `${process.env.GITHUB_REPOSITORY || 'local'}:${period}:${periodKey}`;
const winningSlot = createHash('sha256').update(seed).digest().readUInt32BE(0) % slotCount;

// Which slot is this run? The cron expression that triggered a run is not
// exposed, so the slot is derived from the time: minutes since the period began,
// bucketed into slotCount equal windows. Two cron times in the same bucket would
// both match, so the workflow spreads them evenly across the period.
const minutesIntoPeriod = period === 'weekly'
    ? (((now.getUTCDay() + 6) % 7) * 1440) + (now.getUTCHours() * 60) + now.getUTCMinutes()
    : (now.getUTCHours() * 60) + now.getUTCMinutes();

const periodMinutes = period === 'weekly' ? 7 * 1440 : 1440;
const currentSlot = Math.min(
    slotCount - 1,
    Math.floor((minutesIntoPeriod / periodMinutes) * slotCount)
);

const detail = `${period} ${periodKey}, slot ${currentSlot} of ${slotCount}, winner ${winningSlot}`;
emit(currentSlot === winningSlot, detail);
