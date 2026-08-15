import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { PanasonicMiraiePlatform } from './platform.js';
import { 
  FluentDevice, HVACMode, PowerMode, FanMode, PresetMode, 
  DisplayMode, SwingMode, ConvertiMode 
} from 'miraie-ac-js';

export class PanasonicMiraieAccessory {
  private thermostatService: Service;
  
  // Extra switches
  private displaySwitch: Service;
  private ecoSwitch: Service;
  private powerfulSwitch: Service;
  private cleanSwitch: Service;
  private fanModeSwitch: Service;
  private hSwingService: Service;
  private vSwingService: Service;
  private convertiService: Service;
  private mainFanService: Service;

  // Persistent cache for rubber-banding fix and startup
  private optimisticState: Record<string, any> = {};

  private setOptimisticValue(key: string, value: any) {
    this.optimisticState[key] = value;
  }

  private getEffectiveStatus() {
    let realStatus = this.device.getStatus();
    return { ...this.optimisticState, ...(realStatus || {}) };
  }

  constructor(
    private readonly platform: PanasonicMiraiePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: FluentDevice,
  ) {
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
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
          this.platform.Characteristic.TargetHeatingCoolingState.COOL,
          this.platform.Characteristic.TargetHeatingCoolingState.HEAT,
          this.platform.Characteristic.TargetHeatingCoolingState.AUTO,
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
    if (oldHeaterCooler) this.accessory.removeService(oldHeaterCooler);
    const oldTempSensor = this.accessory.getService(this.platform.Service.TemperatureSensor);
    if (oldTempSensor) this.accessory.removeService(oldTempSensor);

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
        if (value) {
          this.setOptimisticValue('acpm', 'off');
          this.powerfulSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
        }
        await this.device.setPresetMode(value ? PresetMode.ECO : PresetMode.NONE); 
      })
      .onGet(() => this.getEffectiveStatus()?.acec === 'on' || this.getEffectiveStatus()?.acem === 'on');

    this.cleanSwitch = this.createSwitch('Clean', 'clean-switch');
    this.cleanSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => {
        this.setOptimisticValue('acec', value ? 'on' : 'off');
        await this.device.setPresetMode(value ? PresetMode.CLEAN : PresetMode.NONE);
      })
      .onGet(() => false); // Clean usually doesn't stick

    this.fanModeSwitch = this.createSwitch('Fan Only Mode', 'fan-only-mode');
    this.fanModeSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => {
        const displayShouldBeOn = this.displaySwitch.getCharacteristic(this.platform.Characteristic.On).value as boolean;
        if (value) {
           this.setOptimisticValue('ps', 'on');
           this.setOptimisticValue('acmd', 'fan');
           await this.device.turnOn();
           this.enforceDisplayState(displayShouldBeOn);
           await this.device.setHvacMode(HVACMode.FAN);
        } else {
           const dialState = this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).value;
           if (dialState === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
             this.setOptimisticValue('acmd', 'dry');
             await this.device.setHvacMode(HVACMode.DRY);
           } else if (dialState === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
             this.setOptimisticValue('acmd', 'auto');
             await this.device.setHvacMode(HVACMode.AUTO);
           } else {
             this.setOptimisticValue('acmd', 'cool');
             await this.device.setHvacMode(HVACMode.COOL);
           }
        }
      })
      .onGet(() => this.getEffectiveStatus()?.acmd === 'fan');

    const oldDryMode = this.accessory.getServiceById(this.platform.Service.Switch, 'dry-mode');
    if (oldDryMode) this.accessory.removeService(oldDryMode);

    this.powerfulSwitch = this.createSwitch('Powerful', 'powerful-switch');
    this.powerfulSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => { 
        this.setOptimisticValue('acpm', value ? 'on' : 'off');
        if (value) {
          this.setOptimisticValue('acec', 'off');
          this.ecoSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
        }
        await this.device.setPresetMode(value ? PresetMode.BOOST : PresetMode.NONE); 
      })
      .onGet(() => this.getEffectiveStatus()?.acpm === 'on');

    // Remove old switches from cache if they exist
    const oldHSwing = this.accessory.getServiceById(this.platform.Service.Switch, 'hswing-switch');
    if (oldHSwing) this.accessory.removeService(oldHSwing);

    const oldVSwing = this.accessory.getServiceById(this.platform.Service.Switch, 'vswing-switch');
    if (oldVSwing) this.accessory.removeService(oldVSwing);

    const oldConvertiModes = [40, 55, 70, 80, 90, 100, 110];
    for (const mode of oldConvertiModes) {
      const oldConverti = this.accessory.getServiceById(this.platform.Service.Switch, `converti-${mode}`);
      if (oldConverti) this.accessory.removeService(oldConverti);
    }
    // Also try NS and OFF if they were cached
    const oldConvertiNS = this.accessory.getServiceById(this.platform.Service.Switch, `converti-1`);
    if (oldConvertiNS) this.accessory.removeService(oldConvertiNS);
    const oldConvertiOFF = this.accessory.getServiceById(this.platform.Service.Switch, `converti-0`);
    if (oldConvertiOFF) this.accessory.removeService(oldConvertiOFF);
    
    // Ghost Cleanup: Remove the TV hack services that corrupted the UI
    const ghostHTv = this.accessory.getServiceById(this.platform.Service.Television, 'tv-h');
    if (ghostHTv) this.accessory.removeService(ghostHTv);
    
    const ghostVTv = this.accessory.getServiceById(this.platform.Service.Television, 'tv-v');
    if (ghostVTv) this.accessory.removeService(ghostVTv);

    this.hSwingService = this.createFanService('Horizontal Swing', 'hswing-fan');
    this.hSwingService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => {
        if (!value) {
          this.setOptimisticValue('achs', 0);
          await this.device.setHSwingMode(SwingMode.AUTO);
          this.hSwingService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
        }
      })
      .onGet(() => true);

    this.hSwingService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 20 })
      .onSet(async (value) => {
        const speed = value as number;
        const mode = this.getSwingModeFromSpeed(speed);
        const modeStr = mode === SwingMode.AUTO ? 0 : mode;
        this.setOptimisticValue('achs', modeStr);
        await this.device.setHSwingMode(mode);
      })
      .onGet(() => {
        return this.getSwingSpeedFromMode(this.getEffectiveStatus()?.achs);
      });


    this.vSwingService = this.createFanService('Vertical Swing', 'vswing-fan');
    this.vSwingService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => {
        if (!value) {
          this.setOptimisticValue('acvs', 0);
          await this.device.setVSwingMode(SwingMode.AUTO);
          this.vSwingService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
        }
      })
      .onGet(() => true);

    this.vSwingService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 20 })
      .onSet(async (value) => {
        const speed = value as number;
        const mode = this.getSwingModeFromSpeed(speed);
        const modeStr = mode === SwingMode.AUTO ? 0 : mode;
        this.setOptimisticValue('acvs', modeStr);
        await this.device.setVSwingMode(mode);
      })
      .onGet(() => {
        return this.getSwingSpeedFromMode(this.getEffectiveStatus()?.acvs);
      });


    this.convertiService = this.createFanService('Converti Mode', 'converti-fan');
    this.convertiService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => {
        if (!value) {
          this.setOptimisticValue('cnv', 0);
          await this.device.setConvertiMode(ConvertiMode.OFF);
          this.convertiService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
        } else {
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
        const speed = value as number;
        const mode = this.getConvertiModeFromSpeed(speed);
        this.setOptimisticValue('cnv', Number(mode) || 0);
        await this.device.setConvertiMode(mode);
        if (speed === 0) {
          this.convertiService.updateCharacteristic(this.platform.Characteristic.On, false);
        } else {
          this.convertiService.updateCharacteristic(this.platform.Characteristic.On, true);
        }
      })
      .onGet(() => {
        return this.getConvertiSpeedFromMode(this.getEffectiveStatus()?.cnv);
      });

    // Subscribe to MQTT updates if available to update HomeKit in real-time
    const mqttClient = this.platform.session?.getMqttClient();
    if (mqttClient) {
      mqttClient.on('message', (topic: string, message: Buffer) => {
        if (topic.includes(this.device.data.topic[0])) {
          try {
            const raw = JSON.parse(message.toString());
            this.platform.log.info('Intercepted MQTT Temp:', raw.rmtmp);
            // Bypass miraie-ac-js parsing completely and inject directly into our state cache
            Object.assign(this.optimisticState, raw);
            this.updateHomeKitCharacteristics();
          } catch (e) {
            this.platform.log.error('Error handling mqtt message', e);
          }
        }
      });
    }
  }

  private createSwitch(name: string, subtype: string): Service {
    const service = this.accessory.getServiceById(this.platform.Service.Switch, subtype) 
      || this.accessory.addService(this.platform.Service.Switch, name, subtype);
    service.setCharacteristic(this.platform.Characteristic.Name, name);
    if (this.platform.Characteristic.ConfiguredName) {
      service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
    }
    return service;
  }

  private createFanService(name: string, subtype: string): Service {
    const service = this.accessory.getServiceById(this.platform.Service.Fanv2, subtype) 
      || this.accessory.addService(this.platform.Service.Fanv2, name, subtype);
    service.setCharacteristic(this.platform.Characteristic.Name, name);
    if (this.platform.Characteristic.ConfiguredName) {
      service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
    }
    return service;
  }

  private updateHomeKitCharacteristics() {
    try {
      this.thermostatService.updateCharacteristic(
        this.platform.Characteristic.CurrentHeatingCoolingState, this.getCurrentStateSync()
      );
      this.thermostatService.updateCharacteristic(
        this.platform.Characteristic.TargetHeatingCoolingState, this.getTargetStateSync()
      );
      this.thermostatService.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature, this.getCurrentTemperatureSync()
      );
      this.mainFanService.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed, this.getFanSpeedSync()
      );
      
      const status = this.getEffectiveStatus();
      if (status) {
        this.displaySwitch.updateCharacteristic(this.platform.Characteristic.On, status.acdc === 'on');
        this.ecoSwitch.updateCharacteristic(this.platform.Characteristic.On, status.acec === 'on' || status.acem === 'on');
        this.powerfulSwitch.updateCharacteristic(this.platform.Characteristic.On, status.acpm === 'on');
        
        this.fanModeSwitch.updateCharacteristic(this.platform.Characteristic.On, status.acmd === 'fan');

        // clean mode usually sets acec to on
        this.hSwingService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getSwingSpeedFromMode(status.achs));
        this.vSwingService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getSwingSpeedFromMode(status.acvs));
        
        const convertiSpeed = this.getConvertiSpeedFromMode(status.cnv);
        this.convertiService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, convertiSpeed);
        this.convertiService.updateCharacteristic(this.platform.Characteristic.On, convertiSpeed > 0);
      }
    } catch (error) {
      this.platform.log.debug('Failed to update characteristics', error);
    }
  }

  private getCurrentStateSync(): CharacteristicValue {
    const status = this.getEffectiveStatus();
    if (!status || status.ps === 'off') {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
    return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
  }

  private getTargetStateSync(): CharacteristicValue {
    const status = this.getEffectiveStatus();
    if (!status || status.ps === 'off') {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }
    if (status.acmd === 'auto') {
      return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    }
    if (status.acmd === 'dry') {
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    }
    if (status.acmd === 'fan') {
      // Fan mode forces the dial to stay on its last known state visually
      return this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).value || this.platform.Characteristic.TargetHeatingCoolingState.COOL;
    }
    return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
  }

  private getCurrentTemperatureSync(): CharacteristicValue {
    const status = this.getEffectiveStatus();
    // Use rmtmp which is the actual room temperature in MirAIe payload!
    const temp = parseFloat(status?.rmtmp) || parseFloat(status?.actmp) || 24;
    this.platform.log.info(`[DEBUG] getCurrentTemperatureSync: rmtmp=${status?.rmtmp}, actmp=${status?.actmp}, returning=${temp}`);
    return temp;
  }

  private getFanSpeedSync(): CharacteristicValue {
    const status = this.getEffectiveStatus();
    if (!status) return 0;
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
  async setTargetState(value: CharacteristicValue) {
    const isOn = value !== this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    this.setOptimisticValue('ps', isOn ? 'on' : 'off');
    
    // CAPTURE display state BEFORE the AC boots and sends poisoned MQTT payloads!
    const displayShouldBeOn = this.displaySwitch.getCharacteristic(this.platform.Characteristic.On).value as boolean;
    
    if (isOn) {
      await this.device.turnOn();
      this.enforceDisplayState(displayShouldBeOn);
      if (value === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
        this.setOptimisticValue('acmd', 'auto');
        await this.device.setHvacMode(HVACMode.AUTO);
      } else if (value === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
        this.setOptimisticValue('acmd', 'dry');
        await this.device.setHvacMode(HVACMode.DRY);
      } else {
        this.setOptimisticValue('acmd', 'cool');
        await this.device.setHvacMode(HVACMode.COOL);
      }
      // Any dial mode change explicitly breaks fan mode
      this.fanModeSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
    } else {
      await this.device.turnOff();
      this.enforceDisplayState(displayShouldBeOn);
    }
  }

  private async enforceDisplayState(displayShouldBeOn: boolean) {
    // Wait 1.5 seconds to let the physical AC finish its power-on/off beep and firmware routine
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    this.platform.log.info(`[DEBUG] enforceDisplayState fired. displayShouldBeOn=${displayShouldBeOn}`);
    
    // Force the AC to obey the user's display toggle
    try {
      await this.device.setDisplayMode(displayShouldBeOn ? DisplayMode.ON : DisplayMode.OFF);
      
      // Ensure the UI switch is forced back to what it should be (in case MQTT corrupted it during boot)
      this.displaySwitch.updateCharacteristic(this.platform.Characteristic.On, displayShouldBeOn);
      this.platform.log.info(`[DEBUG] enforceDisplayState successfully sent ${displayShouldBeOn ? 'ON' : 'OFF'}`);
    } catch (err) {
      this.platform.log.debug('Failed to enforce display state', err);
    }
  }

  async getCurrentState(): Promise<CharacteristicValue> {
    return this.getCurrentStateSync();
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    return this.getCurrentTemperatureSync();
  }

  async setTargetTemperature(value: CharacteristicValue) {
    const temp = value as number;
    this.setOptimisticValue('actmp', String(temp));
    await this.device.setTemperature(temp);
    
    // Changing temperature breaks Fan mode and restores dial mode
    if (this.getEffectiveStatus()?.acmd === 'fan') {
      const dialState = this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).value;
      if (dialState === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
        this.setOptimisticValue('acmd', 'dry');
        await this.device.setHvacMode(HVACMode.DRY);
      } else if (dialState === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
        this.setOptimisticValue('acmd', 'auto');
        await this.device.setHvacMode(HVACMode.AUTO);
      } else {
        this.setOptimisticValue('acmd', 'cool');
        await this.device.setHvacMode(HVACMode.COOL);
      }
      this.fanModeSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
    }
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    const status = this.getEffectiveStatus();
    return parseFloat(status?.actmp) || 24;
  }

  async setFanSpeed(value: CharacteristicValue) {
    const speed = value as number;
    let mode = FanMode.AUTO;
    let modeStr = 'auto';
    
    if (speed > 0 && speed <= 25) { mode = FanMode.QUIET; modeStr = 'quiet'; }
    else if (speed > 25 && speed <= 50) { mode = FanMode.LOW; modeStr = 'low'; }
    else if (speed > 50 && speed <= 75) { mode = FanMode.MEDIUM; modeStr = 'medium'; }
    else if (speed > 75) { mode = FanMode.HIGH; modeStr = 'high'; }
    
    this.setOptimisticValue('acfs', modeStr);
    await this.device.setFanMode(mode);
  }

  async getFanSpeed(): Promise<CharacteristicValue> {
    return this.getFanSpeedSync();
  }

  private getConvertiSpeedFromMode(mode: any): number {
    const s = String(mode);
    if (s === String(ConvertiMode.C40) || s === '40') return 15;
    if (s === String(ConvertiMode.C55) || s === '55') return 30;
    if (s === String(ConvertiMode.C70) || s === '70') return 45;
    if (s === String(ConvertiMode.C80) || s === '80') return 60;
    if (s === String(ConvertiMode.C90) || s === '90') return 75;
    if (s === String(ConvertiMode.FC) || s === '100') return 90;
    if (s === String(ConvertiMode.HC) || s === '110') return 100;
    return 0;
  }

  private getConvertiModeFromSpeed(speed: number): ConvertiMode {
    if (speed === 0) return ConvertiMode.OFF;
    if (speed <= 15) return ConvertiMode.C40;
    if (speed <= 30) return ConvertiMode.C55;
    if (speed <= 45) return ConvertiMode.C70;
    if (speed <= 60) return ConvertiMode.C80;
    if (speed <= 75) return ConvertiMode.C90;
    if (speed <= 90) return ConvertiMode.FC;
    return ConvertiMode.HC;
  }

  private getSwingSpeedFromMode(mode: any): number {
    const s = String(mode);
    if (s === '1' || s === String(SwingMode.ONE)) return 20;
    if (s === '2' || s === String(SwingMode.TWO)) return 40;
    if (s === '3' || s === String(SwingMode.THREE)) return 60;
    if (s === '4' || s === String(SwingMode.FOUR)) return 80;
    if (s === '5' || s === String(SwingMode.FIVE)) return 100;
    return 0; // Auto
  }

  private getSwingModeFromSpeed(speed: number): SwingMode {
    if (speed === 0) return SwingMode.AUTO;
    if (speed <= 20) return SwingMode.ONE;
    if (speed <= 40) return SwingMode.TWO;
    if (speed <= 60) return SwingMode.THREE;
    if (speed <= 80) return SwingMode.FOUR;
    return SwingMode.FIVE;
  }
}
