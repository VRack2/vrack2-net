import * as path from 'node:path';
import * as net from 'net';
import { readFileSync } from 'node:fs';

import { Device, Port, Rule, ErrorManager, BasicType, BasicPort, BasicMetric, Metric, BasicAction, Action, CoreError } from 'vrack2-core';
import TCPProvider from './classes/TCPProvider';

// Если к порту шины подключено больше одного устройства
ErrorManager.register(
  'ConverterBus',
  'DFAMK2WNMGZD',
  'V2NET_CONN_MORE_ONE',
  'A port cannot contain more than one connection.',
);

// Если провайдер так и не смог выйти из режима реквеста
ErrorManager.register(
  'ConverterBus',
  '5V9HUQC3GVS1',
  'V2NET_PROVIDER_ON_BUSY',
  'The device gave up control but did not complete the request even after all timeouts. The connection was destroyed.',
);


// Если провайдер так и не смог выйти из режима реквеста
ErrorManager.register(
  'ConverterBus',
  'TNTFJI4M1EU1',
  'V2NET_PROVIDER_PORT_NOT_FOUND',
  'This port either does not exist or is not used by any devices.',
);


class ConverterClient extends Device {
  
  description(): string {
    return readFileSync(path.join(path.dirname(__dirname), 'docs', 'ConverterBus.md'), 'utf-8');
  }

  checkOptions(): { [key: string]: BasicType; } {
    return {
      devices: Rule.number().integer().min(1).default(8)
        .description('Количество устройств на шине '),

      socket: Rule.object().example({
        host: '127.0.0.1',
        port: 4001
      }).fields({
        port: Rule.number().require().example(4001).description('Порт для подключения - обязателен'),
        host: Rule.string().example('127.0.0.1').description('Хост для подключения')
      })
        .description('Параметры net.TcpSocketConnectOpts'),

      timeout: Rule.number().integer().min(0).default(15000)
        .description('Таймаут соединения (мс)'),

      debug: Rule.boolean().default(false)
        .description('Включение режима отладки по умолчанию'),

      internalTimer: Rule.number().integer().min(1).max(10000).default(1)
        .description('Внутренний интервал между опросами портов в мс (Может быть полезно для симуляции долгих опросов)'),

      registerMetrics: Rule.boolean().default(true).description('Регистрировать ли метрики? Можно не регистрировать для экономии памяти'),
      countOfFails: Rule.number().default(3).description('Сколько неудачных попыток считается что устройство offline'),
      deviceOfflineAlert: Rule.boolean().default(true).description('Создавать алерт если устройство на сети ушло в offline'),
      disconnectAlert: Rule.boolean().default(true).description('Создавать алерт если был разрыв соединения')
    };
  }

  actions(): { [key: string]: BasicAction; } {
    return {
      debug: Action.global().requirements({
        set: Rule.boolean().default(false).require().description('Новое значение Debug')
      }).description('Установка значения debug в онлайн режиме'),
      'set.port': Action.global().requirements({
        port: Rule.string().require().description('Идентифкатор порта'),
        set: Rule.boolean().default(false).require().description('Включение/выключение порта (до перезапуска сервиса)')
      }).description('Установка значения debug в онлайн режиме')
    }
  }

  outputs(): { [key: string]: BasicPort; } {
    return {
      'dev%d': Port.return().dynamic(this.options.devices).description('Порт для передачи провайдера устройству')
    }
  }

  /** 
   * @see TCPProvider.state 
   * 
   * 
   * */
  shares: {[key: string]: any} = {
    deviceList: {},
    ports: {},
    off: {},
    index: 1,
    activePort: '',
    progress: false,
    debug: false,
  };

  metrics(): { [key: string]: BasicMetric; } {
    const ret: { [key: string]: BasicMetric; } = {}
    // Если не регистрируем - 
    if (!this.options.registerMetrics) return ret
    // Добавляем метрики латенси для каждого порта
    for (let i = 1; i <= this.options.devices; i++){
      let port = this.portName(i)
      ret[port + '.latency'] = Metric.inS().retentions('5s:10m, 1m:2h, 15m:1d, 1h:1w, 6h:1mon, 1d:1y').description('Задержка опроса порта')
      ret[port + '.req.max'] = Metric.inS().retentions('5s:10m, 1m:2h, 15m:1d, 1h:1w, 6h:1mon, 1d:1y').description('Максимальная задержка на запрос')
    }
    return ret
  }

  /**
   * Класс провайдера
  */
  Provider!: TCPProvider;
  
  pushTimestamp = 0

