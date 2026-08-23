/* jslint node:true, esversion:9 */
'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

class RuntimeRefreshCoordinator {
	constructor(options) {
		options = options || {};
		this.markerFile = options.markerFile || path.join(os.homedir(), '.hadithdb', 'runtime-refresh.generation');
		this.seenGeneration = '';
		this.seenSignature = '';
		this.refreshPromise = null;
	}

	async markCurrent() {
		const state = await this.markerState(true);
		this.seenGeneration = state.generation;
		this.seenSignature = state.signature;
		return state.generation;
	}

	async publish() {
		const generation = `${Date.now()}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
		const directory = path.dirname(this.markerFile);
		const temporaryFile = `${this.markerFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
		await fs.mkdir(directory, { recursive: true });
		await fs.writeFile(temporaryFile, `${generation}\n`, 'utf8');
		await fs.rename(temporaryFile, this.markerFile);
		const state = await this.markerState(true);
		this.seenGeneration = state.generation;
		this.seenSignature = state.signature;
		return state.generation;
	}

	async ensureCurrent(refresh) {
		if (this.refreshPromise)
			return this.refreshPromise;
		const state = await this.markerState(false);
		if (!state.generation || state.generation === this.seenGeneration) {
			this.seenSignature = state.signature;
			return false;
		}
		if (this.refreshPromise)
			return this.refreshPromise;

		this.refreshPromise = (async () => {
			await refresh();
			this.seenGeneration = state.generation;
			this.seenSignature = state.signature;
			return true;
		})();
		try {
			return await this.refreshPromise;
		} finally {
			this.refreshPromise = null;
		}
	}

	middleware(refresh) {
		return async (req, res, next) => {
			try {
				await this.ensureCurrent(refresh);
				next();
			} catch (err) {
				next(err);
			}
		};
	}

	async markerState(forceRead) {
		try {
			const stats = await fs.stat(this.markerFile, { bigint: true });
			const signature = `${stats.dev}:${stats.ino}:${stats.mtimeNs}:${stats.size}`;
			if (!forceRead && signature === this.seenSignature)
				return { generation: this.seenGeneration, signature: signature };
			const generation = (await fs.readFile(this.markerFile, 'utf8')).trim();
			return { generation: generation, signature: signature };
		} catch (err) {
			if (err && err.code === 'ENOENT')
				return { generation: '', signature: 'missing' };
			throw err;
		}
	}
}

const runtimeRefresh = new RuntimeRefreshCoordinator();

module.exports = runtimeRefresh;
module.exports.RuntimeRefreshCoordinator = RuntimeRefreshCoordinator;
