// ========== GameEngine — 客户端游戏引擎 ==========
// 单机模式和人机模式共用此引擎，无需服务端

(function () {
  const MAP_W = 60;
  const MAP_H = 40;
  const FOOD_MAX = 30;
  const INITIAL_LENGTH = 4;

  function randPos() {
    return { x: Math.floor(Math.random() * MAP_W), y: Math.floor(Math.random() * MAP_H) };
  }

  function randDir() {
    const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
    return dirs[Math.floor(Math.random() * dirs.length)];
  }

  function genId(len) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  window.GameEngine = class GameEngine {
    constructor(config = {}) {
      this.mapW = config.mapW || MAP_W;
      this.mapH = config.mapH || MAP_H;
      this.tickRate = config.tickRate || 8;
      this.foodMax = config.foodMax || FOOD_MAX;
      this.initialLength = config.initialLength || INITIAL_LENGTH;
      this.players = [];
      this.food = [];
      this.state = 'idle';   // 'idle' | 'running' | 'ended'
      this.tickCount = 0;
      this.winner = null;
      this.ranking = [];

      // 回调
      this.onPlayerDied = null;   // (engine, playerIndex, reason)
      this.onGameOver = null;     // (engine)
      this.onFoodEaten = null;    // (engine, playerIndex, foodPos)
      this.onTick = null;         // (engine) — 每 tick 都触发
    }

    // ---- Public API ----

    addPlayer(name, color) {
      const player = this._makePlayer(name, color, false, 'medium');
      this.players.push(player);
      return this.players.length - 1;
    }

    addBot(name, color, difficulty) {
      const player = this._makePlayer(name, color, true, difficulty || 'medium');
      this.players.push(player);
      return this.players.length - 1;
    }

    start() {
      // 重置所有玩家
      for (const p of this.players) {
        const fresh = this._makePlayer(p.name, p.color, p.isBot, p.difficulty);
        Object.assign(p, fresh);
        p.alive = true;
      }

      this.state = 'running';
      this.tickCount = 0;
      this.food = [];
      this.winner = null;
      this.ranking = [];

      while (this.food.length < this.foodMax) {
        this.food.push(this._spawnFood());
      }
    }

    tick() {
      if (this.state !== 'running') return { changed: false, playersDied: [] };

      this.tickCount++;
      const playersDied = [];

      // 1. 移动所有存活蛇
      for (const p of this.players) {
        if (!p.alive) continue;
        p.segments.unshift({ x: p.head.x + p.dir.x, y: p.head.y + p.dir.y });
        if (p.segments.length > p.length) p.segments.pop();
      }

      // 2. 收集所有占用的格子
      const allSegments = [];
      for (const p of this.players) {
        if (!p.alive) continue;
        for (const seg of p.segments) {
          allSegments.push({ ...seg, ownerIdx: this.players.indexOf(p) });
        }
      }

      // 3. 碰撞检测
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (!p.alive) continue;

        // 撞墙
        if (p.head.x < 0 || p.head.x >= this.mapW || p.head.y < 0 || p.head.y >= this.mapH) {
          this._killPlayer(i, '撞墙出局');
          playersDied.push({ index: i, reason: '撞墙出局' });
          continue;
        }

        // 撞自己
        let selfHit = false;
        for (let j = 1; j < p.segments.length; j++) {
          if (p.segments[j].x === p.head.x && p.segments[j].y === p.head.y) {
            this._killPlayer(i, '撞到自己出局');
            playersDied.push({ index: i, reason: '撞到自己出局' });
            selfHit = true;
            break;
          }
        }
        if (selfHit) continue;

        // 撞其他蛇
        for (const seg of allSegments) {
          if (seg.ownerIdx === i) continue;
          if (seg.x === p.head.x && seg.y === p.head.y) {
            const other = this.players[seg.ownerIdx];
            this._killPlayer(i, `撞到 ${other.name} 出局`);
            playersDied.push({ index: i, reason: `撞到 ${other.name} 出局` });
            break;
          }
        }
      }

      // 检测头对头碰撞（两个蛇头在同一格 — 都死）
      const headPositions = {};
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (!p.alive) continue;
        const key = `${p.head.x},${p.head.y}`;
        if (!headPositions[key]) headPositions[key] = [];
        headPositions[key].push(i);
      }
      for (const key of Object.keys(headPositions)) {
        const indices = headPositions[key];
        if (indices.length >= 2) {
          for (const idx of indices) {
            if (this.players[idx].alive) {
              this._killPlayer(idx, '头对头碰撞出局');
              playersDied.push({ index: idx, reason: '头对头碰撞出局' });
            }
          }
        }
      }

      // 4. 吃食物
      for (let fi = this.food.length - 1; fi >= 0; fi--) {
        const f = this.food[fi];
        for (let i = 0; i < this.players.length; i++) {
          const p = this.players[i];
          if (!p.alive) continue;
          if (p.head.x === f.x && p.head.y === f.y) {
            p.length += 2;
            p.kills++;
            this.food.splice(fi, 1);
            if (this.onFoodEaten) this.onFoodEaten(this, i, { x: f.x, y: f.y });
            break;
          }
        }
      }

      // 5. 补充食物
      while (this.food.length < this.foodMax) {
        this.food.push(this._spawnFood());
      }

      // 6. 胜负判定
      const alivePlayers = this.players.filter(p => p.alive);
      if (alivePlayers.length <= 1) {
        this._endGame();
      }

      // 触发所有死亡回调
      for (const d of playersDied) {
        if (this.onPlayerDied) this.onPlayerDied(this, d.index, d.reason);
      }

      if (this.onTick) this.onTick(this);

      return { changed: playersDied.length > 0, playersDied };
    }

    setDirection(playerIndex, dir) {
      const p = this.players[playerIndex];
      if (!p || !p.alive) return false;
      // 禁止反向
      if (p.dir.x + dir.x === 0 && p.dir.y + dir.y === 0) return false;
      p.dir = { x: dir.x, y: dir.y };
      return true;
    }

    getState() {
      return {
        mapW: this.mapW,
        mapH: this.mapH,
        state: this.state,
        tickCount: this.tickCount,
        players: this.players.map((p, i) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          segments: p.segments.slice(),
          alive: p.alive,
          kills: p.kills,
          length: p.length,
          isBot: p.isBot,
          index: i,
        })),
        food: this.food.slice(),
        aliveCount: this.players.filter(p => p.alive).length,
        winner: this.winner,
        ranking: this.ranking.slice(),
      };
    }

    stop() {
      this.state = 'ended';
    }

    // ---- Internal ----

    _makePlayer(name, color, isBot, difficulty) {
      const dir = randDir();
      const head = randPos();
      const segments = [head];
      for (let k = 1; k < INITIAL_LENGTH; k++) {
        segments.push({ x: head.x - dir.x * k, y: head.y - dir.y * k });
      }
      return {
        id: genId(8),
        name,
        color,
        segments,
        dir,
        length: INITIAL_LENGTH,
        alive: true,
        kills: 0,
        isBot: !!isBot,
        difficulty: difficulty || 'medium',
        aiState: {},
        get head() { return this.segments[0]; },
      };
    }

    _spawnFood() {
      return { ...randPos(), color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)` };
    }

    _killPlayer(index, reason) {
      const p = this.players[index];
      if (!p || !p.alive) return;
      p.alive = false;
    }

    _endGame() {
      this.state = 'ended';
      this.ranking = this.players.map(p => ({
        name: p.name,
        kills: p.kills,
        length: p.length,
        alive: p.alive,
      }));
      this.ranking.sort((a, b) => b.length - a.length);
      this.winner = this.players.find(p => p.alive) || null;
      if (this.onGameOver) this.onGameOver(this);
    }
  };
})();
