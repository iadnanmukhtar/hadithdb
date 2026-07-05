'use strict';

function authConfig() {
	const search = global.settings && global.settings.search ? global.settings.search : {};
	const username = search.username || search.user;
	const password = search.password || search.pass;
	if (!username)
		return {};
	return {
		auth: {
			username: username.toString(),
			password: password === undefined || password === null ? '' : password.toString()
		}
	};
}

function axiosConfig(options) {
	return Object.assign({}, authConfig(), options || {});
}

module.exports = {
	axiosConfig
};
