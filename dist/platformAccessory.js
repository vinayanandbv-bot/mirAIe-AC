import { HVACMode, FanMode, PresetMode, DisplayMode, SwingMode, ConvertiMode } from 'miraie-ac-js';
export class PanasonicMiraieAccessory {
    platform;
    accessory;
    device;
    thermostatService;
    // Extra switches
    displaySwitch;
    ecoSwitch;
    powerfulSwitch;
    cleanSwitch;
    hSwingTvService;
    vSwingTvService;
    convertiService;
    mainFanService;
    // Persistent cache for rubber-banding fix and startup
    optimisticState = {};
    setOptimisticValue(key, value) {
        this.optimisticState[key] = value;
    }
    getEffectiveStatus() {
        let realStatus = this.device.getStatus();
        return { ...this.optimisticState, ...(realStatus || {}) };
    }
    constructor(platform, accessory, device) {
        this.platform = platform;
        this.accessory = accessory;
        this.device = device;
        // Set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Panasonic')
            .setCharacteristic(this.platform.Characteristic.Model, 'MirAIe AC')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, device.data.deviceId || 'Default-Serial');
        // THERMOSTAT SERVICE
        this.thermostatService = this.accessory.getService(this.platform.Service.Thermostat) ||
            this.accessory.addService(this.platform.Service.Thermostat);
        this.thermostatService.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
        this.thermostatService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
            .onGet(this.getCurrentStateSync.bind(this));
        this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .setProps({
            validValues: [
                this.platform.Characteristic.TargetHeatingCoolingState.OFF,
                this.platform.Characteristic.TargetHeatingCoolingState.COOL
            ]
        })
            .onSet(this.setTargetState.bind(this))
            .onGet(this.getTargetStateSync.bind(this));
        this.thermostatService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.getCurrentTemperatureSync.bind(this));
        this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .setProps({ minValue: 16, maxValue: 30, minStep: 1 })
            .onSet(this.setTargetTemperature.bind(this))
            .onGet(this.getTargetTemperature.bind(this));
        this.thermostatService.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
            .onGet(() => this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS);
        // MAIN FAN SERVICE
        this.mainFanService = this.createFanService('Fan Speed', 'main-fan');
        this.mainFanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 25 })
            .onSet(this.setFanSpeed.bind(this))
            .onGet(this.getFanSpeed.bind(this));
        // Remove old services
        const oldHeaterCooler = this.accessory.getService(this.platform.Service.HeaterCooler);
        if (oldHeaterCooler)
            this.accessory.removeService(oldHeaterCooler);
        const oldTempSensor = this.accessory.getService(this.platform.Service.TemperatureSensor);
        if (oldTempSensor)
            this.accessory.removeService(oldTempSensor);
        // AUXILIARY SWITCHES
        this.displaySwitch = this.createSwitch('AC Display', 'display-switch');
        this.displaySwitch.getCharacteristic(this.platform.Characteristic.On)
            .onSet(async (value) => {
            this.setOptimisticValue('acdc', value ? 'on' : 'off');
            await this.device.setDisplayMode(value ? DisplayMode.ON : DisplayMode.OFF);
        })
            .onGet(() => this.getEffectiveStatus()?.acdc === 'on');
        this.ecoSwitch = this.createSwitch('Eco Mode', 'eco-switch');
        this.ecoSwitch.getCharacteristic(this.platform.Characteristic.On)
            .onSet(async (value) => {
            this.setOptimisticValue('acec', value ? 'on' : 'off');
            await this.device.setPresetMode(value ? PresetMode.ECO : PresetMode.NONE);
        })
            .onGet(() => this.getEffectiveStatus()?.acec === 'on' || this.getEffectiveStatus()?.acem === 'on');
        this.powerfulSwitch = this.createSwitch('Powerful', 'powerful-switch');
        this.powerfulSwitch.getCharacteristic(this.platform.Characteristic.On)
            .onSet(async (value) => {
            this.setOptimisticValue('acpm', value ? 'on' : 'off');
            await this.device.setPresetMode(value ? PresetMode.BOOST : PresetMode.NONE);
        })
            .onGet(() => this.getEffectiveStatus()?.acpm === 'on');
        this.cleanSwitch = this.createSwitch('Clean', 'clean-switch');
        this.cleanSwitch.getCharacteristic(this.platform.Characteristic.On)
            .onSet(async (value) => {
            // Note: Clean mode uses 'acec' according to the enum in miraie-ac-js, but let's just track it optimistically
            this.setOptimisticValue('acec', value ? 'on' : 'off');
            await this.device.setPresetMode(value ? PresetMode.CLEAN : PresetMode.NONE);
        })
            .onGet(() => false); // Clean mode usually doesn't stay on as a persistent state in this way, or uses 'acec'
        // Remove old switches from cache if they exist
        const oldHSwing = this.accessory.getServiceById(this.platform.Service.Switch, 'hswing-switch');
        if (oldHSwing)
            this.accessory.removeService(oldHSwing);
        const oldVSwing = this.accessory.getServiceById(this.platform.Service.Switch, 'vswing-switch');
        if (oldVSwing)
            this.accessory.removeService(oldVSwing);
        const oldConvertiModes = [40, 55, 70, 80, 90, 100, 110];
        for (const mode of oldConvertiModes) {
            const oldConverti = this.accessory.getServiceById(this.platform.Service.Switch, `converti-${mode}`);
            if (oldConverti)
                this.accessory.removeService(oldConverti);
        }
        // Also try NS and OFF if they were cached
        const oldConvertiNS = this.accessory.getServiceById(this.platform.Service.Switch, `converti-1`);
        if (oldConvertiNS)
            this.accessory.removeService(oldConvertiNS);
        const oldConvertiOFF = this.accessory.getServiceById(this.platform.Service.Switch, `converti-0`);
        if (oldConvertiOFF)
            this.accessory.removeService(oldConvertiOFF);
        this.hSwingTvService = this.createSwingTV('Horizontal Swing', 'h');
        this.vSwingTvService = this.createSwingTV('Vertical Swing', 'v');
        this.convertiService = this.createFanService('Converti Mode', 'converti-fan');
        this.convertiService.getCharacteristic(this.platform.Characteristic.On)
            .onSet(async (value) => {
            if (!value) {
                this.setOptimisticValue('cnv', 0);
                await this.device.setConvertiMode(ConvertiMode.OFF);
                this.convertiService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
            }
            else {
                this.setOptimisticValue('cnv', 100);
                await this.device.setConvertiMode(ConvertiMode.FC);
                this.convertiService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 90);
            }
        })
            .onGet(() => {
            const mode = this.getEffectiveStatus()?.cnv;
            return mode != null && mode !== 0 && mode !== 1;
        });
        this.convertiService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 15 })
            .onSet(async (value) => {
            const speed = value;
            const mode = this.getConvertiModeFromSpeed(speed);
            this.setOptimisticValue('cnv', Number(mode) || 0);
            await this.device.setConvertiMode(mode);
            if (speed === 0) {
                this.convertiService.updateCharacteristic(this.platform.Characteristic.On, false);
            }
            else {
                this.convertiService.updateCharacteristic(this.platform.Characteristic.On, true);
            }
        })
            .onGet(() => {
            return this.getConvertiSpeedFromMode(this.getEffectiveStatus()?.cnv);
        });
        // Subscribe to MQTT updates if available to update HomeKit in real-time
        const mqttClient = this.platform.session?.getMqttClient();
        if (mqttClient) {
            mqttClient.on('message', (topic, message) => {
                if (topic.includes(this.device.data.topic[0])) {
                    try {
                        const raw = JSON.parse(message.toString());
                        this.platform.log.info('Intercepted MQTT Temp:', raw.rmtmp);
                        // Bypass miraie-ac-js parsing completely and inject directly into our state cache
                        Object.assign(this.optimisticState, raw);
                        this.updateHomeKitCharacteristics();
                    }
                    catch (e) {
                        this.platform.log.error('Error handling mqtt message', e);
                    }
                }
            });
        }
    }
    createSwitch(name, subtype) {
        const service = this.accessory.getServiceById(this.platform.Service.Switch, subtype)
            || this.accessory.addService(this.platform.Service.Switch, name, subtype);
        service.setCharacteristic(this.platform.Characteristic.Name, name);
        if (this.platform.Characteristic.ConfiguredName) {
            service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
        }
        return service;
    }
    createSwingTV(name, swingType) {
        const tvUuid = this.platform.api.hap.uuid.generate(this.device.data.deviceId + '-tv-' + swingType);
        const tvAccessory = new this.platform.api.platformAccessory(name, tvUuid, 31 /* this.platform.api.hap.Categories.TELEVISION */);
        const tvService = tvAccessory.addService(this.platform.Service.Television, name, 'tv');
        tvService.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
        tvService.setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode, this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
        const stateKey = swingType === 'h' ? 'achs' : 'acvs';
        tvService.getCharacteristic(this.platform.Characteristic.Active)
            .onSet(async (value) => {
            if (!value) {
                this.setOptimisticValue(stateKey, 0);
                if (swingType === 'h')
                    await this.device.setHSwingMode(SwingMode.AUTO);
                else
                    await this.device.setVSwingMode(SwingMode.AUTO);
            }
        })
            .onGet(() => this.platform.Characteristic.Active.ACTIVE);
        tvService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
            .onSet(async (value) => {
            const modeId = value;
            this.setOptimisticValue(stateKey, modeId);
            if (swingType === 'h')
                await this.device.setHSwingMode(modeId);
            else
                await this.device.setVSwingMode(modeId);
        })
            .onGet(() => {
            const mode = this.getEffectiveStatus()?.[stateKey];
            return (typeof mode === 'number' && mode >= 0 && mode <= 5) ? mode : 0;
        });
        const modes = [
            { id: 0, name: 'Auto' },
            { id: 1, name: 'Position 1' },
            { id: 2, name: 'Position 2' },
            { id: 3, name: 'Position 3' },
            { id: 4, name: 'Position 4' },
            { id: 5, name: 'Position 5' }
        ];
        for (const mode of modes) {
            const inputService = tvAccessory.addService(this.platform.Service.InputSource, mode.name, 'input' + mode.id);
            inputService.setCharacteristic(this.platform.Characteristic.Identifier, mode.id)
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, mode.name)
                .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
                .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.OTHER)
                .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, this.platform.Characteristic.CurrentVisibilityState.SHOWN);
            tvService.addLinkedService(inputService);
        }
        this.platform.api.publishExternalAccessories('homebridge-miraie-ac', [tvAccessory]);
        return tvService;
    }
    createFanService(name, subtype) {
        const service = this.accessory.getServiceById(this.platform.Service.Fanv2, subtype)
            || this.accessory.addService(this.platform.Service.Fanv2, name, subtype);
        service.setCharacteristic(this.platform.Characteristic.Name, name);
        if (this.platform.Characteristic.ConfiguredName) {
            service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
        }
        return service;
    }
    updateHomeKitCharacteristics() {
        try {
            this.thermostatService.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.getCurrentStateSync());
            this.thermostatService.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.getTargetStateSync());
            this.thermostatService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getCurrentTemperatureSync());
            this.mainFanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getFanSpeedSync());
            const status = this.getEffectiveStatus();
            if (status) {
                this.displaySwitch.updateCharacteristic(this.platform.Characteristic.On, status.acdc === 'on');
                this.ecoSwitch.updateCharacteristic(this.platform.Characteristic.On, status.acec === 'on' || status.acem === 'on');
                this.powerfulSwitch.updateCharacteristic(this.platform.Characteristic.On, status.acpm === 'on');
                let hMode = parseInt(status.achs) || 0;
                if (hMode < 0 || hMode > 5)
                    hMode = 0;
                this.hSwingTvService?.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, hMode);
                let vMode = parseInt(status.acvs) || 0;
                if (vMode < 0 || vMode > 5)
                    vMode = 0;
                this.vSwingTvService?.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, vMode);
                const convertiSpeed = this.getConvertiSpeedFromMode(status.cnv);
                this.convertiService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, convertiSpeed);
                this.convertiService.updateCharacteristic(this.platform.Characteristic.On, convertiSpeed > 0);
            }
        }
        catch (error) {
            this.platform.log.debug('Failed to update characteristics', error);
        }
    }
    getCurrentStateSync() {
        const status = this.getEffectiveStatus();
        if (!status || status.ps === 'off') {
            return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
        }
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    }
    getTargetStateSync() {
        const status = this.getEffectiveStatus();
        if (!status || status.ps === 'off') {
            return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
        }
        return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
    }
    getCurrentTemperatureSync() {
        const status = this.getEffectiveStatus();
        // Use rmtmp which is the actual room temperature in MirAIe payload!
        const temp = parseFloat(status?.rmtmp) || parseFloat(status?.actmp) || 24;
        this.platform.log.info(`[DEBUG] getCurrentTemperatureSync: rmtmp=${status?.rmtmp}, actmp=${status?.actmp}, returning=${temp}`);
        return temp;
    }
    getFanSpeedSync() {
        const status = this.getEffectiveStatus();
        if (!status)
            return 0;
        switch (status.acfs) {
            case 'quiet': return 25;
            case 'low': return 50;
            case 'medium': return 75;
            case 'high': return 100;
            case 'auto':
            default: return 0;
        }
    }
    // Characteristic Handlers
    async setTargetState(value) {
        const isOn = value !== this.platform.Characteristic.TargetHeatingCoolingState.OFF;
        this.setOptimisticValue('ps', isOn ? 'on' : 'off');
        if (isOn) {
            await this.device.turnOn();
            this.setOptimisticValue('acmd', 'cool');
            await this.device.setHvacMode(HVACMode.COOL);
        }
        else {
            await this.device.turnOff();
        }
    }
    async getCurrentState() {
        return this.getCurrentStateSync();
    }
    async getCurrentTemperature() {
        return this.getCurrentTemperatureSync();
    }
    async setTargetTemperature(value) {
        const temp = value;
        this.setOptimisticValue('actmp', String(temp));
        await this.device.setTemperature(temp);
    }
    async getTargetTemperature() {
        const status = this.getEffectiveStatus();
        return parseFloat(status?.actmp) || 24;
    }
    async setFanSpeed(value) {
        const speed = value;
        let mode = FanMode.AUTO;
        let modeStr = 'auto';
        if (speed > 0 && speed <= 25) {
            mode = FanMode.QUIET;
            modeStr = 'quiet';
        }
        else if (speed > 25 && speed <= 50) {
            mode = FanMode.LOW;
            modeStr = 'low';
        }
        else if (speed > 50 && speed <= 75) {
            mode = FanMode.MEDIUM;
            modeStr = 'medium';
        }
        else if (speed > 75) {
            mode = FanMode.HIGH;
            modeStr = 'high';
        }
        this.setOptimisticValue('acfs', modeStr);
        await this.device.setFanMode(mode);
    }
    async getFanSpeed() {
        return this.getFanSpeedSync();
    }
    getConvertiSpeedFromMode(mode) {
        const s = String(mode);
        if (s === String(ConvertiMode.C40) || s === '40')
            return 15;
        if (s === String(ConvertiMode.C55) || s === '55')
            return 30;
        if (s === String(ConvertiMode.C70) || s === '70')
            return 45;
        if (s === String(ConvertiMode.C80) || s === '80')
            return 60;
        if (s === String(ConvertiMode.C90) || s === '90')
            return 75;
        if (s === String(ConvertiMode.FC) || s === '100')
            return 90;
        if (s === String(ConvertiMode.HC) || s === '110')
            return 100;
        return 0;
    }
    getConvertiModeFromSpeed(speed) {
        if (speed === 0)
            return ConvertiMode.OFF;
        if (speed <= 15)
            return ConvertiMode.C40;
        if (speed <= 30)
            return ConvertiMode.C55;
        if (speed <= 45)
            return ConvertiMode.C70;
        if (speed <= 60)
            return ConvertiMode.C80;
        if (speed <= 75)
            return ConvertiMode.C90;
        if (speed <= 90)
            return ConvertiMode.FC;
        return ConvertiMode.HC;
    }
}
