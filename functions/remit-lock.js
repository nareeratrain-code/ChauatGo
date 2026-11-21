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
  const lockWarning = due && !pendingSlip && clock.hour === 21;
  if (cooldownUntilMs > nowMs) {
    return { action: 'keep', notify: false, lockWarning: false, key: clock.key, untilMs: cooldownUntilMs, phase: 'verification_cooldown' };
  }
  // A lock created after 22:00 must survive midnight. Do not clear it just
  // because the new Bangkok date has no completed jobs yet.
  if (lockedUntilMs > nowMs) {
    return { action: 'keep', notify: false, lockWarning: false, key: clock.key, untilMs: lockedUntilMs, phase: 'remit_lock' };
  }
  if (!due) return { action: 'clear', notify: false, lockWarning: false, key: clock.key, minutesToDeadline: 0 };
  if (pendingSlip) return { action: 'hold', notify: notify, lockWarning: false, key: clock.key, minutesToDeadline: minutesUntil(nowMs, 21, 0) };
  if (clock.hour >= 22) {
    return { action: 'lock', notify: notify, lockWarning: false, key: clock.key, untilMs: nowMs + DAY_MS };
  }
  return { action: 'wait', notify: notify, lockWarning: lockWarning, key: clock.key, minutesToDeadline: minutesUntil(nowMs, 21, 0) };
}

// Combine independent policies without allowing a remittance review or sweep
// to clear a risk/safety restriction. The longest active lock wins; ties use
// the higher-priority safety policy.
function effectiveLockPlan(input) {
  const nowMs = Number(input && input.nowMs) || Date.now();
  const policies = [
    { untilMs: Number(input && input.remitLockUntilMs) || 0, reason: 'remit_overdue', priority: 30 },
    { untilMs: Number(input && input.verificationCooldownUntilMs) || 0, reason: 'remit_verified_cooldown', priority: 20 },
    { untilMs: Number(input && input.adminManualUntilMs) || 0, reason: 'admin_manual', priority: 35 },
    { untilMs: Number(input && input.riskRestrictionUntilMs) || 0, reason: 'risk_restriction', priority: 40 },
    { untilMs: Number(input && input.safetySuspensionUntilMs) || 0, reason: 'safety_suspension', priority: 50 }
  ].filter((policy) => policy.untilMs > nowMs);

  policies.sort((left, right) => (
    right.untilMs - left.untilMs || right.priority - left.priority
  ));

  if (!policies.length) return { locked: false, untilMs: 0, reason: null };
  return {
    locked: true,
    untilMs: policies[0].untilMs,
    reason: policies[0].reason
  };
}

module.exports = { bangkokClock, minutesUntil, remitLockPlan, effectiveLockPlan, DAY_MS };
