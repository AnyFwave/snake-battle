// ========== AIMode — 人机对战模式 ==========
// 人类玩家 vs N 个 AI Bot，回合制大逃杀

(function () {
  // Bot 预设名字和颜色
  const BOT_PRESETS = [
    { name: '毒牙', color: '#2ecc71' },
    { name: '闪电', color: '#f1c40f' },
    { name: '巨蟒', color: '#e67e22' },
    { name: '幽灵', color: '#9b59b6' },
    { name: '铁甲', color: '#1abc9c' },
    { name: '幻影', color: '#3498db' },
    { name: '利爪', color: '#e74c3c' },
  ];

  window.AIMode = {
    engine: null,
    myPlayerIndex: -1,
    tickTimer: null,
    renderLoopId: null,
    gameRunning: false,
    selectedBotCount: 4,
    selectedDifficulty: 'medium',
    scoreStartTime: 0,

    /**
     * 显示人机配置面板
     */
    showConfig() {
      const panels = ['menu', 'lobby', 'game', 'result', 'aiConfig', 'multiplayerSetup'];
      panels.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      document.getElementById('aiConfig').style.display = 'block';
    },

    /**
     * 启动人机对战
     * @param {number} botCount — Bot 数量 (1-7)
     * @param {string} difficulty — 'easy' | 'medium' | 'hard'
     */
    start(botCount, difficulty) {
      this.selectedBotCount = botCount;
      this.selectedDifficulty = difficulty;

      // 创建引擎
      this.engine = new GameEngine({ mapW: 60, mapH: 40, tickRate: 8, foodMax: 30 });

      // 添加人类玩家
      this.myPlayerIndex = this.engine.addPlayer('你', '#6c5ce7');

      // 添加 Bot
      for (let i = 0; i < botCount; i++) {
        const preset = BOT_PRESETS[i % BOT_PRESETS.length];
        const name = i < BOT_PRESETS.length ? preset.name : `${preset.name}${i - BOT_PRESETS.length + 1}`;
        this.engine.addBot(name, preset.color, difficulty);
      }

      // 注册回调
      this.engine.onGameOver = (engine) => { this._endGame(engine); };
      this.engine.onPlayerDied = (engine, idx, reason) => {
        const p = engine.players[idx];
        this._addKillMessage(`💀 ${p.name} ${reason}（长度: ${p.length}, 击杀: ${p.kills}）`);
      };

      // 注册每 tick 回调：执行 AI 决策
      this.engine.onTick = (engine) => {
        for (let i = 0; i < engine.players.length; i++) {
          const p = engine.players[i];
          if (!p.alive || !p.isBot) continue;
          const state = engine.getState();
          const dir = AIPlayer.decide(p, state, p.difficulty);
          engine.setDirection(i, dir);
        }
      };

      // 显示游戏界面
      this._showGamePanel();

      const canvas = document.getElementById('gameCanvas');
      const mapW = this.engine.mapW;
      const mapH = this.engine.mapH;
      const cellSize = SnakeRenderer.calcCellSize(mapW, mapH);
      canvas.width = mapW * cellSize;
      canvas.height = mapH * cellSize;

      // 开始！
      this.engine.start();
      this.scoreStartTime = Date.now();
      this.gameRunning = true;

      document.getElementById('killFeed').innerHTML = '';

      // 双循环
      const tickInterval = 1000 / this.engine.tickRate;
      this.tickTimer = setInterval(() => {
        if (!this.gameRunning) return;
        this.engine.tick();
      }, tickInterval);

      this._startRenderLoop();
    },

    _showGamePanel() {
      const panels = ['menu', 'lobby', 'game', 'result', 'aiConfig', 'multiplayerSetup'];
      panels.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      document.getElementById('game').style.display = 'block';
    },

    _startRenderLoop() {
      const canvas = document.getElementById('gameCanvas');
      const ctx = canvas.getContext('2d');

      const render = () => {
        if (!this.gameRunning) return;

        const state = this.engine.getState();
        const cellSize = SnakeRenderer.calcCellSize(state.mapW, state.mapH);
        canvas.width = state.mapW * cellSize;
        canvas.height = state.mapH * cellSize;

        const me = state.players[this.myPlayerIndex];
        SnakeRenderer.render(ctx, state, me ? me.id : null, cellSize);

        // UI
        const elapsed = Math.floor((Date.now() - this.scoreStartTime) / 1000);
        const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const sec = String(elapsed % 60).padStart(2, '0');
        document.getElementById('gameTimer').textContent = `${min}:${sec}`;
        document.getElementById('aliveCount').textContent = `存活：${state.aliveCount}`;

        this.renderLoopId = requestAnimationFrame(render);
      };

      this.renderLoopId = requestAnimationFrame(render);
    },

    _endGame(engine) {
      this.gameRunning = false;
      if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
      if (this.renderLoopId) { cancelAnimationFrame(this.renderLoopId); this.renderLoopId = null; }

      const me = engine.players[this.myPlayerIndex];
      const elapsed = Math.floor((Date.now() - this.scoreStartTime) / 1000);

      // 显示结算
      const $result = document.getElementById('result');
      const $game = document.getElementById('game');
      $game.style.display = 'none';
      $result.style.display = 'block';

      const titleEl = document.getElementById('resultTitle');
      const winnerEl = document.getElementById('winnerInfo');
      const rankingEl = document.getElementById('rankingList');

      if (engine.winner) {
        const isMe = engine.winner.id === (me ? me.id : null);
        titleEl.textContent = isMe ? '🏆 恭喜获胜！' : '💀 游戏结束';
        winnerEl.innerHTML = `
          <p>冠军：<strong style="color:#ffd700;">${engine.winner.name}</strong></p>
          <p>长度：${engine.winner.length} | 击杀：${engine.winner.kills}</p>
          <p style="font-size:0.85rem;color:#a0a0d0;">⏱ ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒</p>
        `;
      } else {
        titleEl.textContent = '🤝 平局！';
        winnerEl.innerHTML = '<p>所有玩家同时出局</p>';
      }

      rankingEl.innerHTML = engine.ranking.map((r, i) => `
        <li>
          <span class="rank-name">#${i + 1} ${r.name} ${r.alive ? '👑' : '💀'}</span>
          <span class="rank-stats">长度 ${r.length} | 击杀 ${r.kills}</span>
        </li>
      `).join('');

      // 按钮
      const btnBack = document.getElementById('btnBackToMenu');
      btnBack.textContent = '再来一局';
      btnBack.onclick = () => {
        $result.style.display = 'none';
        this.restart();
      };

      if (!document.getElementById('btnBackToMenu2')) {
        const btn = document.createElement('button');
        btn.id = 'btnBackToMenu2';
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'margin-top:10px;width:100%;';
        btn.textContent = '返回菜单';
        btn.addEventListener('click', () => { this.exit(); });
        btnBack.parentNode.appendChild(btn);
      }
    },

    restart() {
      if (this.tickTimer) clearInterval(this.tickTimer);
      if (this.renderLoopId) cancelAnimationFrame(this.renderLoopId);
      this.gameRunning = false;
      this.engine = null;
      this.start(this.selectedBotCount, this.selectedDifficulty);
    },

    exit() {
      if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
      if (this.renderLoopId) { cancelAnimationFrame(this.renderLoopId); this.renderLoopId = null; }
      this.gameRunning = false;
      this.engine = null;

      document.getElementById('killFeed').innerHTML = '';

      const $result = document.getElementById('result');
      const $game = document.getElementById('game');
      if ($result) $result.style.display = 'none';
      if ($game) $game.style.display = 'none';

      const btnBack = document.getElementById('btnBackToMenu');
      if (btnBack) btnBack.textContent = '返回大厅';
      const btn2 = document.getElementById('btnBackToMenu2');
      if (btn2) btn2.remove();

      document.getElementById('menu').style.display = 'block';
    },

    _addKillMessage(text) {
      const feed = document.getElementById('killFeed');
      const div = document.createElement('div');
      div.className = 'kill-msg';
      div.textContent = text;
      feed.appendChild(div);
      if (feed.children.length > 20) feed.removeChild(feed.firstChild);
      feed.scrollTop = feed.scrollHeight;
    },
  };
})();
