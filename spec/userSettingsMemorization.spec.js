/* jslint node:true, esversion:9 */
'use strict';

const UserSettings = require('../lib/UserSettings');
const { default_w: defaultFsrsWeights } = require('ts-fsrs');

describe('Quran ayah review settings normalization', () => {
  test.each([
    [undefined, 'uthmani'],
    ['uthmani', 'uthmani'],
    ['indo-pak', 'indo-pak'],
    ['warsh', 'warsh'],
    ['invalid', 'uthmani']
  ])('normalizes Quran script %s to %s', (script, expected) => {
    expect(UserSettings.normalizeSettings({ quran: { script } }).quran.script).toBe(expected);
  });

  test('keeps only supported permanently dismissed Quran tours', () => {
    expect(UserSettings.normalizeSettings({
      quran: { dismissedHelpTours: ['memorize', 'progress', 'study', 'memorize', 'unknown', null] }
    }).quran.dismissedHelpTours).toEqual(['memorize', 'progress', 'study']);
  });

  test('uses bounded-session defaults', () => {
    expect(UserSettings.normalizeSettings({}).memorization).toMatchObject({
      schemaVersion: 1,
      reviewLimit: 10,
      learningLimit: 3,
      relearningLimit: 4,
      weakLimit: 3,
      memorizedLimit: 10,
      reviewTimeBudgetMinutes: 0,
      reviewOrder: 'due_first',
      fsrs: {
        targetRetention: 0.9,
        learningSpeed: 'normal',
        intervalGrowth: 'standard',
        lapseRecovery: 'standard',
        parameters: null,
        optimizedAt: null
      }
    });
  });

  test('removes retired page-level interval settings', () => {
    const memorization = UserSettings.normalizeSettings({
      memorization: { goodReviewDays: 7, easyReviewDays: 14 }
    }).memorization;
    expect(memorization).not.toHaveProperty('goodReviewDays');
    expect(memorization).not.toHaveProperty('easyReviewDays');
  });

  test('accepts the supported queue limits, order, and time budget', () => {
    const memorization = UserSettings.normalizeSettings({
      memorization: {
        reviewLimit: '200',
        learningLimit: '50',
        relearningLimit: '50',
        weakLimit: '50',
        memorizedLimit: '200',
        reviewTimeBudgetMinutes: '240',
        reviewOrder: 'quran_order'
      }
    }).memorization;

    expect(memorization).toMatchObject({
      reviewLimit: 200,
      learningLimit: 50,
      relearningLimit: 50,
      weakLimit: 50,
      memorizedLimit: 200,
      reviewTimeBudgetMinutes: 240,
      reviewOrder: 'quran_order'
    });
  });

  test('falls back safely for out-of-range or unsupported values', () => {
    const memorization = UserSettings.normalizeSettings({
      memorization: {
        reviewLimit: 0,
        learningLimit: 0,
        relearningLimit: 51,
        weakLimit: 51,
        memorizedLimit: 201,
        reviewTimeBudgetMinutes: 241,
        reviewOrder: 'hard_good_easy'
      }
    }).memorization;

    expect(memorization).toMatchObject({
      reviewLimit: 10,
      learningLimit: 3,
      relearningLimit: 4,
      weakLimit: 3,
      memorizedLimit: 10,
      reviewTimeBudgetMinutes: 0,
      reviewOrder: 'due_first'
    });
  });

  test('discards the retired review mode from legacy settings', () => {
    const memorization = UserSettings.normalizeSettings({
      memorization: { reviewMode: 'connected' }
    }).memorization;

    expect(memorization).not.toHaveProperty('reviewMode');
  });

  test.each(['due_first', 'quran_order', 'random'])('retains the %s review order', reviewOrder => {
    expect(UserSettings.normalizeSettings({ memorization: { reviewOrder } }).memorization.reviewOrder)
      .toBe(reviewOrder);
  });

  test('normalizes the simplified FSRS 6 controls and personalized weights', () => {
    const parameters = Array.from(defaultFsrsWeights);
    const fsrs = UserSettings.normalizeSettings({ memorization:{ fsrs:{
      targetRetention:0.95,
      learningSpeed:'fast',
      intervalGrowth:'aggressive',
      lapseRecovery:'strict',
      parameters,
      optimizedAt:'2026-07-31T12:00:00.000Z'
    } } }).memorization.fsrs;
    expect(fsrs).toMatchObject({
      targetRetention:0.95,
      learningSpeed:'fast',
      intervalGrowth:'aggressive',
      lapseRecovery:'strict',
      optimizedAt:'2026-07-31T12:00:00.000Z'
    });
    expect(fsrs.parameters).toHaveLength(21);
  });
});
