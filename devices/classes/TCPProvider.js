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
Object.defineProperty(exports, "__esModule", { value: true });
const net = __importStar(require("net"));
const util = __importStar(require("util"));
/**
 * TCPProvider — класс для управления устойчивым TCP-соединением с поддержкой автоматического
 * переподключения, таймаутов, метрик и буферизации входящих данных.
 *
 * Предназначен для сценариев, где требуется надёжный обмен бинарными пакетами по TCP
 * (например, промышленные протоколы, Modbus TCP и т.п.).
 */
class TCPProvider {
    /**
     * Конструктор инициализирует параметры подключения и колбэк метрик,
     * после чего немедленно создаёт и пытается установить TCP-соединение.
     *
     * @param options — параметры подключения (хост, порт, локальный адрес и т.д.)
     * @param mCb — функция для логирования или сбора метрик
     */
    constructor(options, timeout = 15000, mCb, // Metric CB
    eCb, // Error CB
    rCb = () => { }, // Ready CB
    dCb = () => { } // Destroy CB
    ) {
        /**
         * Буфер накопленных, но ещё не обработанных входящих данных.
         * Сбрасывается перед каждым новым запросом.
         */
        this.buffer = Buffer.from('');
        /**
         * Таймер, отслеживающий таймаут на уровне отдельного запроса.
         * Очищается при получении ответа или при уничтожении провайдера.
         */
        this.timeoutTimer = null;
        /**
         * Колбэки для разрешения/отклонения промиса текущего запроса.
         * Устанавливаются в методе request(), сбрасываются после завершения запроса.
         */
        this.resolve = null;
        this.reject = null;
        /**
         * Колбэки жизненного цикла соединения:
         * - readyCallback вызывается при успешном подключении;
         * - destroyCallback — при закрытии сокета;
         * - packageCheckCallback — для определения завершённости пакета.
         */
        this.readyCallback = () => { };
        this.destroyCallback = () => { };
        this.packageCheckCallback = () => true;
        /**
         * Вызывает тайм-аут сокета через `timeout` миллисекунд бездействия
        */
        this.timeout = 15000;
        /**
         * Очередь устройств для срочной передачи управления
         *
         * Когда какое то устройство, которое не имеет сейчас контроля над TCPProvider
         * но очень срочно хочет его получить - оно может добавить себя в срочную очередь
         *
         * @see addUrgentQueue
        */
        this.urgentQueue = [];
        /**
         * Объект состояния провайдера. Содержит флаги и счётчики для отслеживания
         * активности соединения и выполнения запросов.
         */
        this.state = {
            counter: 0,
            timeout: false,
            connected: false,
            progress: false,
            connection: false,
            errors: 0,
            byteSend: 0,
            byteReceive: 0,
            device: '',
            deviceType: '',
            urgentQueue: this.urgentQueue
        };
        this.timeout = timeout;
        this.options = options;
        this.metricCallback = mCb;
        this.eventCallback = eCb;
        this.readyCallback = rCb;
        this.destroyCallback = dCb;
        this.createSocket();
    }
    /**
     * Возвращает текущее содержимое буфера входящих данных.
     * Используется внешним кодом (например, парсером протокола) для извлечения ответа.
     */
    getBuffer() {
        return this.buffer;
    }
    /**
     * Добавление в срочную очередь устройства
    */
    addUrgentQueue(device) {
        this.urgentQueue.push(device);
    }
    /**
     * Устанавливает текущее активное устройство
     * (устройство которое занимает TCPProvider)
    */
    setDevice(type, device) {
        this.clearDevice(); // Убираем все старое, если оно было
        this.state.device = device;
        this.state.deviceType = type;
        this.eventCallback('render', undefined);
    }
    /**
     * Очищаем информацию о активном устройстве
    */
    clearDevice() {
        if (this.state.device === '')
            return;
        /**
         * Проверяем - если текущее устройство - в очереди под 0 индексом - убираем его
         * По сути устройство воспользовалось своей возможностью и само вызвало
         * clearDevice() или передало управление дальше.
        */
        if (this.urgentQueue.indexOf(this.state.device) === 0)
            this.urgentQueue.splice(0, 1); // удаляем нулевой индекс 
        this.state.device = '';
        this.state.deviceType = '';
        this.eventCallback('render', undefined);
    }
    /**
     * Проверяет флаги и соответсвие срочной очереди.
     * Возвращает true если все условия для запроса учтены и их можно делать
     *
     * Если же возвращает false - **устройство должно немедленно передать управления дальше**
     *
     * Так же проверяет срочную очередь - если есть несоответсвие текущего устройства и устройства
     * в очереди - возвращает false.
    */
    canRequest() {
        // Если занят и не подключен
        if (!this.state.connected || this.state.progress)
            return false;
        // Если в очереди есть устройство, но это не текущее = тоже false
        if (this.urgentQueue.length && this.urgentQueue[0] !== this.state.device)
            return false;
        return true;
    }
    /**
     * Устанавливает пользовательскую функцию для определения завершённости пакета.
     * Функция принимает текущий буфер и должна вернуть true, если пакет полный.
     */
    setPkgCheck(callback) {
        this.packageCheckCallback = callback;
    }
    /**
     * Выполняет запрос с автоматическими повторами в случае таймаута.
     *
     * @param buffer — данные для отправки
     * @param timeout — таймаут одного запроса (в миллисекундах)
     * @param maxRetries — максимальное количество попыток (по умолчанию 3)
     * @returns Promise<boolean> — разрешается при успешном получении полного пакета
     * @throws Error — если все попытки завершились неудачей
     */
    autoRequest(buffer, timeout, maxRetries = 3) {
        return __awaiter(this, void 0, void 0, function* () {
            const startTime = Date.now();
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    yield this.request(buffer, timeout);
                    const duration = Date.now() - startTime;
                    this.metricCallback('request', duration);
                    return true;
                }
                catch (error) {
                    const duration = Date.now() - startTime;
                    this.metricCallback('timeout', duration);
                    if (attempt === maxRetries) {
                        throw new Error(`All requests (${maxRetries}) failed: ${error.message}`);
                    }
                }
            }
            return false; // unreachable, но требуется для удовлетворения типизации
        });
    }
    /**
     * Выполняет одиночный запрос: отправляет данные и ожидает полный ответ.
     *
     * Перед отправкой проверяет, что соединение установлено и провайдер не занят.
     * Подписывается на данные один раз, используя once, и запускает таймер таймаута.
     *
     * @param buffer — данные для отправки
     * @param timeout — таймаут запроса в миллисекундах
     * @returns Promise<boolean> — разрешается при получении полного пакета
     */
    request(buffer, timeout) {
        if (this.state.progress)
            throw new Error('Provider is busy');
        if (!this.state.connected)
            throw new Error('Provider not connected');
        this.state.progress = true;
        this.buffer = Buffer.from('');
        return new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
            this.timeoutTimer = setTimeout(() => {
                if (this.socket) {
                    this.socket.removeAllListeners('data');
                }
                this.state.progress = false;
                this.state.errors++;
                reject(new Error('Request timeout'));
            }, timeout);
            if (this.socket) {
                this.socket.write(buffer);
                this.eventCallback('WRITE', util.inspect(buffer, { maxArrayLength: null }));
                this.state.byteSend += buffer.length;
                this.socket.once('data', this.handleData.bind(this));
            }
            else {
                reject(new Error('Socket not available'));
            }
        });
    }
    /**
     * Принудительно закрывает соединение и освобождает все ресурсы:
     * - очищает таймер запроса;
     * - удаляет обработчики событий сокета;
     * - уничтожает сокет;
     * - отклоняет текущий промис запроса (если есть).
     */
    destroy() {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        if (this.socket) {
            this.socket.removeAllListeners('data');
            this.socket.destroy();
        }
        if (this.reject) {
            this.reject(new Error('Provider destroyed'));
            this.reject = null;
            this.resolve = null;
        }
    }
    /**
     * Создаёт новый экземпляр net.Socket, применяет таймаут соединения
     * и регистрирует обработчики событий сокета.
     * Затем инициирует подключение к удалённому хосту.
     */
    createSocket() {
        this.socket = new net.Socket();
        // Устанавливаем таймаут на уровне сокета (для установки соединения и бездействия)
        this.socket.setTimeout(this.timeout);
        this.state.timeout = false;
        // Регистрация обработчиков событий сокета
        this.socket.on('connect', () => this.handleConnect());
        this.socket.on('timeout', () => this.handleTimeout());
        this.socket.on('error', (error) => this.eventCallback('error', error));
        this.socket.on('close', () => this.handleClose());
        // Инициируем подключение и устанавливаем флаг попытки соединения
        this.state.connection = true;
        this.socket.connect(this.options);
    }
    /**
     * Обработчик события 'connect'.
     * Сбрасывает флаги таймаута и подключения, устанавливает флаг успешного соединения,
     * отправляет метрику и вызывает колбэк готовности.
     */
    handleConnect() {
        this.state.timeout = false;
        this.state.connection = false;
        this.state.connected = true;
        this.metricCallback('connected', 1);
        this.readyCallback();
    }
    /**
     * Обработчик события 'timeout' сокета.
     * Устанавливает флаг таймаута, принудительно закрывает сокет с ошибкой
     * и через 1 секунду пытается пересоздать соединение.
     */
    handleTimeout() {
        this.state.timeout = true;
        if (this.socket) {
            this.socket.destroy(new Error('Socket connection timeout'));
        }
        setTimeout(() => {
            this.createSocket();
        }, 1000);
    }
    /**
     * Обработчик события 'close'.
     * Вызывает колбэк уничтожения, сбрасывает флаги соединения,
     * отправляет метрику отключения и, если закрытие не вызвано таймаутом,
     * пытается переподключиться через 3 секунды.
     */
    handleClose() {
        this.destroyCallback();
        this.state.connected = false;
        this.state.connection = false;
        this.metricCallback('connected', 0);
        if (!this.state.timeout && this.socket) {
            setTimeout(() => { this.socket.connect(this.options); }, 3000);
        }
    }
    /**
     * Обработчик входящих данных. Вызывается один раз на каждую порцию данных
     * благодаря использованию socket.once('data', ...).
     *
     * Накапливает данные в буфере, отправляет метрику чтения и проверяет,
     * достаточно ли данных для формирования полного пакета.
     * Если пакет неполный — повторно подписывается на следующую порцию.
     *
     * @param data — буфер с новыми входящими данными
     */
    handleData(data) {
        this.state.byteReceive += data.length;
        this.eventCallback('READ', util.inspect(data, { maxArrayLength: null }));
        this.buffer = Buffer.concat([this.buffer, data]);
        if (this.packageCheckCallback(this.buffer)) {
            this.completeRequest();
        }
        else {
            this.socket.once('data', this.handleData.bind(this));
        }
    }
    /**
     * Завершает текущий запрос: очищает таймер таймаута, сбрасывает флаг выполнения,
     * увеличивает счётчик успешных запросов и разрешает промис.
     */
    completeRequest() {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        this.state.progress = false;
        this.state.counter++;
        if (this.resolve) {
            this.resolve(true);
            this.resolve = null;
            this.reject = null;
        }
    }
}
exports.default = TCPProvider;
