'use strict';

const axios = require('axios');
const Debug = require('./Debug')('hadithdb:BulkTranslations');
const Utils = require('./Utils');

const SUPPORTED_PROVIDERS = new Set(['deepseek', 'openai']);

function optionValue(args, name) {
	const inline = args.find(argument => argument.startsWith(`${name}=`));
	if (inline)
		return inline.slice(name.length + 1);
	const index = args.indexOf(name);
	if (index < 0)
		return null;
	if (!args[index + 1] || args[index + 1].startsWith('--'))
		throw new Error(`${name} requires a value`);
	return args[index + 1];
}

function readOptions(args) {
	const provider = Utils.trimToEmpty(optionValue(args, '--provider')).toLowerCase();
	if (provider && !SUPPORTED_PROVIDERS.has(provider))
		throw new Error('--provider must be deepseek or openai');
	const consumed = new Set();
	for (let index = 0; index < args.length; index++) {
		if (args[index] === '--provider' || args[index] === '--model') {
			consumed.add(index);
			consumed.add(index + 1);
		} else if (args[index].startsWith('--provider=') || args[index].startsWith('--model=')) {
			consumed.add(index);
		}
	}
	return {
		provider: provider || null,
		model: Utils.trimToEmpty(optionValue(args, '--model')) || null,
		positional: args.filter((_argument, index) => !consumed.has(index))
	};
}

function selectedModel(options = {}) {
	const targetLanguage = Utils.trimToEmpty(options.targetLanguage || 'en').toLowerCase();
	const provider = Utils.trimToEmpty(options.provider || (targetLanguage === 'en' ? 'deepseek' : 'openai')).toLowerCase();
	if (!SUPPORTED_PROVIDERS.has(provider))
		throw new Error(`Unsupported bulk translation provider: ${provider}`);
	const settings = provider === 'deepseek' ? global.settings?.deepSeek : global.settings?.openAI;
	if (!Utils.isTruthy(settings?.key))
		throw new Error(`settings.${provider === 'deepseek' ? 'deepSeek' : 'openAI'}.key is required`);
	const model = Utils.trimToEmpty(options.model || settings.model);
	if (!model)
		throw new Error(`settings.${provider === 'deepseek' ? 'deepSeek' : 'openAI'}.model is required`);
	return { provider, model, key: settings.key };
}

async function translate(prompt, options = {}) {
	const selected = selectedModel(options);
	const isDeepSeek = selected.provider === 'deepseek';
	const data = {
		model: selected.model,
		messages: [
			{ role: 'system', content: Utils.classicalIslamicLiteraturePrompt() },
			{ role: 'user', content: prompt }
		],
		...(isDeepSeek ? { thinking: { type: 'disabled' }, reasoning_effort: 'none' } : {})
	};
	const url = isDeepSeek
		? 'https://api.deepseek.com/chat/completions'
		: 'https://api.openai.com/v1/chat/completions';
	const started = Date.now();
	try {
		Debug(`bulk translation start provider=${selected.provider} model=${selected.model}`);
		const response = await axios.post(url, data, {
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${selected.key}`
			}
		});
		Debug(`bulk translation done provider=${selected.provider} model=${selected.model} elapsedMs=${Date.now() - started}`);
		return response.data.choices[0].message.content;
	} catch (error) {
		Debug.error(`bulk translation failed provider=${selected.provider} model=${selected.model} elapsedMs=${Date.now() - started} status=${error.response?.status || 'n/a'}: ${error.response?.statusText || error.message}\n${error.stack || ''}`);
		throw error;
	}
}

module.exports = { readOptions, selectedModel, translate };
