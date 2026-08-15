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
  private hSwingSwitch: Service;
  private vSwingSwitch: Service;

  // Converti7 switches
  private convertiSwitches: Map<ConvertiMode, Service> = new Map();

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

    this.hSwingSwitch = this.createSwitch('Horizontal Swing', 'hswing-switch');
    this.hSwingSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => { 
        this.updateCache('h_swing', value ? 'auto' : '1');
        await this.device.setHSwingMode(value ? SwingMode.AUTO : SwingMode.ONE); 
      })
      .onGet(() => this.device.getStatus()?.h_swing === 'auto');

    this.vSwingSwitch = this.createSwitch('Vertical Swing', 'vswing-switch');
    this.vSwingSwitch.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => { 
        this.updateCache('v_swing', value ? 'auto' : '1');
        await this.device.setVSwingMode(value ? SwingMode.AUTO : SwingMode.ONE); 
      })
      .onGet(() => this.device.getStatus()?.v_swing === 'auto');

    // CONVERTI7 SWITCHES (40%, 55%, 70%, 80%, 90%, 100%, 110%)
    const convertiModes = [
      { name: 'Converti 40%', mode: ConvertiMode.C40 },
      { name: 'Converti 55%', mode: ConvertiMode.C55 },
      { name: 'Converti 70%', mode: ConvertiMode.C70 },
      { name: 'Converti 80%', mode: ConvertiMode.C80 },
      { name: 'Converti 90%', mode: ConvertiMode.C90 },
      { name: 'Converti 100%', mode: ConvertiMode.FC },
      { name: 'Converti 110%', mode: ConvertiMode.HC },
    ];

    for (const cm of convertiModes) {
      const sw = this.createSwitch(cm.name, `converti-${cm.mode}`);
      sw.getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value) => { 
          // Optimistically update cache
          this.updateCache('converti_mode', value ? cm.mode : ConvertiMode.OFF);
          
          // If turning on, set this mode. If turning off, set to OFF/NS
          await this.device.setConvertiMode(value ? cm.mode : ConvertiMode.OFF);
          
          // Turn off other converti switches in HomeKit UI
          if (value) {
            for (const otherCm of convertiModes) {
              if (otherCm.mode !== cm.mode) {
                this.convertiSwitches.get(otherCm.mode)?.updateCharacteristic(this.platform.Characteristic.On, false);
              }
            }
          }
        })
        .onGet(() => {
          // We have to guess the status format. Assuming the API uses string values like '40', '55' or similar.
          // Fallback to false if unsupported.
          const currentConverti = this.device.getStatus()?.converti_mode;
          if (currentConverti == null) return false;
          // In some libraries, it returns string "40" or number 40.
          return String(currentConverti) === String(cm.mode) || String(currentConverti) === cm.mode.toString();
        });
      this.convertiSwitches.set(cm.mode, sw);
    }

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
        this.hSwingSwitch.updateCharacteristic(this.platform.Characteristic.On, status.h_swing === 'auto');
        this.vSwingSwitch.updateCharacteristic(this.platform.Characteristic.On, status.v_swing === 'auto');
        
        for (const [mode, sw] of this.convertiSwitches.entries()) {
          sw.updateCharacteristic(this.platform.Characteristic.On, String(status.converti_mode) === String(mode));
        }
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
}
