/* Ember Dash — start.ng integration.
 * Talks to start.ng through its hidden connect page with postMessage.
 * The game never sees passwords or emails; only the player's character.
 */
(function () {
  'use strict';

  const START_NG = 'https://start.ng';
  let frame = null;

  // Creates the hidden connect frame once.
  function connectFrame() {
    if (!frame) {
      frame = new Promise((resolve, reject) => {
        const el = document.createElement('iframe');
        el.src = START_NG + '/connect';
        el.hidden = true;
        el.onload = function () { resolve(el); };
        el.onerror = reject;
        document.body.append(el);
      });
    }
    return frame;
  }

  // Sends a message and resolves to start.ng's reply, or null if it didn't answer.
  async function askStartNg(message, replyType, timeoutMs) {
    const el = await connectFrame();
    return new Promise(function (resolve) {
      const requestId = Math.random().toString(36).slice(2);
      const done = function (reply) {
        clearTimeout(timer);
        removeEventListener('message', onMessage);
        resolve(reply);
      };
      const timer = setTimeout(function () { done(null); }, timeoutMs || 5000);
      function onMessage(e) {
        // Trust replies only from start.ng's connect frame itself.
        if (e.origin !== START_NG || e.source !== el.contentWindow) return;
        if (e.data && e.data.type === replyType && e.data.requestId === requestId) done(e.data);
      }
      addEventListener('message', onMessage);
      el.contentWindow.postMessage(Object.assign({}, message, { requestId: requestId }), START_NG);
    });
  }

  // start.ng's one guest look, used when nobody is signed in (or offline).
  const FALLBACK_STYLE = {
    body: 'female', primaryColor: '#a55eea', secondaryColor: '#0c6e5a',
    skinColor: '#8d5524', hairColor: '#17120f', hair: 'braids', hat: 'none', accessory: 'none'
  };
  const FALLBACK_PLAYER = { name: 'Guest', style: FALLBACK_STYLE, face: null, signedIn: false };

  const api = {
    START_NG: START_NG,
    player: FALLBACK_PLAYER,
    isGuest: true,
    listeners: [],
    asked: false,

    askStartNg: askStartNg,

    // Asks start.ng who's playing. Safe to call repeatedly (tab refocus).
    async refreshPlayer() {
      let reply = null;
      try { reply = await askStartNg({ type: 'startng:whoami' }, 'startng:user', 4000); } catch (e) { reply = null; }
      api.asked = true;
      const before = api.player;
      if (reply && (reply.user || reply.guest)) {
        const user = reply.user || null;
        const guest = reply.guest || null;
        const p = user || guest;
        api.player = {
          id: user ? user.id : null,
          name: (p && p.name) || 'Guest',
          account: user ? user.account : null,
          style: Object.assign({}, FALLBACK_STYLE, (p && p.style) || {}),
          face: (p && p.face) || null,
          signedIn: !!user
        };
      } else {
        api.player = FALLBACK_PLAYER;
      }
      api.isGuest = !api.player.signedIn;
      const changed = JSON.stringify(api.player) !== JSON.stringify(before);
      if (changed) api.listeners.forEach(function (fn) { fn(api.player); });
      return api.player;
    },

    onPlayer(fn) { api.listeners.push(fn); },

    // Where start.ng signs the player in and sends them back.
    signInUrl() {
      return START_NG + '/?return_to=' + encodeURIComponent(location.origin + location.pathname);
    },
    signIn() { location.href = api.signInUrl(); },

    // Saves a run (signed-in players only). stats must match startng.json.
    async saveScore(stats) {
      try {
        return await askStartNg({ type: 'startng:score', stats: stats }, 'startng:scoreSaved', 6000);
      } catch (e) { return null; }
    },

    // Top players, everyone included.
    async fetchLeaderboard(limit) {
      try {
        return await askStartNg({ type: 'startng:leaderboard', limit: limit || 10 }, 'startng:leaderboardData', 6000);
      } catch (e) { return null; }
    }
  };

  window.StartNg = api;
})();
