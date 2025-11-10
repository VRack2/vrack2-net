# VRack2 Net

Устройства для организации простых сервисов TCP/UDP

На данном этапе работает и протестированно только:
 
 - **ConverterClient** - Для работы с устройствами работающие на преобразователях типа Ethernet <-> (serial,RS485,CAN).

## Установка

Клонируем в директорию устройств (по умолчанию /opt/vrack2-service/devices)

```
cd /opt/vrack2-service/devices/
git clone https://github.com/VRack2/vrack2-net.git
```

## Использование

 - [ConverterClient](./docs/ConverterClient.md) - Для работы через преобразователи типа Ethernet <-> (serial,RS485,CAN).

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
