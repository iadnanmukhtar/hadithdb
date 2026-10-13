'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const client = fs.readFileSync(path.join(__dirname, '../public/static/js/script.js'), 'utf8');
function source(name) {
 const start = client.search(new RegExp('(?:async )?function ' + name + '\\('));
 return client.slice(start, client.indexOf('\nfunction ', start + 1));
}

test('image copy starts clipboard write before the asynchronous PNG render completes', async () => {
 let finishRender;
 const png = new Promise(resolve => { finishRender = resolve; });
 const blob = { type: 'image/png' };
 let item;
 const write = jest.fn(async items => { item = items[0]; await item.data['image/png']; });
 const context = vm.createContext({
  window: { html2canvas: true, ClipboardItem: true, toastr: true },
  ClipboardItem: class { constructor(data) { this.data = data; } },
  navigator: { clipboard: { write } }, document: {},
  renderHadithShareImage: jest.fn(() => png),
  toastr: { success: jest.fn(), error: jest.fn() }
 });
 vm.runInContext(source('exportHadithShareCard'), context);
 const button = { disabled: false, innerHTML: 'Copy' };
 const result = context.exportHadithShareCard({ classList: { remove() {} } }, 'copy', button);
 expect(write).toHaveBeenCalledTimes(1);
 expect(item.data['image/png']).toBe(png);
 expect(button.disabled).toBe(true);
 finishRender(blob);
 await result;
 expect(context.toastr.success).toHaveBeenCalledWith('Image copied to clipboard');
 expect(button).toEqual({ disabled: false, innerHTML: 'Copy' });
});

test('a failed PNG render reports failure and restores the copy button', async () => {
 const context = vm.createContext({
  window: { html2canvas: true, ClipboardItem: true, toastr: true },
  ClipboardItem: class { constructor(data) { this.data = data; } },
  navigator: { clipboard: { write: async items => { await items[0].data['image/png']; } } },
  document: {}, renderHadithShareImage: () => Promise.reject(new Error('Render failed')),
  toastr: { success: jest.fn(), error: jest.fn() }
 });
 vm.runInContext(source('exportHadithShareCard'), context);
 const button = { disabled: false, innerHTML: 'Copy' };
 await context.exportHadithShareCard({ classList: { remove() {} } }, 'copy', button);
 expect(context.toastr.error).toHaveBeenCalledWith('Render failed');
 expect(context.toastr.success).not.toHaveBeenCalled();
 expect(button).toEqual({ disabled: false, innerHTML: 'Copy' });
});

test('audio can load metadata and seek before its first play call', async () => {
 const listeners = {};
 const audio = {
  readyState: 0, currentTime: 0,
  addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
  load: jest.fn(() => {
   if (audio.preload === 'none') return;
   audio.readyState = 1;
   for (const fn of listeners.loadedmetadata || []) fn();
  }),
  play: jest.fn(() => Promise.resolve())
 };
 const context = vm.createContext({
  Audio: function () { return audio; }, window: {},
  quranPassageAudioState: { control: {}, playlist: [{ url: 'https://audio.example/001.mp3', startMs: 3690 }], index: 0, requestId: 1 },
  applyQuranPassageAudioPlaybackRate() {}, setQuranPassageAudioHighlight() {}, hideQuranAudioTranslationMarquee() {},
  setQuranPassageAudioPlaying() {}, preloadNextQuranPassageAudio() {}, showQuranAudioTranslationMarquee() {},
  quranPassageAudioSourceUrl: item => item.url
 });
 vm.runInContext(source('quranPassageAudioElement') + '\n' + source('playCurrentQuranPassageAudio'), context);
 context.playCurrentQuranPassageAudio();
 expect(audio.load).toHaveBeenCalledTimes(1);
 expect(audio.play).toHaveBeenCalledTimes(1);
 expect(audio.currentTime).toBe(3.69);
});
