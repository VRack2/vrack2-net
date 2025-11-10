import { Device, BasicType } from 'vrack2-core';
import TCPProvider from './classes/TCPProvider';
declare class ConverterClient extends Device {
    description(): string;
    checkOptions(): {
        [key: string]: BasicType;
    };
    inputs(): {
        gate: import("vrack2-core/lib/ports/StandartPort").default;
    };
    outputs(): {
        provider: import("vrack2-core/lib/ports/StandartPort").default;
        'metric.connected': import("vrack2-core/lib/ports/StandartPort").default;
        'metric.request': import("vrack2-core/lib/ports/StandartPort").default;
        'metric.timeout': import("vrack2-core/lib/ports/StandartPort").default;
    };
    metrics(): {
        'metric.connected': import("vrack2-core/lib/metrics/IvS").default;
        'metric.request': import("vrack2-core/lib/metrics/IvS").default;
        'metric.timeout': import("vrack2-core/lib/metrics/IvS").default;
    };
    /**
     * @see TCPProvider.state
     * */
    shares: {
        [key: string]: any;
    };
    /**
     * Класс провайдера
    */
    provider: TCPProvider;
    /**
     * Флаг, что на данный момент управление провайдером
     * находится у самого TCPProvider
     * */
    private inputGateFlag;
    readonly metricList: Record<string, boolean>;
    process(): void;
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
    inputGate(): void;
}
export default ConverterClient;
