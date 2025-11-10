import * as net from 'net';
import * as util from 'util';

/**
 * TCPProvider — класс для управления устойчивым TCP-соединением с поддержкой автоматического
 * переподключения, таймаутов, метрик и буферизации входящих данных.
 * 
 * Предназначен для сценариев, где требуется надёжный обмен бинарными пакетами по TCP
 * (например, промышленные протоколы, Modbus TCP и т.п.).
 */
class TCPProvider {
  /**
   * Экземпляр TCP-сокета из модуля 'net'. Может быть null до инициализации или после уничтожения.
   */
  private socket!: net.Socket;

  /**
   * Буфер накопленных, но ещё не обработанных входящих данных.
   * Сбрасывается перед каждым новым запросом.
   */
  private buffer: Buffer = Buffer.from('');

  /**
   * Таймер, отслеживающий таймаут на уровне отдельного запроса.
   * Очищается при получении ответа или при уничтожении провайдера.
   */
  private timeoutTimer: NodeJS.Timeout | null = null;

  /**
   * Колбэки для разрешения/отклонения промиса текущего запроса.
   * Устанавливаются в методе request(), сбрасываются после завершения запроса.
   */
  private resolve: ((value: boolean) => void) | null = null;
  private reject: ((reason?: any) => void) | null = null;

  /**
   * Колбэки жизненного цикла соединения:
   * - readyCallback вызывается при успешном подключении;
   * - destroyCallback — при закрытии сокета;
   * - packageCheckCallback — для определения завершённости пакета.
   */
  private readyCallback: () => void = () => { };
  private destroyCallback: () => void = () => { };
  private packageCheckCallback: (buffer: Buffer) => boolean = () => true;

  /**
   * Функция обратного вызова для отправки метрик (событий, ошибок, времени выполнения и т.д.).
   * Принимает имя метрики и её значение.
   */
  private metricCallback: (event: string, data: any) => void;
  private eventCallback: (event: string, data: any) => void;


  /**
   * Параметры подключения (хост, порт, таймаут и т.д.), передаваемые в net.Socket.connect().
   */
  private options: net.TcpSocketConnectOpts;

  /**
   * Вызывает тайм-аут сокета через `timeout` миллисекунд бездействия
  */
  private timeout: number = 15000

  /**
   * Очередь устройств для срочной передачи управления
   * 
   * Когда какое то устройство, которое не имеет сейчас контроля над TCPProvider
   * но очень срочно хочет его получить - оно может добавить себя в срочную очередь
   * 
   * @see addUrgentQueue
  */
  private urgentQueue: Array<string> = []

  /**
   * Объект состояния провайдера. Содержит флаги и счётчики для отслеживания
   * активности соединения и выполнения запросов.
   */
  public state = {
    counter: 0,          // Общее количество успешно завершённых запросов
    timeout: false,      // Установлен, если последнее соединение завершилось по таймауту
    connected: false,    // Указывает, установлено ли TCP-соединение
    progress: false,     // Указывает, выполняется ли в данный момент запрос
    connection: false,   // Указывает, находится ли провайдер в процессе подключения
    errors: 0,           // Счётчик ошибок (в основном таймаутов запросов)
    byteSend: 0,         // Общее количество отправленных байт
    byteReceive: 0,      // Общее количество полученных байт
    device: '',          // Активное устройство которое сейчас заняло провайдер
    deviceType: '',      // Тип активного устройства
    urgentQueue: this.urgentQueue
  };

  /**
   * Конструктор инициализирует параметры подключения и колбэк метрик,
   * после чего немедленно создаёт и пытается установить TCP-соединение.
   * 
   * @param options — параметры подключения (хост, порт, локальный адрес и т.д.)
   * @param mCb — функция для логирования или сбора метрик
   */
  constructor(
    options: net.TcpSocketConnectOpts,
    timeout: number = 15000,
    mCb: (event: string, data: any) => void, // Metric CB
    eCb: (event: string, data: any) => void, // Error CB
    rCb: () => void = () => { },              // Ready CB
    dCb: () => void = () => { }               // Destroy CB
  ) {
    this.timeout = timeout
    this.options = options;
    this.metricCallback = mCb;
    this.eventCallback = eCb
    this.readyCallback = rCb
    this.destroyCallback = dCb
    this.createSocket();
  }