  process(): void {
    this.shares.debug = this.options.debug

    // Заполняем shares данные по фактически подключенным портам
    this.fillSharesPorts()

    // Создаем провайдера, биндим хендлеры
    this.Provider = new TCPProvider(
      this.options.socket as net.TcpSocketConnectOpts, 
      this.options.timeout,
      this.metricHandler.bind(this),
      this.eventHandler.bind(this),
      this.readyHandler.bind(this)
    );

    // Инициализация shares из состояния провайдера
    this.shares.provider = this.Provider.state;
    this.render();
  }

  /** 
   * Установка debug в online режиме
   */
  async actionDebug(data: { set: boolean }){
    this.shares.debug = data.set
    return 'success'
  }

  /**
   * Экшен включения/выключения порта
  */
  async actionSetPort(data: {set: boolean, port: string}){
    if (!this.shares.deviceList[data.port]) throw ErrorManager.make('V2NET_PROVIDER_PORT_NOT_FOUND', data)
    if (data.set && this.shares.off[data.port] ) delete this.shares.off[data.port] 
    if (!data.set && !this.shares.off[data.port] ) { 
      this.shares.deviceList[data.port].online = false
      this.shares.off[data.port] = true
    }
    this.render()
    return 'success'
  }

  /**
   * Обработчик ивентов
  */
  eventHandler(event: string, value: any) {
    switch (event){
      case 'error':
        // Обработка ошибок
        this.error(value.toString(), value)
        break;
      default: 
        // Обрабатываем READ WRITE и тп
        if (this.shares.debug) this.terminal(event, value)
    }
  }

  /**
   * Обработчик метрик
  */
  metricHandler(metric: string, value: number): void {
    if (metric === 'request') this.metric(this.shares.activePort + '.req.max', value, 'max')
  }

  /**
   * Обработчик готовности провайдера
  */
  readyHandler(): void {
    this.nextGate();
  }

  /**
   * Обработчик при отключении соединения
   * 
  */
  destroyHandler(): void {
    if (this.options.disconnectAlert) this.alert('Provider disconnected', this.shares)
    // Помечаем все устройства оффлайн
    for (const port in this.shares.deviceList){
      if (this.shares.deviceList[port]) this.shares.deviceList[port].online = false
    }
    this.render()
  }


  async nextGate() {
    // Если еще прогресс идет
    if (this.shares.progress) return
    // Если провайдер не соединен
    if (!this.Provider.state.connected) return
  
    const queue = this.Provider.getNowInQueue()
    // Если у нас есть кто то внутри 
    // Надо дать управление шиной именно ему 
    if (queue) 
      await this.queueTick(queue)
    else 
      await this.standartTick()

    setTimeout(this.nextGate.bind(this), this.options.internalTimer)
  }
  
  /**
   * Выполняем в случае если у нас есть активное устройство в срочной очереди
  */
  async queueTick(device: string){
    const port = this.getDevicePort(device)
    if (port) {
      await this.portMaintenance(port)
    }else {
      // Какой то ретард передал название несуществующего ID устройства
      // Хер знает кто это не способен передать this.id
      // Вобщем порпускаме ретарда предварительно очищая очередь вручную
      this.alert('Someone added a non-existent device to the urgent queue.', { device })
      this.Provider.clearUrgentQueue()
      await this.standartTick()
    }
  }

  /**
   * Выполняем стандартный тик
  */
  async standartTick(){
    const port = this.portName()
    await this.portMaintenance(port)
    this.nextTick()
  }


  /**
   * Обслуживание порта - предоставляем провайдера, устанавливаем нужные флаги
   * 
   * @see beforePush
   * @see afterPush
  */
  async portMaintenance(port: string){
    if (this.shares.off[port]) return
    this.beforePush(port)
    try {
      await this.ports.output[port].push(this.Provider)
      this.shares.deviceList[port].stats.success++
      this.shares.deviceList[port].online = true
      this.shares.deviceList[port].fails = 0
    }catch(err){
      // Вначале обрабатываем 
      if (err instanceof CoreError && (err.vShort === "V2NET_PROVIDER_CANT_REQUEST" || err.vShort === "V2NET_PROVIDER_REQUIRE_BUS"))
        {
        // Считаем что провайдер не может выполнять свои обязанности по какой то причине
        // Или внутри провайдера есть в срочной очереди устройства 
        // В любом случае - в этой ситуации мы просто сообщаем что устройство было пропущено
        if (err.vShort === "V2NET_PROVIDER_CANT_REQUEST"){
          this.error('Provider can`t request', err)
        }
        if (err.vShort === "V2NET_PROVIDER_REQUIRE_BUS"){
          this.notify('Provider require bus - skip device', this.shares.deviceList[this.shares.activePort])
        }
        // Правим статистику что мы пропустили его
        this.shares.deviceList[this.shares.activePort].stats.skip++
      }else{
        // Это провал - плюсуем 
        this.shares.deviceList[port].fails++
        // Если провалов больше чем положено - offline и alert
        if (this.shares.deviceList[port].online && this.shares.deviceList[port].fails >= this.options.countOfFails){
          if (this.options.deviceOfflineAlert) this.alert("Device is currently offline!", this.shares.deviceList[port])
          this.shares.deviceList[port].online = false
        }
        this.error('Error of work port ' + port + ' device '+ this.shares.deviceList[port].id, err as Error)
        this.shares.deviceList[port].stats.errors++
      }
    }
    this.afterPush(port)

    await this.waitProvider()
  }

