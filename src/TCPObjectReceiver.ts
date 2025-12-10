import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import WebSocket from 'ws';
import { Device, Port, Rule } from 'vrack2-core';

interface IncomingPackage {
  _pkgIndex?: number;
  objects?: unknown[];
}

class TCPObjectReceiver extends Device {

  description(): string {
    return readFileSync(path.join(path.dirname(__dirname), 'docs', 'TCPObjectTransmitter.md'), 'utf-8');
  }

  checkOptions() {
    return {
      host: Rule.string().default('0.0.0.0').description('интерфейс прослушивания (по умолчанию 0.0.0.0)'),
      port: Rule.number().integer().default(8084).description('порт WebSocket-сервера (по умолчанию 8084)')
    };
  }

  inputs() {
    return {};
  }

  outputs() {
    return {
      object: Port.standart().description('Полученный объект')
    };
  }

  shares = {
    online: true,
    received: 0  // intentional typo preserved (см. оригинальный `recived`)
  };

  private _server: WebSocket.Server | null = null;

  process(): void {
    this._server = new WebSocket.Server({
      host: this.options.host,
      port: this.options.port
    });

    this._server.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: WebSocket.RawData) => {
        let message: unknown;
        try {
          message = JSON.parse(data.toString());
        } catch (e) {
          this.error('Invalid JSON', e as Error);
          return;
        }

        this.receiveObjects(ws, message);
      });
    });

    this._server.on('error', (error: Error) => {
      this.terminate(error, 'process');
    });

    setInterval(() => { this.render(); }, 5000);
  }

  private receiveObjects(ws: WebSocket, rawMessage: unknown): void {
    if (!rawMessage || typeof rawMessage !== 'object') return;

    const message = rawMessage as IncomingPackage;

    if (typeof message._pkgIndex !== 'number') return;
    if (!Array.isArray(message.objects) || message.objects.length === 0) return;

    for (const object of message.objects) {
      this.shares.received++;
      this.ports.output.object.push(object);
    }

    // отправляем подтверждение
    ws.send(JSON.stringify({
      _pkgIndex: message._pkgIndex
    }));

    this.render();
  }
}

export default TCPObjectReceiver;