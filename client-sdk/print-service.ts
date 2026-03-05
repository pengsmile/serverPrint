/**
 * PrintService Client SDK for NocoBase / React
 *
 * 特性：
 * 1. 单例模式：无论 import 多少次，Socket 连接只有一个。
 * 2. 懒加载：只有在真正调用 print 或 status 时才建立连接（也可手动 connect）。
 * 3. 自动重连：内置 Socket.io 重连机制。
 *
 * 安装依赖：
 * npm install socket.io-client
 */

import { io, Socket } from 'socket.io-client';
import { message } from 'antd';

export interface PrintResult {
  success: boolean;
  message?: string;
  jobId?: string;
  [key: string]: any;
}

export interface PrintOptions {
  printer?: string;
  copies?: number;
  pageSize?: string | { width: number; height: number };
  margins?: {
    marginType?: 'default' | 'none' | 'printableArea' | 'custom';
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
}

export interface PrinterStatus {
  exists: boolean;
  status?: string;
  isDefault?: boolean;
  message?: string;
  defaultPrinter?: string;
  [key: string]: any;
}

declare global {
  interface Window {
    PrintService: typeof PrintService;
    printService: PrintService;
  }
}

class PrintService {
  private url: string;
  private socket: Socket | null;
  isConnected: boolean;
  private connectPromise: Promise<void> | null;
  init: any;

  constructor(url = 'http://localhost:18765') {
    this.url = url;
    this.socket = null;
    this.isConnected = false;
    this.connectPromise = null;
  }

  // 配置服务地址（如果在不同环境地址不同）
  setConfig(url: string) {
    this.url = url;
    // 如果已经连接，需要断开重连吗？暂时简单处理，只更新 url
    if (this.socket && this.isConnected) {
      console.warn('[PrintService] URL changed, please reconnect manually if needed.');
    }
  }

  /**
   * 建立连接（幂等操作，可重复调用）
   * @param {boolean} forceRetry 是否强制重试（即使之前失败过）
   */
  connect(forceRetry = false): Promise<void> {
    if (this.socket && this.socket.connected) {
      return Promise.resolve();
    }

    // 如果正在连接中，返回现有的 Promise
    if (this.connectPromise && !forceRetry) {
      return this.connectPromise;
    }

    // 清理旧的连接尝试
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.connectPromise = new Promise((resolve, reject) => {
      const metadata = {
        title: typeof document !== 'undefined' ? document.title : '',
        url: typeof location !== 'undefined' ? location.origin : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      };
      // 使用 import 引入的 io
      this.socket = io(this.url, {
        transports: ['websocket'],
        query: {
          clientInfo: JSON.stringify(metadata),
        },
        // 自动重连配置
        reconnection: true,
        reconnectionAttempts: 5, // 5次重试
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 2000, // 缩短连接超时时间，以便更快触发重试
        autoConnect: true,
      });

      this.socket.on('connect', () => {
        console.log('[PrintService] Connected to local print service');
        this.isConnected = true;
        resolve();
        message.success('打印服务已连接');
      });

      // 监听每次重连尝试
      this.socket.on('reconnect_attempt', (attempt) => {
        console.log(`[PrintService] Reconnection attempt #${attempt} / 5`);
      });

      this.socket.on('connect_error', (err: Error) => {
        // 连接失败时，不 reject，而是保持重试状态
        console.warn('[PrintService] Connection failed:', err.message);
        this.isConnected = false;
      });

      this.socket.on('reconnect_error', (err: Error) => {
        console.warn('[PrintService] Reconnect error:', err.message);
      });

      // 当所有重连尝试都失败时触发
      this.socket.on('reconnect_failed', () => {
        console.error('[PrintService] Reconnection failed: Max attempts reached');
        this.isConnected = false;
        reject(new Error('打印服务重连失败'));
        message.error('打印服务重连失败，请检查 PrintHelper 是否已启动');
      });

      this.socket.on('disconnect', (reason: Socket.DisconnectReason) => {
        console.log('[PrintService] Disconnected:', reason);
        this.isConnected = false;
        message.error('打印服务已断开');
        // 如果是服务器端断开或网络问题，socket.io 会自动重连
        // 如果是手动调用 disconnect，则需要重新 connect
      });
    });

    // 初始连接不设超时 reject，让其在后台一直尝试
    // 只有在具体调用 print/getPrinters 时才检查连接状态
    return this.connectPromise;
  }

  /**
   * 核心方法：打印 HTML
   */
  async print(html: string, options: PrintOptions = {}): Promise<PrintResult> {
    const { printer: printerName = '', copies = 1, pageSize, margins } = options;

    // 尝试连接（如果未连接）
    this.connect();

    // 等待连接成功，或者超时
    try {
      await this.waitForConnection(5000); // 等待5秒连接
    } catch (e) {
      // 连接失败，提示用户检查服务
      return {
        success: false,
        message: '连接打印服务失败，请检查 PrintHelper 是否已启动',
      };
    }

    if (!this.socket) {
      return {
        success: false,
        message: 'Socket instance missing',
      };
    }

    return new Promise((resolve, reject) => {
      // 生成唯一 Request ID 避免并发混淆（可选，这里简单处理）
      this.socket?.emit('print', {
        html,
        printer: printerName,
        copies,
        pageSize,
        margins,
      });

      const handler = (result: PrintResult) => {
        this.socket?.off('printResult', handler);
        resolve(result);
      };

      this.socket?.on('printResult', handler);

      // 10秒超时
      setTimeout(() => {
        this.socket?.off('printResult', handler);
        reject(new Error('Print request timeout'));
      }, 10000);
    });
  }

