// @ts-check
'use strict';

const Rag = require('./Rag');
const Search = require('./Search');

class Chatbot extends Rag {

	/**
	 * @param {{ role?: string, content?: string }[]} messages
	 * @param {{ books?: string|string[], topK?: number, generate?: boolean }} [options]
	 */
	static async chat(messages, options) {
		messages = normalizeMessages(messages);
		var question = latestUserMessage(messages);
		var result = await Rag.answerWithItems(buildContextualQuestion(messages), options);
		result.question = question;
		result.messages = normalizeMessages(messages);
		return result;
	}

}

module.exports = Chatbot;

function latestUserMessage(messages) {
	for (var i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user' && messages[i].content)
			return Search.truncateQuery(messages[i].content);
	}
	return '';
}

function normalizeMessages(messages) {
	if (!Array.isArray(messages))
		return [];
	return messages
		.map(message => ({
			role: message?.role === 'assistant' ? 'assistant' : 'user',
			content: Search.truncateQuery(message?.content || '')
		}))
		.filter(message => message.content);
}

function buildContextualQuestion(messages) {
	var userMessages = messages
		.filter(message => message.role === 'user')
		.map(message => message.content)
		.slice(-3);
	if (userMessages.length < 2)
		return userMessages[0] || '';
	return Search.truncateQuery([
		`Previous context: ${userMessages.slice(0, -1).join(' ')}`,
		`Current question: ${userMessages[userMessages.length - 1]}`
	].join('\n'));
}
