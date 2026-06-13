(() => {
  "use strict";

  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const frame = document.querySelector(".game-frame");
  const $ = (selector) => document.querySelector(selector);
  const playerSprite = new Image();
  playerSprite.src = "assets/office-worker-sprite.png";

  const ui = {
    start: $("#startScreen"), upgrade: $("#upgradeScreen"), pause: $("#pauseScreen"), end: $("#endScreen"),
    healthBar: $("#healthBar"), xpBar: $("#xpBar"), healthText: $("#healthText"), xpText: $("#xpText"),
    level: $("#levelText"), timer: $("#timerText"), wave: $("#waveText"), kills: $("#killText"),
    comboHud: $("#comboHud"), comboText: $("#comboText"), comboBonus: $("#comboBonus"),
    choices: $("#upgradeChoices"), build: $("#buildList"), sound: $("#soundButton"), pauseButton: $("#pauseButton"),
    upgradeKicker: $("#upgradeKicker"), upgradeTitle: $("#upgradeTitle"), refreshUpgrades: $("#refreshUpgradesButton"),
    bossHud: $("#bossHud"), bossBar: $("#bossHealthBar"), bossAlert: $("#bossAlert"),
    bossHudKicker: $("#bossHudKicker"), bossHudName: $("#bossHudName"),
    bossAlertKicker: $("#bossAlertKicker"), bossAlertName: $("#bossAlertName"), bossAlertQuote: $("#bossAlertQuote")
  };

  const TAU = Math.PI * 2;
  const GAME_DURATION = 300;
  const BOSS_TIME = 240;
  const isLocalPreview = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const debugStartTime = isLocalPreview ? Number(new URLSearchParams(location.search).get("t")) || 0 : 0;
  const keys = new Set();
  let width = 0, height = 0, dpr = 1;
  let lastTime = performance.now();
  let state = "start";
  let game;
  let audioContext = null;
  let soundOn = true;

  const upgrades = [
    { id: "context", icon: "◉", name: "补充上下文", color: "#48e7ff", desc: "上下文场扩大，靠近你的错误持续被解析。", apply: p => { p.aura += 15; p.auraDamage += 5; } },
    { id: "coffee", icon: "≈", name: "喝口咖啡", color: "#3f8cff", desc: "耐心上限 +25，并立刻恢复 30 点。", apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 30); } },
    { id: "retry", icon: "↯", name: "再试一次", color: "#ffe66d", desc: "提示词发射频率提高 22%。这次一定行。", apply: p => { p.fireRate *= .78; } },
    { id: "trust", icon: "✦", name: "相信模型", color: "#a75bff", desc: "提高暴击概率；灵光一现造成 2.4 倍伤害。", apply: p => { p.crit = Math.min(.65, p.crit + .13); } },
    { id: "autosave", icon: "◇", name: "自动保存", color: "#ff4fd8", desc: "每解决 18 个错误，恢复 6 点耐心。", apply: p => { p.snack += 1; } },
    { id: "model", icon: "+", name: "切个模型", color: "#ff86eb", desc: "每次攻击额外发射一条并行提示词。", apply: p => { p.projectiles = Math.min(7, p.projectiles + 1); } },
    { id: "takeover", icon: "↑", name: "人工接管", color: "#eef8ff", desc: "所有输出提高 35%。关键部分还是自己来。", apply: p => { p.damage *= 1.35; } },
    { id: "undo", icon: "⌁", name: "Cmd + Z", color: "#65f0a8", desc: "移动速度提高 16%，撤回闪身冷却缩短。", apply: p => { p.speed *= 1.16; p.dashMax *= .82; } },
    { id: "rewrite", icon: "</>", name: "删掉重写", color: "#c47aff", desc: "提示词变大，并额外穿透 1 个错误。", apply: p => { p.bulletSize += 1.8; p.pierce += 1; } }
  ];

  const enemyKinds = [
    { name: "语法报错", label: "报错", color: "#ff4fd8", hp: 14, speed: 55, size: 17, xp: 1 },
    { name: "模型幻觉", label: "幻觉", color: "#a75bff", hp: 24, speed: 82, size: 17, xp: 2 },
    { name: "需求漂移", label: "漂移", color: "#3f8cff", hp: 46, speed: 42, size: 18, xp: 3 },
    { name: "上下文溢出", label: "溢出", color: "#ffe66d", hp: 80, speed: 32, size: 20, xp: 5 }
  ];

  const conflictKind = { name: "冲突标记", label: "冲突", color: "#ff4fd8", hp: 42, speed: 74, size: 18, xp: 3 };
  const miniBossSchedule = [
    { time: 45, kind: { name: "编译崩溃", label: "编译崩溃", color: "#ff4fd8", hp: enemyKinds[0].hp * 10, speed: 43, size: 27, xp: 8, isMiniBoss: true }, quote: "“这一处红字，想占满整个终端。”" },
    { time: 105, kind: { name: "幻觉风暴", label: "幻觉风暴", color: "#a75bff", hp: enemyKinds[1].hp * 12, speed: 52, size: 29, xp: 10, isMiniBoss: true }, quote: "“说得越像真的，就越危险。”" },
    { time: 165, kind: { name: "需求失控", label: "需求失控", color: "#3f8cff", hp: enemyKinds[2].hp * 15, speed: 39, size: 31, xp: 12, isMiniBoss: true }, quote: "“再加一个功能，就一个。”" },
    { time: 210, kind: { name: "上下文爆炸", label: "上下文爆炸", color: "#ffe66d", hp: enemyKinds[3].hp * 18, speed: 34, size: 34, xp: 15, isMiniBoss: true }, quote: "“窗口满了，但需求还在增长。”" }
  ];
  const bossKind = { name: "合并冲突小姐", color: "#ff4fd8", hp: 3600, speed: 0, size: 54, xp: 30, isBoss: true };

  function freshGame() {
    return {
      time: Math.min(debugStartTime, GAME_DURATION - 1), kills: 0, spawnClock: 0, shake: 0, flash: 0,
      bossSpawned: false, bossDefeated: false, boss: null, activeBoss: null, bossIntro: 0,
      miniBossSpawned: miniBossSchedule.map(entry => debugStartTime >= entry.time), miniBossesDefeated: 0,
      pendingUpgradeReasons: [], upgradeRefreshes: 2, currentUpgradePicks: [], currentUpgradeReason: "level",
      combo: 0, comboTimer: 0, maxCombo: 0, perfectDodges: 0, slowTime: 0, dodgeFlash: 0,
      enemies: [], bullets: [], hazards: [], particles: [], texts: [], pickups: [], stars: makeStars(),
      player: {
        x: width / 2, y: height / 2, r: 13, speed: 235, hp: 100, maxHp: 100,
        level: 1, xp: 0, xpNeed: 8, damage: 15, fireRate: .64, fireClock: 0,
        bulletSpeed: 520, bulletSize: 4.5, projectiles: 1, pierce: 0, crit: .08,
        aura: 48, auraDamage: 2, dash: 0, dashMax: 2.2, dashTime: 0, invincible: 0,
        dirX: 1, dirY: 0, snack: 0, snackProgress: 0, perfectCritTime: 0,
        coffeeRush: 0, fireBursts: 0, upgrades: {}
      }
    };
  }

  function makeStars() {
    return Array.from({ length: Math.max(60, Math.floor(width * height / 9000)) }, () => ({
      x: Math.random() * width, y: Math.random() * height, r: Math.random() * 1.2 + .2, a: Math.random() * .45 + .08
    }));
  }

  function resize() {
    const rect = frame.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(320, rect.width);
    height = Math.max(360, rect.height);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (game) game.stars = makeStars();
  }

  function beep(frequency = 440, duration = .05, volume = .035, type = "sine") {
    if (!soundOn) return;
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  }

  function startGame() {
    game = freshGame();
    state = "playing";
    hideAllOverlays();
    ui.pauseButton.textContent = "暂停";
    ui.bossHud.classList.remove("visible");
    ui.bossAlert.classList.remove("visible");
    updateUI();
    lastTime = performance.now();
    beep(330, .08, .04, "triangle");
    setTimeout(() => beep(494, .12, .035, "triangle"), 90);
  }

  function hideAllOverlays() {
    document.querySelectorAll(".overlay").forEach(el => el.classList.remove("visible"));
  }

  function togglePause(force) {
    if (state === "start" || state === "upgrade" || state === "ended") return;
    const shouldPause = force ?? state === "playing";
    state = shouldPause ? "paused" : "playing";
    ui.pause.classList.toggle("visible", shouldPause);
    ui.pauseButton.textContent = shouldPause ? "继续" : "暂停";
    lastTime = performance.now();
  }

  function spawnEnemy(forcedKind = null, origin = null) {
    const progress = game.time / GAME_DURATION;
    const roll = Math.random();
    let index = roll < .52 ? 0 : roll < .79 ? 1 : roll < .94 ? 2 : 3;
    if (game.time < 35) index = Math.min(index, 1);
    if (game.time < 80) index = Math.min(index, 2);
    const kind = forcedKind || enemyKinds[index];
    const side = Math.floor(Math.random() * 4);
    const margin = 32;
    let x, y;
    if (origin) { x = origin.x + (Math.random() - .5) * 90; y = origin.y + 50 + Math.random() * 30; }
    else if (side === 0) { x = Math.random() * width; y = -margin; }
    else if (side === 1) { x = width + margin; y = Math.random() * height; }
    else if (side === 2) { x = Math.random() * width; y = height + margin; }
    else { x = -margin; y = Math.random() * height; }
    const scale = 1 + progress * .9;
    game.enemies.push({
      x, y, kind, r: kind.size, hp: kind.hp * scale, maxHp: kind.hp * scale,
      speed: kind.speed * (1 + progress * .18), hit: 0, auraTick: 0, angle: Math.random() * TAU
    });
  }

  function spawnBoss() {
    game.bossSpawned = true;
    game.bossIntro = 3.2;
    const hpScale = 1 + Math.max(0, game.player.level - 7) * .05;
    const boss = {
      x: width / 2, y: -80, kind: bossKind, r: bossKind.size,
      hp: bossKind.hp * hpScale, maxHp: bossKind.hp * hpScale,
      speed: 0, hit: 0, auraTick: 0, angle: 0, attackClock: 1.1,
      burstClock: 4.2, summonClock: 6, entrance: 0
    };
    game.boss = boss;
    game.activeBoss = boss;
    game.enemies.push(boss);
    setBossPresentation("FINAL MERGE REQUEST", bossKind.name, "“两个版本，都想活下来。”");
    ui.bossHud.classList.add("visible");
    ui.bossAlert.classList.remove("visible");
    void ui.bossAlert.offsetWidth;
    ui.bossAlert.classList.add("visible");
    game.shake = 18;
    game.flash = .45;
    burst(width / 2, 110, "#48e7ff", 28, 260);
    burst(width / 2, 110, "#ff4fd8", 28, 260);
    beep(92, .5, .07, "sawtooth");
    setTimeout(() => beep(138, .45, .055, "sawtooth"), 180);
  }

  function spawnMiniBoss(scheduleIndex) {
    const entry = miniBossSchedule[scheduleIndex];
    game.miniBossSpawned[scheduleIndex] = true;
    const progressScale = 1 + game.time / GAME_DURATION * .9;
    const kind = entry.kind;
    const miniBoss = {
      x: width / 2, y: -50, kind, r: kind.size,
      hp: kind.hp * progressScale, maxHp: kind.hp * progressScale,
      speed: kind.speed, hit: 0, auraTick: 0, angle: 0, scheduleIndex
    };
    game.activeBoss = miniBoss;
    game.enemies.push(miniBoss);
    setBossPresentation(`MINUTE ${scheduleIndex + 1} CHECKPOINT`, kind.name, entry.quote);
    ui.bossHud.classList.add("visible");
    ui.bossAlert.classList.remove("visible");
    void ui.bossAlert.offsetWidth;
    ui.bossAlert.classList.add("visible");
    game.shake = 12 + scheduleIndex * 2;
    game.flash = .28;
    burst(width / 2, 90, kind.color, 26, 230);
    beep(116 - scheduleIndex * 8, .32, .055, "sawtooth");
  }

  function setBossPresentation(kicker, name, quote) {
    ui.bossHudKicker.textContent = kicker;
    ui.bossHudName.textContent = name;
    ui.bossAlertKicker.textContent = kicker;
    ui.bossAlertName.textContent = name;
    ui.bossAlertQuote.textContent = quote;
  }

  function nearestEnemy() {
    let best = null, bestDistance = Infinity;
    for (const enemy of game.enemies) {
      const dx = enemy.x - game.player.x, dy = enemy.y - game.player.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = enemy; }
    }
    return best;
  }

  function hasUpgrade(id) {
    return (game.player.upgrades[id] || 0) > 0;
  }

  function hasSynergy(first, second) {
    return hasUpgrade(first) && hasUpgrade(second);
  }

  function activeSynergies() {
    const active = [];
    if (hasSynergy("context", "takeover")) active.push({ name: "上下文审查", color: "#48e7ff" });
    if (hasSynergy("retry", "model")) active.push({ name: "提示词洪流", color: "#ffe66d" });
    if (hasSynergy("autosave", "coffee")) active.push({ name: "咖啡自动续杯", color: "#65f0a8" });
    return active;
  }

  function comboFireBonus() {
    return Math.min(.36, game.combo * .018);
  }

  function comboTokenBonus() {
    return Math.min(2, Math.floor(game.combo / 8));
  }

  function registerComboKill(x, y) {
    game.combo += 1;
    game.comboTimer = 3;
    game.maxCombo = Math.max(game.maxCombo, game.combo);
    if (game.combo === 8 || game.combo === 16 || game.combo === 24) {
      game.texts.push({ x, y: y - 35, text: `${game.combo} COMBO`, color: "#ffe66d", life: 1, glow: "#ffe66d", font: "900 14px ui-monospace, monospace" });
      beep(520 + game.combo * 8, .09, .035, "triangle");
    }
  }

  function resetCombo() {
    game.combo = 0;
    game.comboTimer = 0;
  }

  function createPlayerBullet(player, angle, damageScale = 1) {
    const critChance = Math.min(.95, player.crit + (player.perfectCritTime > 0 ? .35 : 0));
    const critical = Math.random() < critChance;
    game.bullets.push({
      x: player.x + Math.cos(angle) * 25, y: player.y - 5 + Math.sin(angle) * 25,
      vx: Math.cos(angle) * player.bulletSpeed, vy: Math.sin(angle) * player.bulletSpeed,
      r: player.bulletSize * (critical ? 1.45 : 1), damage: player.damage * damageScale * (critical ? 2.4 : 1),
      life: 1.25, hits: player.pierce, critical
    });
  }

  function fire() {
    const p = game.player;
    const target = nearestEnemy();
    if (!target) return;
    const base = Math.atan2(target.y - p.y, target.x - p.x);
    const spread = .16;
    for (let i = 0; i < p.projectiles; i++) {
      const offset = (i - (p.projectiles - 1) / 2) * spread;
      createPlayerBullet(p, base + offset);
    }
    p.fireBursts += 1;
    if (hasSynergy("retry", "model") && p.fireBursts % 6 === 0) {
      for (let i = 0; i < 7; i++) createPlayerBullet(p, base + (i - 3) * .2, .72);
      game.texts.push({ x: p.x, y: p.y - 48, text: "提示词洪流", color: "#ffe66d", life: .75, glow: "#ffe66d" });
      burst(p.x, p.y, "#ffe66d", 12, 125);
    }
    beep(280 + p.projectiles * 18, .028, .013, "triangle");
  }

  function applyAuraDamage(enemy, player) {
    const critical = hasSynergy("context", "takeover") && Math.random() < .2;
    damageEnemy(enemy, player.auraDamage * (critical ? 2.4 : 1), critical, critical ? "上下文暴击" : "灵光一现!");
  }

  function damageEnemy(enemy, amount, critical = false, criticalText = "灵光一现!") {
    enemy.hp -= amount;
    enemy.hit = .08;
    burst(enemy.x, enemy.y, enemy.kind.color, critical ? 7 : 3, critical ? 130 : 75);
    if (critical) game.texts.push({ x: enemy.x, y: enemy.y - enemy.r - 8, text: criticalText, color: "#ffe66d", life: .6 });
    if (enemy.hp <= 0) killEnemy(enemy);
  }

  function killEnemy(enemy) {
    const index = game.enemies.indexOf(enemy);
    if (index < 0) return;
    game.enemies.splice(index, 1);
    game.kills += 1;
    registerComboKill(enemy.x, enemy.y);
    if (enemy.kind.isBoss) {
      game.boss = null;
      game.activeBoss = null;
      game.bossDefeated = true;
      ui.bossHud.classList.remove("visible");
      game.shake = 24;
      game.flash = .7;
      for (let i = 0; i < 5; i++) setTimeout(() => burst(enemy.x, enemy.y, i % 2 ? "#48e7ff" : "#ff4fd8", 24, 320), i * 90);
      game.texts.push({ x: enemy.x, y: enemy.y - 65, text: "冲突已解决", color: "#eef8ff", life: 2 });
      beep(220, .18, .07, "sawtooth");
      setTimeout(() => beep(440, .3, .06, "triangle"), 170);
    } else if (enemy.kind.isMiniBoss) {
      const wasActiveBoss = game.activeBoss === enemy;
      if (wasActiveBoss) game.activeBoss = null;
      game.miniBossesDefeated += 1;
      if (wasActiveBoss) ui.bossHud.classList.remove("visible");
      game.shake = 18;
      game.flash = .5;
      for (let i = 0; i < 3; i++) setTimeout(() => burst(enemy.x, enemy.y, enemy.kind.color, 20, 260), i * 80);
      game.texts.push({ x: enemy.x, y: enemy.y - 55, text: "问题已压住", color: "#eef8ff", life: 1.5 });
      beep(196, .16, .06, "sawtooth");
      requestUpgrade("miniBoss");
    }
    const p = game.player;
    p.snackProgress += 1;
    if (p.snack && p.snackProgress >= 18) {
      p.snackProgress = 0;
      p.hp = Math.min(p.maxHp, p.hp + 6 * p.snack);
      game.texts.push({ x: p.x, y: p.y - 25, text: "+耐心", color: "#48e7ff", life: .8 });
      if (hasSynergy("autosave", "coffee")) {
        p.coffeeRush = 3;
        game.texts.push({ x: p.x, y: p.y - 43, text: "咖啡自动续杯", color: "#65f0a8", life: 1, glow: "#65f0a8" });
      }
    }
    burst(enemy.x, enemy.y, enemy.kind.color, 12, 170);
    const tokenValue = enemy.kind.xp + comboTokenBonus();
    game.pickups.push({ x: enemy.x, y: enemy.y, value: tokenValue, r: 4 + tokenValue * .35, life: 12 });
    if (enemy.kind.xp >= 5 && !enemy.kind.isBoss) { game.shake = 7; beep(95, .12, .05, "sawtooth"); }
  }

  function gainXp(value) {
    const p = game.player;
    p.xp += value;
    if (p.xp >= p.xpNeed) {
      p.xp -= p.xpNeed;
      p.level += 1;
      p.xpNeed = Math.floor(p.xpNeed * 1.27 + 4);
      requestUpgrade("level");
    }
  }

  function requestUpgrade(reason) {
    if (state === "upgrade") {
      game.pendingUpgradeReasons.push(reason);
      return;
    }
    showUpgrade(reason);
  }

  function showUpgrade(reason = "level") {
    state = "upgrade";
    game.currentUpgradeReason = reason;
    const isMiniBossReward = reason === "miniBoss";
    ui.upgradeKicker.textContent = isMiniBossReward ? "MINI BOSS REWARD" : "PROMPT EVOLUTION";
    ui.upgradeTitle.textContent = isMiniBossReward ? "问题已解决，额外强化一次。" : "这次迭代，强化什么？";
    renderUpgradeChoices(pickUpgrades());
    updateRefreshButton();
    ui.upgrade.classList.add("visible");
    beep(523, .1, .04, "sine");
    setTimeout(() => beep(784, .18, .03, "sine"), 85);
  }

  function pickUpgrades(excludedIds = []) {
    const excluded = new Set(excludedIds);
    const preferred = upgrades.filter(upgrade => !excluded.has(upgrade.id)).sort(() => Math.random() - .5);
    const fallback = upgrades.filter(upgrade => excluded.has(upgrade.id)).sort(() => Math.random() - .5);
    return [...preferred, ...fallback].slice(0, 3);
  }

  function renderUpgradeChoices(picks) {
    const isMiniBossReward = game.currentUpgradeReason === "miniBoss";
    game.currentUpgradePicks = picks.map(upgrade => upgrade.id);
    ui.choices.innerHTML = "";
    for (const upgrade of picks) {
      const count = game.player.upgrades[upgrade.id] || 0;
      const button = document.createElement("button");
      button.className = "upgrade-card";
      button.style.setProperty("--accent", upgrade.color);
      button.innerHTML = `<span class="upgrade-icon">${upgrade.icon}</span><h3>${upgrade.name}</h3><p>${upgrade.desc}</p><small>${isMiniBossReward ? "小 Boss 战利品" : count ? `已增幅 ${count} 次` : "首次模型增幅"}</small>`;
      button.addEventListener("click", () => chooseUpgrade(upgrade), { once: true });
      ui.choices.appendChild(button);
    }
  }

  function refreshUpgradeChoices() {
    if (state !== "upgrade" || game.upgradeRefreshes <= 0) return;
    game.upgradeRefreshes -= 1;
    renderUpgradeChoices(pickUpgrades(game.currentUpgradePicks));
    updateRefreshButton();
    beep(392, .07, .03, "triangle");
    setTimeout(() => beep(587, .1, .025, "triangle"), 70);
  }

  function updateRefreshButton() {
    const remaining = game.upgradeRefreshes;
    ui.refreshUpgrades.disabled = remaining <= 0;
    ui.refreshUpgrades.innerHTML = remaining > 0
      ? `本局刷新（剩余 ${remaining} 次） <kbd>R</kbd>`
      : "本局刷新次数已用完";
  }

  function chooseUpgrade(upgrade) {
    const p = game.player;
    upgrade.apply(p);
    p.upgrades[upgrade.id] = (p.upgrades[upgrade.id] || 0) + 1;
    ui.upgrade.classList.remove("visible");
    updateBuild();
    updateUI();
    if (game.pendingUpgradeReasons.length) {
      showUpgrade(game.pendingUpgradeReasons.shift());
      return;
    }
    state = "playing";
    lastTime = performance.now();
  }

  function updateBuild() {
    const entries = Object.entries(game.player.upgrades);
    const upgradeTags = entries.map(([id, count]) => {
      const item = upgrades.find(upgrade => upgrade.id === id);
      return `<span style="color:${item.color}">${item.name}${count > 1 ? ` ×${count}` : ""}</span>`;
    });
    const synergyTags = activeSynergies().map(synergy => `<span style="color:${synergy.color};border:1px solid ${synergy.color}55">联动·${synergy.name}</span>`);
    ui.build.innerHTML = [...upgradeTags, ...synergyTags].join("") || "<span>等待第一次模型增幅</span>";
  }

  function burst(x, y, color, count, force) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TAU, speed = Math.random() * force + 20;
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: Math.random() * 2.5 + 1, color, life: Math.random() * .45 + .25 });
    }
  }

  function createHazard(x, y, angle, speed, color, radius = 6, damage = 9) {
    game.hazards.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: radius, damage, color, life: 5, spin: Math.random() * TAU });
  }

  function fireBossFan(boss, player) {
    const phaseTwo = boss.hp < boss.maxHp * .5;
    const count = phaseTwo ? 9 : 7;
    const base = Math.atan2(player.y - boss.y, player.x - boss.x);
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * .16;
      createHazard(boss.x, boss.y + 28, base + offset, phaseTwo ? 245 : 215, i % 2 ? "#48e7ff" : "#ff4fd8", phaseTwo ? 7 : 6, 9);
    }
    beep(155, .08, .025, "square");
  }

  function fireConflictRing(boss) {
    const count = boss.hp < boss.maxHp * .5 ? 22 : 16;
    const offset = game.time * .7;
    for (let i = 0; i < count; i++) {
      createHazard(boss.x, boss.y, offset + i / count * TAU, 150, i % 2 ? "#48e7ff" : "#ff4fd8", 7, 11);
    }
    game.shake = 9;
    burst(boss.x, boss.y, "#eef8ff", 16, 190);
    beep(78, .22, .045, "sawtooth");
  }

  function updateBoss(boss, dt, player) {
    boss.entrance = Math.min(1, boss.entrance + dt * .7);
    const targetX = width * .5 + Math.sin(game.time * .72) * Math.min(260, width * .23);
    const targetY = 125 + Math.cos(game.time * 1.1) * 22;
    boss.x += (targetX - boss.x) * dt * 1.8;
    boss.y += (targetY - boss.y) * dt * 2.2;
    boss.angle += dt;
    boss.hit = Math.max(0, boss.hit - dt);
    boss.auraTick -= dt;
    boss.attackClock -= dt;
    boss.burstClock -= dt;
    boss.summonClock -= dt;
    if (boss.attackClock <= 0) {
      boss.attackClock = boss.hp < boss.maxHp * .5 ? .72 : 1.08;
      fireBossFan(boss, player);
    }
    if (boss.burstClock <= 0) {
      boss.burstClock = boss.hp < boss.maxHp * .5 ? 3.4 : 4.8;
      fireConflictRing(boss);
    }
    if (boss.summonClock <= 0) {
      boss.summonClock = 6.4;
      for (let i = 0; i < 3; i++) spawnEnemy(conflictKind, boss);
      game.texts.push({ x: boss.x, y: boss.y + 78, text: "<<<<<<< HEAD", color: "#ff4fd8", life: 1.2 });
    }
    if (Math.hypot(player.x - boss.x, player.y - boss.y) < player.aura + boss.r && boss.auraTick <= 0) {
      boss.auraTick = .42;
      applyAuraDamage(boss, player);
    }
  }

  function damagePlayer(amount, sourceX, sourceY) {
    const p = game.player;
    if (p.invincible > 0) return;
    resetCombo();
    p.hp -= amount;
    p.invincible = .7;
    game.shake = 10;
    game.flash = .2;
    burst(p.x, p.y, "#ff4fd8", 15, 220);
    beep(110, .14, .055, "square");
    if (sourceX !== undefined) {
      const dx = p.x - sourceX, dy = p.y - sourceY, length = Math.hypot(dx, dy) || 1;
      p.x = Math.max(p.r, Math.min(width - p.r, p.x + dx / length * 14));
      p.y = Math.max(p.r, Math.min(height - p.r, p.y + dy / length * 14));
    }
    if (p.hp <= 0) endGame(false);
  }

  function update(dt) {
    if (state !== "playing") return;
    const p = game.player;
    game.time += dt;
    game.slowTime = Math.max(0, game.slowTime - dt);
    game.dodgeFlash = Math.max(0, game.dodgeFlash - dt);
    p.perfectCritTime = Math.max(0, p.perfectCritTime - dt);
    p.coffeeRush = Math.max(0, p.coffeeRush - dt);
    if (game.combo > 0) {
      game.comboTimer -= dt;
      if (game.comboTimer <= 0) resetCombo();
    }
    const worldDt = game.slowTime > 0 ? dt * .35 : dt;
    if (game.time >= GAME_DURATION) {
      game.time = GAME_DURATION;
      updateUI();
      return endGame(true);
    }
    if (!game.bossSpawned && game.time >= BOSS_TIME) spawnBoss();
    for (let i = 0; i < miniBossSchedule.length; i++) {
      if (!game.miniBossSpawned[i] && game.time >= miniBossSchedule[i].time) spawnMiniBoss(i);
    }
    game.bossIntro = Math.max(0, game.bossIntro - worldDt);
    game.spawnClock -= worldDt;
    const finalMinute = game.time >= BOSS_TIME;
    const interval = Math.max(finalMinute ? .12 : .16, .78 - game.time * .0018);
    if (game.spawnClock <= 0) {
      game.spawnClock = interval;
      spawnEnemy();
      if (game.time > 150 && Math.random() < .32) spawnEnemy();
      if (finalMinute && Math.random() < .48) spawnEnemy();
    }

    let dx = 0, dy = 0;
    if (keys.has("w") || keys.has("arrowup")) dy -= 1;
    if (keys.has("s") || keys.has("arrowdown")) dy += 1;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;
    const length = Math.hypot(dx, dy) || 1;
    if (dx || dy) { dx /= length; dy /= length; p.dirX = dx; p.dirY = dy; }
    const dashBoost = p.dashTime > 0 ? 3.25 : 1;
    const coffeeBoost = p.coffeeRush > 0 ? 1.35 : 1;
    p.x = Math.max(p.r, Math.min(width - p.r, p.x + dx * p.speed * coffeeBoost * dashBoost * dt));
    p.y = Math.max(p.r, Math.min(height - p.r, p.y + dy * p.speed * coffeeBoost * dashBoost * dt));
    p.dash = Math.max(0, p.dash - dt);
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.invincible = Math.max(0, p.invincible - dt);
    p.fireClock -= dt;
    if (p.fireClock <= 0 && game.enemies.length) { p.fireClock = p.fireRate / (1 + comboFireBonus()); fire(); }

    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const bullet = game.bullets[i];
      bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
      let remove = bullet.life <= 0;
      for (const enemy of [...game.enemies]) {
        if (Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y) < bullet.r + enemy.r) {
          damageEnemy(enemy, bullet.damage, bullet.critical);
          if (bullet.hits-- <= 0) { remove = true; break; }
        }
      }
      if (remove) game.bullets.splice(i, 1);
    }

    for (let i = game.hazards.length - 1; i >= 0; i--) {
      const hazard = game.hazards[i];
      hazard.x += hazard.vx * worldDt; hazard.y += hazard.vy * worldDt; hazard.life -= worldDt; hazard.spin += worldDt * 4;
      const outside = hazard.x < -50 || hazard.x > width + 50 || hazard.y < -50 || hazard.y > height + 50;
      if (Math.hypot(hazard.x - p.x, hazard.y - p.y) < hazard.r + p.r) {
        damagePlayer(hazard.damage, hazard.x, hazard.y);
        game.hazards.splice(i, 1);
      } else if (hazard.life <= 0 || outside) game.hazards.splice(i, 1);
    }

    for (const enemy of [...game.enemies]) {
      if (enemy.kind.isBoss) {
        updateBoss(enemy, worldDt, p);
        continue;
      }
      const ex = p.x - enemy.x, ey = p.y - enemy.y, distance = Math.hypot(ex, ey) || 1;
      enemy.x += ex / distance * enemy.speed * worldDt;
      enemy.y += ey / distance * enemy.speed * worldDt;
      enemy.angle += worldDt;
      enemy.hit = Math.max(0, enemy.hit - worldDt);
      enemy.auraTick -= worldDt;
      if (distance < p.aura + enemy.r && enemy.auraTick <= 0) {
        enemy.auraTick = .42;
        applyAuraDamage(enemy, p);
      }
      if (distance < p.r + enemy.r && p.invincible <= 0) {
        damagePlayer(8 + enemy.kind.xp * 1.5, enemy.x, enemy.y);
        enemy.x -= ex / distance * 24; enemy.y -= ey / distance * 24;
      }
    }

    for (let i = game.pickups.length - 1; i >= 0; i--) {
      const orb = game.pickups[i];
      orb.life -= dt;
      const ox = p.x - orb.x, oy = p.y - orb.y, distance = Math.hypot(ox, oy) || 1;
      if (distance < 120) { const pull = 90 + (120 - distance) * 4; orb.x += ox / distance * pull * dt; orb.y += oy / distance * pull * dt; }
      if (distance < p.r + orb.r + 5) {
        gainXp(orb.value);
        game.texts.push({
          x: p.x + (Math.random() - .5) * 8,
          y: p.y - 47,
          text: orb.value > 1 ? `+${orb.value} TOKEN` : "+TOKEN",
          color: "#c8faff",
          life: .8,
          maxLife: .8,
          alpha: .68,
          font: "700 11px ui-monospace, monospace",
          rise: 18,
          glow: "#48e7ff"
        });
        game.pickups.splice(i, 1);
        beep(650, .025, .012, "sine");
      }
      else if (orb.life <= 0) game.pickups.splice(i, 1);
    }

    updateEffects(dt);
    updateUI();
  }

  function updateEffects(dt) {
    game.shake = Math.max(0, game.shake - dt * 30);
    game.flash = Math.max(0, game.flash - dt);
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const particle = game.particles[i];
      particle.x += particle.vx * dt; particle.y += particle.vy * dt;
      particle.vx *= .96; particle.vy *= .96; particle.life -= dt;
      if (particle.life <= 0) game.particles.splice(i, 1);
    }
    for (let i = game.texts.length - 1; i >= 0; i--) {
      game.texts[i].y -= (game.texts[i].rise ?? 24) * dt; game.texts[i].life -= dt;
      if (game.texts[i].life <= 0) game.texts.splice(i, 1);
    }
  }

  function dash() {
    if (state !== "playing" || game.player.dash > 0) return;
    const p = game.player;
    const dangerNearby = game.hazards.some(hazard => Math.hypot(hazard.x - p.x, hazard.y - p.y) < hazard.r + p.r + 52)
      || game.enemies.some(enemy => Math.hypot(enemy.x - p.x, enemy.y - p.y) < enemy.r + p.r + 42);
    p.dash = p.dashMax; p.dashTime = .18; p.invincible = .28;
    if (dangerNearby) {
      game.slowTime = .75;
      game.dodgeFlash = .35;
      game.perfectDodges += 1;
      p.perfectCritTime = 2.5;
      game.texts.push({ x: p.x, y: p.y - 52, text: "漂亮撤回", color: "#48e7ff", life: 1.1, glow: "#48e7ff", font: "900 14px sans-serif" });
      burst(p.x, p.y, "#48e7ff", 22, 220);
      beep(720, .1, .05, "triangle");
      setTimeout(() => beep(960, .12, .04, "sine"), 70);
    }
    burst(p.x, p.y, "#7de2c1", 10, 140);
    beep(210, .09, .035, "sawtooth");
  }

  function endGame(won) {
    state = "ended";
    const p = game.player;
    ui.bossHud.classList.remove("visible");
    ui.bossAlert.classList.remove("visible");
    $("#endKicker").textContent = won ? "VIBE CODING CHECKPOINT" : "PATIENCE EXHAUSTED";
    $("#endTitle").textContent = won ? "五分钟到了，回去看看代码。" : "生成也许已经有结果了。";
    $("#endSummary").textContent = won
      ? (game.bossDefeated ? "合并冲突已经解决。现在切回工作区，看看这一轮 Vibe Coding 写出了什么。" : "你撑过了最终合并请求。现在切回工作区，生成结果大概正在等你。")
      : "不用把等待也变成压力。先回到工作区看看进度，需要的话再开一局。";
    $("#endStats").innerHTML = `<div><strong>${formatTime(game.time)}</strong><span>等待时间</span></div><div><strong>${game.kills}</strong><span>已解决</span></div><div><strong>${game.maxCombo}</strong><span>最高连杀</span></div><div><strong>${game.perfectDodges}</strong><span>漂亮撤回</span></div><div><strong>${p.level}</strong><span>最终迭代</span></div>`;
    ui.end.classList.add("visible");
    beep(won ? 523 : 180, .25, .05, won ? "sine" : "triangle");
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function updateUI() {
    if (!game) return;
    const p = game.player;
    ui.healthBar.style.width = `${Math.max(0, p.hp / p.maxHp * 100)}%`;
    ui.xpBar.style.width = `${p.xp / p.xpNeed * 100}%`;
    ui.healthText.textContent = `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`;
    ui.xpText.textContent = `${p.xp} / ${p.xpNeed}`;
    ui.level.textContent = p.level;
    ui.timer.textContent = formatTime(game.time);
    ui.kills.textContent = game.kills;
    const fireBonus = Math.round(comboFireBonus() * 100);
    const tokenBonus = comboTokenBonus();
    ui.comboHud.classList.toggle("visible", game.combo > 0);
    ui.comboText.textContent = `${game.combo} COMBO`;
    ui.comboBonus.textContent = `射速 +${fireBonus}%${tokenBonus ? ` · Token +${tokenBonus}` : ""}`;
    ui.wave.textContent = game.activeBoss?.kind.isMiniBoss
      ? `${game.activeBoss.kind.name}正在阻塞生成`
      : game.time < 60 ? "代码正在生成" : game.time < 150 ? "模型开始深入上下文" : game.time < BOSS_TIME ? "生成还需要一点时间" : game.bossDefeated ? "冲突已解决，坚持到生成完成" : "FINAL MERGE REQUEST";
    if (game.activeBoss) ui.bossBar.style.width = `${Math.max(0, game.activeBoss.hp / game.activeBoss.maxHp * 100)}%`;
  }

  function drawBackground() {
    const gradient = ctx.createRadialGradient(width * .5, height * .48, 20, width * .5, height * .48, Math.max(width, height) * .75);
    if (game?.time >= BOSS_TIME) {
      gradient.addColorStop(0, "#21123a"); gradient.addColorStop(.46, "#10172d"); gradient.addColorStop(1, "#070811");
    } else {
      gradient.addColorStop(0, "#121f3d"); gradient.addColorStop(.55, "#0c1428"); gradient.addColorStop(1, "#070a14");
    }
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    for (const star of game?.stars || []) {
      ctx.globalAlpha = star.a; ctx.fillStyle = "#dbe7ff"; ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = .045; ctx.strokeStyle = "#b8c5e8"; ctx.lineWidth = 1;
    const gap = 52, offsetX = (game?.time * 4 || 0) % gap, offsetY = (game?.time * 2 || 0) % gap;
    for (let x = -gap + offsetX; x < width + gap; x += gap) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = -gap + offsetY; y < height + gap; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    if (game?.time >= BOSS_TIME) {
      const split = width / 2 + Math.sin(game.time * 1.4) * 45;
      const leftGlow = ctx.createLinearGradient(0, 0, split, 0);
      leftGlow.addColorStop(0, "rgba(72,231,255,.08)"); leftGlow.addColorStop(1, "rgba(72,231,255,0)");
      ctx.fillStyle = leftGlow; ctx.fillRect(0, 0, split, height);
      const rightGlow = ctx.createLinearGradient(split, 0, width, 0);
      rightGlow.addColorStop(0, "rgba(255,79,216,0)"); rightGlow.addColorStop(1, "rgba(255,79,216,.09)");
      ctx.fillStyle = rightGlow; ctx.fillRect(split, 0, width - split, height);
      ctx.strokeStyle = `rgba(238,248,255,${.12 + Math.sin(game.time * 8) * .04})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(split, 0); ctx.lineTo(split, height); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.save();
    const sx = game?.shake ? (Math.random() - .5) * game.shake : 0;
    const sy = game?.shake ? (Math.random() - .5) * game.shake : 0;
    ctx.translate(sx, sy);
    drawBackground();
    if (game) {
      drawPickups(); drawBullets(); drawHazards(); drawEnemies(); drawPlayer(); drawParticles(); drawTexts();
      if (game.flash > 0) { ctx.fillStyle = `rgba(255, 93, 72, ${game.flash * .35})`; ctx.fillRect(-10, -10, width + 20, height + 20); }
      if (game.dodgeFlash > 0) { ctx.fillStyle = `rgba(72, 231, 255, ${game.dodgeFlash * .22})`; ctx.fillRect(-10, -10, width + 20, height + 20); }
      if (game.slowTime > 0) { ctx.strokeStyle = "rgba(72,231,255,.35)"; ctx.lineWidth = 5; ctx.strokeRect(3, 3, width - 6, height - 6); }
    }
    ctx.restore();
  }

  function drawPlayer() {
    const p = game.player;
    const pulse = Math.sin(game.time * 4) * 2;
    ctx.strokeStyle = "rgba(72, 231, 255, .18)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.aura + pulse, 0, TAU); ctx.stroke();
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 55);
    glow.addColorStop(0, "rgba(72,231,255,.28)"); glow.addColorStop(1, "rgba(72,231,255,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, 55, 0, TAU); ctx.fill();
    ctx.globalAlpha = p.invincible > 0 && Math.floor(p.invincible * 14) % 2 ? .35 : 1;
    const moving = keys.has("w") || keys.has("a") || keys.has("s") || keys.has("d") || keys.has("arrowup") || keys.has("arrowleft") || keys.has("arrowdown") || keys.has("arrowright");
    const bob = moving ? Math.round(Math.sin(game.time * 13) * 1.5) : Math.round(Math.sin(game.time * 3) * .5);
    if (p.dashTime > 0) {
      drawPlayerSprite(p, p.x - p.dirX * 23, p.y - p.dirY * 23 + bob, .18);
      drawPlayerSprite(p, p.x - p.dirX * 12, p.y - p.dirY * 12 + bob, .32);
    }
    drawPlayerSprite(p, p.x, p.y + bob, 1);
    ctx.globalAlpha = 1;
    if (p.dash > 0) {
      ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 21, -.5 * Math.PI, (-.5 + (1 - p.dash / p.dashMax) * 2) * Math.PI); ctx.stroke();
    }
  }

  function drawPlayerSprite(player, x, y, alpha) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(player.dirX < -.05 ? -1 : 1, 1);
    ctx.globalAlpha *= alpha;
    if (playerSprite.complete && playerSprite.naturalWidth) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(playerSprite, -28, -43, 56, 79);
    } else {
      ctx.fillStyle = "#eef8ff";
      ctx.fillRect(-8, -12, 16, 24);
      ctx.fillStyle = "#48e7ff";
      ctx.fillRect(-4, -8, 8, 8);
    }
    ctx.restore();
  }

  function drawEnemies() {
    for (const enemy of game.enemies) {
      if (enemy.kind.isBoss) {
        drawBoss(enemy);
        continue;
      }
      const label = enemy.kind.label || enemy.kind.name.slice(0, 4);
      const badgeWidth = Math.max(40, label.length * 15 + 15);
      const badgeHeight = 25;
      ctx.save(); ctx.translate(Math.round(enemy.x), Math.round(enemy.y));
      ctx.rotate(Math.sin(enemy.angle * .7) * .045);
      if (enemy.kind.isMiniBoss) {
        ctx.globalAlpha = .45;
        ctx.strokeStyle = enemy.kind.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.r + 13 + Math.sin(game.time * 5) * 2, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.shadowBlur = enemy.hit > 0 ? 20 : enemy.kind.isMiniBoss ? 18 : 10;
      ctx.shadowColor = enemy.hit > 0 ? "#ffffff" : enemy.kind.color;
      ctx.fillStyle = "rgba(7, 10, 22, .9)";
      ctx.strokeStyle = enemy.hit > 0 ? "#ffffff" : enemy.kind.color;
      ctx.lineWidth = enemy.kind.isMiniBoss ? 2.5 : 1.5;
      roundedRectPath(ctx, -badgeWidth / 2, -badgeHeight / 2, badgeWidth, badgeHeight, 7);
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = .2;
      ctx.fillStyle = enemy.kind.color;
      roundedRectPath(ctx, -badgeWidth / 2 + 3, -badgeHeight / 2 + 3, badgeWidth - 6, badgeHeight - 6, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 7;
      ctx.fillStyle = "#eef8ff";
      ctx.font = "800 12px 'PingFang SC', 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, .5);
      if (enemy.kind.isMiniBoss) {
        ctx.font = "800 7px ui-monospace, monospace";
        ctx.fillStyle = enemy.kind.color;
        ctx.fillText("MINI BOSS", 0, -badgeHeight / 2 - 7);
      }
      ctx.restore();
      if (enemy.hp < enemy.maxHp) {
        const healthWidth = badgeWidth - 8;
        ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(enemy.x - healthWidth / 2, enemy.y + badgeHeight / 2 + 5, healthWidth, 2);
        ctx.fillStyle = enemy.kind.color; ctx.fillRect(enemy.x - healthWidth / 2, enemy.y + badgeHeight / 2 + 5, healthWidth * Math.max(0, enemy.hp / enemy.maxHp), 2);
      }
    }
  }

  function roundedRectPath(context, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + w - r, y);
    context.quadraticCurveTo(x + w, y, x + w, y + r);
    context.lineTo(x + w, y + h - r);
    context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    context.lineTo(x + r, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function drawBoss(boss) {
    const pulse = Math.sin(game.time * 4) * 3;
    ctx.save();
    ctx.translate(boss.x, boss.y);

    ctx.globalAlpha = .3;
    ctx.strokeStyle = "#48e7ff"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 78 + pulse, 0, Math.PI); ctx.stroke();
    ctx.strokeStyle = "#ff4fd8";
    ctx.beginPath(); ctx.arc(0, 0, 78 - pulse, Math.PI, TAU); ctx.stroke();
    ctx.rotate(-game.time * .28);
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * TAU;
      ctx.save(); ctx.rotate(angle); ctx.translate(0, -88);
      ctx.fillStyle = i % 2 ? "#48e7ff" : "#ff4fd8";
      ctx.font = "900 13px monospace"; ctx.textAlign = "center"; ctx.fillText(i % 2 ? ">" : "<", 0, 0);
      ctx.restore();
    }
    ctx.rotate(game.time * .28);
    ctx.globalAlpha = 1;

    ctx.shadowBlur = 28; ctx.shadowColor = boss.hit > 0 ? "#ffffff" : "#a75bff";
    const hair = ctx.createLinearGradient(-48, 0, 48, 0);
    hair.addColorStop(0, "#174c70"); hair.addColorStop(.48, "#101325"); hair.addColorStop(.52, "#22102d"); hair.addColorStop(1, "#7a175f");
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(-42, -28); ctx.quadraticCurveTo(-68, 12, -48, 72); ctx.quadraticCurveTo(-22, 56, 0, 65);
    ctx.quadraticCurveTo(24, 58, 49, 73); ctx.quadraticCurveTo(68, 10, 41, -29); ctx.closePath(); ctx.fill();

    ctx.shadowBlur = 12;
    const suit = ctx.createLinearGradient(-45, 0, 45, 0);
    suit.addColorStop(0, "#123a5c"); suit.addColorStop(.5, "#111526"); suit.addColorStop(1, "#591345");
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.moveTo(-45, 76); ctx.quadraticCurveTo(-37, 38, -18, 29); ctx.lineTo(18, 29); ctx.quadraticCurveTo(38, 38, 46, 76); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(238,248,255,.55)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-18, 32); ctx.lineTo(0, 58); ctx.lineTo(18, 32); ctx.stroke();

    ctx.shadowBlur = 18;
    const face = ctx.createLinearGradient(-22, 0, 22, 0);
    face.addColorStop(0, boss.hit > 0 ? "#ffffff" : "#a9ecff"); face.addColorStop(.49, "#e8f9ff"); face.addColorStop(.51, "#fff0fb"); face.addColorStop(1, boss.hit > 0 ? "#ffffff" : "#ffb7eb");
    ctx.fillStyle = face;
    ctx.beginPath(); ctx.ellipse(0, -9, 25, 34, 0, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#153650"; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-16, -13); ctx.quadraticCurveTo(-10, -17, -5, -13); ctx.stroke();
    ctx.strokeStyle = "#6b174f";
    ctx.beginPath(); ctx.moveTo(5, -13); ctx.quadraticCurveTo(11, -17, 16, -13); ctx.stroke();
    ctx.fillStyle = "#10131f"; ctx.beginPath(); ctx.arc(-10, -12, 2.5, 0, TAU); ctx.arc(10, -12, 2.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#8d3b74"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 3, 7, .2, Math.PI - .2); ctx.stroke();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#48e7ff"; ctx.beginPath(); ctx.moveTo(-30, -37); ctx.lineTo(-18, -52); ctx.lineTo(-5, -39); ctx.stroke();
    ctx.strokeStyle = "#ff4fd8"; ctx.beginPath(); ctx.moveTo(5, -39); ctx.lineTo(18, -52); ctx.lineTo(30, -37); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -43); ctx.lineTo(0, 60); ctx.stroke();
    ctx.restore();
  }

  function drawHazards() {
    for (const hazard of game.hazards) {
      ctx.save(); ctx.translate(hazard.x, hazard.y); ctx.rotate(hazard.spin);
      ctx.shadowBlur = 18; ctx.shadowColor = hazard.color; ctx.strokeStyle = hazard.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-hazard.r, -hazard.r); ctx.lineTo(hazard.r, hazard.r); ctx.moveTo(hazard.r, -hazard.r); ctx.lineTo(-hazard.r, hazard.r); ctx.stroke();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }

  function drawBullets() {
    for (const bullet of game.bullets) {
      ctx.shadowBlur = 14; ctx.shadowColor = bullet.critical ? "#ffe66d" : "#48e7ff";
      ctx.fillStyle = bullet.critical ? "#ffe66d" : "#eef8ff";
      ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.r, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawPickups() {
    for (const orb of game.pickups) {
      const pulse = 1 + Math.sin(game.time * 7 + orb.x) * .18;
      ctx.shadowBlur = 12; ctx.shadowColor = "#3f8cff"; ctx.fillStyle = "#74dfff";
      ctx.beginPath(); ctx.arc(orb.x, orb.y, orb.r * pulse, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawParticles() {
    for (const particle of game.particles) {
      ctx.globalAlpha = Math.min(1, particle.life * 2.5); ctx.fillStyle = particle.color;
      ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawTexts() {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const item of game.texts) {
      const maxLife = item.maxLife || 1;
      const fade = Math.min(1, item.life / Math.min(.35, maxLife));
      ctx.globalAlpha = fade * (item.alpha ?? 1);
      ctx.font = item.font || "800 12px sans-serif";
      ctx.fillStyle = item.color;
      ctx.shadowBlur = item.glow ? 8 : 0;
      ctx.shadowColor = item.glow || "transparent";
      ctx.fillText(item.text, item.x, item.y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function loop(now) {
    const dt = Math.min(.033, (now - lastTime) / 1000);
    lastTime = now;
    update(dt); draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "r", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
    if (key === "r" && state === "upgrade") refreshUpgradeChoices();
    else if (key === " ") dash(); else if (key === "escape") togglePause(); else keys.add(key);
  });
  window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => { keys.clear(); if (state === "playing") togglePause(true); });
  $("#startButton").addEventListener("click", startGame);
  $("#restartButton").addEventListener("click", startGame);
  $("#resumeButton").addEventListener("click", () => togglePause(false));
  ui.pauseButton.addEventListener("click", () => togglePause());
  ui.refreshUpgrades.addEventListener("click", refreshUpgradeChoices);
  ui.sound.addEventListener("click", () => { soundOn = !soundOn; ui.sound.textContent = `声音：${soundOn ? "开" : "关"}`; if (soundOn) beep(440); });

  resize();
  game = freshGame();
  draw();
  requestAnimationFrame(loop);
})();
