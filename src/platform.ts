import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { PanasonicMiraieAccessory } from './platformAccessory.js';
import { createSession, Session, FluentDevice } from 'miraie-ac-js';

export class PanasonicMiraiePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();

  public session?: Session;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices() {
    if (!this.config.username || !this.config.password) {
      this.log.error('Missing username or password in config.');
      return;
    }

    try {
      this.log.info('Connecting to MirAIe API...');
      this.session = await createSession({
        username: this.config.username,
        password: this.config.password,
      });

      await this.session.connect();
      this.log.info('Connected to MirAIe MQTT broker.');

      const devices = await this.session.getDevices();
      this.log.info(`Found ${devices.length} devices.`);

      if (devices.length === 0) {
        return;
      }

      // Subscribe to all device topics for real-time updates
      const topics = devices.map((d: FluentDevice) => `${d.data.topic[0]}/status`);
      await this.session.subscribeToTopics(topics);
      this.log.info(`Subscribed to status topics: ${topics.join(', ')}`);

      for (const device of devices) {
        const uuid = this.api.hap.uuid.generate(device.data.device_id);
        const existingAccessory = this.accessories.get(uuid);

        if (existingAccessory) {
          this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
          // pass the device object to the accessory handler
          new PanasonicMiraieAccessory(this, existingAccessory, device);
        } else {
          this.log.info('Adding new accessory:', device.getFriendlyName());
          // create a new accessory
          const accessory = new this.api.platformAccessory(device.getFriendlyName(), uuid);
          
          // store a copy of the device object in the `accessory.context`
          accessory.context.device = device.data;

          // pass the device object to the accessory handler
          new PanasonicMiraieAccessory(this, accessory, device);

          // link the accessory to your platform
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }
    } catch (err) {
      this.log.error('Failed to discover devices:', err);
    }
  }
}
