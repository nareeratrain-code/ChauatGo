'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const BANGKOK_MS = 7 * 60 * 60 * 1000;

function bangkokClock(ms) {
  const shifted = new Date((Number(ms) || 0) + BANGKOK_MS);
  return {
    key: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

function minutesUntil(ms, hour, minute) {
  const clock = bangkokClock(ms);
  let diff = (hour * 60 + minute) - (clock.hour * 60 + clock.minute);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

// amount is today's unpaid 20%. A slip already waiting for review does not lock.
// After 22:00 with nothing pending, lock for 24 hours. After an admin verifies
// a slip, keep the rider locked for a separate 24-hour verification cooldown.
function remitLockPlan(input) {
  const nowMs = Number(input && input.nowMs) || 0;
  const amount = Number(input && input.amount) || 0;
  const pendingSlip = !!(input && input.pendingSlip);
  const lockedUntilMs = Number(input && input.lockedUntilMs) || 0;
  const cooldownUntilMs = Number(input && input.cooldownUntilMs) || 0;
  const clock = bangkokClock(nowMs);
  const due = amount > 0;
  const notify = due && clock.hour === 20;
  if (cooldownUntilMs > nowMs) {
    return { action: 'keep', notify: false, key: clock.key, untilMs: cooldownUntilMs, phase: 'verification_cooldown' };
  }
  if (!due) return { action: 'clear', notify: false, key: clock.key, minutesToDeadline: 0 };
  if (pendingSlip) return { action: 'hold', notify: notify, key: clock.key, minutesToDeadline: minutesUntil(nowMs, 21, 0) };
  if (lockedUntilMs > nowMs) return { action: 'keep', notify: notify, key: clock.key, untilMs: lockedUntilMs };
  if (clock.hour >= 22) {
    return { action: 'lock', notify: notify, key: clock.key, untilMs: nowMs + DAY_MS };
  }
  return { action: 'wait', notify: notify, key: clock.key, minutesToDeadline: minutesUntil(nowMs, 21, 0) };
}

module.exports = { bangkokClock, minutesUntil, remitLockPlan, DAY_MS };
