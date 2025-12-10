import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import WebSocket from 'ws';
import { Device, Port, Rule, Metric } from 'vrack2-core';

interface QueuedCallback {
  (data: unknown): void;
}

interface OutgoingObject {
  [key: string]: unknown;
}

interface OutgoingPackage extends OutgoingObject {
  _pkgIndex: number;
}

class ObjectSender extends Device {

  description(): string {
    return readFileSync(path.join(path.dirname(__dirname), 'docs', 'TCPObjectTransmitter.md'), 'utf-8');
  }

  checkOptions() {
    return {
      host: Rule.string().default('127.0.0.1').description('Адрес сервера `ObjectReceiver`'),
      port: Rule.number().integer().default(8084).description('Порт сервера `ObjectReceiver`'),
      queueTimeout: Rule.number().integer().default(5000).description('таймаут ожидания подтверждения (мс, по умолчанию 5000)'),
      sendTimeout: Rule.number().integer().default(1000).description('задержка перед отправкой буфера (мс, по умолчанию 1000)')
    };
  }

  inputs() {
    return {
      object: Port.standart().description('Объект отправления')
    };
  }

  shares = {
    online: false,
    sended: 0,
    noSended: 0
  };

  // ——— private state ———
  private _buffer = new Map<number, unknown>();
  private _sended = new Map<number, boolean>();
  private _queue = new Map<number, QueuedCallback>();
  private _queueTimeout = new Map<number, NodeJS.Timeout>();
  private _pkgIndex = 1;
  private _sendTimer: NodeJS.Timeout | null = null;
  private _ws: WebSocket | false = false;
  private _objectIndex = 1;

  process(): void {
    this.createClient();
    this.render()
  }

  private createClient(): void {
    const url = `ws://${this.options.host}:${this.options.port}/`;
    this._ws = new WebSocket(url);

    this._ws.on('error', (error: Error) => {
      this.error('WebSocket Error', error);
    });

    this._ws.on('open', () => {
      this.shares.online = true;
      if (this._buffer.size) this.sendTimer();
    });

    this._ws.on('message', (data: WebSocket.RawData) => {
      let remoteData: any;

      try {
        remoteData = JSON.parse(data.toString());
      } catch (e) {
        this.error('Invalid JSON',  e as Error);
        return;
      }

      this.notify('message', remoteData);

      // Проверяем наличие данные которые нам нужны
      if (!remoteData || typeof remoteData !== 'object') return
      const pkgIndex = remoteData._pkgIndex;
      if (typeof pkgIndex !== 'number' || !this._queue.has(pkgIndex)) return

      // Обработка таймаута
      const timeoutId = this._queueTimeout.get(pkgIndex);
      if (timeoutId) clearTimeout(timeoutId);
      
      // Выполняем очередь
      const callback = this._queue.get(pkgIndex)!;
      callback(remoteData);
      this._queue.delete(pkgIndex);
      this._queueTimeout.delete(pkgIndex);
    });

    this._ws.on('close', () => {
      this.shares.online = false;
      this.render();
      setTimeout(() => {
        this.createClient();
      }, 5000);
    });
  }

  private sendObjects(): void {
    const data: unknown[] = [];
    for (const key of this._buffer.keys()) {
      data.push(this._buffer.get(key)!);
      this._sended.set(key, true);
    }

    const payload: OutgoingObject = {
      objects: data
    };

    const keys = Array.from(this._sended.keys());

    this.commandPromise(payload)
      .then(() => {
        this.shares.sended += this._sended.size;
        for (const key of keys) {
          this._sended.delete(key);
          this._buffer.delete(key);
        }
        this.shares.noSended = this._buffer.size;
        this._sendTimer = null;
        this.render();
      })
      .catch((error: Error) => {
        this.error('Error send object', error);
        for (const key of keys) this._sended.delete(key);
        if (this._ws && this._ws.readyState !== WebSocket.CLOSED) {
          this._ws.terminate();
        }
        this._sendTimer = null;
        this.render();
      });
  }

  private sendTimer(): void {
    if (!this.shares.online) return;
    if (this._sendTimer) return;

    this._sendTimer = setTimeout(() => {
      this._sendTimer = null;
      this.render();
      this.sendObjects();
    }, this.options.sendTimeout);
  }

  inputObject(data: unknown): void {
    if (this._buffer.size > 200) {
      this.sendTimer();
      return;
    }
    this._buffer.set(this._objectIndex, data);
    this.shares.noSended = this._buffer.size;
    this._objectIndex++;
    this.sendTimer();
  }

  private commandPromise(data: OutgoingObject): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.command(data, resolve, reject);
    });
  }

  private command(data: OutgoingObject, callback: QueuedCallback, errorCallback: (reason: string) => void): void {
    const pkg: OutgoingPackage = {
      ...data,
      _pkgIndex: this._pkgIndex++
    };
    this.addToQueue(pkg, callback, errorCallback);
  }

  private addToQueue(data: OutgoingPackage, callback: QueuedCallback, errorCallback: (reason: string) => void): void {
    const pkgIndex = data._pkgIndex;

    this._queue.set(pkgIndex, callback);
    const timeoutId = setTimeout(() => {
      errorCallback('Timeout');
      this._queue.delete(pkgIndex);
      this._queueTimeout.delete(pkgIndex);
    }, this.options.queueTimeout);
    this._queueTimeout.set(pkgIndex, timeoutId);

    if (this.shares.online && this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(data));
    } else {
      errorCallback('WebSocket is close');
    }
  }
}

export default ObjectSender;