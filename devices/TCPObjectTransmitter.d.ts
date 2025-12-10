import { Device } from 'vrack2-core';
declare class ObjectSender extends Device {
    description(): string;
    checkOptions(): {
        host: import("vrack2-core/lib/validator/types/StringType").default;
        port: import("vrack2-core/lib/validator/types/NumberType").default;
        queueTimeout: import("vrack2-core/lib/validator/types/NumberType").default;
        sendTimeout: import("vrack2-core/lib/validator/types/NumberType").default;
    };
    inputs(): {
        object: import("vrack2-core/lib/ports/StandartPort").default;
    };
    shares: {
        online: boolean;
        sended: number;
        noSended: number;
    };
    private _buffer;
    private _sended;
    private _queue;
    private _queueTimeout;
    private _pkgIndex;
    private _sendTimer;
    private _ws;
    private _objectIndex;
    process(): void;
    private createClient;
    private sendObjects;
    private sendTimer;
    inputObject(data: unknown): void;
    private commandPromise;
    private command;
    private addToQueue;
}
export default ObjectSender;
