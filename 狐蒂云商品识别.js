// ==UserScript==
// @name         狐蒂云商品识别
// @namespace    http://tampermonkey.net/
// @version      1.2.2
// @description  在指定范围内搜索识别有效的商品页，自动关闭弹窗，自动循环扫描，记录PID和商品标题，支持获取基础价格
// @match        https://www.szhdy.com/cart?*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /** ==========================
   * ⚙️ 默认配置
   * =========================== */
  const scannerDefaultConfig = {
    scannerStartPid: 1850,
    scannerEndPid: 1900,
    scannerCheckInterval: 500,
    scannerSidebarMode: false,
    scannerGetPrice: false
  };

  /** ==========================
   * 💾 配置处理
   * =========================== */
  const loadScannerConfig = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("hudiyun_scanner_config"));
      return saved ? { ...scannerDefaultConfig, ...saved } : scannerDefaultConfig;
    } catch {
      return scannerDefaultConfig;
    }
  };

  const saveScannerConfig = (cfg) => {
    localStorage.setItem("hudiyun_scanner_config", JSON.stringify(cfg));
  };

  // 成功ID列表持久化（支持旧格式兼容）
  const loadScannerSuccessIds = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("hudiyun_scanner_success"));
      if (!saved || saved.length === 0) return [];
      
      // 兼容旧格式：如果是数字数组，转换为对象数组
      if (typeof saved[0] === 'number') {
        return saved.map(pid => ({ pid, title: '' }));
      }
      
      return saved;
    } catch {
      return [];
    }
  };

  const saveScannerSuccessIds = (items) => {
    localStorage.setItem("hudiyun_scanner_success", JSON.stringify(items));
  };
  
  // 失败记录持久化
  const loadScannerFailedIds = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("hudiyun_scanner_failed"));
      return saved || [];
    } catch {
      return [];
    }
  };

  const saveScannerFailedIds = (items) => {
    localStorage.setItem("hudiyun_scanner_failed", JSON.stringify(items));
  };
  
  // 检查PID是否已存在于成功列表
  const hasPidInSuccessList = (pid) => {
    // 确保使用最新的数据
    const currentIds = loadScannerSuccessIds();
    return currentIds.some(item => {
      const itemPid = typeof item === 'object' ? item.pid : item;
      return itemPid === pid;
    });
  };
  
  // 检查PID是否已存在于失败列表
  const hasPidInFailedList = (pid) => {
    const currentFailed = loadScannerFailedIds();
    return currentFailed.some(item => {
      const itemPid = typeof item === 'object' ? item.pid : item;
      return itemPid === pid;
    });
  };
  
  // 获取商品标题
  const getProductTitle = () => {
    const productName = document.querySelector('.allocation-header-title h1');
    if (productName) {
      const title = productName.textContent.trim();
      return title.length > 0 ? title : '';
    }
    return '';
  };

  // 获取商品基础价格
  const getProductPrice = () => {
    try {
      // 方法1: 优先查找 ordersummarybottom-title 容器中的价格
      // 价格结构：<div class="ordersummarybottom-prefix">¥</div> + <div class="pricePositioning">整数部分</div> + <div class="ordersummarybottom-price">小数部分</div>
      const orderSummaryContainer = document.querySelector('.ordersummarybottom-title');
      if (orderSummaryContainer) {
        const prefixEl = orderSummaryContainer.querySelector('.ordersummarybottom-prefix');
        const pricePositioningEl = orderSummaryContainer.querySelector('.pricePositioning');
        const priceEl = orderSummaryContainer.querySelector('.ordersummarybottom-price');
        
        if (priceEl) {
          // 获取完整价格
          const priceText = priceEl.textContent.trim();
          // 如果有 pricePositioning，可能需要拼接，但通常 ordersummarybottom-price 已经包含完整价格
          // 如果 priceText 是完整数字（如 "111.00"），直接使用
          if (priceText && /^\d+\.?\d*$/.test(priceText.replace(/,/g, ''))) {
            return `¥${priceText.trim()}`;
          }
          
          // 如果有 pricePositioning，尝试拼接
          if (pricePositioningEl && priceEl) {
            const positioningText = pricePositioningEl.textContent.trim();
            const priceText = priceEl.textContent.trim();
            const fullPrice = (positioningText + priceText).replace(/,/g, '').trim();
            if (fullPrice && /^\d+\.?\d*$/.test(fullPrice)) {
              return `¥${fullPrice}`;
            }
          }
        }
        
        // 如果找不到具体元素，尝试从容器文本中提取
        const containerText = orderSummaryContainer.textContent || '';
        const priceMatch = containerText.match(/¥\s*([\d,]+\.?\d*)/);
        if (priceMatch && priceMatch[1]) {
          const price = priceMatch[1].replace(/,/g, '').trim();
          return `¥${price}`;
        }
      }

      // 方法2: 查找包含"费用合计"的文本，然后在附近查找价格
      const bodyText = document.body.textContent;
      const priceMatch = bodyText.match(/费用合计[：:]\s*¥\s*([\d,]+\.?\d*)/i);
      if (priceMatch && priceMatch[1]) {
        const price = priceMatch[1].replace(/,/g, '').trim();
        return `¥${price}`;
      }

      // 方法3: 查找所有包含¥符号的元素，寻找最可能的费用合计价格
      const priceElements = document.querySelectorAll('*');
      for (const el of priceElements) {
        const text = el.textContent || '';
        if (text.includes('费用合计') || text.includes('费用')) {
          // 在同一元素或子元素中查找¥符号后的数字
          const priceMatch = text.match(/¥\s*([\d,]+\.?\d*)/);
          if (priceMatch && priceMatch[1]) {
            const price = priceMatch[1].replace(/,/g, '').trim();
            return `¥${price}`;
          }
        }
      }

      // 方法4: 直接查找页面中所有¥符号，取第一个合理的数字（作为最后手段）
      const allText = document.body.innerText || document.body.textContent || '';
      const allPrices = allText.match(/¥\s*([\d,]+\.?\d*)/g);
      if (allPrices && allPrices.length > 0) {
        // 尝试找到在"费用"附近的 price
        for (const priceStr of allPrices) {
          const priceNum = priceStr.match(/([\d,]+\.?\d*)/);
          if (priceNum && priceNum[1]) {
            const priceValue = parseFloat(priceNum[1].replace(/,/g, ''));
            // 只接受合理的价格范围（比如1到9999999）
            if (priceValue >= 1 && priceValue <= 9999999) {
              return priceStr.trim();
            }
          }
        }
      }

      return '';
    } catch (e) {
      console.error('[狐蒂云识别] 获取价格时出错:', e);
      return '';
    }
  };

  // 检测HTTP错误状态（通过HTML样式判断）
  const detectHttpError = () => {
    // 检测404错误：页面标题或特定的404元素
    const title = document.title.trim();
    if (title === '404' || title.includes('404')) {
      return '404';
    }
    
    // 检测404：通过"抱歉找不到页面"文本
    const maintainText = document.querySelector('.maintain-text-title');
    if (maintainText && maintainText.textContent.includes('抱歉找不到页面')) {
      return '404';
    }
    
    // 检测502错误
    if (title === '502 Bad Gateway' || title.includes('502 Bad Gateway')) {
      return '502';
    }
    
    // 检测其他常见错误码（通过标题判断）
    if (title.includes('500') || title.includes('500 Internal Server Error')) {
      return '500';
    }
    if (title.includes('403') || title.includes('403 Forbidden')) {
      return '403';
    }
    if (title.includes('503') || title.includes('503 Service Unavailable')) {
      return '503';
    }
    
    // 检测页面是否完全空白或只有错误信息
    const hasContent = document.querySelector('.allocation-header-title, .os-card, .configureproduct, .sky-cart-menu-item');
    if (!hasContent && (title.includes('错误') || title.includes('Error') || document.body.textContent.trim().length < 100)) {
      return 'EMPTY';
    }
    
    return null;
  };

  const scannerConfig = loadScannerConfig();
  let scannerSuccessIds = loadScannerSuccessIds();
  let scannerFailedIds = loadScannerFailedIds();
  
  // 扫描状态持久化
  const loadScannerRunning = () => {
    try {
      const v = localStorage.getItem("hudiyun_scanner_running");
      return v === null ? false : v === "true";
    } catch {
      return false;
    }
  };
  
  const saveScannerRunning = (val) => {
    try {
      localStorage.setItem("hudiyun_scanner_running", String(!!val));
    } catch {}
  };
  
  const loadScannerCurrentPid = () => {
    try {
      const v = localStorage.getItem("hudiyun_scanner_current_pid");
      return v ? parseInt(v) : scannerConfig.scannerStartPid;
    } catch {
      return scannerConfig.scannerStartPid;
    }
  };
  
  const saveScannerCurrentPid = (pid) => {
    try {
      localStorage.setItem("hudiyun_scanner_current_pid", String(pid));
    } catch {}
  };
  
  let scannerRunning = loadScannerRunning();
  let scannerCurrentPid = loadScannerCurrentPid();

  /** ==========================
   * 🧠 工具函数
   * =========================== */
  
  const sleep = (ms = null) => {
    const delay = ms || scannerConfig.scannerCheckInterval;
    return new Promise((r) => setTimeout(r, delay));
  };

  const now = () => new Date().getTime();
  const formatTime = (ts) => new Date(ts).toTimeString().split(" ")[0];

  // 检测并自动关闭弹窗
  const checkAndCloseScannerPopup = () => {
    const popupButton = document.querySelector('input[type="button"].layer-cancel[value="已阅读知晓"]');
    if (popupButton && popupButton.style.display !== 'none') {
      console.log('[狐蒂云识别] 检测到弹窗，自动点击关闭');
      popupButton.click();
      return true;
    }
    return false;
  };

  // 判断页面是否为有效的商品配置页
  // 识别成功：页面包含产品配置表单等元素
  // 识别失败：可能是侧边栏导航页面或错误页面
  const isSuccessPage = () => {
    try {
      // 方法1: 检测是否存在产品名称或标题（成功页面有产品名称，失败页面为空）
      const productName = document.querySelector('.allocation-header-title h1');
      const hasProductName = productName && productName.textContent.trim().length > 0;
      
      // 方法2: 检测是否存在操作系统选择卡片（成功页面有，失败页面没有）
      const hasOsCard = document.querySelector('.os-card') !== null;
      
      // 方法3: 检测是否存在多个地区选择（导航侧边栏特征 - 这是失败页面的特征）
      const hasMultipleRegions = document.querySelectorAll('.sky-cart-menu-item').length > 3;
      
      // 方法4: 检测是否存在"周期"选择按钮组（成功页面的关键特征）
      const hasCycleButtons = document.querySelector('.sky-btn-group.btn-group-toggle');
      const hasCycleOptions = hasCycleButtons && hasCycleButtons.children.length > 0;
      
      // 方法5: 检测是否包含配置项（如网络类型、带宽等的按钮组）
      const hasConfigOptions = document.querySelectorAll('.sky-config-btn').length > 0;
      
      // 方法6: 检测是否包含配置区域
      const hasConfigArea = document.querySelector('.configureproduct') !== null;
      
      // 方法7: 检测是否包含"加入购物车"按钮且有内容
      const btnBuyNow = document.querySelector('.btn-buyNow');
      const hasBuyButton = btnBuyNow && btnBuyNow.textContent.trim().length > 0;
      
      // 调试输出
      const debugInfo = {
        hasProductName,
        hasOsCard,
        hasCycleOptions,
        hasConfigOptions,
        hasConfigArea,
        hasBuyButton,
        hasMultipleRegions
      };
      
      // 成功条件：至少满足以下条件之一
      // 1. 有产品名称（最关键）
      // 2. 有操作系统选择卡片（非常关键）
      // 3. 有配置区域且有配置选项
      const hasProductInfo = hasProductName || hasOsCard || (hasConfigArea && (hasCycleOptions || hasConfigOptions));
      
      // 优先判断：如果有明确的商品内容，即使有导航菜单也判定为成功
      // 因为有些商品页左侧也会有导航菜单，这是正常的
      if (hasProductInfo) {
        // 特别检查：如果有产品名称或操作系统卡片，且有关键按钮，直接判定成功
        if ((hasProductName || hasOsCard) && hasBuyButton) {
          console.log('[狐蒂云识别] 识别成功：检测到商品内容（有产品名称或操作系统卡片）', debugInfo);
          return true;
        }
        // 如果有配置区域和配置选项，也判定成功
        if (hasConfigArea && (hasCycleOptions || hasConfigOptions) && hasBuyButton) {
          console.log('[狐蒂云识别] 识别成功：检测到配置区域和配置选项', debugInfo);
          return true;
        }
      }
      
      // 如果页面既没有产品名称，又没有操作系统卡片，也没有配置区域，一定是失败页
      if (!hasProductName && !hasOsCard && !hasConfigArea) {
        console.log('[狐蒂云识别] 识别失败：缺少关键元素', debugInfo);
        return false;
      }
      
      // 只有在没有明确商品内容的情况下，才检查是否是纯导航页
      // 如果有很多地区导航菜单项（超过3个），且没有商品内容，说明是纯导航页
      if (hasMultipleRegions && !hasProductInfo) {
        console.log('[狐蒂云识别] 识别失败：检测到导航页且无商品内容', debugInfo);
        return false;
      }
      
      // 其他情况：有商品信息但可能缺少按钮，也判定为成功（更宽松的判断）
      if (hasProductInfo) {
        console.log('[狐蒂云识别] 识别成功：检测到商品信息', debugInfo);
        return true;
      }
      
      console.log('[狐蒂云识别] 识别失败：不满足成功条件', debugInfo);
      return false;
    } catch (e) {
      console.error('[狐蒂云识别] 识别过程中出错:', e);
      return false;
    }
  };

  /** ==========================
   * 🧠 控制面板
   * =========================== */
  const createPanel = () => {
    // 样式
    const style = document.createElement('style');
    style.textContent = `
      #scanner-panel {
        font-family: system-ui, sans-serif;
        position: fixed;
        right: 0;
        bottom: 0;
        width: 320px;
        max-height: 90vh;
        z-index: 99999;
        transition: width 0.3s ease;
      }
      #scanner-panel.sidebar {
        width: 180px;
      }
      .scanner-card {
        background: #1a1a1a;
        border-radius: 8px 0 0 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        color: #f0f0f0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        max-height: 90vh;
        height: 100%;
      }
      .scanner-header {
        background: #333;
        padding: 8px 12px;
        font-weight: 500;
        font-size: 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }
      .scale-btn {
        cursor: pointer;
        font-size: 16px;
        padding: 0 4px;
      }
      .scanner-status {
        padding: 10px 12px;
        font-size: 12px;
        border-bottom: 1px solid #333;
        flex-shrink: 0;
      }
      .scanner-config {
        padding: 10px 12px;
        font-size: 12px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }
      .status-item {
        margin: 4px 0;
        display: flex;
        justify-content: space-between;
      }
      .status-label { color: #aaa; }
      .status-running { color: #4cd964; }
      .status-paused { color: #ffcc00; }
      .config-group {
        margin-bottom: 8px;
      }
      .config-label {
        display: block;
        color: #aaa;
        margin-bottom: 3px;
        font-size: 11px;
      }
      .config-checkbox-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        color: #aaa;
        font-size: 12px;
        user-select: none;
        padding: 2px 0;
        width: auto;
        margin: 0;
      }
      .config-checkbox-label:hover {
        color: #f0f0f0;
      }
      .config-checkbox-label input[type="checkbox"] {
        margin: 0;
        cursor: pointer;
        width: auto;
        flex-shrink: 0;
        vertical-align: middle;
        position: relative;
        outline: none;
      }
      .config-checkbox-label input[type="checkbox"]:focus {
        outline: none;
        box-shadow: none;
      }
      .config-input {
        width: 100%;
        padding: 5px 8px;
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 4px;
        color: #f0f0f0;
        font-size: 12px;
        box-sizing: border-box;
      }
      .config-input:focus {
        outline: none;
        border-color: #4cd964;
      }
      .scanner-actions {
        display: flex;
        padding: 8px 12px;
        gap: 5px;
        background: #222;
        flex-shrink: 0;
      }
      .scanner-btn {
        flex: 1;
        padding: 5px 0;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
      }
      .scanner-btn.toggle { background: #4cd964; color: #000; }
      .scanner-btn.clear { background: #ffcc00; color: #000; }
      .scanner-btn.copy { background: #5ac8fa; color: #000; }
      .scanner-btn:active { opacity: 0.8; }
      .success-list {
        max-height: 120px;
        overflow-y: auto;
        margin-top: 8px;
        padding: 8px;
        background: #2a2a2a;
        border-radius: 4px;
        font-size: 11px;
        line-height: 1.6;
      }
      .success-item {
        padding: 2px 0;
        color: #4cd964;
        font-family: monospace;
        word-break: break-word;
        line-height: 1.5;
      }
      .success-count {
        color: #4cd964;
        font-weight: bold;
      }
      .failed-list {
        max-height: 100px;
        overflow-y: auto;
        margin-top: 8px;
        padding: 8px;
        background: #2a2a2a;
        border-radius: 4px;
        font-size: 11px;
        line-height: 1.6;
      }
      .failed-item {
        padding: 2px 0;
        color: #ff3b30;
        font-family: monospace;
        word-break: break-word;
        line-height: 1.5;
      }
      .failed-count {
        color: #ff3b30;
        font-weight: bold;
      }
      /* 侧栏模式隐藏配置区和操作区 */
      #scanner-panel.sidebar .scanner-config,
      #scanner-panel.sidebar .scanner-actions,
      #scanner-panel.sidebar .success-list-container,
      #scanner-panel.sidebar .failed-list-container {
        display: none;
      }
    `;
    document.head.appendChild(style);

    const p = document.createElement("div");
    p.id = "scanner-panel";
    if (scannerConfig.scannerSidebarMode) p.classList.add("sidebar");

    p.innerHTML = `
      <div class="scanner-card">
        <div class="scanner-header">
          狐蒂云识别商品页
          <span class="scale-btn" id="scanner-scale-btn">${scannerConfig.scannerSidebarMode ? '→' : '←'}</span>
        </div>

        <div class="scanner-status">
          <div class="status-item">
            <span class="status-label">状态：</span>
            <span id="scanner-status" class="status-paused">已暂停</span>
          </div>
          <div class="status-item">
            <span class="status-label">当前：</span>
            <span id="scanner-current">-</span>
          </div>
          <div class="status-item">
            <span class="status-label">进度：</span>
            <span id="scanner-progress">0%</span>
          </div>
        </div>

        <div class="scanner-config">
          <div class="config-group">
            <label class="config-label">起始 PID</label>
            <input id="cfg-start-pid" type="number" value="${scannerConfig.scannerStartPid}" class="config-input">
          </div>
          <div class="config-group">
            <label class="config-label">结束 PID</label>
            <input id="cfg-end-pid" type="number" value="${scannerConfig.scannerEndPid}" class="config-input">
          </div>
          <div class="config-group">
            <label class="config-label">检查间隔(ms)</label>
            <input id="cfg-interval" type="number" value="${scannerConfig.scannerCheckInterval}" class="config-input">
          </div>
          <div class="config-group">
            <label class="config-checkbox-label">
              <input type="checkbox" id="cfg-get-price" ${scannerConfig.scannerGetPrice ? 'checked' : ''}>
              获取基础价格
            </label>
          </div>
          <div class="config-group">
            <label class="status-label">成功数量：</label>
            <span class="success-count" id="success-count">${scannerSuccessIds.length}</span>
          </div>
          <div class="success-list-container">
            <label class="config-label">成功 ID：</label>
            <div class="success-list" id="success-list">${scannerSuccessIds.length > 0 ? scannerSuccessIds.map(item => {
              const pid = typeof item === 'object' ? item.pid : item;
              const title = typeof item === 'object' && item.title ? item.title : '';
              const price = typeof item === 'object' && item.price ? item.price : '';
              return `<div class="success-item">${pid}${title ? ' ' + title : ''}${price ? ' ' + price : ''}</div>`;
            }).join('') : '<div class="success-item" style="color:#aaa;">暂无</div>'}</div>
          </div>
          <div class="config-group">
            <label class="status-label">失败数量：</label>
            <span class="failed-count" id="failed-count">${scannerFailedIds.length}</span>
          </div>
          <div class="failed-list-container">
            <label class="config-label">失败 ID：</label>
            <div class="failed-list" id="failed-list">${scannerFailedIds.length > 0 ? scannerFailedIds.map(item => {
              const pid = typeof item === 'object' ? item.pid : item;
              const code = typeof item === 'object' && item.code ? item.code : 'ERROR';
              return `<div class="failed-item">${pid} (${code})</div>`;
            }).join('') : '<div class="failed-item" style="color:#aaa;">暂无</div>'}</div>
          </div>
        </div>

        <div class="scanner-actions">
          <button id="scanner-toggle" class="scanner-btn toggle">开始</button>
          <button id="scanner-clear" class="scanner-btn clear">清空</button>
          <button id="scanner-clear-failed" class="scanner-btn clear" style="flex: 0.8; font-size: 11px;">清空失败</button>
          <button id="scanner-copy" class="scanner-btn copy">复制</button>
        </div>
      </div>
    `;
    document.body.appendChild(p);

    // 缩放按钮事件
    const scaleBtn = document.querySelector("#scanner-scale-btn");
    scaleBtn.addEventListener("click", () => {
      const panel = document.querySelector("#scanner-panel");
      scannerConfig.scannerSidebarMode = !scannerConfig.scannerSidebarMode;
      if (scannerConfig.scannerSidebarMode) {
        panel.classList.add("sidebar");
        scaleBtn.textContent = '→';
      } else {
        panel.classList.remove("sidebar");
        scaleBtn.textContent = '←';
      }
      saveScannerConfig(scannerConfig);
    });

    // 开始/暂停按钮
    const toggleBtn = document.querySelector("#scanner-toggle");
    toggleBtn.addEventListener("click", () => {
      if (!scannerRunning) {
        // 开始扫描
        startScan();
      } else {
        // 暂停扫描
        stopScan();
      }
      updatePanel();
    });

    // 清空成功结果
    document.querySelector("#scanner-clear").addEventListener("click", () => {
      if (confirm('确认清空所有成功记录？')) {
        scannerSuccessIds = [];
        saveScannerSuccessIds([]);
        scannerCurrentPid = scannerConfig.scannerStartPid;
        saveScannerCurrentPid(scannerCurrentPid);
        updatePanel();
      }
    });

    // 清空失败结果
    document.querySelector("#scanner-clear-failed").addEventListener("click", () => {
      if (confirm('确认清空所有失败记录？')) {
        scannerFailedIds = [];
        saveScannerFailedIds([]);
        updatePanel();
      }
    });

    // 复制ID列表（包含标题）
    document.querySelector("#scanner-copy").addEventListener("click", () => {
      if (scannerSuccessIds.length === 0) {
        alert('暂无成功的ID');
        return;
      }
      // 格式化复制内容：PID 标题 价格，每行一个
      const text = scannerSuccessIds.map(item => {
        const pid = typeof item === 'object' ? item.pid : item;
        const title = typeof item === 'object' && item.title ? item.title : '';
        const price = typeof item === 'object' && item.price ? item.price : '';
        return `${pid}${title ? ' ' + title : ''}${price ? ' ' + price : ''}`;
      }).join('\n');
      
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector("#scanner-copy");
        const originalText = btn.textContent;
        btn.textContent = "已复制";
        setTimeout(() => {
          btn.textContent = originalText;
        }, 1000);
      }).catch(() => {
        alert('复制失败，请手动复制');
      });
    });

    // 自动保存配置
    document.querySelectorAll('#cfg-start-pid, #cfg-end-pid, #cfg-interval').forEach(el => {
      el.addEventListener('change', () => {
        scannerConfig.scannerStartPid = parseInt(document.querySelector("#cfg-start-pid").value) || 1850;
        scannerConfig.scannerEndPid = parseInt(document.querySelector("#cfg-end-pid").value) || 1900;
        scannerConfig.scannerCheckInterval = parseInt(document.querySelector("#cfg-interval").value) || 500;
        saveScannerConfig(scannerConfig);
        scannerCurrentPid = scannerConfig.scannerStartPid; // 重置当前位置
        saveScannerCurrentPid(scannerCurrentPid);
        updatePanel();
      });
    });

    // 价格获取选项自动保存
    document.querySelector("#cfg-get-price").addEventListener('change', () => {
      scannerConfig.scannerGetPrice = document.querySelector("#cfg-get-price").checked;
      saveScannerConfig(scannerConfig);
    });

    // 如果还没有当前PID，初始化为起始PID
    if (!scannerCurrentPid || scannerCurrentPid < scannerConfig.scannerStartPid) {
      scannerCurrentPid = scannerConfig.scannerStartPid;
      saveScannerCurrentPid(scannerCurrentPid);
    }
    updatePanel();
  };

  /** ==========================
   * 🧠 面板更新
   * =========================== */
  const updatePanel = () => {
    // 重新加载最新状态以确保显示正确
    scannerSuccessIds = loadScannerSuccessIds();
    scannerFailedIds = loadScannerFailedIds();
    scannerRunning = loadScannerRunning();
    scannerCurrentPid = loadScannerCurrentPid();
    
    const statusEl = document.querySelector("#scanner-status");
    const currentEl = document.querySelector("#scanner-current");
    const progressEl = document.querySelector("#scanner-progress");
    const countEl = document.querySelector("#success-count");
    const listEl = document.querySelector("#success-list");
    const failedCountEl = document.querySelector("#failed-count");
    const failedListEl = document.querySelector("#failed-list");
    const toggleBtn = document.querySelector("#scanner-toggle");

    if (!statusEl || !currentEl || !progressEl || !countEl || !listEl) {
      // 面板元素还未创建，稍后重试
      return;
    }

    if (scannerRunning) {
      statusEl.className = "status-running";
      statusEl.textContent = "扫描中";
      if (toggleBtn) toggleBtn.textContent = "暂停";
    } else {
      statusEl.className = "status-paused";
      statusEl.textContent = "已暂停";
      if (toggleBtn) toggleBtn.textContent = "开始";
    }

    currentEl.textContent = scannerCurrentPid;
    
    const total = scannerConfig.scannerEndPid - scannerConfig.scannerStartPid + 1;
    const current = scannerCurrentPid - scannerConfig.scannerStartPid + 1;
    const progress = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
    progressEl.textContent = `${progress}%`;

    countEl.textContent = scannerSuccessIds.length;
    
    if (scannerSuccessIds.length > 0) {
      // 按PID数字排序显示
      const sortedIds = [...scannerSuccessIds].sort((a, b) => {
        const pidA = typeof a === 'object' ? a.pid : a;
        const pidB = typeof b === 'object' ? b.pid : b;
        return pidA - pidB;
      });
      listEl.innerHTML = sortedIds.map(item => {
        const pid = typeof item === 'object' ? item.pid : item;
        const title = typeof item === 'object' && item.title ? item.title : '';
        const price = typeof item === 'object' && item.price ? item.price : '';
        return `<div class="success-item">${pid}${title ? ' ' + title : ''}${price ? ' ' + price : ''}</div>`;
      }).join('');
    } else {
      listEl.innerHTML = '<div class="success-item" style="color:#aaa;">暂无</div>';
    }
    
    // 更新失败记录显示
    if (failedCountEl) {
      failedCountEl.textContent = scannerFailedIds.length;
    }
    
    if (failedListEl) {
      if (scannerFailedIds.length > 0) {
        const sortedFailed = [...scannerFailedIds].sort((a, b) => {
          const pidA = typeof a === 'object' ? a.pid : a;
          const pidB = typeof b === 'object' ? b.pid : b;
          return pidA - pidB;
        });
        failedListEl.innerHTML = sortedFailed.map(item => {
          const pid = typeof item === 'object' ? item.pid : item;
          const code = typeof item === 'object' && item.code ? item.code : 'ERROR';
          return `<div class="failed-item">${pid} (${code})</div>`;
        }).join('');
      } else {
        failedListEl.innerHTML = '<div class="failed-item" style="color:#aaa;">暂无</div>';
      }
    }
    
    console.log(`[狐蒂云识别] 面板已更新 - 当前PID: ${scannerCurrentPid}, 成功数: ${scannerSuccessIds.length}, 失败数: ${scannerFailedIds.length}`);
  };

  // 从URL中提取PID
  const getPidFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const pid = urlParams.get('pid');
    return pid ? parseInt(pid) : null;
  };

  /** ==========================
   * 🦊 核心扫描逻辑
   * =========================== */
  const startScan = async () => {
    scannerRunning = true;
    saveScannerRunning(true);
    
    // 重置到起始PID（如果还没有开始）
    if (scannerCurrentPid < scannerConfig.scannerStartPid) {
      scannerCurrentPid = scannerConfig.scannerStartPid;
      saveScannerCurrentPid(scannerCurrentPid);
    }
    
    updatePanel();

    // 检查当前页面是否已经是目标PID
    const currentUrlPid = getPidFromUrl();
    
    if (currentUrlPid === scannerCurrentPid) {
      // 当前页面就是目标PID，直接检测
      await processCurrentPage();
    } else {
      // 跳转到目标PID页面
      const url = `https://www.szhdy.com/cart?action=configureproduct&pid=${scannerCurrentPid}`;
      location.href = url;
    }
  };

  // 等待元素出现
  const waitForElement = async (selector, timeout = 3000, interval = 200) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await sleep(interval);
    }
    return null;
  };

  // 获取当前PID的重试状态
  const getRetryFlag = (pid) => {
    try {
      const flag = localStorage.getItem(`hudiyun_scanner_retry_${pid}`);
      return flag === 'true';
    } catch {
      return false;
    }
  };

  // 设置当前PID的重试状态
  const setRetryFlag = (pid, isRetrying) => {
    try {
      localStorage.setItem(`hudiyun_scanner_retry_${pid}`, String(isRetrying));
    } catch {}
  };

  // 清除当前PID的重试状态
  const clearRetryFlag = (pid) => {
    try {
      localStorage.removeItem(`hudiyun_scanner_retry_${pid}`);
    } catch {}
  };

  // 处理当前页面
  const processCurrentPage = async () => {
    if (!scannerRunning) {
      updatePanel();
      return;
    }

    // 检查是否超出范围
    if (scannerCurrentPid > scannerConfig.scannerEndPid) {
      scannerRunning = false;
      saveScannerRunning(false);
      updatePanel();
      alert('扫描完成！共找到 ' + scannerSuccessIds.length + ' 个有效的商品页，失败 ' + scannerFailedIds.length + ' 个。');
      return;
    }

    // 更新当前PID显示
    updatePanel();
    const isRetrying = getRetryFlag(scannerCurrentPid);
    console.log(`[狐蒂云识别] 开始检测 PID ${scannerCurrentPid}...${isRetrying ? ' (重试中)' : ''}`);

    // 等待页面加载并检查弹窗
    await sleep(500);
    
    // 自动关闭弹窗
    checkAndCloseScannerPopup();
    
    // 等待关键元素加载（产品标题或配置区域）
    const hasKeyElement = await waitForElement('.allocation-header-title, .os-card, .configureproduct', 3000);
    if (!hasKeyElement) {
      console.log(`[狐蒂云识别] PID ${scannerCurrentPid} 页面加载超时，可能无效`);
    }
    
    // 再等待一段时间确保DOM完全渲染
    await sleep(1000);

    // 检测HTTP错误
    const httpError = detectHttpError();
    
    // 如果检测到HTTP错误
    if (httpError) {
      console.log(`[狐蒂云识别] ⚠️ PID ${scannerCurrentPid} 检测到HTTP错误: ${httpError}`);
      
      // 如果是第一次检测到错误，进行重试
      if (!isRetrying) {
        console.log(`[狐蒂云识别] 等待 ${scannerConfig.scannerCheckInterval}ms 后刷新页面重试...`);
        setRetryFlag(scannerCurrentPid, true);
        await sleep(scannerConfig.scannerCheckInterval);
        location.reload();
        return;
      } else {
        // 第二次检测还是错误，记录失败
        console.log(`[狐蒂云识别] ❌ PID ${scannerCurrentPid} 重试后仍然失败，错误码: ${httpError}`);
        if (!hasPidInFailedList(scannerCurrentPid)) {
          scannerFailedIds.push({
            pid: scannerCurrentPid,
            code: httpError
          });
          scannerFailedIds.sort((a, b) => {
            const pidA = typeof a === 'object' ? a.pid : a;
            const pidB = typeof b === 'object' ? b.pid : b;
            return pidA - pidB;
          });
          saveScannerFailedIds(scannerFailedIds);
          scannerFailedIds = loadScannerFailedIds();
          updatePanel();
        }
        clearRetryFlag(scannerCurrentPid);
      }
    } else {
      // 没有HTTP错误，清除重试标记
      clearRetryFlag(scannerCurrentPid);
      
      // 检查页面是否为成功页面（增加详细调试）
      const isSuccess = isSuccessPage();
      
      // 调试信息
      const productName = document.querySelector('.allocation-header-title h1');
      const hasOsCard = document.querySelector('.os-card') !== null;
      const hasBuyButton = document.querySelector('.btn-buyNow') !== null;
      console.log(`[狐蒂云识别] PID ${scannerCurrentPid} 检测结果:`, {
        isSuccess,
        productName: productName ? productName.textContent.trim() : '无',
        hasOsCard,
        hasBuyButton,
        currentUrlPid: getPidFromUrl(),
        isRetrying
      });
      
      if (isSuccess) {
        if (!hasPidInSuccessList(scannerCurrentPid)) {
          // 获取商品标题
          const productTitle = getProductTitle();
          
          // 如果启用了价格获取，尝试获取价格
          let productPrice = '';
          if (scannerConfig.scannerGetPrice) {
            productPrice = getProductPrice();
            console.log(`[狐蒂云识别] PID ${scannerCurrentPid} 价格: ${productPrice || '未获取到'}`);
          }
          
          console.log(`[狐蒂云识别] ✅ PID ${scannerCurrentPid} 识别成功！标题: ${productTitle || '无标题'}${productPrice ? ' 价格: ' + productPrice : ''}`);
          
          // 保存PID、标题和价格
          scannerSuccessIds.push({
            pid: scannerCurrentPid,
            title: productTitle || '',
            price: productPrice || ''
          });
          
          // 按PID数字排序
          scannerSuccessIds.sort((a, b) => {
            const pidA = typeof a === 'object' ? a.pid : a;
            const pidB = typeof b === 'object' ? b.pid : b;
            return pidA - pidB;
          });
          
          saveScannerSuccessIds(scannerSuccessIds);
          // 强制重新加载并更新面板
          scannerSuccessIds = loadScannerSuccessIds();
          updatePanel();
          playSound();
          console.log(`[狐蒂云识别] 成功列表已更新，当前共 ${scannerSuccessIds.length} 个`);
        } else {
          console.log(`[狐蒂云识别] PID ${scannerCurrentPid} 已存在于成功列表`);
        }
      } else {
        // 如果是在重试中但仍然识别失败，记录失败
        if (isRetrying) {
          console.log(`[狐蒂云识别] ❌ PID ${scannerCurrentPid} 重试后仍然识别失败`);
          if (!hasPidInFailedList(scannerCurrentPid)) {
            scannerFailedIds.push({
              pid: scannerCurrentPid,
              code: '识别失败'
            });
            scannerFailedIds.sort((a, b) => {
              const pidA = typeof a === 'object' ? a.pid : a;
              const pidB = typeof b === 'object' ? b.pid : b;
              return pidA - pidB;
            });
            saveScannerFailedIds(scannerFailedIds);
            scannerFailedIds = loadScannerFailedIds();
            updatePanel();
          }
        } else {
          console.log(`[狐蒂云识别] ❌ PID ${scannerCurrentPid} 未识别成功`);
        }
        clearRetryFlag(scannerCurrentPid);
      }
    }

    // 只有在不是重试刷新页面的情况下，才继续下一个PID
    // 如果是因为错误刷新，会在刷新后重新进入processCurrentPage
    if (!httpError || (httpError && isRetrying)) {
      // 继续下一个PID
      scannerCurrentPid++;
      saveScannerCurrentPid(scannerCurrentPid);
      
      // 检查是否超出范围
      if (scannerCurrentPid > scannerConfig.scannerEndPid) {
        scannerRunning = false;
        saveScannerRunning(false);
        updatePanel();
        alert('扫描完成！共找到 ' + scannerSuccessIds.length + ' 个有效的商品页，失败 ' + scannerFailedIds.length + ' 个。');
        return;
      }
      
      // 等待后跳转到下一个PID
      await sleep(scannerConfig.scannerCheckInterval);
      
      const url = `https://www.szhdy.com/cart?action=configureproduct&pid=${scannerCurrentPid}`;
      console.log(`[狐蒂云识别] 跳转到下一个 PID: ${scannerCurrentPid}`);
      location.href = url;
    }
  };

  const stopScan = () => {
    scannerRunning = false;
    saveScannerRunning(false);
    updatePanel();
  };
  
  // 页面加载时检查是否需要继续扫描
  const checkAndContinueScan = async () => {
    if (!scannerRunning) {
      return;
    }
    
    const currentUrlPid = getPidFromUrl();
    const targetPid = loadScannerCurrentPid();
    
    // 如果当前页面的PID与目标PID匹配，说明页面已经加载完成，可以开始检测
    if (currentUrlPid === targetPid) {
      await processCurrentPage();
    }
  };

  const playSound = () => {
    try {
      const audio = new Audio("https://assets.mixkit.co/sfx/preview/mixkit-achievement-bell-600.mp3");
      audio.preload = "auto";
      audio.play().catch(() => console.warn("[狐蒂云识别] 请点击页面启用声音"));
    } catch (e) {
      console.error("[狐蒂云识别] 播放失败", e);
    }
  };

  /** ==========================
   * 🚀 初始化
   * =========================== */
  const doIt = async () => {
    // 重新加载最新状态（因为页面可能刚刷新）
    scannerSuccessIds = loadScannerSuccessIds();
    scannerFailedIds = loadScannerFailedIds();
    scannerRunning = loadScannerRunning();
    scannerCurrentPid = loadScannerCurrentPid();
    const latestConfig = loadScannerConfig();
    scannerConfig.scannerStartPid = latestConfig.scannerStartPid;
    scannerConfig.scannerEndPid = latestConfig.scannerEndPid;
    scannerConfig.scannerCheckInterval = latestConfig.scannerCheckInterval;
    scannerConfig.scannerGetPrice = latestConfig.scannerGetPrice !== undefined ? latestConfig.scannerGetPrice : false;
    
    createPanel();
    
    // 页面加载时检测并关闭弹窗
    checkAndCloseScannerPopup();
    
    // 如果正在扫描，等待页面加载完成后继续
    if (scannerRunning) {
      await sleep(1000);
      await checkAndContinueScan();
    }
  };

  if (document.readyState === "complete") {
    doIt();
  } else {
    window.addEventListener("load", doIt);
  }
})();