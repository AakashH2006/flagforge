import { describe, expect, it } from 'vitest';
import { challengePoints, rankScore } from '../src/lib/scoring.js';

const rules = { initialPoints: 500, minPoints: 100, decay: 25 };

describe('challengePoints', () => {
  it('is worth full value until a second team solves it', () => {
    expect(challengePoints(rules, 0)).toBe(500);
    expect(challengePoints(rules, 1)).toBe(500);
    expect(challengePoints(rules, 2)).toBeLessThan(500);
  });

  it('falls off slowly at first and never below the minimum', () => {
    const early = challengePoints(rules, 2) - challengePoints(rules, 6);
    const late = challengePoints(rules, 20) - challengePoints(rules, 24);
    expect(late).toBeGreaterThan(early);

    expect(challengePoints(rules, 26)).toBe(100);
    expect(challengePoints(rules, 500)).toBe(100);
  });

  it('never rises as more teams solve it', () => {
    let previous = Infinity;
    for (let solves = 0; solves <= 60; solves++) {
      const points = challengePoints(rules, solves);
      expect(points).toBeLessThanOrEqual(previous);
      previous = points;
    }
  });

  it('keeps a fixed value when the minimum equals the initial value', () => {
    const fixed = { initialPoints: 250, minPoints: 250, decay: 10 };
    expect(challengePoints(fixed, 0)).toBe(250);
    expect(challengePoints(fixed, 99)).toBe(250);
  });
});

describe('rankScore', () => {
  const start = new Date('2026-03-01T10:00:00Z');
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

  it('ranks on points first', () => {
    expect(rankScore(300, at(1), start)).toBeGreaterThan(rankScore(299, at(0), start));
  });

  it('breaks ties in favour of the team that got there first', () => {
    expect(rankScore(300, at(5), start)).toBeGreaterThan(rankScore(300, at(45), start));
  });

  it('puts a team with no solves behind one with points', () => {
    expect(rankScore(0, null, start)).toBeLessThan(rankScore(1, at(600), start));
  });

  it('stays an exact integer, so equal scores really are equal', () => {
    const score = rankScore(10_000, at(1234), start);
    expect(Number.isSafeInteger(score)).toBe(true);
    expect(score).toBe(rankScore(10_000, at(1234), start));
  });

  it('handles solves before the start and past the tie-break window', () => {
    expect(rankScore(100, at(-30), start)).toBe(rankScore(100, start, start));
    expect(rankScore(100, at(100 * 24 * 60), start)).toBeLessThan(rankScore(100, at(1), start));
  });
});
