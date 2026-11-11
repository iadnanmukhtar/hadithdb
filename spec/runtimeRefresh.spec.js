'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { RuntimeRefreshCoordinator } = require('../lib/RuntimeRefresh');

describe('multi-worker runtime refresh', () => {
	let directory;
	let markerFile;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hadithdb-runtime-refresh-'));
		markerFile = path.join(directory, 'generation');
	});

	afterEach(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	test('publishes one generation that every other worker applies once', async () => {
		const firstWorker = new RuntimeRefreshCoordinator({ markerFile: markerFile });
		const secondWorker = new RuntimeRefreshCoordinator({ markerFile: markerFile });
		await firstWorker.markCurrent();
		await secondWorker.markCurrent();

		const generation = await firstWorker.publish();
		const refresh = jest.fn().mockResolvedValue();

		await expect(secondWorker.ensureCurrent(refresh)).resolves.toBe(true);
		await expect(secondWorker.ensureCurrent(refresh)).resolves.toBe(false);
		await expect(firstWorker.ensureCurrent(refresh)).resolves.toBe(false);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(generation).toBeTruthy();
	});

	test('content edits invalidate the publishing worker as well as its peer', async () => {
		const first = new RuntimeRefreshCoordinator({ markerFile });
		const second = new RuntimeRefreshCoordinator({ markerFile });
		await first.markCurrent();
		await second.markCurrent();
		await first.publish({ invalidateLocal: true });
		const refreshFirst = jest.fn().mockResolvedValue();
		const refreshSecond = jest.fn().mockResolvedValue();
		await expect(first.ensureCurrent(refreshFirst)).resolves.toBe(true);
		await expect(second.ensureCurrent(refreshSecond)).resolves.toBe(true);
		await expect(first.ensureCurrent(refreshFirst)).resolves.toBe(false);
		expect(refreshFirst).toHaveBeenCalledTimes(1);
		expect(refreshSecond).toHaveBeenCalledTimes(1);
	});

	test('coalesces concurrent requests while a worker refreshes', async () => {
		const publisher = new RuntimeRefreshCoordinator({ markerFile: markerFile });
		const worker = new RuntimeRefreshCoordinator({ markerFile: markerFile });
		await publisher.markCurrent();
		await worker.markCurrent();
		await publisher.publish();

		let resolveRefresh;
		let signalRefreshStarted;
		const refreshStarted = new Promise(resolve => { signalRefreshStarted = resolve; });
		const refresh = jest.fn(() => {
			signalRefreshStarted();
			return new Promise(resolve => { resolveRefresh = resolve; });
		});
		const first = worker.ensureCurrent(refresh);
		const second = worker.ensureCurrent(refresh);
		await refreshStarted;
		resolveRefresh();

		const results = await Promise.all([first, second]);
		expect(results).toContain(true);
		expect(results.every(result => typeof result === 'boolean')).toBe(true);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	test('retries a generation when the worker refresh fails', async () => {
		const publisher = new RuntimeRefreshCoordinator({ markerFile: markerFile });
		const worker = new RuntimeRefreshCoordinator({ markerFile: markerFile });
		await publisher.markCurrent();
		await worker.markCurrent();
		await publisher.publish();

		const refreshError = new Error('refresh failed');
		const refresh = jest.fn()
			.mockRejectedValueOnce(refreshError)
			.mockResolvedValueOnce();

		await expect(worker.ensureCurrent(refresh)).rejects.toBe(refreshError);
		await expect(worker.ensureCurrent(refresh)).resolves.toBe(true);
		expect(refresh).toHaveBeenCalledTimes(2);
	});
});
