/* Ember Dash — an endless lava-runner.
 * Flee the eruption across crumbling obsidian platforms: leap gaps, slide under
 * basalt arches, dodge flame vents and grab crystals. Your start.ng character runs.
 * Plain canvas 2D, no dependencies.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- helpers
  const $ = function (id) { return document.getElementById(id); };
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const lerp = function (a, b, t) { return a + (b - a) * t; };
  const rand = function (a, b) { return a + Math.random() * (b - a); };
  const randInt = function (a, b) { return Math.floor(rand(a, b + 1)); };
  const pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

  // ---------------------------------------------------------------- canvas
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, u = 1, dpr = 1; // u = scale unit (1 at 720px tall window)

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    u = clamp(H / 720, 0.62, 1.35);
    physics();
  }

  // ------------------------------------------------------------ gameplay constants
  let K = {};
  function physics() {
    const boostCap = 1.045; // max crystal speed-boost; gaps are generated for it
    K.grav = 2600 * u;
    K.jumpV = 980 * u;
    K.djumpV = 930 * u;
    K.speed0 = 330 * u;
    K.speedAccel = 9 * u;      // per second
    K.speedMax = 760 * u;
    K.playerW = 16 * u;
    K.playerH = 42 * u;
    K.slideH = 20 * u;
    K.groundY = Math.round(H * 0.8);
    K.maxGapFactor = 0.66 * boostCap; // fraction of current speed a normal gap may span
    K.wideGapFactor = 0.95;           // gaps that need a double jump
    K.ventW = 26 * u; K.ventH = 32 * u;
    K.archW = 62 * u; K.archBottom = 26 * u; // clearance under the arch
    K.crystalR = 9 * u;
    K.lavaCatchUp = 1000 * u; // beyond this distance the lava hurries
    K.lavaMercy = 175 * u;    // closer than this the lava eases off
    K.figH = 44 * u;          // drawn character height
  }

  // ---------------------------------------------------------------- state
  const S = {
    mode: 'title',          // title | playing | dying | gameover
    paused: false,
    t: 0,
    speed: 0, speedBase: 0, boostStacks: 0, boostTimer: 0,
    dist: 0,                // metres run
    crystals: 0,
    camX: 0,
    shake: 0,
    player: { x: 0, y: 0, vy: 0, onGround: true, jumps: 0, sliding: false, rot: 0, tumble: false, stumble: 0 },
    lavaX: 0, lavaSurge: 0, lavaSurgeT: 0, lavaNextSurge: 0, lavaWarn: 0,
    platforms: [], vents: [], arches: [], gems: [],
    particles: [], banners: [],
    gen: { x: 0, lastGap: false, sinceObstacle: 0 },
    milestone: 0,
    deathReason: '', dead: false, engulfedT: 0,
    best: { distance: 0, crystals: 0 },
    bestSource: 'you',
    saveState: 'idle', saveText: '', saveWarn: false,
    board: null, boardLoaded: false,
    titleBob: 0
  };

  const STORAGE_KEY = 'emberdash_best_v1';
  function loadBest() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const b = JSON.parse(raw);
        if (b && typeof b.distance === 'number') S.best = b;
      }
    } catch (e) { /* storage may be unavailable */ }
  }
  function saveBest() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S.best)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- audio
  const Sound = {
    ctx: null, master: null, muted: false, rumbleGain: null,
    ensure() {
      if (Sound.ctx) { if (Sound.ctx.state === 'suspended') Sound.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      Sound.ctx = new AC();
      Sound.master = Sound.ctx.createGain();
      Sound.master.gain.value = Sound.muted ? 0 : 0.5;
      Sound.master.connect(Sound.ctx.destination);
      // low lava rumble, gain driven by proximity
      const len = Sound.ctx.sampleRate * 2;
      const buf = Sound.ctx.createBuffer(1, len, Sound.ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = last * 0.98 + (Math.random() * 2 - 1) * 0.02; data[i] = last; }
      const src = Sound.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filt = Sound.ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 180;
      Sound.rumbleGain = Sound.ctx.createGain();
      Sound.rumbleGain.gain.value = 0;
      src.connect(filt); filt.connect(Sound.rumbleGain); Sound.rumbleGain.connect(Sound.master);
      src.start();
    },
    setMuted(m) {
      Sound.muted = m;
      if (Sound.master) Sound.master.gain.value = m ? 0 : 0.5;
      try { localStorage.setItem('emberdash_muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    },
    env(freq, dur, type, vol, slideTo) {
      const c = Sound.ctx; if (!c) return;
      const o = c.createOscillator(); const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), c.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.3, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(Sound.master);
      o.start(); o.stop(c.currentTime + dur + 0.02);
    },
    noise(dur, vol, freq) {
      const c = Sound.ctx; if (!c) return;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 900;
      const g = c.createGain(); g.gain.value = vol || 0.25;
      src.connect(f); f.connect(g); g.connect(Sound.master);
      src.start();
    },
    jump() { Sound.env(340, 0.16, 'square', 0.16, 700); },
    djump() { Sound.env(520, 0.18, 'square', 0.15, 980); },
    land() { Sound.noise(0.07, 0.12, 300); },
    slide() { Sound.noise(0.22, 0.16, 500); },
    gem() { Sound.env(880, 0.12, 'triangle', 0.22, 1480); Sound.env(1320, 0.18, 'sine', 0.12, 1760); },
    milestone() { Sound.env(660, 0.12, 'triangle', 0.2); setTimeout(function () { Sound.env(990, 0.18, 'triangle', 0.2); }, 110); },
    surge() { Sound.env(90, 0.7, 'sawtooth', 0.18, 220); },
    death() { Sound.noise(0.6, 0.35, 250); Sound.env(300, 0.7, 'sawtooth', 0.2, 50); },
    best() { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { Sound.env(f, 0.22, 'triangle', 0.18); }, i * 120); }); }
  };
  try { Sound.muted = localStorage.getItem('emberdash_muted') === '1'; } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------- input
  const keys = {};
  let jumpQueued = false, slideHeld = false;

  function queueJump() {
    Sound.ensure();
    if (S.mode === 'title') { startRun(); return; }
    if (S.mode === 'gameover') { startRun(); return; }
    if (S.mode !== 'playing' || S.paused) return;
    jumpQueued = true;
  }
  function setSlide(v) {
    slideHeld = v;
    if (S.mode === 'playing' && v && S.player.onGround && !S.player.sliding) Sound.slide();
  }

  window.addEventListener('keydown', function (e) {
    if (e.repeat) {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
      return;
    }
    keys[e.code] = true;
    switch (e.code) {
      case 'Space': case 'ArrowUp': case 'KeyW': e.preventDefault(); queueJump(); break;
      case 'ArrowDown': case 'KeyS': e.preventDefault(); setSlide(true); break;
      case 'KeyP': case 'Escape': togglePause(); break;
      case 'KeyM': toggleMute(); break;
      case 'Enter': if (S.mode === 'title' || S.mode === 'gameover') queueJump(); break;
    }
  });
  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') setSlide(false);
  });

  canvas.addEventListener('pointerdown', function () { queueJump(); });

  const btnJump = $('btn-jump'), btnSlide = $('btn-slide');
  btnJump.addEventListener('pointerdown', function (e) { e.preventDefault(); queueJump(); });
  btnSlide.addEventListener('pointerdown', function (e) { e.preventDefault(); setSlide(true); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
    btnSlide.addEventListener(ev, function () { setSlide(false); });
  });
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) $('touch-controls').hidden = false;

  function togglePause() {
    if (S.mode !== 'playing' && S.mode !== 'paused') return;
    S.paused = !S.paused;
    $('pause').hidden = !S.paused;
  }
  function toggleMute() {
    Sound.ensure();
    Sound.setMuted(!Sound.muted);
    $('mute-btn').innerHTML = Sound.muted ? '&#128263;' : '&#128266;';
  }
  $('mute-btn').innerHTML = Sound.muted ? '&#128263;' : '&#128266;';
  $('mute-btn').addEventListener('click', toggleMute);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && S.mode === 'playing' && !S.paused) togglePause();
    if (!document.hidden && window.StartNg) window.StartNg.refreshPlayer();
  });
  window.addEventListener('focus', function () { if (window.StartNg) window.StartNg.refreshPlayer(); });
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------- world generation
  function difficulty() { return clamp(S.dist / 1600, 0, 1); } // 0..1 over 1600 m

  function generate() {
    const gen = S.gen;
    const ahead = S.camX + W * 1.6;
    while (gen.x < ahead) {
      const d = difficulty();
      // platform
      const platW = rand(lerp(200, 320, d), lerp(380, 620, d)) * u;
      const plat = { x: gen.x, w: platW };
      S.platforms.push(plat);
      // obstacles inside the platform
      const margin = 90 * u + K.playerW;
      if (gen.sinceObstacle > lerp(420, 240, d) * u && platW > 320 * u && Math.random() < lerp(0.55, 0.9, d)) {
        const ox = gen.x + rand(margin, platW - margin);
        const type = Math.random() < (0.55 - 0.25 * d) ? 'vent' : 'arch';
        if (type === 'vent') {
          S.vents.push({ x: ox, w: K.ventW, h: K.ventH, phase: rand(0, 6.28) });
          if (d > 0.55 && Math.random() < 0.35) S.vents.push({ x: ox + K.ventW + rand(30, 60) * u, w: K.ventW, h: K.ventH, phase: rand(0, 6.28) });
        } else {
          S.arches.push({ x: ox - K.archW / 2, w: K.archW });
        }
        gen.sinceObstacle = 0;
      } else {
        gen.sinceObstacle += platW;
      }
      // crystals over the platform
      if (Math.random() < 0.8) {
        const n = randInt(3, 6);
        const startX = gen.x + rand(margin * 0.5, platW - n * 34 * u - margin * 0.5);
        const arc = Math.random() < 0.5;
        for (let i = 0; i < n; i++) {
          const t = n > 1 ? i / (n - 1) : 0.5;
          const lift = arc ? Math.sin(t * Math.PI) * 90 * u : 0;
          S.gems.push({ x: startX + i * 34 * u, y: K.groundY - (60 + lift) * u, got: false, phase: rand(0, 6.28) });
        }
      }
      gen.x += platW;
      // gap
      const gapChance = lerp(0.5, 0.95, d);
      if (Math.random() < gapChance) {
        const speed = Math.max(S.speed, K.speed0);
        const wide = d > 0.25 && Math.random() < lerp(0.1, 0.28, d);
        const gapW = wide
          ? rand(0.72, K.wideGapFactor) * speed
          : rand(0.34, K.maxGapFactor) * speed;
        gen.x += gapW;
        // crystals arcing over the gap
        if (Math.random() < 0.85) {
          const n = randInt(3, 5);
          for (let i = 0; i < n; i++) {
            const t = n > 1 ? (i + 0.5) / n : 0.5;
            S.gems.push({ x: gen.x - gapW + gapW * t, y: K.groundY - (70 + Math.sin(t * Math.PI) * 120) * u, got: false, phase: rand(0, 6.28) });
          }
        }
        gen.sinceObstacle += gapW;
        gen.lastGap = true;
      } else {
        gen.lastGap = false;
      }
    }
    // cull what's far behind
    const cull = S.camX - W;
    S.platforms = S.platforms.filter(function (p) { return p.x + p.w > cull; });
    S.vents = S.vents.filter(function (p) { return p.x + p.w > cull; });
    S.arches = S.arches.filter(function (p) { return p.x + p.w > cull; });
    S.gems = S.gems.filter(function (p) { return !p.got && p.x > cull; });
  }

  function groundAt(x) {
    for (let i = 0; i < S.platforms.length; i++) {
      const p = S.platforms[i];
      if (x >= p.x && x <= p.x + p.w) return K.groundY;
    }
    return null;
  }

  // ---------------------------------------------------------------- particles
  function spawnEmbers(n) {
    for (let i = 0; i < n; i++) {
      S.particles.push({
        kind: 'ember',
        x: S.camX + rand(-50, W + 50), y: H + rand(10, 80),
        vx: rand(-25, 25), vy: rand(-140, -60),
        life: rand(1.4, 3), age: 0, size: rand(1.5, 3.5) * u, hue: rand(14, 38)
      });
    }
  }
  function spawnBurst(x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(0.2, 1) * (power || 200) * u;
      S.particles.push({
        kind: 'burst', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 * u,
        life: rand(0.4, 0.9), age: 0, size: rand(2, 4.5) * u, color: color
      });
    }
  }
  function spawnDust(x, y) {
    for (let i = 0; i < 6; i++) {
      S.particles.push({
        kind: 'dust', x: x + rand(-6, 6) * u, y: y + rand(-3, 1) * u,
        vx: rand(-90, -20) * u, vy: rand(-70, -10) * u,
        life: rand(0.3, 0.6), age: 0, size: rand(2.5, 5) * u
      });
    }
  }
  function updateParticles(dt) {
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.age += dt;
      if (p.age >= p.life) { S.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'burst') p.vy += 700 * u * dt;
      if (p.kind === 'ember') { p.vx += Math.sin(p.age * 3 + p.size) * 12 * dt; }
    }
  }

  // ---------------------------------------------------------------- run lifecycle
  function startRun() {
    physics();
    S.mode = 'playing';
    S.paused = false;
    $('pause').hidden = true;
    $('title').hidden = true;
    $('gameover').hidden = true;
    $('hud').hidden = false;
    S.speed = S.speedBase = K.speed0;
    S.boostStacks = 0; S.boostTimer = 0;
    S.dist = 0; S.crystals = 0; S.milestone = 0;
    S.platforms = [{ x: -600 * u, w: 2600 * u }];
    S.vents = []; S.arches = []; S.gems = []; S.particles = []; S.banners = [];
    S.gen = { x: 2000 * u, lastGap: false, sinceObstacle: 999 };
    S.player = { x: 120 * u, y: K.groundY, vy: 0, onGround: true, jumps: 0, sliding: false, rot: 0, tumble: false, stumble: 0 };
    S.lavaX = S.player.x - 1150 * u;
    S.lavaSurge = 0; S.lavaSurgeT = 0; S.lavaNextSurge = rand(8, 12); S.lavaWarn = 0;
    S.camX = S.player.x - W * 0.3;
    S.shake = 0; S.dead = false; S.deathReason = ''; S.engulfedT = 0;
    S.saveState = 'idle'; S.saveText = ''; S.saveWarn = false;
    generate();
    updateHud();
  }

  function die(reason) {
    if (S.mode !== 'playing') return;
    S.mode = 'dying';
    S.deathReason = reason;
    S.shake = 16 * u;
    Sound.death();
    spawnBurst(S.player.x, S.player.y - K.playerH * 0.5, '#ff8a2b', 26, 280);
    if (reason === 'fall') S.player.tumble = true;
  }

  function finishDeath() {
    S.mode = 'gameover';
    $('hud').hidden = true;
    const distance = Math.floor(S.dist);
    const crystals = Math.floor(S.crystals);
    const isNewBest = distance > S.best.distance;
    if (isNewBest) { S.best = { distance: distance, crystals: crystals }; saveBest(); }
    $('result-dist').textContent = distance + ' m';
    $('result-crystals').textContent = String(crystals);
    $('result-best').textContent = S.best.distance + ' m';
    $('gameover').hidden = false;
    if (isNewBest) Sound.best();
    refreshBoard();
    saveScore(distance, crystals);
  }

  async function saveScore(distance, crystals) {
    const msg = $('save-message');
    const ng = window.StartNg;
    if (!ng || !ng.player.signedIn) {
      msg.className = 'save-message warn';
      msg.textContent = 'Sign in to save your score to the leaderboard';
      return;
    }
    msg.className = 'save-message';
    msg.textContent = 'Saving your run…';
    const reply = await ng.saveScore({ distance: distance, crystals: crystals });
    if (reply && reply.ok && reply.result) {
      const r = reply.result;
      msg.textContent = r.improved
        ? 'New personal best! You’re #' + r.rank + ' on the leaderboard'
        : 'Saved — you’re #' + r.rank + ' on the leaderboard';
      if (r.stats && typeof r.stats.distance === 'number' && r.stats.distance > S.best.distance) {
        S.best = { distance: r.stats.distance, crystals: r.stats.crystals || 0 };
        saveBest();
        $('result-best').textContent = S.best.distance + ' m';
      }
      refreshBoard();
    } else if (reply && reply.ok === false) {
      msg.className = 'save-message warn';
      msg.textContent = reply.error || 'Could not save this run';
      if (/sign in/i.test(reply.error || '')) { ng.player.signedIn = false; showSignIn(true); }
    } else {
      msg.className = 'save-message warn';
      msg.textContent = 'Could not reach start.ng — play again to retry saving';
    }
  }

  function renderBoard(list) {
    if (!list) return;
    const board = list.closest('.board');
    if (!window.StartNg || !S.board || !S.board.entries || !S.board.entries.length) {
      if (board) board.hidden = true;
      return;
    }
    const myId = window.StartNg.player.id;
    const statLabel = function (e) {
      const d = e.stats && typeof e.stats.distance === 'number' ? e.stats.distance : e.score;
      const c = e.stats && typeof e.stats.crystals === 'number' ? e.stats.crystals : null;
      return { d: d, c: c };
    };
    list.replaceChildren.apply(list, S.board.entries.slice(0, 10).map(function (e) {
      const li = document.createElement('li');
      if (myId != null && e.player_id === myId) li.className = 'me';
      const v = statLabel(e);
      li.innerHTML = '<span class="rank">#' + e.rank + '</span><span class="name"></span>' +
        '<span class="dist">' + v.d + ' m</span>' +
        '<span class="gems">' + (v.c == null ? '' : '\u{1F48E} ' + v.c) + '</span>';
      li.querySelector('.name').textContent = e.name || 'Runner';
      return li;
    }));
    board.hidden = false;
  }

  async function refreshBoard() {
    const ng = window.StartNg;
    if (!ng) return;
    const reply = await ng.fetchLeaderboard(10);
    if (reply && reply.ok) {
      S.board = reply;
      renderBoard($('title-board-list'));
      renderBoard($('gameover-board-list'));
    } else if (!ng.asked) {
      // never heard from start.ng (e.g. opened as a local file): hide boards
      const t = $('title-board'); if (t) t.hidden = true;
      const g = $('gameover-board'); if (g) g.hidden = true;
    }
  }

  // ---------------------------------------------------------------- update
  let lastT = 0;
  function update(dt) {
    S.t += dt;
    S.titleBob += dt;
    if (S.mode === 'title') {
      updateParticles(dt);
      if (Math.random() < 0.35) spawnEmbers(1);
      S.lavaX = S.player.x - 1150 * u; // lava idles far behind on the title screen
      return;
    }
    if (S.paused) return;

    const P = S.player;

    if (S.mode === 'playing') {
      // speed: grows over time, small boost from crystals
      S.speedBase = Math.min(S.speedBase + K.speedAccel * dt, K.speedMax);
      if (S.boostTimer > 0) {
        S.boostTimer -= dt;
        if (S.boostTimer <= 0 && S.boostStacks > 0) S.boostStacks--;
      }
      const boost = 1 + 0.015 * S.boostStacks;
      S.speed = S.speedBase * boost;

      P.x += S.speed * dt;
      S.dist = P.x / (10 * u); // 10px = 1 metre

      // milestone banners
      const m = Math.floor(S.dist / 250);
      if (m > S.milestone) {
        S.milestone = m;
        S.banners.push({ text: (m * 250) + ' m', age: 0, life: 1.4, y: H * 0.3 });
        Sound.milestone();
      }

      // jump
      if (jumpQueued) {
        jumpQueued = false;
        if (P.onGround) {
          P.vy = -K.jumpV; P.onGround = false; P.jumps = 1; P.sliding = false;
          Sound.jump(); spawnDust(P.x, P.y);
        } else if (P.jumps < 2) {
          P.vy = -K.djumpV; P.jumps = 2;
          Sound.djump(); spawnBurst(P.x, P.y - 10 * u, '#ffd15c', 8, 120);
        }
      }

      // gravity
      P.vy += K.grav * dt;
      P.y += P.vy * dt;
      const g = groundAt(P.x + K.playerW * 0.2);
      const wasAir = !P.onGround;
      if (g != null && P.y >= g && P.vy >= 0) {
        P.y = g; P.vy = 0;
        if (!P.onGround) { P.onGround = true; P.jumps = 0; if (wasAir) { Sound.land(); spawnDust(P.x, P.y); } }
      } else if (g == null || P.y < g - 0.5) {
        P.onGround = false;
      }
      // fell off the world
      if (P.y > K.groundY + 120 * u) die('fall');

      // sliding
      const wantSlide = slideHeld || keys.ArrowDown || keys.KeyS;
      P.sliding = !!(wantSlide && P.onGround);
      if (!P.onGround && wantSlide && P.vy > 0) P.vy += K.grav * 0.9 * dt; // fast-fall for snappy platforming

      // collision boxes
      const ph = P.sliding ? K.slideH : K.playerH;
      const box = { x: P.x - K.playerW / 2, y: P.y - ph, w: K.playerW, h: ph };
      for (let i = 0; i < S.vents.length; i++) {
        const v = S.vents[i];
        if (box.x < v.x + v.w && box.x + box.w > v.x && box.y + box.h > K.groundY - v.h && box.y < K.groundY) { die('vent'); break; }
      }
      for (let i = 0; i < S.arches.length; i++) {
        const a = S.arches[i];
        const bottom = K.groundY - K.archBottom;
        if (box.x < a.x + a.w && box.x + box.w > a.x && box.y < bottom) { die('arch'); break; }
      }
      // crystals
      for (let i = 0; i < S.gems.length; i++) {
        const gm = S.gems[i];
        if (gm.got) continue;
        const dx = gm.x - P.x, dy = (gm.y) - (P.y - ph * 0.55);
        if (dx * dx + dy * dy < (K.crystalR + 16 * u) * (K.crystalR + 16 * u)) {
          gm.got = true;
          S.crystals++;
          S.boostTimer = 2.6; S.boostStacks = Math.min(S.boostStacks + 1, 3);
          Sound.gem();
          spawnBurst(gm.x, gm.y, '#7df9ff', 10, 150);
        }
      }

      // lava
      S.lavaNextSurge -= dt;
      if (S.lavaSurgeT > 0) {
        S.lavaSurgeT -= dt;
        if (S.lavaSurgeT <= 0) S.lavaSurge = 0;
      } else if (S.lavaNextSurge <= 0) {
        S.lavaSurge = 1; S.lavaSurgeT = 2.4; S.lavaNextSurge = rand(10, 16);
        S.shake = Math.max(S.shake, 6 * u);
        Sound.surge();
      }
      const gapAhead = P.x - S.lavaX;
      let lavaSpeed = S.speed * 0.955;
      if (gapAhead > K.lavaCatchUp) lavaSpeed += 55 * u;
      if (gapAhead < K.lavaMercy) lavaSpeed -= 45 * u;
      if (S.lavaSurge) lavaSpeed = S.speed * 1.13;
      S.lavaX += Math.max(0, lavaSpeed) * dt;
      if (P.x - S.lavaX < 26 * u) die('lava');

      // heat bar
      const heat = clamp(1 - (P.x - S.lavaX) / (1150 * u), 0, 1);
      $('heat-bar').style.width = Math.round(heat * 100) + '%';

      // embers
      if (Math.random() < 0.5) spawnEmbers(1);

      updateHud();
    } else if (S.mode === 'dying') {
      // the lava surges in and swallows the runner
      P.x += S.speed * 0.35 * dt;
      if (P.tumble || S.deathReason === 'lava') {
        P.vy += K.grav * dt; P.y += P.vy * dt; P.rot += dt * 5;
        if (groundAt(P.x) != null && P.y > K.groundY) { P.y = K.groundY; P.vy = 0; }
      }
      S.lavaX += S.speed * 1.55 * dt;
      S.shake = Math.max(S.shake, 8 * u);
      spawnEmbers(2);
      if (Math.random() < 0.5) spawnBurst(S.lavaX + 20 * u, K.groundY - rand(0, 60) * u, '#ff7a2f', 2, 200);
      if (S.lavaX >= P.x - 10 * u) {
        S.engulfedT += dt;
        if (S.engulfedT > 0.45) finishDeath();
      }
    }

    // banners float up and fade
    for (let i = S.banners.length - 1; i >= 0; i--) {
      const b = S.banners[i];
      b.age += dt; b.y -= 30 * dt;
      if (b.age > b.life) S.banners.splice(i, 1);
    }

    updateParticles(dt);
    S.camX = lerp(S.camX, P.x - W * 0.3, 1 - Math.pow(0.001, dt));
    if (S.shake > 0) S.shake = Math.max(0, S.shake - 40 * u * dt);
    if (Sound.rumbleGain) {
      const heat = clamp(1 - (P.x - S.lavaX) / (1150 * u), 0, 1);
      const rumble = (S.mode === 'playing' || S.mode === 'dying') ? 0.12 + heat * 0.5 : 0;
      Sound.rumbleGain.gain.value = Number.isFinite(rumble) ? rumble : 0;
    }
    if (S.mode === 'playing') generate();
    jumpQueued = false;
  }

  function updateHud() {
    $('hud-dist').textContent = Math.floor(S.dist) + ' m';
    $('hud-crystals').textContent = String(S.crystals);
    const bestPill = $('hud-best-pill');
    if (S.best.distance > 0) { bestPill.hidden = false; $('hud-best').textContent = S.best.distance + ' m'; }
  }

  // ---------------------------------------------------------------- character drawing
  function drawCharacter(c, style, o) {
    // o: { x, y (feet), scale, phase, pose: run|jump|slide|idle|dead, rot }
    const s = o.scale;
    const ph = o.phase || 0;
    const st = style || {};
    const skin = st.skinColor || '#8d5524';
    const shirt = st.primaryColor || '#a55eea';
    const pants = st.secondaryColor || '#0c6e5a';
    const hair = st.hairColor || '#17120f';
    const female = st.body === 'female';
    const pose = o.pose || 'idle';

    c.save();
    c.translate(o.x, o.y);
    if (o.rot) c.rotate(o.rot);
    c.scale(s, s);
    c.lineCap = 'round';
    c.lineJoin = 'round';

    // figure is 44 units tall; feet at 0, head top at -44
    const swing = Math.sin(ph * Math.PI * 2);
    const swing2 = Math.cos(ph * Math.PI * 2);

    let legA = 0, legB = 0, armA = 0, armB = 0, lean = 0, bodyDrop = 0;
    if (pose === 'run') { legA = swing * 0.95; legB = -swing * 0.95; armA = -swing * 0.8; armB = swing * 0.8; lean = 0.1; bodyDrop = Math.abs(swing2) * -1.2; }
    else if (pose === 'jump') { legA = 0.75; legB = -0.35; armA = -1.9; armB = -1.2; lean = 0.16; }
    else if (pose === 'fall') { legA = 0.4; legB = -0.7; armA = -2.4; armB = -2.0; lean = -0.1; }
    else { legA = 0.06; legB = -0.06; armA = 0.12; armB = -0.12; bodyDrop = Math.sin(o.idleT ? o.idleT * 2.2 : 0) * 0.8; }

    if (pose === 'slide') {
      // horizontal pose, low to the ground
      c.rotate(-1.15);
      c.translate(4, -6);
    } else {
      c.rotate(lean * 0.35);
      c.translate(0, bodyDrop);
    }

    const hipY = -20, shoulderY = -32, headY = -38, headR = 6.6;

    function limb(x0, y0, angle, len, color, width) {
      c.strokeStyle = color; c.lineWidth = width;
      c.beginPath(); c.moveTo(x0, y0);
      const kx = x0 + Math.sin(angle) * len * 0.55, ky = y0 + Math.cos(angle) * len * 0.55;
      const fx = x0 + Math.sin(angle) * len, fy = y0 + Math.cos(angle) * len;
      c.quadraticCurveTo(kx, ky, fx, fy);
      c.stroke();
      return { x: fx, y: fy };
    }

    // back limbs first (darker)
    c.globalAlpha = 0.85;
    const backFoot = limb(0, hipY, legB, 19, shade(pants, -0.28), 5.4);
    const backHand = limb(0, shoulderY + 1, armB, 14, shade(skin, -0.25), 4.4);
    c.globalAlpha = 1;

    // backpack behind the torso
    if (st.accessory === 'backpack') {
      c.fillStyle = shade(pants, -0.15);
      roundRect(c, -9.5, shoulderY - 3.5, 7.5, 13, 3);
      c.fill();
    }

    // scarf tail flows behind
    if (st.accessory === 'scarf') {
      c.strokeStyle = shade(pants, 0.12); c.lineWidth = 3.4;
      c.beginPath(); c.moveTo(-2, shoulderY + 2.5);
      c.quadraticCurveTo(-10, shoulderY + 4 + Math.sin(ph * 6.28) * 2, -16, shoulderY + 9 + Math.sin(ph * 6.28 + 1) * 3);
      c.stroke();
    }

    // torso
    c.fillStyle = shirt;
    const tw = female ? 10.5 : 12;
    c.beginPath();
    c.moveTo(-tw / 2, hipY + 1.5);
    c.lineTo(-tw / 2 + (female ? 0 : 0.4), shoulderY);
    c.quadraticCurveTo(0, shoulderY - 2.2, tw / 2, shoulderY);
    c.lineTo(tw / 2, hipY + 1.5);
    if (female) { c.lineTo(tw / 2 + 2.4, hipY + 5); c.lineTo(-tw / 2 - 2.4, hipY + 5); } // skirt flare
    c.closePath(); c.fill();

    // front leg
    limb(0, hipY, legA, 19, pants, 5.6);
    // front arm (sleeve in shirt colour, hand in skin)
    const hand = limb(0, shoulderY + 1, armA, 8.5, shirt, 4.6);
    limb(hand.x, hand.y, armA * 0.5 + 0.25, 6, skin, 4.2);

    // head
    c.fillStyle = skin;
    c.beginPath(); c.arc(2.2, headY, headR, 0, 6.29); c.fill();
    // neck
    c.fillStyle = skin;
    c.fillRect(0.4, headY + 4, 3.4, 4);

    // hair
    const hairKind = st.hair || 'short';
    drawHair(c, hairKind, headY, headR);

    // hat
    drawHat(c, st.hat || 'none', headY, headR);

    // face
    c.fillStyle = '#1d1512';
    c.beginPath(); c.arc(4.6, headY - 1.1, 1.15, 0, 6.29); c.fill();
    if (st.accessory === 'glasses') {
      c.strokeStyle = '#20242b'; c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(-0.4, headY - 1.6); c.lineTo(6.4, headY - 1.6); c.stroke();
      c.fillStyle = 'rgba(30,40,55,.75)';
      roundRect(c, 2.6, headY - 3.2, 4.2, 3.4, 1.2); c.fill();
    }
    if (st.accessory === 'earrings') {
      c.fillStyle = '#ffd15c';
      c.beginPath(); c.arc(-1.4, headY + 2.4, 1.15, 0, 6.29); c.fill();
    }
    if (st.accessory === 'beard') {
      c.fillStyle = hair;
      c.beginPath();
      c.arc(2.6, headY + 2.2, 4.6, 0.25, Math.PI - 0.4);
      c.closePath(); c.fill();
    }

    c.restore();

    function drawHair(c, kind, hy, hr) {
      c.fillStyle = hair;
      const t = o.phase ? Math.sin(o.phase * 6.28) : 0;
      switch (kind) {
        case 'bald': break;
        case 'afro':
          c.beginPath(); c.arc(1.2, hy - hr * 0.7, hr * 1.25, 0, 6.29); c.fill();
          break;
        case 'braids':
          c.beginPath(); c.arc(1.6, hy - 1.4, hr + 0.7, Math.PI * 0.95, Math.PI * 2.05); c.fill();
          c.strokeStyle = hair; c.lineWidth = 2.6;
          c.beginPath(); c.moveTo(-2.4, hy - 1); c.quadraticCurveTo(-6, hy + 5 + t * 2, -5, hy + 11 + t * 3); c.stroke();
          c.beginPath(); c.moveTo(-0.6, hy - 3); c.quadraticCurveTo(-8.6, hy + 2 - t * 2, -9.6, hy + 8 - t * 2); c.stroke();
          break;
        case 'bun':
          c.beginPath(); c.arc(1.6, hy - 1.4, hr + 0.7, Math.PI * 0.95, Math.PI * 2.05); c.fill();
          c.beginPath(); c.arc(-1.8, hy - hr - 1.4, 3.4, 0, 6.29); c.fill();
          break;
        case 'ponytail':
          c.beginPath(); c.arc(1.6, hy - 1.4, hr + 0.7, Math.PI * 0.95, Math.PI * 2.05); c.fill();
          c.strokeStyle = hair; c.lineWidth = 3.2;
          c.beginPath(); c.moveTo(-2.6, hy - 2.6);
          c.quadraticCurveTo(-9, hy + t * 3, -13.5, hy + 4 + t * 4);
          c.stroke();
          break;
        case 'dreads':
          c.beginPath(); c.arc(1.6, hy - 1.4, hr + 0.7, Math.PI * 0.95, Math.PI * 2.05); c.fill();
          c.strokeStyle = hair; c.lineWidth = 2.1;
          for (let i = 0; i < 4; i++) {
            const sx = -3.4 + i * 1.7;
            c.beginPath(); c.moveTo(sx, hy - 1);
            c.quadraticCurveTo(sx - 3 - i * 0.4, hy + 4 + t * 1.5, sx - 3.6 - i * 0.5, hy + 8.5 + t * 2 + i * 0.8);
            c.stroke();
          }
          break;
        default: // short
          c.beginPath(); c.arc(1.6, hy - 1.4, hr + 0.6, Math.PI * 0.92, Math.PI * 2.08); c.fill();
      }
    }

    function drawHat(c, kind, hy, hr) {
      switch (kind) {
        case 'cap':
          c.fillStyle = shirt;
          c.beginPath(); c.arc(1.6, hy - 1.8, hr + 0.9, Math.PI * 1.02, Math.PI * 2.02); c.fill();
          c.fillRect(-3.4, hy - 3.4, 5, 1.8);
          c.beginPath(); c.ellipse(6.6, hy - 2.6, 4.6, 1.5, 0, 0, 6.29); c.fill();
          break;
        case 'beanie':
          c.fillStyle = pants;
          c.beginPath(); c.arc(1.6, hy - 1.6, hr + 1.1, Math.PI * 1.0, Math.PI * 2.0); c.fill();
          c.fillRect(-4.8, hy - 3.6, 12.6, 3);
          break;
        case 'tophat':
          c.fillStyle = '#232028';
          c.beginPath(); c.ellipse(1.8, hy - hr + 0.6, 7.6, 2.1, 0, 0, 6.29); c.fill();
          c.fillRect(-3.6, hy - hr - 10.5, 10.8, 11);
          c.fillStyle = shirt; c.fillRect(-3.6, hy - hr - 3.4, 10.8, 2.2);
          c.beginPath(); c.ellipse(1.8, hy - hr - 10.5, 5.4, 1.7, 0, 0, 6.29); c.fill();
          break;
        case 'crown':
          c.fillStyle = '#ffd15c';
          c.beginPath();
          c.moveTo(-4.4, hy - hr + 1.4);
          c.lineTo(-4.4, hy - hr - 4.6); c.lineTo(-1.6, hy - hr - 1.4);
          c.lineTo(1.6, hy - hr - 6); c.lineTo(4.6, hy - hr - 1.4);
          c.lineTo(7.6, hy - hr - 4.6); c.lineTo(7.6, hy - hr + 1.4);
          c.closePath(); c.fill();
          c.fillStyle = '#ff6a3d';
          c.beginPath(); c.arc(1.6, hy - hr - 2.2, 1.2, 0, 6.29); c.fill();
          break;
      }
    }
  }

  function shade(hex, amt) {
    const c = hexToRgb(hex);
    const f = function (v) { return Math.round(clamp(v + 255 * amt, 0, 255)); };
    return 'rgb(' + f(c.r) + ',' + f(c.g) + ',' + f(c.b) + ')';
  }
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 140, g: 85, b: 36 };
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---------------------------------------------------------------- render
  function render() {
    const t = S.t;
    const cam = S.camX + (S.shake > 0 ? rand(-S.shake, S.shake) : 0);
    const shakeY = S.shake > 0 ? rand(-S.shake, S.shake) * 0.4 : 0;

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2b1220');
    sky.addColorStop(0.45, '#5c1e26');
    sky.addColorStop(0.78, '#a83a24');
    sky.addColorStop(1, '#e0642a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // sun
    const sunX = W * 0.72 - cam * 0.02 % W, sunY = H * 0.34;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 220 * u);
    sunGrad.addColorStop(0, 'rgba(255,214,140,.95)');
    sunGrad.addColorStop(0.25, 'rgba(255,160,80,.55)');
    sunGrad.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(sunX - 260 * u, sunY - 260 * u, 520 * u, 520 * u);
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath(); ctx.arc(sunX, sunY, 54 * u, 0, 6.29); ctx.fill();

    drawVolcanoLayer(cam * 0.06, H * 0.56, '#3a1420', 150 * u, 0.9, true);
    drawVolcanoLayer(cam * 0.12, H * 0.64, '#2c1017', 120 * u, 1.35, false);
    drawSpireLayer(cam * 0.3, H * 0.72, '#20090f');

    // lava sea below the platforms
    drawLavaSea(cam, t);

    // platforms
    for (let i = 0; i < S.platforms.length; i++) drawPlatform(S.platforms[i], cam);

    // crystals
    for (let i = 0; i < S.gems.length; i++) {
      const g = S.gems[i];
      if (g.got) continue;
      drawGem(g, cam, t);
    }

    // obstacles
    for (let i = 0; i < S.vents.length; i++) drawVent(S.vents[i], cam, t);
    for (let i = 0; i < S.arches.length; i++) drawArch(S.arches[i], cam);

    // lava wall (the chaser)
    drawLavaWall(cam, t);

    // player
    drawPlayer(cam, t);

    // particles
    drawParticles(cam);

    // milestone banners
    for (let i = 0; i < S.banners.length; i++) {
      const b = S.banners[i];
      const a = 1 - b.age / b.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffd15c';
      ctx.font = '900 ' + Math.round(40 * u) + 'px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.text, W / 2, b.y);
      ctx.globalAlpha = 1;
    }

    // surge warning glow
    if (S.lavaSurge || S.lavaNextSurge < 1.2) {
      const pulse = S.lavaSurge ? 0.35 : 0.14 * (1 - S.lavaNextSurge / 1.2) * (0.6 + 0.4 * Math.sin(t * 14));
      const gg = ctx.createLinearGradient(0, H, 0, H * 0.4);
      gg.addColorStop(0, 'rgba(255,70,30,' + pulse + ')');
      gg.addColorStop(1, 'rgba(255,70,30,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, W, H);
    }

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.45, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(20,4,8,.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    function drawVolcanoLayer(off, baseY, color, amp, jag, erupting) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      const step = 90 * u;
      const start = -((off) % step) - step;
      for (let x = start; x <= W + step; x += step) {
        const seed = Math.floor((x + off) / step);
        const h = (Math.sin(seed * 12.9898) * 43758.5453) % 1;
        const y = baseY - Math.abs(h) * amp * jag;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      if (erupting) {
        // erupting volcano with glowing crater
        const vx = W * 0.5 - (off % (W * 2.4)) + W * 1.2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(vx - 230 * u, baseY + 60 * u);
        ctx.lineTo(vx - 34 * u, baseY - 150 * u);
        ctx.lineTo(vx + 34 * u, baseY - 150 * u);
        ctx.lineTo(vx + 230 * u, baseY + 60 * u);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,120,50,.85)';
        ctx.beginPath(); ctx.ellipse(vx, baseY - 150 * u, 30 * u, 7 * u, 0, 0, 6.29); ctx.fill();
        // ash plume
        ctx.fillStyle = 'rgba(60,25,25,.55)';
        for (let i = 0; i < 5; i++) {
          const py = baseY - 160 * u - i * 34 * u - (t * 8 % 34) * u;
          ctx.beginPath();
          ctx.arc(vx + Math.sin(i * 2 + t * 0.6) * 22 * u + i * 6 * u, py, (16 + i * 9) * u, 0, 6.29);
          ctx.fill();
        }
      }
    }

    function drawSpireLayer(off, baseY, color) {
      ctx.fillStyle = color;
      const step = 260 * u;
      const start = -((off) % step) - step;
      for (let x = start; x <= W + step; x += step) {
        const seed = Math.floor((x + off) / step);
        const h = ((Math.sin(seed * 78.233) * 43758.5453) % 1 + 1) % 1;
        const hgt = (40 + h * 90) * u;
        ctx.beginPath();
        ctx.moveTo(x - 30 * u, baseY);
        ctx.lineTo(x, baseY - hgt);
        ctx.lineTo(x + 30 * u, baseY);
        ctx.closePath();
        ctx.fill();
      }
    }

    function drawLavaSea(cam2, time) {
      const top = K.groundY + 4 * u;
      const grad = ctx.createLinearGradient(0, top, 0, H);
      grad.addColorStop(0, '#ff9b3d');
      grad.addColorStop(0.35, '#ff5d20');
      grad.addColorStop(1, '#b1260f');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 14 * u) {
        const worldX = x + cam2;
        const y = top + Math.sin(worldX * 0.012 / u + time * 2.2) * 3.5 * u + Math.sin(worldX * 0.031 / u - time * 3.1) * 2 * u;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      // glow
      const glow = ctx.createLinearGradient(0, top - 40 * u, 0, top + 30 * u);
      glow.addColorStop(0, 'rgba(255,140,50,0)');
      glow.addColorStop(1, 'rgba(255,150,60,.35)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, top - 40 * u, W, 70 * u);
    }

    function drawPlatform(p, cam2) {
      const x0 = p.x - cam2, x1 = p.x + p.w - cam2;
      if (x1 < -10 || x0 > W + 10) return;
      const top = K.groundY, depth = H - top + 30 * u;
      // body
      const g = ctx.createLinearGradient(0, top, 0, top + depth);
      g.addColorStop(0, '#2a1c22');
      g.addColorStop(0.25, '#1d1218');
      g.addColorStop(1, '#120a0e');
      ctx.fillStyle = g;
      ctx.fillRect(x0, top, p.w, depth);
      // top crust highlight
      ctx.fillStyle = '#4a2f2a';
      ctx.fillRect(x0, top, p.w, 3.5 * u);
      ctx.fillStyle = '#6b4030';
      ctx.fillRect(x0, top, p.w, 1.4 * u);
      // glowing cracks
      ctx.strokeStyle = 'rgba(255,110,40,.55)';
      ctx.lineWidth = 1.6 * u;
      const cstep = 46 * u;
      let wx = Math.ceil(p.x / cstep) * cstep;
      for (; wx < p.x + p.w; wx += cstep) {
        const sx = wx - cam2;
        if (sx < -20 || sx > W + 20) continue;
        const seed = Math.round(wx / cstep);
        const flick = 0.5 + 0.5 * Math.sin(t * 3 + seed * 2.4);
        ctx.globalAlpha = 0.25 + flick * 0.4;
        ctx.beginPath();
        ctx.moveTo(sx, top + 6 * u);
        ctx.lineTo(sx + ((seed % 3) - 1) * 8 * u, top + (14 + (seed % 5) * 6) * u);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // rough bottom edge
      ctx.fillStyle = '#0d070a';
      ctx.beginPath();
      ctx.moveTo(x0, top + depth);
      for (let x = x0; x <= x1; x += 24 * u) {
        const seed = Math.floor((x + p.x) / (24 * u));
        const h = (((Math.sin(seed * 91.7) * 43758.5) % 1) + 1) % 1;
        ctx.lineTo(x, top + depth - (6 + h * 20) * u);
      }
      ctx.lineTo(x1, top + depth);
      ctx.closePath();
      ctx.fill();
    }

    function drawGem(g, cam2, time) {
      const x = g.x - cam2;
      if (x < -40 || x > W + 40) return;
      const y = g.y + Math.sin(time * 2.4 + g.phase) * 4 * u;
      const r = K.crystalR;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(time * 1.6 + g.phase) * 0.25);
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 3);
      glow.addColorStop(0, 'rgba(120,240,255,.55)');
      glow.addColorStop(1, 'rgba(120,240,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-r * 3, -r * 3, r * 6, r * 6);
      ctx.fillStyle = '#8ef7ff';
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 0.85, 0); ctx.lineTo(0, r * 1.25); ctx.lineTo(-r * 0.85, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 0.85, 0); ctx.lineTo(0, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    function drawVent(v, cam2, time) {
      const x = v.x - cam2 + v.w / 2;
      if (x < -80 || x > W + 80) return;
      const f = 0.85 + 0.15 * Math.sin(time * 9 + v.phase);
      const h = v.h * f;
      // vent ring on the ground
      ctx.fillStyle = '#170d10';
      ctx.beginPath(); ctx.ellipse(x, K.groundY, v.w * 0.75, 5 * u, 0, 0, 6.29); ctx.fill();
      // flame
      const fg = ctx.createLinearGradient(0, K.groundY - h, 0, K.groundY);
      fg.addColorStop(0, 'rgba(255,240,160,.95)');
      fg.addColorStop(0.5, 'rgba(255,140,40,.9)');
      fg.addColorStop(1, 'rgba(220,50,20,.85)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(x - v.w / 2, K.groundY);
      ctx.quadraticCurveTo(x - v.w * 0.55, K.groundY - h * 0.6, x - v.w * 0.1, K.groundY - h);
      ctx.quadraticCurveTo(x + v.w * 0.05, K.groundY - h * 0.55, x + v.w * 0.16, K.groundY - h * 0.86);
      ctx.quadraticCurveTo(x + v.w * 0.5, K.groundY - h * 0.45, x + v.w / 2, K.groundY);
      ctx.closePath(); ctx.fill();
    }

    function drawArch(a, cam2) {
      const x0 = a.x - cam2, x1 = a.x + a.w - cam2;
      if (x1 < -20 || x0 > W + 20) return;
      const bottom = K.groundY - K.archBottom;
      // hanging basalt slab
      const g = ctx.createLinearGradient(0, 0, 0, bottom);
      g.addColorStop(0, '#241318');
      g.addColorStop(1, '#3a2226');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, -20);
      ctx.lineTo(x1, -20);
      ctx.lineTo(x1, bottom - 8 * u);
      ctx.lineTo(x1 - 8 * u, bottom);
      ctx.lineTo(x0 + 8 * u, bottom);
      ctx.lineTo(x0, bottom - 8 * u);
      ctx.closePath(); ctx.fill();
      // ember rim
      ctx.fillStyle = 'rgba(255,120,50,.5)';
      ctx.fillRect(x0, bottom - 2.5 * u, a.w, 2.5 * u);
      // stalactite teeth
      ctx.fillStyle = '#241318';
      for (let x = x0 + 6 * u; x < x1 - 6 * u; x += 14 * u) {
        ctx.beginPath();
        ctx.moveTo(x, bottom - 1 * u);
        ctx.lineTo(x + 7 * u, bottom - 1 * u);
        ctx.lineTo(x + 3.5 * u, bottom + 6 * u);
        ctx.closePath(); ctx.fill();
      }
    }

    function drawLavaWall(cam2, time) {
      const x = S.lavaX - cam2;
      if (x < -400) return;
      const edge = Math.min(x, W + 300);
      // glowing wall of lava leaning over the world
      const g = ctx.createLinearGradient(edge - 320 * u, 0, edge, 0);
      g.addColorStop(0, 'rgba(180,40,15,0)');
      g.addColorStop(0.55, 'rgba(230,70,20,.75)');
      g.addColorStop(1, 'rgba(255,150,50,.98)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(edge - 320 * u, H);
      for (let yy = H; yy >= -20; yy -= 22 * u) {
        const bulge = Math.sin(yy * 0.02 / u + time * 3) * 26 * u + Math.sin(yy * 0.052 / u - time * 5) * 12 * u;
        ctx.lineTo(edge + bulge - 30 * u, yy);
      }
      ctx.lineTo(edge - 320 * u, -20);
      ctx.closePath();
      ctx.fill();
      // leading crest
      ctx.strokeStyle = 'rgba(255,220,140,.9)';
      ctx.lineWidth = 4 * u;
      ctx.beginPath();
      for (let yy = -20; yy <= H; yy += 22 * u) {
        const bulge = Math.sin(yy * 0.02 / u + time * 3) * 26 * u + Math.sin(yy * 0.052 / u - time * 5) * 12 * u;
        if (yy === -20) ctx.moveTo(edge + bulge - 30 * u, yy); else ctx.lineTo(edge + bulge - 30 * u, yy);
      }
      ctx.stroke();
    }

    function drawPlayer(cam2, time) {
      const P = S.player;
      const x = P.x - cam2;
      let pose;
      if (S.mode === 'dying' || S.mode === 'gameover') pose = 'fall';
      else if (P.sliding) pose = 'slide';
      else if (!P.onGround) pose = P.vy < 0 ? 'jump' : 'fall';
      else if (S.mode === 'title') pose = 'idle';
      else pose = 'run';

      let phase;
      if (S.mode === 'playing') phase = (P.x / (46 * u)) % 1;
      else if (S.mode === 'title') phase = 0;
      else phase = (time * 0.5) % 1;

      const style = window.StartNg ? window.StartNg.player.style : null;
      // shadow
      const g = groundAt(P.x);
      if (g != null) {
        const sh = clamp(1 - (g - P.y) / (160 * u), 0.25, 1);
        ctx.fillStyle = 'rgba(0,0,0,' + 0.35 * sh + ')';
        ctx.beginPath();
        ctx.ellipse(x, g + 2 * u, (P.sliding ? 18 : 13) * u * sh, 4 * u * sh, 0, 0, 6.29);
        ctx.fill();
      }
      drawCharacter(ctx, style, {
        x: x, y: P.y, scale: u * (K.playerH / 44), phase: phase, pose: pose,
        rot: P.rot, idleT: S.titleBob
      });
      // speed streaks
      if (S.mode === 'playing' && S.speed > K.speed0 * 1.5) {
        ctx.strokeStyle = 'rgba(255,220,180,' + clamp((S.speed / K.speedMax - 0.4) * 0.5, 0, 0.3) + ')';
        ctx.lineWidth = 1.6 * u;
        for (let i = 0; i < 3; i++) {
          const yy = P.y - (8 + i * 10) * u + Math.sin(time * 8 + i) * 2 * u;
          ctx.beginPath();
          ctx.moveTo(x - 24 * u - i * 8 * u, yy);
          ctx.lineTo(x - 40 * u - i * 10 * u, yy);
          ctx.stroke();
        }
      }
    }

    function drawParticles(cam2) {
      for (let i = 0; i < S.particles.length; i++) {
        const p = S.particles[i];
        const a = 1 - p.age / p.life;
        const x = p.x - cam2;
        if (x < -30 || x > W + 30) continue;
        ctx.globalAlpha = a * (p.kind === 'dust' ? 0.5 : 1);
        if (p.kind === 'ember') {
          ctx.fillStyle = 'hsl(' + p.hue + ',100%,' + (55 + a * 15) + '%)';
        } else if (p.kind === 'burst') {
          ctx.fillStyle = p.color;
        } else {
          ctx.fillStyle = '#8a6a5a';
        }
        ctx.beginPath();
        ctx.arc(x, p.y, p.size * (p.kind === 'dust' ? 1 + a : a), 0, 6.29);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- loop
  function frame(now) {
    const dt = Math.min((now - lastT) / 1000 || 0, 0.05);
    lastT = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- start.ng glue
  function showSignIn(force) {
    const btn = $('player-sign-in');
    const guest = !window.StartNg || !window.StartNg.player.signedIn;
    btn.hidden = !(guest || force);
  }

  function applyPlayer() {
    const ng = window.StartNg;
    const p = ng.player;
    $('player-name').textContent = p.name;
    $('player-account').textContent = p.signedIn && p.account ? '@' + p.account : 'Playing as guest';
    if (p.face) $('player-face').src = p.face;
    else $('player-face').removeAttribute('src');
    showSignIn(false);
    $('profile').hidden = false;
    if (p.signedIn) refreshBoard();
  }

  $('player-sign-in').addEventListener('click', function () { window.StartNg.signIn(); });
  $('play-btn').addEventListener('click', function () { Sound.ensure(); startRun(); });
  $('again-btn').addEventListener('click', function () { Sound.ensure(); startRun(); });

  // ---------------------------------------------------------------- boot
  loadBest();
  resize();
  physics();
  S.player = { x: W * 0.32, y: K.groundY, vy: 0, onGround: true, jumps: 0, sliding: false, rot: 0, tumble: false, stumble: 0 };
  S.lavaX = S.player.x - 1150 * u;
  S.camX = 0;
  S.platforms = [{ x: -W, w: W * 3 }];
  if (S.best.distance > 0) {
    $('title-best').hidden = false;
    $('title-best').textContent = 'Best: ' + S.best.distance + ' m · ' + S.best.crystals + ' crystals';
  }
  requestAnimationFrame(frame);

  if (window.StartNg) {
    window.StartNg.onPlayer(applyPlayer);
    window.StartNg.refreshPlayer().then(function () {
      applyPlayer();
      refreshBoard();
    });
  }
})();
