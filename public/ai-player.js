// ========== AIPlayer — 贪吃蛇 AI 决策模块 ==========
// 方向评分算法：安全性 > 陷阱检测 > 食物距离 > 随机噪声

(function () {
  window.AIPlayer = {

    /**
     * 为 Bot 决定下一步方向
     * @param {object} bot       — 蛇的玩家对象（含 segments, dir, aiState, difficulty）
     * @param {object} gameState — { mapW, mapH, players, food }（可以是 engine 本身或 engine.getState()）
     * @param {string} difficulty — 'easy' | 'medium' | 'hard'
     * @returns {{x: number, y: number}}
     */
    decide(bot, gameState, difficulty) {
      const head = bot.segments[0];
      const dirs = [
        { x: 0, y: -1, name: 'up' },
        { x: 1, y: 0, name: 'right' },
        { x: 0, y: 1, name: 'down' },
        { x: -1, y: 0, name: 'left' },
      ];

      const candidates = dirs.filter(d => {
        // 禁止反向
        if (bot.dir.x + d.x === 0 && bot.dir.y + d.y === 0) return false;
        return true;
      });

      if (candidates.length === 0) return { x: 0, y: 1 }; // 只能继续

      // 难度参数
      const diffConfig = {
        easy:   { noiseMax: 80, lookAheadSteps: 0, randomChance: 0.15 },
        medium: { noiseMax: 30, lookAheadSteps: 3, randomChance: 0.05 },
        hard:   { noiseMax: 10, lookAheadSteps: 6, randomChance: 0.02 },
      };
      const cfg = diffConfig[difficulty] || diffConfig.medium;

      // 对每个候选方向评分
      const scored = candidates.map(d => {
        const nextX = head.x + d.x;
        const nextY = head.y + d.y;

        // --- 立即死亡检查 ---
        if (nextX < 0 || nextX >= gameState.mapW || nextY < 0 || nextY >= gameState.mapH) {
          return { dir: d, score: -10000 };
        }

        if (this._isOccupied(nextX, nextY, gameState.players, bot.id || bot.name)) {
          return { dir: d, score: -10000 };
        }

        let score = 0;

        // --- 陷阱检测（中/困难） ---
        if (cfg.lookAheadSteps > 0) {
          const reachable = this._floodFillCount(nextX, nextY, gameState, cfg.lookAheadSteps, bot.id || bot.name);
          score += reachable * 15;
        }

        // --- 食物距离 ---
        const nearestF = this._nearestFood(nextX, nextY, gameState.food);
        if (nearestF) {
          const dist = Math.abs(nextX - nearestF.x) + Math.abs(nextY - nearestF.y);
          score += Math.max(0, 250 - dist * 12);
        }

        // --- 边缘惩罚（困难） ---
        if (difficulty === 'hard') {
          const edgeDist = Math.min(nextX, nextY, gameState.mapW - 1 - nextX, gameState.mapH - 1 - nextY);
          if (edgeDist <= 2) score -= 20;
        }

        // --- 随机噪声 ---
        score += Math.random() * cfg.noiseMax;

        return { dir: d, score };
      });

      // 排序选最高分
      scored.sort((a, b) => b.score - a.score);

      // 简单模式有几率随机选
      if (difficulty === 'easy' && Math.random() < cfg.randomChance && scored.length > 1) {
        return scored[Math.floor(Math.random() * scored.length)].dir;
      }

      return scored[0].dir;
    },

    // --- 内部辅助 ---

    /**
     * 检查某格是否被任何蛇占据
     */
    _isOccupied(x, y, players, excludeId) {
      for (const p of players) {
        if (!p.alive && p.alive !== undefined) continue;  // 跳过明确不再活着的
        if (p.id === excludeId || p.name === excludeId) continue;
        if (!p.segments) continue;
        for (const seg of p.segments) {
          if (seg.x === x && seg.y === y) return true;
        }
      }
      return false;
    },

    /**
     * 找离当前位置最近的食物
     */
    _nearestFood(x, y, food) {
      if (!food || food.length === 0) return null;
      let best = null;
      let bestDist = Infinity;
      for (const f of food) {
        const dist = Math.abs(f.x - x) + Math.abs(f.y - y);
        if (dist < bestDist) { bestDist = dist; best = f; }
      }
      return best;
    },

    /**
     * BFS 计算从 (startX, startY) 出发在 maxSteps 步内可达的格子数
     * 用于评估移动后的活动空间（空间越大越安全）
     */
    _floodFillCount(startX, startY, gameState, maxSteps, excludeId) {
      const visited = new Set();
      let queue = [{ x: startX, y: startY }];
      let count = 0;

      for (let step = 0; step <= maxSteps; step++) {
        const nextQueue = [];
        for (const pos of queue) {
          const key = `${pos.x},${pos.y}`;
          if (visited.has(key)) continue;
          if (pos.x < 0 || pos.x >= gameState.mapW || pos.y < 0 || pos.y >= gameState.mapH) continue;
          if (this._isOccupied(pos.x, pos.y, gameState.players, excludeId)) continue;
          visited.add(key);
          count++;

          // 四个方向
          nextQueue.push({ x: pos.x, y: pos.y - 1 });
          nextQueue.push({ x: pos.x + 1, y: pos.y });
          nextQueue.push({ x: pos.x, y: pos.y + 1 });
          nextQueue.push({ x: pos.x - 1, y: pos.y });
        }
        queue = nextQueue;
      }

      return count;
    },
  };
})();
