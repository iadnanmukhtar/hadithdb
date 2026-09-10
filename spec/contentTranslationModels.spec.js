'use strict';

const ContentTranslations = require('../lib/ContentTranslations');

describe('content translation models', () => {
  const originalSettings = global.settings;

  afterEach(() => {
    global.settings = originalSettings;
  });

  test('offers configured OpenAI and DeepSeek models', () => {
    global.settings = {
      openAI: { key: 'openai-key', model: 'gpt-test' },
      deepSeek: { key: 'deepseek-key', model: 'deepseek-flash' },
      payments: { content: { translationModel: 'openai' } }
    };

    expect(ContentTranslations.translationModelOptions()).toEqual([
      { id: 'openai', label: 'OpenAI', provider: 'openai', model: 'gpt-test' },
      { id: 'deepseek', label: 'DeepSeek', provider: 'deepseek', model: 'deepseek-flash' }
    ]);
  });

  test('selects DeepSeek when configured for content translation', () => {
    global.settings = {
      openAI: { key: 'openai-key', model: 'gpt-test' },
      deepSeek: { key: 'deepseek-key', model: 'deepseek-flash' },
      payments: { content: { translationModel: 'deepseek' } }
    };

    expect(ContentTranslations.selectedTranslationModel()).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-flash'
    });
  });

  test('keeps OpenAI as the default selection', () => {
    global.settings = {
      openAI: { key: 'openai-key', model: 'gpt-test' },
      deepSeek: { key: 'deepseek-key', model: 'deepseek-flash' }
    };

    expect(ContentTranslations.selectedTranslationModel().provider).toBe('openai');
  });

  test('can keep DeepSeek specifically for English translations', () => {
    global.settings = {
      openAI: { key: 'openai-key', model: 'gpt-test' },
      deepSeek: { key: 'deepseek-key', model: 'deepseek-flash' },
      payments: {
        content: {
          translationModel: 'openai',
          englishTranslationModel: 'deepseek'
        }
      }
    };

    expect(ContentTranslations.selectedTranslationModel({ code: 'ar' }).provider).toBe('openai');
    expect(ContentTranslations.selectedTranslationModel({ code: 'en' }).provider).toBe('deepseek');
  });

  test('grounds hadith translation in content and book context with b. and bt. name forms', () => {
    const messages = ContentTranslations.buildMessages({
      itemType: 'hadith',
      ref: 'sample:1',
      sourceLanguage: 'Arabic',
      fields: { body: 'نص' },
      promptContext: {
        content_type: 'hadith record',
        book_title: 'Sample Hadith Collection',
        chapter_title: 'Book of Knowledge'
      }
    }, { code: 'en', label: 'English' }, 'translate');

    expect(messages[0].content).toContain('classical Islamic literature');
    expect(messages[0].content).toContain('hadith record with title, isnad, matn');
    expect(messages[0].content).toContain('ibn/bin as "b." and bint as "bt."');
    expect(messages[1].content).toContain('Sample Hadith Collection');
    expect(messages[1].content).toContain('Book of Knowledge');
  });
});
