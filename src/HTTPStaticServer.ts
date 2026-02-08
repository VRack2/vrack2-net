import { Device, Port, Rule } from "vrack2-core";
import http from 'http';
import fs from 'fs';
import path from 'path';
import { readFileSync } from 'node:fs';

export default class StaticServer extends Device {

  private server: http.Server | null = null;

  description(): string {
    return readFileSync(path.join(path.dirname(__dirname), 'docs', 'HTTPStaticServer.md'), 'utf-8');
  }

  checkOptions() {
    return {
      port: Rule.number().integer().min(1).max(65535).default(8080).description('Порт сервера'),
      directory: Rule.string().default('./public').description('Директория со статическими файлами'),
      index: Rule.string().default('index.html').description('Файл по умолчанию'),
      runAtStart: Rule.boolean().default(true).description('Запускать сервер вместе с запуском устройства')
    }
  }

  inputs() {
    return {
      'start': Port.standart().description('Запустить сервер'),
      'stop': Port.standart().description('Остановить сервер')
    }
  }

  shares = {
    running: false,
    port: 0,
    requests: 0
  }

  process() {
    this.render();
    if (this.options.runAtStart) this.inputStart()
  }

  inputStart() {
    if (this.server) return;

    try {
      this.startServer();
      this.shares.running = true;
      this.shares.port = this.options.port;
      this.render();
    } catch (error) {
      this.error('Ошибка запуска сервера', error as Error);
    }
  }

  inputStop() {
    if (!this.server) return;
    this.stopServer();
    this.shares.running = false;
    this.shares.requests = 0;
    this.render();
  }

  startServer() {
    this.server = http.createServer((req, res) => {
      this.shares.requests++;
      this.render();
      if (req.url === undefined) req.url = ''
      // Безопасная обработка пути
      let filePath = path.join(this.options.directory, req.url);
      
      // Если путь заканчивается на /, добавляем index файл
      if (filePath.endsWith('/')) {
        filePath = path.join(filePath, this.options.index);
      }

      // Проверяем, что файл находится внутри разрешенной директории
      const resolvedPath = path.resolve(filePath);
      const basePath = path.resolve(this.options.directory);
      
      if (!resolvedPath.startsWith(basePath)) {
        res.writeHead(403);
        res.end('Доступ запрещен');
        return;
      }

      // Читаем и отправляем файл
      fs.readFile(filePath, (err, data) => {
        if (err) {
          if (err.code === 'ENOENT') {
            res.writeHead(404);
            res.end('Файл не найден');
          } else {
            res.writeHead(500);
            res.end('Ошибка сервера');
          }
          return;
        }

        // Определяем Content-Type по расширению
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes: Record<string, string> = {
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

    this.server.on('error', (err: Error) => {
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