  /**
   * Возвращает текущее содержимое буфера входящих данных.
   * Используется внешним кодом (например, парсером протокола) для извлечения ответа.
   */
  public getBuffer(): Buffer {
    return this.buffer;
  }

  /**
   * Добавление в срочную очередь устройства
  */
  addUrgentQueue(device: string) {
    this.urgentQueue.push(device)
  }

  /**
   * Устанавливает текущее активное устройство 
   * (устройство которое занимает TCPProvider)
  */
  setDevice(type: string, device: string) {
    this.clearDevice() // Убираем все старое, если оно было
    this.state.device = device
    this.state.deviceType = type
    this.eventCallback('render', undefined)
  }

  /**
   * Очищаем информацию о активном устройстве
  */
  clearDevice(){
    if (this.state.device === '') return

    /**
     * Проверяем - если текущее устройство - в очереди под 0 индексом - убираем его
     * По сути устройство воспользовалось своей возможностью и само вызвало
     * clearDevice() или передало управление дальше. 
    */
    if (this.urgentQueue.indexOf(this.state.device) === 0) this.urgentQueue.splice(0,1) // удаляем нулевой индекс 

    this.state.device = ''
    this.state.deviceType = ''

    this.eventCallback('render', undefined)
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
  canRequest(){
    // Если занят и не подключен
    if (!this.state.connected || this.state.progress) return false
    // Если в очереди есть устройство, но это не текущее = тоже false
    if (this.urgentQueue.length && this.urgentQueue[0] !== this.state.device) return false
    return true
  }

  /**
   * Устанавливает пользовательскую функцию для определения завершённости пакета.
   * Функция принимает текущий буфер и должна вернуть true, если пакет полный.
   */
  public setPkgCheck(callback: (buffer: Buffer) => boolean): void {
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
  public async autoRequest(buffer: Buffer, timeout: number, maxRetries = 3): Promise<boolean> {
    const startTime = Date.now();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.request(buffer, timeout);
        const duration = Date.now() - startTime;
        this.metricCallback('request', duration);
        return true;
      } catch (error: any) {
        const duration = Date.now() - startTime;
        this.metricCallback('timeout', duration);

        if (attempt === maxRetries) {
          throw new Error(`All requests (${maxRetries}) failed: ${error.message}`);
        }
      }
    }
    return false; // unreachable, но требуется для удовлетворения типизации
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
  public request(buffer: Buffer, timeout: number): Promise<boolean> {
    if (this.state.progress) throw new Error('Provider is busy');
    if (!this.state.connected) throw new Error('Provider not connected');

    this.state.progress = true;
    this.buffer = Buffer.from('');

    return new Promise<boolean>((resolve, reject) => {
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
        this.metricCallback('WRITE', util.inspect(buffer, { maxArrayLength: null }));
        this.state.byteSend += buffer.length;
        this.socket.once('data', this.handleData.bind(this));
      } else {
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
  public destroy(): void {
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
  private createSocket(): void {
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
  private handleConnect(): void {
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
  private handleTimeout(): void {
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
  private handleClose(): void {
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
  private handleData(data: Buffer): void {
    this.state.byteReceive += data.length;
    this.metricCallback('READ', util.inspect(data, { maxArrayLength: null }));
    this.buffer = Buffer.concat([this.buffer, data]);

    if (this.packageCheckCallback(this.buffer)) {
      this.completeRequest();
    } else {
      this.socket.once('data', this.handleData.bind(this));
    }
  }

  /**
   * Завершает текущий запрос: очищает таймер таймаута, сбрасывает флаг выполнения,
   * увеличивает счётчик успешных запросов и разрешает промис.
   */
  private completeRequest(): void {
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

export default TCPProvider;