  /**
   * Проверят завершение выполнения запроса провайдера
   * Во первых - так быть не должно - кто то косячит (this.shares.activePort)
   * Во вторых - это достойно алерта - надо это срочно фиксить
  */
  async waitProvider(){
    // Устройство не отдало управление - прогресс еще не закончился
    // Будем ждать
    if (this.Provider.state.progress){ 
      this.alert('Control was transferred before the request was completed.', { device: this.shares.deviceList[this.shares.activePort] })
      for (let i = 0; i < 30; i++){
        if (!this.Provider.state.connected) return
        if (!this.Provider.state.progress) break
        await this.lDelay(300) // * 30 ~ 10 сек
      }
      // Ситуация не поменялась - нахуй его - кидаем соединение
      this.error('The provider is always busy', ErrorManager.make('V2NET_PROVIDER_ON_BUSY', { device: this.shares.deviceList[this.shares.activePort] }))
      this.Provider.destroy()
    }
  }

  protected beforePush(port: string){
    // ставим прогресс
    this.shares.progress = true

    if (this.shares.debug) this.event('Set active port', { port })
    // Устанавливаем активный порт
    this.shares.activePort = port
    // Устанавливаем активное устройство для провайдера
    this.Provider.setDevice(this.shares.deviceList[port].type, this.shares.deviceList[port].id)
    if (this.shares.debug) this.event('Set provider device', { 
      type: this.shares.deviceList[port].type, 
      device: this.shares.deviceList[port].id
    })
    // Отмечаем начала работы с устройством
    this.pushTimestamp =  Date.now()
    // Обновляем информацию
    this.render()
  }

  /**
   * Запускается после возвращения управления шины
  */
  protected afterPush(port: string){
    // Отправляем метрику латенси всего устройства
    if (this.options.registerMetrics) this.metric(port + '.latency', Date.now() - this.pushTimestamp)
    // Убираем активное устройство из провайдера, даже если оно все еще занято
    this.Provider.clearDevice()
    // Убираем локальный прогресс 
    this.shares.activePort = ''
    this.shares.progress = false
    // Обновляем информацию
    this.render()
  }

  /**
   * Заполняем shares данные на основе фактически подключеных портов
   * 
   * Запускается только в this.process()
   * */ 
  protected fillSharesPorts(){
    for (let i = 1; i <= this.options.devices; i++){
      let port = this.portName(i)

      // Если не соединен помечаем как не активный
      if (!this.ports.output[port].connected){
        this.shares.deviceList[port] = false
        this.shares.ports[i] = false
        continue
      }
      // Если соеденен но соединений больше 1 - заканчиваем представление
      if (this.ports.output[port].connections.length > 1){
        // this is the end
        throw ErrorManager.make('V2NET_CONN_MORE_ONE')
      }
      
      // Заполняем действующий порт 
      this.shares.ports[i] = port
 
      // Получаем класс связи на порту (она должна быть одна)
      const connection = this.ports.output[port].connections[0]

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
      }

      this.shares.deviceList[port] = dInfo
    }
  }

  /**
   * Возвращает порт по идентфиикатору устройства
   * Покрайней мере он попытается его найти, в случае чего вернет ''
  */
  protected getDevicePort(device: string){
    for (const port in this.shares.deviceList)
      if (this.shares.deviceList[port].id === device) return port 
    return ''
  }

  /**
   * Возвращает название исходящего порта по индеку
   * Если индекс не указан - использует индекс из shares
  */
  protected portName(index: number | undefined = undefined){
    if (index === undefined) return 'dev' + this.shares.index
    return 'dev' + index
  }
  
  /**
   * Считает и устанавливает следующий индекс порта
  */
  protected nextTick(){
    this.shares.index++
    if (this.shares.ports[this.shares.index] === undefined){
      this.shares.index = 1
      return
    }
    if (this.shares.ports[this.shares.index] === false){
      this.nextTick()
      return
    }
  }

  /**
   * Обертка для await Delay(ms)
   * Используется что бы ждать какое то время
  */
  protected lDelay(ms: number){
    return new Promise((resolve,reject)=>{
      setTimeout(resolve, ms)
    })
  }
}

export default ConverterClient;