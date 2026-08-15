import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { PanasonicMiraiePlatform } from './platform.js';
import { 
  FluentDevice, HVACMode, PowerMode, FanMode, PresetMode, 
  DisplayMode, SwingMode, ConvertiMode 
} from 'miraie-ac-js';

export class PanasonicMiraieAccessory {
  private heaterCoolerService: Service;
  
  // Extra switches
  private displaySwitch: Service;
  private ecoSwitch: Service;
  private powerfulSwitch: Service;
  private cleanSwitch: Service;
  private hSwingService: Service;
  private vSwingService: Service;
  private convertiService: Service;

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

    // HEATER COOLER SERVICE
    this.heaterCoolerService = this.accessory.getService(this.platform.Service.HeaterCooler) || 
      this.accessory.addService(this.platform.Service.HeaterCooler);
    this.heaterCoolerService.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    this.heaterCoolerService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.heaterCoolerService.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onSet(this.setTargetState.bind(this))
      .onGet(this.getTargetState.bind(this));

    this.heaterCoolerService.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentState.bind(this));

    this.heaterCoolerService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.heaterCoolerService.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 30, minStep: 1 })
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(this.getTargetTemperature.bind(this));

    this.heaterCoolerService.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 30, minStep: 1 })
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(this.getTargetTemperature.bind(this));

    this.heaterCoolerService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 25 })
      .onSet(this.setFanSpeed.bind(this))
      .onGet(this.getFanSpeed.bind(this));

    // AUXILIARY SWITCHES
    this.displaySwitch = this.createSwitch('AC Display', 'display-switch');
    this.displaySwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => { 
        this.updateCache('display', value ? 'on' : 'off');
        await this.device.setDisplayMode(value ? DisplayMode.ON : DisplayMode.OFF); 
      })
      .onGet(() => this.device.getStatus()?.display === 'on');

    this.ecoSwitch = this.createSwitch('Eco Mode', 'eco-switch');
    this.ecoSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => { 
        this.updateCache('preset_mode', value ? 'eco' : 'off');
        await this.device.setPresetMode(value ? PresetMode.ECO : PresetMode.NONE); 
      })
      .onGet(() => this.device.getStatus()?.preset_mode === 'eco');

    this.powerfulSwitch = this.createSwitch('Powerful', 'powerful-switch');
    this.powerfulSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => { 
        this.updateCache('preset_mode', value ? 'boost' : 'off');
        await this.device.setPresetMode(value ? PresetMode.BOOST : PresetMode.NONE); 
      })
      .onGet(() => this.device.getStatus()?.preset_mode === 'boost');

    this.cleanSwitch = this.createSwitch('Clean', 'clean-switch');
    this.cleanSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => { 
        this.updateCache('preset_mode', value ? 'clean' : 'off');
        await this.device.setPresetMode(value ? PresetMode.CLEAN : PresetMode.NONE); 
      })
      .onGet(() => this.device.getStatus()?.preset_mode === 'clean');

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

    this.hSwingService = this.createFanService('Horizontal Swing', 'hswing-fan');
    this.hSwingService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => {
        // If turning off, we can't really turn off swing, but maybe set to Auto or Position 3
        // Since we mapped 0% to Auto, turning off the fan could mean 'Auto' or we just ignore On/Off.
        // Let's just set to Auto if OFF
        const mode = value ? SwingMode.AUTO : SwingMode.AUTO; // Just fallback
        // wait, let's just ignore the On state and rely on RotationSpeed for actual state changes.
        // Or if On is true, we keep current speed, if false we set to Auto.
        if (!value) {
          this.updateCache('h_swing', 'auto');
          await this.device.setHSwingMode(SwingMode.AUTO);
          this.hSwingService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
        }
      })
      .onGet(() => {
        const mode = this.device.getStatus()?.h_swing;
        // The fan is 'On' if it's not auto, or maybe just always On so the slider is visible
        return true; 
      });

    this.hSwingService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 20 })
      .onSet(async (value) => {
        const speed = value as number;
        const mode = this.getSwingModeFromSpeed(speed);
        const modeStr = mode === SwingMode.AUTO ? 'auto' : String(mode);
        this.updateCache('h_swing', modeStr);
        await this.device.setHSwingMode(mode);
      })
      .onGet(() => {
        return this.getSwingSpeedFromMode(this.device.getStatus()?.h_swing);
      });


    this.vSwingService = this.createFanService('Vertical Swing', 'vswing-fan');
    this.vSwingService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => {
        if (!value) {
          this.updateCache('v_swing', 'auto');
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
        const modeStr = mode === SwingMode.AUTO ? 'auto' : String(mode);
        this.updateCache('v_swing', modeStr);
        await this.device.setVSwingMode(mode);
      })
      .onGet(() => {
        return this.getSwingSpeedFromMode(this.device.getStatus()?.v_swing);
      });


    this.convertiService = this.createFanService('Converti Mode', 'converti-fan');
    this.convertiService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => {
        if (!value) {
          this.updateCache('converti_mode', ConvertiMode.OFF);
          await this.device.setConvertiMode(ConvertiMode.OFF);
          this.convertiService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
        } else {
          // If turned ON without slider, default to 100% (FC)
          this.updateCache('converti_mode', ConvertiMode.FC);
          await this.device.setConvertiMode(ConvertiMode.FC);
          this.convertiService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 90);
        }
      })
      .onGet(() => {
        const mode = this.device.getStatus()?.converti_mode;
        return mode != null && mode !== ConvertiMode.OFF && mode !== ConvertiMode.NS && mode !== 0;
      });

    this.convertiService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 15 })
      .onSet(async (value) => {
        const speed = value as number;
        const mode = this.getConvertiModeFromSpeed(speed);
        this.updateCache('converti_mode', mode);
        await this.device.setConvertiMode(mode);
        if (speed === 0) {
          this.convertiService.updateCharacteristic(this.platform.Characteristic.On, false);
        } else {
          this.convertiService.updateCharacteristic(this.platform.Characteristic.On, true);
        }
      })
      .onGet(() => {
        return this.getConvertiSpeedFromMode(this.device.getStatus()?.converti_mode);
      });

    // Subscribe to MQTT updates if available to update HomeKit in real-time
    const mqttClient = this.platform.session?.getMqttClient();
    if (mqttClient) {
      mqttClient.on('message', (topic: string, message: Buffer) => {
        if (topic.includes(this.device.data.topic[0])) {
          try {
            // Usually the state is updated internally by `miraie-ac-js` but we should trigger HomeKit updates
            // We can just call get methods on characteristics to force an update.
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
    return service;
  }

  private createFanService(name: string, subtype: string): Service {
    const service = this.accessory.getServiceById(this.platform.Service.Fanv2, subtype) 
      || this.accessory.addService(this.platform.Service.Fanv2, name, subtype);
    service.setCharacteristic(this.platform.Characteristic.Name, name);
    return service;
  }

  private updateHomeKitCharacteristics() {
    // This function can be expanded to actively push updates to HomeKit
    // For now we rely on HomeKit's polling via onGet handlers which read the latest `getStatus()` cache
    // But forcing an update ensures real-time responsiveness.
    try {
      this.heaterCoolerService.updateCharacteristic(
        this.platform.Characteristic.Active, this.getActiveSync()
      );
      this.heaterCoolerService.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature, this.getCurrentTemperatureSync()
      );
      this.heaterCoolerService.updateCharacteristic(
        this.platform.Characteristic.TargetHeaterCoolerState, this.getTargetStateSync()
      );
      this.heaterCoolerService.updateCharacteristic(
        this.platform.Characteristic.CurrentHeaterCoolerState, this.getCurrentStateSync()
      );
      this.heaterCoolerService.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed, this.getFanSpeedSync()
      );
      
      const status = this.device.getStatus();
      if (status) {
        this.displaySwitch.updateCharacteristic(this.platform.Characteristic.On, status.display === 'on');
        this.ecoSwitch.updateCharacteristic(this.platform.Characteristic.On, status.preset_mode === 'eco');
        this.powerfulSwitch.updateCharacteristic(this.platform.Characteristic.On, status.preset_mode === 'boost');
        this.cleanSwitch.updateCharacteristic(this.platform.Characteristic.On, status.preset_mode === 'clean');
        this.hSwingService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getSwingSpeedFromMode(status.h_swing));
        this.vSwingService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getSwingSpeedFromMode(status.v_swing));
        
        const convertiSpeed = this.getConvertiSpeedFromMode(status.converti_mode);
        this.convertiService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, convertiSpeed);
        this.convertiService.updateCharacteristic(this.platform.Characteristic.On, convertiSpeed > 0);
      }
    } catch (error) {
      this.platform.log.debug('Failed to update characteristics', error);
    }
  }

  // Sync getters for updateHomeKitCharacteristics
  private getActiveSync(): CharacteristicValue {
    const status = this.device.getStatus();
    return status?.power === 'on' 
      ? this.platform.Characteristic.Active.ACTIVE 
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private getCurrentTemperatureSync(): CharacteristicValue {
    const status = this.device.getStatus();
    return status?.room_temperature || 24;
  }

  private getTargetStateSync(): CharacteristicValue {
    const status = this.device.getStatus();
    if (!status) return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    switch (status.mode) {
      case 'cool': return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
      case 'heat': return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
      default: return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }
  }

  private getCurrentStateSync(): CharacteristicValue {
    const status = this.device.getStatus();
    if (!status || status.power === 'off') {
      return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
    switch (status.mode) {
      case 'cool': return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
      case 'heat': return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
      case 'fan': return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
      default: return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE; // auto could be idle depending on temp
    }
  }

  private getFanSpeedSync(): CharacteristicValue {
    const status = this.device.getStatus();
    if (!status) return 0;
    switch (status.fan_speed) {
      case 'quiet': return 25;
      case 'low': return 50;
      case 'medium': return 75;
      case 'high': return 100;
      case 'auto':
      default: return 0; // Auto mapped to 0 or could just let HomeKit handle auto differently
    }
  }


  private updateCache(key: string, value: any) {
    let status = this.device.getStatus();
    if (!status) {
      status = {};
      (this.device as any).status = status;
    }
    status[key] = value;
  }

  // Characteristic Handlers
  async setActive(value: CharacteristicValue) {
    const isOn = value === this.platform.Characteristic.Active.ACTIVE;
    this.updateCache('power', isOn ? 'on' : 'off');
    
    if (isOn) {
      await this.device.turnOn();
    } else {
      await this.device.turnOff();
    }
  }

  async getActive(): Promise<CharacteristicValue> {
    return this.getActiveSync();
  }

  async setTargetState(value: CharacteristicValue) {
    let mode = HVACMode.AUTO;
    let modeStr = 'auto';
    if (value === this.platform.Characteristic.TargetHeaterCoolerState.COOL) { mode = HVACMode.COOL; modeStr = 'cool'; }
    if (value === this.platform.Characteristic.TargetHeaterCoolerState.HEAT) { mode = HVACMode.HEAT; modeStr = 'heat'; }
    
    this.updateCache('mode', modeStr);
    await this.device.setHvacMode(mode);
  }

  async getTargetState(): Promise<CharacteristicValue> {
    return this.getTargetStateSync();
  }

  async getCurrentState(): Promise<CharacteristicValue> {
    return this.getCurrentStateSync();
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    return this.getCurrentTemperatureSync();
  }

  async setTargetTemperature(value: CharacteristicValue) {
    const temp = value as number;
    this.updateCache('temperature', temp);
    await this.device.setTemperature(temp);
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    const status = this.device.getStatus();
    return status?.temperature || 24;
  }

  async setFanSpeed(value: CharacteristicValue) {
    const speed = value as number;
    let mode = FanMode.AUTO;
    let modeStr = 'auto';
    
    if (speed > 0 && speed <= 25) { mode = FanMode.QUIET; modeStr = 'quiet'; }
    else if (speed > 25 && speed <= 50) { mode = FanMode.LOW; modeStr = 'low'; }
    else if (speed > 50 && speed <= 75) { mode = FanMode.MEDIUM; modeStr = 'medium'; }
    else if (speed > 75) { mode = FanMode.HIGH; modeStr = 'high'; }
    
    this.updateCache('fan_speed', modeStr);
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
