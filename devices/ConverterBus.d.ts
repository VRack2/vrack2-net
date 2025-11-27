import { Device, BasicType, BasicPort, BasicMetric, BasicAction } from 'vrack2-core';
import TCPProvider from './classes/TCPProvider';
declare class ConverterClient extends Device {
    description(): string;
    checkOptions(): {
        [key: string]: BasicType;
    };
    actions(): {
        [key: string]: BasicAction;
    };
    outputs(): {
        [key: string]: BasicPort;
    };
    /**
     * @see TCPProvider.state
     *
     *
     * */
    shares: {
        [key: string]: any;
    };
    metrics(): {
        [key: string]: BasicMetric;
    };
    /**
     * Класс провайдера
    */
    Provider: TCPProvider;
    pushTimestamp: number;
    process(): void;
    /**
     * Установка debug в online режиме
     */
    actionDebug(data: {
        set: boolean;
    }): Promise<string>;
    /**
     * Экшен включения/выключения порта
    */
    actionSetPort(data: {
        set: boolean;
        port: string;
    }): Promise<string>;
    /**
     * Обработчик ивентов
    */
    eventHandler(event: string, value: any): void;
    /**
     * Обработчик метрик
    */
    metricHandler(metric: string, value: number): void;
    /**
     * Обработчик готовности провайдера
    */
    readyHandler(): void;
    /**
     * Обработчик при отключении соединения
     *
    */
    destroyHandler(): void;
    nextGate(): Promise<void>;
    /**
     * Выполняем в случае если у нас есть активное устройство в срочной очереди
    */
    queueTick(device: string): Promise<void>;
    /**
     * Выполняем стандартный тик
    */
    standartTick(): Promise<void>;
    /**
     * Обслуживание порта - предоставляем провайдера, устанавливаем нужные флаги
     *
     * @see beforePush
     * @see afterPush
    */
    portMaintenance(port: string): Promise<void>;
    /**
     * Проверят завершение выполнения запроса провайдера
     * Во первых - так быть не должно - кто то косячит (this.shares.activePort)
     * Во вторых - это достойно алерта - надо это срочно фиксить
    */
    waitProvider(): Promise<void>;
    protected beforePush(port: string): void;
    /**
     * Запускается после возвращения управления шины
    */
    protected afterPush(port: string): void;
    /**
     * Заполняем shares данные на основе фактически подключеных портов
     *
     * Запускается только в this.process()
     * */
    protected fillSharesPorts(): void;
    /**
     * Возвращает порт по идентфиикатору устройства
     * Покрайней мере он попытается его найти, в случае чего вернет ''
    */
    protected getDevicePort(device: string): string;
    /**
     * Возвращает название исходящего порта по индеку
     * Если индекс не указан - использует индекс из shares
    */
    protected portName(index?: number | undefined): string;
    /**
     * Считает и устанавливает следующий индекс порта
    */
    protected nextTick(): void;
    /**
     * Обертка для await Delay(ms)
     * Используется что бы ждать какое то время
    */
    protected lDelay(ms: number): Promise<unknown>;
}
export default ConverterClient;
