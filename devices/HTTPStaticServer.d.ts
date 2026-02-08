import { Device } from "vrack2-core";
export default class StaticServer extends Device {
    private server;
    description(): string;
    checkOptions(): {
        port: import("vrack2-core/lib/validator/types/NumberType").default;
        directory: import("vrack2-core/lib/validator/types/StringType").default;
        index: import("vrack2-core/lib/validator/types/StringType").default;
        runAtStart: import("vrack2-core/lib/validator/types/BooleanType").default;
    };
    inputs(): {
        start: import("vrack2-core/lib/ports/StandartPort").default;
        stop: import("vrack2-core/lib/ports/StandartPort").default;
    };
    shares: {
        running: boolean;
        port: number;
        requests: number;
    };
    process(): void;
    inputStart(): void;
    inputStop(): void;
    startServer(): void;
    stopServer(): void;
}
