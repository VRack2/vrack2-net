import * as path from 'node:path';
import * as net from 'net';
import { readFileSync } from 'node:fs';

import { Device, Port, Rule, Metric, BasicType } from 'vrack2-core';
import TCPProvider from './classes/TCPProvider';

class ConverterClient extends Device {
  
  description(): string {
    return readFileSync(path.join(path.dirname(__dirname), 'docs', 'ConverterClient.md'), 'utf-8');
  }

  checkOptions(): { [key: string]: BasicType; } {
    return {
      socket: Rule.object().example({
        host: '127.0.0.1',
        port: 4001
      }).fields({
        port: Rule.number().require().example(4001).description('Порт для подключения - обязателен'),
        host: Rule.string().example('127.0.0.1').description('Хост для подключения')
      }).description('Параметры net.TcpSocketConnectOpts'),
      timeout: Rule.number().integer().min(0).default(15000).description('Таймаут соединения (мс)'),
      debug: Rule.boolean().default(false).description('Отсылает проходящие данные через него в терминал'),
    };
  }

  inputs() {
    return {
      gate: Port.standart().description('Вход передачи управления провайдером'),
    };
  }

  outputs() {
    return {
      provider: Port.standart().description('Выход провайдера'),
      'metric.connected': Port.standart().description('Состояние соединения с преобразователем'),
      'metric.request': Port.standart().description('Время потраченное на успешный запрос'),
      'metric.timeout': Port.standart().description('Время потраченное на неотвеченный запрос'),
    };
  }

  metrics() {
    return {
      'metric.connected': Metric.inS()
        .retentions('5s:1h, 30s:6h, 2m:1d,15m:1w, 1h:1mon')
        .description('Состояние соединения с преобразователем'),
      'metric.request': Metric.inS()
        .retentions('5s:1h, 30s:6h, 2m:1d,15m:1w, 1h:1mon')
        .description('Время потраченное на успешный запрос'),
      'metric.timeout': Metric.inS()
        .retentions('5s:1h, 30s:6h, 2m:1d,15m:1w, 1h:1mon')
        .description('Время потраченное на неотвеченный запрос'),
    };
  }

  /** 
   * @see TCPProvider.state 
   * */
  shares: {[key: string]: any} = {};
  /**
   * Класс провайдера
  */
  provider!: TCPProvider;

  /** 
   * Флаг, что на данный момент управление провайдером 
   * находится у самого TCPProvider 
   * */
  private inputGateFlag = true;

  readonly metricList: Record<string, boolean> = {
    connected: true,
    request: true,
    timeout: true,
  };

  process(): void {
    this.provider = new TCPProvider(
      this.options.socket as net.TcpSocketConnectOpts, 
      this.options.timeout,
      this.metricHandler.bind(this),
      this.eventHandler.bind(this),
      this.readyHandler.bind(this)
    );

    // Инициализация shares из состояния провайдера
    // После этого this.shares переопределять нельзя!
    this.shares = this.provider.state;
    this.render();
  }

  /**
   * Обработчик ивентов
  */
  eventHandler(event: string, value: any) {
    switch (event){
      case 'error':
        // Обработка ошибок
        this.error(value.toString(), value)
      case 'render':
        this.render()
      default: 
        // Обрабатываем READ WRITE и тп
        if (this.options.debug) this.terminal(event, value)
    }
  }


  /**
   * Обработчик метрик
  */
  metricHandler(metric: string, value: number): void {
    if (!this.metricList[metric]) return
    this.metric(`metric.${metric}`, value);
    this.ports.output[`metric.${metric}`].push(value);
    this.render();
  }

  /**
   * Обработчик готовности провайдера
  */
  readyHandler(): void {
    if (this.inputGateFlag) this.inputGate();
  }

  inputGate(): void {
    this.inputGateFlag = true;
    this.provider.clearDevice() // Очищаем информацию о активном устройстве
    if (this.provider.state.connected) {
      this.inputGateFlag = false;
      setTimeout(() => { 
        // Обязательно отправляем через таймаут 
        this.ports.output.provider.push(this.provider);
      }, 1);
    }
  }
}

export default ConverterClient;