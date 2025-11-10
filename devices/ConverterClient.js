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
const path = __importStar(require("node:path"));
const node_fs_1 = require("node:fs");
const vrack2_core_1 = require("vrack2-core");
const TCPProvider_1 = __importDefault(require("./classes/TCPProvider"));
class ConverterClient extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        /**
         * @see TCPProvider.state
         * */
        this.shares = {};
        /**
         * Флаг, что на данный момент управление провайдером
         * находится у самого TCPProvider
         * */
        this.inputGateFlag = true;
        this.metricList = {
            connected: true,
            request: true,
            timeout: true,
        };
    }
    description() {
        return (0, node_fs_1.readFileSync)(path.join(path.dirname(__dirname), 'docs', 'ConverterClient.md'), 'utf-8');
    }
    checkOptions() {
        return {
            socket: vrack2_core_1.Rule.object().example({
                host: '127.0.0.1',
                port: 4001
            }).fields({
                port: vrack2_core_1.Rule.number().require().example(4001).description('Порт для подключения - обязателен'),
                host: vrack2_core_1.Rule.string().example('127.0.0.1').description('Хост для подключения')
            }).description('Параметры net.TcpSocketConnectOpts'),
            timeout: vrack2_core_1.Rule.number().integer().min(0).default(15000).description('Таймаут соединения (мс)'),
            debug: vrack2_core_1.Rule.boolean().default(false).description('Отсылает проходящие данные через него в терминал'),
        };
    }
    inputs() {
        return {
            gate: vrack2_core_1.Port.standart().description('Вход передачи управления провайдером'),
        };
    }
    outputs() {
        return {
            provider: vrack2_core_1.Port.standart().description('Выход провайдера'),
            'metric.connected': vrack2_core_1.Port.standart().description('Состояние соединения с преобразователем'),
            'metric.request': vrack2_core_1.Port.standart().description('Время потраченное на успешный запрос'),
            'metric.timeout': vrack2_core_1.Port.standart().description('Время потраченное на неотвеченный запрос'),
        };
    }
    metrics() {
        return {
            'metric.connected': vrack2_core_1.Metric.inS()
                .retentions('5s:1h, 30s:6h, 2m:1d,15m:1w, 1h:1mon')
                .description('Состояние соединения с преобразователем'),
            'metric.request': vrack2_core_1.Metric.inS()
                .retentions('5s:1h, 30s:6h, 2m:1d,15m:1w, 1h:1mon')
                .description('Время потраченное на успешный запрос'),
            'metric.timeout': vrack2_core_1.Metric.inS()
                .retentions('5s:1h, 30s:6h, 2m:1d,15m:1w, 1h:1mon')
                .description('Время потраченное на неотвеченный запрос'),
        };
    }
    process() {
        this.provider = new TCPProvider_1.default(this.options.socket, this.options.timeout, this.metricHandler.bind(this), this.eventHandler.bind(this), this.readyHandler.bind(this));
        // Инициализация shares из состояния провайдера
        // После этого this.shares переопределять нельзя!
        this.shares = this.provider.state;
        this.render();
    }
    /**
     * Обработчик ивентов
    */
    eventHandler(event, value) {
        switch (event) {
            case 'error':
                // Обработка ошибок
                this.error(value.toString(), value);
            case 'render':
                this.render();
            default:
                // Обрабатываем READ WRITE и тп
                if (this.options.debug)
                    this.terminal(event, value);
        }
    }
    /**
     * Обработчик метрик
    */
    metricHandler(metric, value) {
        if (!this.metricList[metric])
            return;
        this.metric(`metric.${metric}`, value);
        this.ports.output[`metric.${metric}`].push(value);
        this.render();
    }
    /**
     * Обработчик готовности провайдера
    */
    readyHandler() {
        if (this.inputGateFlag)
            this.inputGate();
    }
    inputGate() {
        this.inputGateFlag = true;
        this.provider.clearDevice(); // Очищаем информацию о активном устройстве
        if (this.provider.state.connected) {
            this.inputGateFlag = false;
            setTimeout(() => {
                // Обязательно отправляем через таймаут 
                this.ports.output.provider.push(this.provider);
            }, 1);
        }
    }
}
exports.default = ConverterClient;
