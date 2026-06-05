// ========== SinglePlayerMode — 单机经典贪吃蛇 ==========
// 无网络、无对手，纯客户端游戏循环

(function () {
  window.SinglePlayerMode = {
    engine: null,
    myPlayerIndex: -1,
    tickTimer: null,
    renderLoopId: null,
    scoreStartTime: 0,
    gameRunning: false,

    /**
     * 启动单机模式：初始化引擎 → 添加玩家 → 开始游戏循环
     */
    start() {
      // 创建引擎
      this.engine = new GameEngine({ mapW: 60, mapH: 40, tickRate: 8, foodMax: 30 });
      this.myPlayerIndex = this.engine.addPlayer('Player', '#6c5ce7');

      // 注册回调
      this.engine.onGameOver = (engine) => { this._endGame(engine); };
      this.engine.onPlayerDied = (engine, idx, reason) => {
        if (idx === this.myPlayerIndex) {
          this._addKillMessage(`💀 你 ${reason}（长度: ${engine.players[idx].length}）`);
        }
      };

      // 显示游戏 Canvas
      this._showGamePanel();

      // 获取画布
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

      // 清空击杀日志
      document.getElementById('killFeed').innerHTML = '';

      // 启动双循环
      const tickInterval = 1000 / this.engine.tickRate;
      this.tickTimer = setInterval(() => {
        if (!this.gameRunning) return;
        this.engine.tick();
      }, tickInterval);

      this._startRenderLoop();
    },

    _showGamePanel() {
      const $menu = document.getElementById('menu');
      const $lobby = document.getElementById('lobby');
      const $game = document.getElementById('game');
      const $result = document.getElementById('result');
      const $aiConfig = document.getElementById('aiConfig');
      const $multiplayerSetup = document.getElementById('multiplayerSetup');

      [$menu, $lobby, $game, $result, $aiConfig, $multiplayerSetup].forEach(
        p => { if (p) p.style.display = 'none'; }
      );
      $game.style.display = 'block';
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

        // UI 更新
        const elapsed = Math.floor((Date.now() - this.scoreStartTime) / 1000);
        const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const sec = String(elapsed % 60).padStart(2, '0');
        document.getElementById('gameTimer').textContent = `${min}:${sec}`;
        const myLen = me && me.alive ? me.length : 0;
        document.getElementById('aliveCount').textContent = `长度：${myLen} | 最高分：${this._getHighScore()}`;

        this.renderLoopId = requestAnimationFrame(render);
      };

      this.renderLoopId = requestAnimationFrame(render);
    },

    _endGame(engine) {
      this.gameRunning = false;
      if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
      if (this.renderLoopId) { cancelAnimationFrame(this.renderLoopId); this.renderLoopId = null; }

      const me = engine.players[this.myPlayerIndex];
      const score = me ? me.length : 0;
      const elapsed = Math.floor((Date.now() - this.scoreStartTime) / 1000);

      // 保存最高分
      this._saveHighScore(score);

      // 显示结算
      const $result = document.getElementById('result');
      const $game = document.getElementById('game');
      $game.style.display = 'none';
      $result.style.display = 'block';

      const titleEl = document.getElementById('resultTitle');
      const winnerEl = document.getElementById('winnerInfo');
      const rankingEl = document.getElementById('rankingList');

      titleEl.textContent = '🎮 游戏结束';
      winnerEl.innerHTML = `
        <p>最终长度：<strong style="color:#ffd700;">${score}</strong></p>
        <p>存活时间：${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒</p>
        <p>🏆 历史最高分：<strong style="color:#ffd700;">${this._getHighScore()}</strong></p>
      `;
      rankingEl.innerHTML = ''; // 单机模式无排行榜

      // 改按钮文字
      const btnBack = document.getElementById('btnBackToMenu');
      btnBack.textContent = '再来一局';
      btnBack.onclick = () => {
        $result.style.display = 'none';
        this.restart();
      };

      // 额外添加返回菜单按钮
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
      // 清理旧状态
      if (this.tickTimer) clearInterval(this.tickTimer);
      if (this.renderLoopId) cancelAnimationFrame(this.renderLoopId);
      this.gameRunning = false;
      this.engine = null;

      // 重新开始
      this.start();
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

      // 恢复按钮
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

    // --- 最高分 ---

    _getHighScore() {
      try {
        const scores = JSON.parse(localStorage.getItem('snake_single_high_score') || '0');
        return scores;
      } catch { return 0; }
    },

    _saveHighScore(score) {
      const current = this._getHighScore();
      if (score > current) {
        localStorage.setItem('snake_single_high_score', JSON.stringify(score));
      }
    },
  };
})();
