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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("node:path"));
const node_fs_1 = require("node:fs");
const vrack2_core_1 = require("vrack2-core");
const TCPProvider_1 = __importDefault(require("./classes/TCPProvider"));
// Если к порту шины подключено больше одного устройства
vrack2_core_1.ErrorManager.register('ConverterBus', 'DFAMK2WNMGZD', 'V2NET_CONN_MORE_ONE', 'A port cannot contain more than one connection.');
// Если провайдер так и не смог выйти из режима реквеста
vrack2_core_1.ErrorManager.register('ConverterBus', '5V9HUQC3GVS1', 'V2NET_PROVIDER_ON_BUSY', 'The device gave up control but did not complete the request even after all timeouts. The connection was destroyed.');
// Если провайдер так и не смог выйти из режима реквеста
vrack2_core_1.ErrorManager.register('ConverterBus', 'TNTFJI4M1EU1', 'V2NET_PROVIDER_PORT_NOT_FOUND', 'This port either does not exist or is not used by any devices.');
class ConverterClient extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        /**
         * @see TCPProvider.state
         *
         *
         * */
        this.shares = {
            deviceList: {},
            ports: {},
            off: {},
            index: 1,
            activePort: '',
            progress: false,
            debug: false,
        };
        this.pushTimestamp = 0;
    }
    description() {
        return (0, node_fs_1.readFileSync)(path.join(path.dirname(__dirname), 'docs', 'ConverterBus.md'), 'utf-8');
    }
    checkOptions() {
        return {
            devices: vrack2_core_1.Rule.number().integer().min(1).default(8)
                .description('Количество устройств на шине '),
            socket: vrack2_core_1.Rule.object().example({
                host: '127.0.0.1',
                port: 4001
            }).fields({
                port: vrack2_core_1.Rule.number().require().example(4001).description('Порт для подключения - обязателен'),
                host: vrack2_core_1.Rule.string().example('127.0.0.1').description('Хост для подключения')
            })
                .description('Параметры net.TcpSocketConnectOpts'),
            timeout: vrack2_core_1.Rule.number().integer().min(0).default(15000)
                .description('Таймаут соединения (мс)'),
            debug: vrack2_core_1.Rule.boolean().default(false)
                .description('Включение режима отладки по умолчанию'),
            registerMetrics: vrack2_core_1.Rule.boolean().default(true).description('Регистрировать ли метрики? Можно не регистрировать для экономии памяти'),
            countOfFails: vrack2_core_1.Rule.number().default(3).description('Сколько неудачных попыток считается что устройство offline'),
            deviceOfflineAlert: vrack2_core_1.Rule.boolean().default(true).description('Создавать алерт если устройство на сети ушло в offline'),
            disconnectAlert: vrack2_core_1.Rule.boolean().default(true).description('Создавать алерт если был разрыв соединения')
        };
    }
    actions() {
        return {
            debug: vrack2_core_1.Action.global().requirements({
                set: vrack2_core_1.Rule.boolean().default(false).require().description('Новое значение Debug')
            }).description('Установка значения debug в онлайн режиме'),
            'set.port': vrack2_core_1.Action.global().requirements({
                port: vrack2_core_1.Rule.string().require().description('Идентифкатор порта'),
                set: vrack2_core_1.Rule.boolean().default(false).require().description('Включение/выключение порта (до перезапуска сервиса)')
            }).description('Установка значения debug в онлайн режиме')
        };
    }
    outputs() {
        return {
            'dev%d': vrack2_core_1.Port.return().dynamic(this.options.devices).description('Порт для передачи провайдера устройству')
        };
    }
    metrics() {
        const ret = {};
        // Если не регистрируем - 
        if (!this.options.registerMetrics)
            return ret;
        // Добавляем метрики латенси для каждого порта
        for (let i = 1; i <= this.options.devices; i++) {
            let port = this.portName(i);
            ret[port + '.latency'] = vrack2_core_1.Metric.inS().retentions('5s:10m, 1m:2h, 15m:1d, 1h:1w, 6h:1mon, 1d:1y').description('Задержка опроса порта');
            ret[port + '.req.max'] = vrack2_core_1.Metric.inS().retentions('5s:10m, 1m:2h, 15m:1d, 1h:1w, 6h:1mon, 1d:1y').description('Максимальная задержка на запрос');
        }
        return ret;
    }
    process() {
        this.shares.debug = this.options.debug;
        // Заполняем shares данные по фактически подключенным портам
        this.fillSharesPorts();
        // Создаем провайдера, биндим хендлеры
        this.Provider = new TCPProvider_1.default(this.options.socket, this.options.timeout, this.metricHandler.bind(this), this.eventHandler.bind(this), this.readyHandler.bind(this));
        // Инициализация shares из состояния провайдера
        this.shares.provider = this.Provider.state;
        this.render();
    }
    /**
     * Установка debug в online режиме
     */
    actionDebug(data) {
        return __awaiter(this, void 0, void 0, function* () {
            this.shares.debug = data.set;
            return 'success';
        });
    }
    /**
     * Экшен включения/выключения порта
    */
    actionSetPort(data) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.shares.deviceList[data.port])
                throw vrack2_core_1.ErrorManager.make('V2NET_PROVIDER_PORT_NOT_FOUND', data);
            if (data.set && this.shares.off[data.port])
                delete this.shares.off[data.port];
            if (!data.set && !this.shares.off[data.port]) {
                this.shares.deviceList[data.port].online = false;
                this.shares.off[data.port] = true;
            }
            this.render();
            return 'success';
        });
    }
    /**
     * Обработчик ивентов
    */
    eventHandler(event, value) {
        switch (event) {
            case 'error':
                // Обработка ошибок
                this.error(value.toString(), value);
                break;
            default:
                // Обрабатываем READ WRITE и тп
                if (this.shares.debug)
                    this.terminal(event, value);
        }
    }
    /**
     * Обработчик метрик
    */
    metricHandler(metric, value) {
        if (metric === 'request')
            this.metric(this.shares.activePort + '.req.max', value, 'max');
    }
    /**
     * Обработчик готовности провайдера
    */
    readyHandler() {
        this.nextGate();
    }
    /**
     * Обработчик при отключении соединения
     *
    */
    destroyHandler() {
        if (this.options.disconnectAlert)
            this.alert('Provider disconnected', this.shares);
        // Помечаем все устройства оффлайн
        for (const port in this.shares.deviceList) {
            if (this.shares.deviceList[port])
                this.shares.deviceList[port].online = false;
        }
        this.render();
    }
    nextGate() {
        return __awaiter(this, void 0, void 0, function* () {
            // Если еще прогресс идет
            if (this.shares.progress)
                return;
            // Если провайдер не соединен
            if (!this.Provider.state.connected)
                return;
            const queue = this.Provider.getNowInQueue();
            // Если у нас есть кто то внутри 
            // Надо дать управление шиной именно ему 
            if (queue)
                yield this.queueTick(queue);
            else
                yield this.standartTick();
            setTimeout(this.nextGate.bind(this), 1);
        });
    }
    /**
     * Выполняем в случае если у нас есть активное устройство в срочной очереди
    */
    queueTick(device) {
        return __awaiter(this, void 0, void 0, function* () {
            const port = this.getDevicePort(device);
            if (port) {
                yield this.portMaintenance(port);
            }
            else {
                // Какой то ретард передал название несуществующего ID устройства
                // Хер знает кто это не способен передать this.id
                // Вобщем порпускаме ретарда предварительно очищая очередь вручную
                this.alert('Someone added a non-existent device to the urgent queue.', { device });
                this.Provider.clearUrgentQueue();
                yield this.standartTick();
            }
        });
    }
    /**
     * Выполняем стандартный тик
    */
    standartTick() {
        return __awaiter(this, void 0, void 0, function* () {
            const port = this.portName();
            yield this.portMaintenance(port);
            this.nextTick();
        });
    }
    /**
     * Обслуживание порта - предоставляем провайдера, устанавливаем нужные флаги
     *
     * @see beforePush
     * @see afterPush
    */
    portMaintenance(port) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.shares.off[port])
                return;
            this.beforePush(port);
            try {
                yield this.ports.output[port].push(this.Provider);
                this.shares.deviceList[port].stats.success++;
                this.shares.deviceList[port].online = true;
                this.shares.deviceList[port].fails = 0;
            }
            catch (err) {
                // Вначале обрабатываем 
                if (err instanceof vrack2_core_1.CoreError && (err.vShort === "V2NET_PROVIDER_CANT_REQUEST" || err.vShort === "V2NET_PROVIDER_REQUIRE_BUS")) {
                    // Считаем что провайдер не может выполнять свои обязанности по какой то причине
                    // Или внутри провайдера есть в срочной очереди устройства 
                    // В любом случае - в этой ситуации мы просто сообщаем что устройство было пропущено
                    if (err.vShort === "V2NET_PROVIDER_CANT_REQUEST") {
                        this.error('Provider can`t request', err);
                    }
                    if (err.vShort === "V2NET_PROVIDER_REQUIRE_BUS") {
                        this.notify('Provider require bus - skip device', this.shares.deviceList[this.shares.activePort]);
                    }
                    // Правим статистику что мы пропустили его
                    this.shares.deviceList[this.shares.activePort].stats.skip++;
                }
                else {
                    // Это провал - плюсуем 
                    this.shares.deviceList[port].fails++;
                    // Если провалов больше чем положено - offline и alert
                    if (this.shares.deviceList[port].online && this.shares.deviceList[port].fails >= this.options.countOfFails) {
                        if (this.options.deviceOfflineAlert)
                            this.alert("Device is currently offline!", this.shares.deviceList[port]);
                        this.shares.deviceList[port].online = false;
                    }
                    this.error('Error of work port ' + port + ' device ' + this.shares.deviceList[port].id, err);
                    this.shares.deviceList[port].stats.errors++;
                }
            }
            this.afterPush(port);
            yield this.waitProvider();
        });
    }
    /**
     * Проверят завершение выполнения запроса провайдера
     * Во первых - так быть не должно - кто то косячит (this.shares.activePort)
     * Во вторых - это достойно алерта - надо это срочно фиксить
    */
    waitProvider() {
        return __awaiter(this, void 0, void 0, function* () {
            // Устройство не отдало управление - прогресс еще не закончился
            // Будем ждать
            if (this.Provider.state.progress) {
                this.alert('Control was transferred before the request was completed.', { device: this.shares.deviceList[this.shares.activePort] });
                for (let i = 0; i < 30; i++) {
                    if (!this.Provider.state.connected)
                        return;
                    if (!this.Provider.state.progress)
                        break;
                    yield this.lDelay(300); // * 30 ~ 10 сек
                }
                // Ситуация не поменялась - нахуй его - кидаем соединение
                this.error('The provider is always busy', vrack2_core_1.ErrorManager.make('V2NET_PROVIDER_ON_BUSY', { device: this.shares.deviceList[this.shares.activePort] }));
                this.Provider.destroy();
            }
        });
    }
    beforePush(port) {
        // ставим прогресс
        this.shares.progress = true;
        if (this.shares.debug)
            this.event('Set active port', { port });
        // Устанавливаем активный порт
        this.shares.activePort = port;
        // Устанавливаем активное устройство для провайдера
        this.Provider.setDevice(this.shares.deviceList[port].type, this.shares.deviceList[port].id);
        if (this.shares.debug)
            this.event('Set provider device', {
                type: this.shares.deviceList[port].type,
                device: this.shares.deviceList[port].id
            });
        // Отмечаем начала работы с устройством
        this.pushTimestamp = Date.now();
        // Обновляем информацию
        this.render();
    }
    /**
     * Запускается после возвращения управления шины
    */
    afterPush(port) {
        // Отправляем метрику латенси всего устройства
        if (this.options.registerMetrics)
            this.metric(port + '.latency', Date.now() - this.pushTimestamp);
        // Убираем активное устройство из провайдера, даже если оно все еще занято
        this.Provider.clearDevice();
        // Убираем локальный прогресс 
        this.shares.activePort = '';
        this.shares.progress = false;
        // Обновляем информацию
        this.render();
    }
    /**
     * Заполняем shares данные на основе фактически подключеных портов
     *
     * Запускается только в this.process()
     * */
    fillSharesPorts() {
        for (let i = 1; i <= this.options.devices; i++) {
            let port = this.portName(i);
            // Если не соединен помечаем как не активный
            if (!this.ports.output[port].connected) {
                this.shares.deviceList[port] = false;
                this.shares.ports[i] = false;
                continue;
            }
            // Если соеденен но соединений больше 1 - заканчиваем представление
            if (this.ports.output[port].connections.length > 1) {
                // this is the end
                throw vrack2_core_1.ErrorManager.make('V2NET_CONN_MORE_ONE');
            }
            // Заполняем действующий порт 
            this.shares.ports[i] = port;
            // Получаем класс связи на порту (она должна быть одна)
            const connection = this.ports.output[port].connections[0];
            // Формируем информацию о устройстве
            const dInfo = {
                id: connection.inputLink.Device.id,
                type: connection.inputLink.Device.type,
                online: false,
                fails: 0,
                stats: {
                    success: 0,
                    errors: 0,
                    skip: 0,
                }
            };
            this.shares.deviceList[port] = dInfo;
        }
    }
    /**
     * Возвращает порт по идентфиикатору устройства
     * Покрайней мере он попытается его найти, в случае чего вернет ''
    */
    getDevicePort(device) {
        for (const port in this.shares.deviceList)
            if (this.shares.deviceList[port].id === device)
                return port;
        return '';
    }
    /**
     * Возвращает название исходящего порта по индеку
     * Если индекс не указан - использует индекс из shares
    */
    portName(index = undefined) {
        if (index === undefined)
            return 'dev' + this.shares.index;
        return 'dev' + index;
    }
    /**
     * Считает и устанавливает следующий индекс порта
    */
    nextTick() {
        this.shares.index++;
        if (this.shares.ports[this.shares.index] === undefined) {
            this.shares.index = 1;
            return;
        }
        if (this.shares.ports[this.shares.index] === false) {
            this.nextTick();
            return;
        }
    }
    /**
     * Обертка для await Delay(ms)
     * Используется что бы ждать какое то время
    */
    lDelay(ms) {
        return new Promise((resolve, reject) => {
            setTimeout(resolve, ms);
        });
    }
}
exports.default = ConverterClient;
