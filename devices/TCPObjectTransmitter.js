"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const ws_1 = __importDefault(require("ws"));
const vrack2_core_1 = require("vrack2-core");
class ObjectSender extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.shares = {
            online: false,
            sended: 0,
            noSended: 0
        };
        // ——— private state ———
        this._buffer = new Map();
        this._sended = new Map();
        this._queue = new Map();
        this._queueTimeout = new Map();
        this._pkgIndex = 1;
        this._sendTimer = null;
        this._ws = false;
        this._objectIndex = 1;
    }
    description() {
        return (0, node_fs_1.readFileSync)(path.join(path.dirname(__dirname), 'docs', 'TCPObjectTransmitter.md'), 'utf-8');
    }
    checkOptions() {
        return {
            host: vrack2_core_1.Rule.string().default('127.0.0.1').description('Адрес сервера `ObjectReceiver`'),
            port: vrack2_core_1.Rule.number().integer().default(8084).description('Порт сервера `ObjectReceiver`'),
            queueTimeout: vrack2_core_1.Rule.number().integer().default(5000).description('таймаут ожидания подтверждения (мс, по умолчанию 5000)'),
            sendTimeout: vrack2_core_1.Rule.number().integer().default(1000).description('задержка перед отправкой буфера (мс, по умолчанию 1000)')
        };
    }
    inputs() {
        return {
            object: vrack2_core_1.Port.standart().description('Объект отправления')
        };
    }
    process() {
        this.createClient();
        this.render();
    }
    createClient() {
        const url = `ws://${this.options.host}:${this.options.port}/`;
        this.terminal('Try connection', { url });
        this._ws = new ws_1.default(url);
        this._ws.on('error', (error) => {
            this.error('WebSocket Error', error);
        });
        this._ws.on('open', () => {
            this.terminal('opened', this.shares);
            this.shares.online = true;
            if (this._buffer.size)
                this.sendTimer();
            this.render();
        });
        this._ws.on('message', (data) => {
            let remoteData;
            try {
                remoteData = JSON.parse(data.toString());
            }
            catch (e) {
                this.error('Invalid JSON', e);
                return;
            }
            this.notify('message', remoteData);
            // Проверяем наличие данные которые нам нужны
            if (!remoteData || typeof remoteData !== 'object')
                return;
            const pkgIndex = remoteData._pkgIndex;
            if (typeof pkgIndex !== 'number' || !this._queue.has(pkgIndex))
                return;
            // Обработка таймаута
            const timeoutId = this._queueTimeout.get(pkgIndex);
            if (timeoutId)
                clearTimeout(timeoutId);
            // Выполняем очередь
            const callback = this._queue.get(pkgIndex);
            callback(remoteData);
            this._queue.delete(pkgIndex);
            this._queueTimeout.delete(pkgIndex);
        });
        this._ws.on('close', () => {
            this.terminal('closed', this.shares);
            this.shares.online = false;
            this.render();
            setTimeout(() => {
                this.createClient();
            }, 5000);
        });
    }
    sendObjects() {
        const data = [];
        for (const key of this._buffer.keys()) {
            data.push(this._buffer.get(key));
            this._sended.set(key, true);
        }
        const payload = {
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
            .catch((error) => {
            this.error('Error send object', error);
            for (const key of keys)
                this._sended.delete(key);
            if (this._ws && this._ws.readyState !== ws_1.default.CLOSED) {
                this._ws.terminate();
            }
            this._sendTimer = null;
            this.render();
        });
    }
    sendTimer() {
        if (!this.shares.online)
            return;
        if (this._sendTimer)
            return;
        this._sendTimer = setTimeout(() => {
            this._sendTimer = null;
            this.render();
            this.sendObjects();
        }, this.options.sendTimeout);
    }
    inputObject(data) {
        if (this._buffer.size > 200) {
            this.sendTimer();
            return;
        }
        this._buffer.set(this._objectIndex, data);
        this.shares.noSended = this._buffer.size;
        this._objectIndex++;
        this.sendTimer();
    }
    commandPromise(data) {
        return new Promise((resolve, reject) => {
            this.command(data, resolve, reject);
        });
    }
    command(data, callback, errorCallback) {
        const pkg = Object.assign(Object.assign({}, data), { _pkgIndex: this._pkgIndex++ });
        this.addToQueue(pkg, callback, errorCallback);
    }
    addToQueue(data, callback, errorCallback) {
        const pkgIndex = data._pkgIndex;
        this._queue.set(pkgIndex, callback);
        const timeoutId = setTimeout(() => {
            errorCallback('Timeout');
            this._queue.delete(pkgIndex);
            this._queueTimeout.delete(pkgIndex);
        }, this.options.queueTimeout);
        this._queueTimeout.set(pkgIndex, timeoutId);
        if (this.shares.online && this._ws && this._ws.readyState === ws_1.default.OPEN) {
            this._ws.send(JSON.stringify(data));
        }
        else {
            errorCallback('WebSocket is close');
        }
    }
}
exports.default = ObjectSender;
