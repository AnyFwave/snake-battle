// ========== SnakeRenderer — 共享 Canvas 渲染模块 ==========
// 从 client.js 抽取，单机/人机/联机三类模式共用

(function () {
  window.SnakeRenderer = {

    /**
     * 渲染一帧到 canvas context
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} state     — { mapW, mapH, players, food, aliveCount }
     * @param {string|null} myPlayerId — 本地玩家的 id（用于高亮），null 表示不高亮
     * @param {number} cellSize  — 每格像素
     */
    render(ctx, state, myPlayerId, cellSize) {
      const { mapW, mapH, players, food } = state;

      // 背景
      ctx.fillStyle = '#0d0d25';
      ctx.fillRect(0, 0, mapW * cellSize, mapH * cellSize);

      // 网格线
      ctx.strokeStyle = '#111133';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= mapW; x++) {
        ctx.beginPath();
        ctx.moveTo(x * cellSize, 0);
        ctx.lineTo(x * cellSize, mapH * cellSize);
        ctx.stroke();
      }
      for (let y = 0; y <= mapH; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * cellSize);
        ctx.lineTo(mapW * cellSize, y * cellSize);
        ctx.stroke();
      }

      // 食物
      food.forEach(f => {
        const cx = f.x * cellSize + cellSize / 2;
        const cy = f.y * cellSize + cellSize / 2;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(cx, cy, cellSize * 0.35, 0, Math.PI * 2);
        ctx.fill();
        // 光晕
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(cx, cy, cellSize * 0.15, 0, Math.PI * 2);
        ctx.fill();
      });

      // 蛇
      players.forEach(p => {
        if (!p.segments || p.segments.length === 0) return;
        const isMe = p.id === myPlayerId;
        const alpha = p.alive ? 1 : 0.3;

        p.segments.forEach((seg, i) => {
          const x = seg.x * cellSize;
          const y = seg.y * cellSize;
          const pad = 1;

          ctx.globalAlpha = alpha;

          if (i === 0) {
            // 蛇头 — 圆角方形
            ctx.fillStyle = isMe ? '#fff' : p.color;
            this._roundRect(ctx, x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, 4);
            ctx.fill();

            // 眼睛
            ctx.fillStyle = p.alive ? '#000' : '#666';
            const eyeR = cellSize * 0.1;
            const cx = x + cellSize / 2;
            const cy = y + cellSize / 2;
            ctx.beginPath();
            ctx.arc(cx - cellSize * 0.2, cy - cellSize * 0.1, eyeR, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx + cellSize * 0.2, cy - cellSize * 0.1, eyeR, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // 身体
            const ratio = 1 - (i / p.segments.length) * 0.4;
            ctx.fillStyle = isMe
              ? `rgba(200,200,255,${ratio})`
              : this._adjustAlpha(p.color, ratio);
            this._roundRect(ctx, x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, 3);
            ctx.fill();
          }

          ctx.globalAlpha = 1;

          // 自己蛇的边框
          if (isMe && p.alive) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            this._roundRect(ctx, x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, 4);
            ctx.stroke();
          }
        });

        // 死亡蛇的 X 标记
        if (!p.alive && p.segments.length > 0) {
          const hx = p.segments[0].x * cellSize + cellSize / 2;
          const hy = p.segments[0].y * cellSize + cellSize / 2;
          const s = cellSize * 0.3;
          ctx.strokeStyle = '#f44';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(hx - s, hy - s);
          ctx.lineTo(hx + s, hy + s);
          ctx.moveTo(hx + s, hy - s);
          ctx.lineTo(hx - s, hy + s);
          ctx.stroke();
        }
      });
    },

    /**
     * 计算适合视口的格子大小
     */
    calcCellSize(mapW, mapH) {
      const maxW = Math.min(window.innerWidth - 40, 700);
      const maxH = Math.min(window.innerHeight - 160, 500);
      return Math.floor(Math.min(maxW / mapW, maxH / mapH));
    },

    // --- 内部辅助 ---

    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    },

    _adjustAlpha(hsl, alpha) {
      const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (match) {
        return `hsla(${match[1]}, ${match[2]}%, ${match[3]}%, ${alpha})`;
      }
      return hsl;
    },
  };
})();
