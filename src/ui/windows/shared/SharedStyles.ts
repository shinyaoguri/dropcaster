export const SharedStyles = {
  // 選択ボックス関連のスタイル
  selectionBox: `
    .selection-box {
      position: absolute;
      pointer-events: auto;
      cursor: move;
      min-width: 20px;
      min-height: 20px;
    }
    
    .selection-box.source {
      border: 2px solid #00ff00;
      background: rgba(0, 255, 0, 0.1);
    }
    
    .selection-box.mapping {
      border: 2px solid #ff00ff;
      background: rgba(255, 0, 255, 0.1);
    }
  `,
  
  // ハンドル関連のスタイル
  handles: `
    .handle {
      position: absolute;
      width: 12px;
      height: 12px;
      border: 2px solid #fff;
      border-radius: 50%;
      pointer-events: auto;
      z-index: 10;
    }
    
    .handle.source {
      background: #00ff00;
    }
    
    .handle.mapping {
      background: #ff00ff;
    }
    
    .handle-nw {
      top: -6px;
      left: -6px;
      cursor: nw-resize;
    }
    
    .handle-ne {
      top: -6px;
      right: -6px;
      cursor: ne-resize;
    }
    
    .handle-sw {
      bottom: -6px;
      left: -6px;
      cursor: sw-resize;
    }
    
    .handle-se {
      bottom: -6px;
      right: -6px;
      cursor: se-resize;
    }
  `,
  
  // エッジハンドルのスタイル
  edges: `
    .edge {
      position: absolute;
      background: transparent;
      pointer-events: auto;
    }
    
    .edge-n, .edge-s {
      height: 6px;
      left: 6px;
      right: 6px;
    }
    
    .edge-n {
      top: -3px;
      cursor: n-resize;
    }
    
    .edge-s {
      bottom: -3px;
      cursor: s-resize;
    }
    
    .edge-e, .edge-w {
      width: 6px;
      top: 6px;
      bottom: 6px;
    }
    
    .edge-e {
      right: -3px;
      cursor: e-resize;
    }
    
    .edge-w {
      left: -3px;
      cursor: w-resize;
    }
  `,
  
  // ビデオコンテナのスタイル
  videoContainer: `
    .video-container {
      width: 100%;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      margin: 0;
      padding: 0;
      position: relative;
    }
    
    .video-wrapper {
      position: relative;
      width: 100%;
      max-width: 100%;
      max-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `,
  
  // ウィンドウ共通のベーススタイル
  windowBase: `
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      background-color: #1a1a1a;
      color: #ffffff;
    }
    
    * {
      box-sizing: border-box;
    }
    
    h1, h2, h3, h4, h5, h6 {
      margin: 0;
      padding: 0;
    }
    
    button {
      font-family: inherit;
    }
  `,
  
  // カラムレイアウト
  columnLayout: `
    .column {
      display: flex;
      flex-direction: column;
      border-right: 1px solid #333;
    }
    
    .column:last-child {
      border-right: none;
    }
    
    .column-header {
      padding: 15px;
      background: #2a2a2a;
      border-bottom: 1px solid #444;
    }
    
    .column-header h2 {
      margin: 0;
      font-size: 16px;
      color: #fff;
      font-weight: 500;
    }
  `,
  
  // ツールボタン
  toolButton: `
    .tool-button {
      width: 100%;
      padding: 8px 12px;
      background: #444;
      border: 1px solid #555;
      color: #fff;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }
    
    .tool-button:hover {
      background: #555;
      border-color: #666;
    }
    
    .tool-button:active {
      background: #333;
    }
  `
};

// すべてのスタイルを結合したもの
export function getCombinedStyles(includeOptions: {
  selectionBox?: boolean;
  handles?: boolean;
  edges?: boolean;
  videoContainer?: boolean;
  windowBase?: boolean;
  columnLayout?: boolean;
  toolButton?: boolean;
} = {}): string {
  const styles: string[] = [];
  
  const defaults = {
    windowBase: true,
    ...includeOptions
  };
  
  Object.entries(defaults).forEach(([key, include]) => {
    if (include && SharedStyles[key as keyof typeof SharedStyles]) {
      styles.push(SharedStyles[key as keyof typeof SharedStyles]);
    }
  });
  
  return styles.join('\n');
}