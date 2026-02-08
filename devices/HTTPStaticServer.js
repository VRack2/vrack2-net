"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vrack2_core_1 = require("vrack2-core");
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const node_fs_1 = require("node:fs");
class StaticServer extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.server = null;
        this.shares = {
            running: false,
            port: 0,
            requests: 0
        };
    }
    description() {
        return (0, node_fs_1.readFileSync)(path_1.default.join(path_1.default.dirname(__dirname), 'docs', 'HTTPStaticServer.md'), 'utf-8');
    }
    checkOptions() {
        return {
            port: vrack2_core_1.Rule.number().integer().min(1).max(65535).default(8080).description('Порт сервера'),
            directory: vrack2_core_1.Rule.string().default('./public').description('Директория со статическими файлами'),
            index: vrack2_core_1.Rule.string().default('index.html').description('Файл по умолчанию'),
            runAtStart: vrack2_core_1.Rule.boolean().default(true).description('Запускать сервер вместе с запуском устройства')
        };
    }
    inputs() {
        return {
            'start': vrack2_core_1.Port.standart().description('Запустить сервер'),
            'stop': vrack2_core_1.Port.standart().description('Остановить сервер')
        };
    }
    process() {
        this.render();
        if (this.options.runAtStart)
            this.inputStart();
    }
    inputStart() {
        if (this.server)
            return;
        try {
            this.startServer();
            this.shares.running = true;
            this.shares.port = this.options.port;
            this.render();
        }
        catch (error) {
            this.error('Ошибка запуска сервера', error);
        }
    }
    inputStop() {
        if (!this.server)
            return;
        this.stopServer();
        this.shares.running = false;
        this.shares.requests = 0;
        this.render();
    }
    startServer() {
        this.server = http_1.default.createServer((req, res) => {
            this.shares.requests++;
            this.render();
            if (req.url === undefined)
                req.url = '';
            // Безопасная обработка пути
            let filePath = path_1.default.join(this.options.directory, req.url);
            // Если путь заканчивается на /, добавляем index файл
            if (filePath.endsWith('/')) {
                filePath = path_1.default.join(filePath, this.options.index);
            }
            // Проверяем, что файл находится внутри разрешенной директории
            const resolvedPath = path_1.default.resolve(filePath);
            const basePath = path_1.default.resolve(this.options.directory);
            if (!resolvedPath.startsWith(basePath)) {
                res.writeHead(403);
                res.end('Доступ запрещен');
                return;
            }
            // Читаем и отправляем файл
            fs_1.default.readFile(filePath, (err, data) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        res.writeHead(404);
                        res.end('Файл не найден');
                    }
                    else {
                        res.writeHead(500);
                        res.end('Ошибка сервера');
                    }
                    return;
                }
                // Определяем Content-Type по расширению
                const ext = path_1.default.extname(filePath).toLowerCase();
                const contentTypes = {
                    '.html': 'text/html',
                    '.css': 'text/css',
                    '.js': 'application/javascript',
                    '.json': 'application/json',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml',
                    '.ico': 'image/x-icon'
                };
                const contentType = contentTypes[ext] || 'text/plain';
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            });
        });
        this.server.listen(this.options.port, () => {
            this.notify('Сервер запущен', { port: this.options.port });
        });
        this.server.on('error', (err) => {
            this.error('Ошибка сервера', err);
        });
    }
    stopServer() {
        if (this.server) {
            this.server.close();
            this.server = null;
            this.notify('Сервер остановлен', {});
        }
    }
}
exports.default = StaticServer;
