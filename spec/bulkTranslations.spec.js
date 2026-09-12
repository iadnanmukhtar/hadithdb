'use strict';

jest.mock('axios');

const axios = require('axios');
const BulkTranslations = require('../lib/BulkTranslations');

describe('bulk translation provider selection', () => {
	const originalSettings = global.settings;

	afterEach(() => {
		global.settings = originalSettings;
		jest.clearAllMocks();
	});

	beforeEach(() => {
		global.settings = {
			openAI: { key: 'openai-key', model: 'gpt-test' },
			deepSeek: { key: 'deepseek-key', model: 'deepseek-test' }
		};
	});

	test('defaults English bulk translations to DeepSeek', () => {
		expect(BulkTranslations.selectedModel({ targetLanguage: 'en' })).toMatchObject({
			provider: 'deepseek',
			model: 'deepseek-test'
		});
	});

	test('allows an explicit OpenAI provider and model', () => {
		expect(BulkTranslations.selectedModel({
			targetLanguage: 'en',
			provider: 'openai',
			model: 'gpt-explicit'
		})).toMatchObject({
			provider: 'openai',
			model: 'gpt-explicit'
		});
	});

	test('removes provider flags from positional utility arguments', () => {
		expect(BulkTranslations.readOptions(['8', '100', '--provider', 'openai', '--model=gpt-explicit'])).toEqual({
			provider: 'openai',
			model: 'gpt-explicit',
			positional: ['8', '100']
		});
	});

	test('sends the default English request to DeepSeek', async () => {
		axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'Translation' } }] } });

		await expect(BulkTranslations.translate('Translate this.', { targetLanguage: 'en' })).resolves.toBe('Translation');
		expect(axios.post).toHaveBeenCalledWith(
			'https://api.deepseek.com/chat/completions',
			expect.objectContaining({
				model: 'deepseek-test',
				thinking: { type: 'disabled' },
				reasoning_effort: 'none'
			}),
			expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer deepseek-key' }) })
		);
	});
});
