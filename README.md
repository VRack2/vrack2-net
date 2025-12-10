# VRack2 Net

Устройства для организации простых сервисов TCP/UDP

На данном этапе работает и протестированно только:
 
 - **ConverterBus** - Для работы с устройствами работающие на преобразователях типа Ethernet <-> (serial,RS485,CAN).

## Установка

Клонируем в директорию устройств (по умолчанию /opt/vrack2-service/devices)

```
cd /opt/vrack2-service/devices/
git clone https://github.com/VRack2/vrack2-net.git
```

Устанавливаем зависимости: 

```
npm install
```

## Использование

 - [ConverterBus](./docs/ConverterBus.md) - Для работы через преобразователи типа Ethernet <-> (serial,RS485,CAN).
 - [TCPObjectTransmitter](./docs/TCPObjectTransmitter.md) - Устройство для надёжной отправки объектов на удалённый `TCPObjectReceiver` через WebSocket-соединение.
 - [TCPObjectReceiver](./docs/TCPObjectReceiver.md) - Устройство  WebSocket-сервер для приёма объектов от внешних клиентов (например, `TCPObjectTransmitter`)
### Дополнительно 

 - [vrack2-modbus](https://github.com/VRack2/vrack2-modbus) - Упращенная работа с устройстами по протоколу Modbus.
 - [vrack2-other-rtu](https://github.com/VRack2/vrack2-other-rtu) - Набор разных ModbusRTU устройств
 - 
## Связанные репозитории

- [VRack2](https://github.com/VRack2/vrack2) - фреймворк для автоматизации и управления сервисами
- [VRack2-Service](https://github.com/VRack2/vrack2-service) — запуск сервисов на базе VRack2-Core.
- [VRack2-Core](https://github.com/VRack2/vrack2-core) — фреймворк для событийно-ориентированных сервисов на JavaScript/TypeScript.
- [VGranite](https://github.com/VRack2/VGranite) — сервис для организации туннелей Socket → Serial.
- [VRack2-Remote](https://github.com/VRack2/vrack2-remote) - библиотека для работы с VRack2 API
