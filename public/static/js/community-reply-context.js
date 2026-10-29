(function () {
  'use strict';
  function show(container, author = {}, html = '', text = '') {
    if (!container) return;
    author = author || {};
    const avatar = document.createElement('span');
    avatar.className = 'community-avatar';
    const name = author.name || 'Community member';
    avatar.textContent = name.trim().slice(0, 1);
    const photo = author.photo || author.avatarFallback;
    if (photo && /^(https?:\/\/|\/(?!\/))/i.test(photo)) {
      const img = document.createElement('img');
      img.alt = ''; img.src = photo; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => { avatar.textContent = name.trim().slice(0, 1); }, {once:true});
      avatar.replaceChildren(img);
    }
    const copy = document.createElement('div'), label = document.createElement('strong'), excerpt = document.createElement('p');
    label.textContent = name;
    label.dir = excerpt.dir = 'auto';
    const parsed = new DOMParser().parseFromString(html || '', 'text/html');
    excerpt.textContent = (html ? parsed.body.textContent : text || '').trim().slice(0, 280);
    copy.append(label, excerpt);
    container.replaceChildren(avatar, copy);
    container.hidden = false;
  }
  window.CommunityReplyContext = {show};
})();
