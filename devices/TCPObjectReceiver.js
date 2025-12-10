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
class TCPObjectReceiver extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.shares = {
            online: true,
            received: 0 // intentional typo preserved (см. оригинальный `recived`)
        };
        this._server = null;
    }
    description() {
        return (0, node_fs_1.readFileSync)(path.join(path.dirname(__dirname), 'docs', 'TCPObjectTransmitter.md'), 'utf-8');
    }
    checkOptions() {
        return {
            host: vrack2_core_1.Rule.string().default('0.0.0.0').description('интерфейс прослушивания (по умолчанию 0.0.0.0)'),
            port: vrack2_core_1.Rule.number().integer().default(8084).description('порт WebSocket-сервера (по умолчанию 8084)')
        };
    }
    inputs() {
        return {};
    }
    outputs() {
        return {
            object: vrack2_core_1.Port.standart().description('Полученный объект')
        };
    }
    process() {
        this._server = new ws_1.default.Server({
            host: this.options.host,
            port: this.options.port
        });
        this._server.on('connection', (ws) => {
            ws.on('message', (data) => {
                let message;
                try {
                    message = JSON.parse(data.toString());
                }
                catch (e) {
                    this.error('Invalid JSON', e);
                    return;
                }
                this.receiveObjects(ws, message);
            });
        });
        this._server.on('error', (error) => {
            this.terminate(error, 'process');
        });
        setInterval(() => { this.render(); }, 5000);
    }
    receiveObjects(ws, rawMessage) {
        if (!rawMessage || typeof rawMessage !== 'object')
            return;
        const message = rawMessage;
        if (typeof message._pkgIndex !== 'number')
            return;
        if (!Array.isArray(message.objects) || message.objects.length === 0)
            return;
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
exports.default = TCPObjectReceiver;
