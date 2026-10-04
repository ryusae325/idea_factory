import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// タップ/クリックでボタンやカードから広がるインクエフェクト
document.addEventListener('pointerdown', (e) => {
  const target = (e.target as Element | null)?.closest('button, a, .tap-card') as HTMLElement | null;
  if (!target || target.hasAttribute('disabled') || target.getAttribute('aria-disabled') === 'true') return;
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.4;
  const ink = document.createElement('span');
  ink.className = 'ink';
  ink.style.width = ink.style.height = `${size}px`;
  ink.style.left = `${e.clientX - rect.left - size / 2}px`;
  ink.style.top = `${e.clientY - rect.top - size / 2}px`;
  if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
  target.classList.add('ink-host');
  target.appendChild(ink);
  ink.addEventListener('animationend', () => ink.remove());
});

// PWA: Service Worker 登録（本番のみ）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 登録失敗時もアプリは通常動作 */
    });
  });
}
