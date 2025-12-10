import { Device } from 'vrack2-core';
declare class TCPObjectReceiver extends Device {
    description(): string;
    checkOptions(): {
        host: import("vrack2-core/lib/validator/types/StringType").default;
        port: import("vrack2-core/lib/validator/types/NumberType").default;
    };
    inputs(): {};
    outputs(): {
        object: import("vrack2-core/lib/ports/StandartPort").default;
    };
    shares: {
        online: boolean;
        received: number;
    };
    private _server;
    process(): void;
    private receiveObjects;
}
export default TCPObjectReceiver;