  /**
   * 获取打印机列表
   */
  async getPrinters(): Promise<any[]> {
    this.connect();

    try {
      await this.waitForConnection(2000); // 列表获取等待时间短一点
    } catch (e) {
      console.warn('[PrintService] Failed to connect for printer list');
      return [];
    }

    if (!this.socket) return [];

    return new Promise((resolve) => {
      this.socket?.emit('printers');
      this.socket?.once('printers', (list: any[]) => resolve(list));
      setTimeout(() => resolve([]), 2000);
    });
  }

  /**
   * 获取原始打印机列表 (包含 Electron 完整信息)
   */
  async getPrintersAsync(): Promise<any[]> {
    this.connect();

    try {
      await this.waitForConnection(2000);
    } catch (e) {
      console.warn('[PrintService] Failed to connect for raw printer list');
      return [];
    }

    if (!this.socket) return [];

    return new Promise((resolve) => {
      // 推荐的严谨写法
      this.socket?.once('rawPrinters', (list: any[]) => resolve(list));
      this.socket?.emit('rawPrinters');
      setTimeout(() => resolve([]), 2000);
    });
  }

  /**
   * 获取服务状态
   * @returns {Promise<Object>}
   */
  async getStatus(): Promise<PrinterStatus | null> {
    this.connect();

    try {
      await this.waitForConnection(2000);
    } catch (e) {
      return null;
    }

    if (!this.socket) return null;

    return new Promise((resolve) => {
      this.socket?.once('status', (status: PrinterStatus) => {
        resolve(status);
      });
      this.socket?.emit('status');
      setTimeout(() => resolve(null), 3000);
    });
  }

  /**
   * 获取指定打印机的详细状态（如：Ready, Offline, Error）
   * @param {string} [printerName] 打印机名称（若不传，自动查询默认打印机）
   * @returns {Promise<Object>} { exists: boolean, status: string, isDefault: boolean }
   */
  async getPrinterStatus(printerName?: string): Promise<PrinterStatus> {
    this.connect();

    try {
      await this.waitForConnection(2000);
    } catch (e) {
      return { exists: false, message: 'Service not connected' };
    }

    // 如果没有参数，先查询默认打印机
    if (!printerName) {
      const status = await this.getStatus();
      if (status && status.defaultPrinter) {
        printerName = status.defaultPrinter;
      } else {
        return { exists: false, message: 'No default printer found' };
      }
    }

    if (!this.socket) return { exists: false, message: 'Socket not initialized' };

    return new Promise((resolve) => {
      this.socket?.emit('printerStatus', printerName);

      this.socket?.once('printerStatus', (status: PrinterStatus) => {
        resolve(status);
      });

      setTimeout(() => resolve({ exists: false, message: 'Timeout' }), 3000);
    });
  }

  /**
   * 获取打印机支持的纸张列表
   * @param {string} printerName 打印机名称
   */
  async getPrinterPapers(printerName: string): Promise<string[]> {
    this.connect();

    try {
      await this.waitForConnection(2000);
    } catch (e) {
      console.warn('[PrintService] Failed to connect for papers');
      return [];
    }

    if (!this.socket) return [];

    return new Promise((resolve) => {
      this.socket?.once('printerPapers', (list: string[]) => resolve(list));
      this.socket?.emit('printerPapers', printerName);
      setTimeout(() => resolve([]), 5000); // 纸张查询可能较慢，给5秒
    });
  }
  private waitForConnection(timeout = 5000): Promise<void> {
    if (this.isConnected && this.socket && this.socket.connected) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      // eslint-disable-next-line prefer-const
      let timer: ReturnType<typeof setTimeout>;

      const checkInterval = setInterval(() => {
        if (this.isConnected && this.socket && this.socket.connected) {
          clearInterval(checkInterval);
          clearTimeout(timer);
          resolve();
        }
      }, 200);

      timer = setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Connection wait timeout'));
      }, timeout);
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.connectPromise = null;
    }
  }
}

// 创建全局单例
const printService = new PrintService();

/**
 * 显式初始化函数（防止 Tree Shaking）
 * 在项目入口调用：import { printService } from './print-service'; printService.init();
 */
(printService as any).init = () => {
  console.info('[PrintService] SDK initialized');
  return printService;
};

// 1. 默认导出单例 (ES Module)
export { printService };
export default printService;

// 2. 挂载到 window (浏览器环境) - 增加更积极的副作用标记
if (typeof window !== 'undefined') {
  (window as any).PrintService = PrintService;
  (window as any).printService = printService;

  // 打印一个醒目的 Log，确保开发者知道它加载了
  console.log(
    '%c 🖨️ PrintService %c Loaded %c',
    'background:#4caf50 ; padding: 1px; border-radius: 3px 0 0 3px;  color: #fff',
    'background:#1976d2 ; padding: 1px; border-radius: 0 3px 3px 0;  color: #fff',
    'background:transparent',
  );
}

// 3. CommonJS 兼容导出
declare const module: any;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = printService;
  module.exports.PrintService = PrintService;
}
