import { describe, expect, it } from 'vitest';
import {
  decideProfile,
  defaultMatchingPreferences,
  defaultMatchingState,
  eligibleProfiles,
  isMatchingPreferences,
  isMatchingState,
  matchedProfiles,
  matchingProfiles,
  resetMatchingRound,
  restoreProfile,
  undoMatching,
} from './matching-model';

describe('matching data and decisions', () => {
  it('contains adult demonstration profiles and never recommends an underage record', () => {
    expect(
      matchingProfiles.every((profile) => Number.isInteger(profile.age) && profile.age >= 18),
    ).toBe(true);
    expect(
      eligibleProfiles([{ ...matchingProfiles[0], age: 17 }], {
        ...defaultMatchingPreferences,
        minAge: 18,
      }),
    ).toEqual([]);
    expect(isMatchingPreferences({ ...defaultMatchingPreferences, minAge: 17 })).toBe(false);
    expect(isMatchingPreferences({ ...defaultMatchingPreferences, minAge: 40, maxAge: 25 })).toBe(
      false,
    );
    expect(isMatchingPreferences({ ...defaultMatchingPreferences, minAge: 18.5 })).toBe(false);
  });

  it('combines adult age, city, gender, intent and any selected interest', () => {
    const filtered = eligibleProfiles(matchingProfiles, {
      minAge: 30,
      maxAge: 35,
      city: '成都',
      gender: 'man',
      intention: 'friends',
      interests: ['摄影', '阅读'],
    });
    expect(filtered.map((profile) => profile.id)).toEqual(['lu-an']);
    expect(
      eligibleProfiles(matchingProfiles, { ...defaultMatchingPreferences, intention: 'date' }).map(
        (profile) => profile.id,
      ),
    ).not.toContain('xu-nian');
    expect(
      eligibleProfiles(matchingProfiles, { ...defaultMatchingPreferences, intention: 'date' }).map(
        (profile) => profile.id,
      ),
    ).toContain('lin-you');
  });

  it('creates a connection only after mutual likes and reverses decisions without duplicates', () => {
    const liked = decideProfile(defaultMatchingState, 'lin-you', 'like');
    expect(matchedProfiles(liked).map((profile) => profile.id)).toEqual(['lin-you']);
    expect(matchedProfiles(decideProfile(defaultMatchingState, 'chen-yu', 'like'))).toEqual([]);
    const replaced = decideProfile(liked, 'lin-you', 'skip');
    expect(replaced.decisions).toHaveLength(1);
    expect(matchedProfiles(replaced)).toEqual([]);
    expect(undoMatching(replaced).decisions).toEqual(liked.decisions);
    expect(restoreProfile(liked, 'lin-you').decisions).toEqual([]);
  });

  it('resets only skips and restores the exact prior round with undo', () => {
    const liked = decideProfile(defaultMatchingState, 'lin-you', 'like');
    const before = decideProfile(liked, 'chen-yu', 'skip');
    const reset = resetMatchingRound(before);
    expect(reset.decisions.map((decision) => decision.profileId)).toEqual(['lin-you']);
    expect(matchedProfiles(reset)).toHaveLength(1);
    expect(undoMatching(reset).decisions).toEqual(before.decisions);
    expect(undoMatching(reset).undo).toBeNull();
  });

  it('rejects unknown, duplicate or malformed persisted records and nested undo data', () => {
    expect(isMatchingState(defaultMatchingState)).toBe(true);
    const decision = { profileId: 'lin-you', choice: 'like', createdAt: 1 };
    expect(isMatchingState({ ...defaultMatchingState, decisions: [decision, decision] })).toBe(
      false,
    );
    expect(
      isMatchingState({
        ...defaultMatchingState,
        decisions: [{ ...decision, profileId: 'unknown' }],
      }),
    ).toBe(false);
    expect(
      isMatchingState({
        ...defaultMatchingState,
        decisions: [{ ...decision, createdAt: Infinity }],
      }),
    ).toBe(false);
    expect(
      isMatchingState({ ...defaultMatchingState, undo: { kind: 'reset', decisions: [null] } }),
    ).toBe(false);
    expect(
      isMatchingState({
        ...defaultMatchingState,
        preferences: { ...defaultMatchingPreferences, interests: ['摄影', '摄影'] },
      }),
    ).toBe(false);
  });
});
