import { createSession } from 'miraie-ac-js';
import fs from 'fs';

async function main() {
  try {
    const config = JSON.parse(fs.readFileSync('/Users/chaithanya/.homebridge/config.json', 'utf8'));
    const platform = config.platforms.find(p => p.platform === 'MirAIeAC');
    if (!platform) return;
    
    const session = await createSession({
      username: platform.username,
      password: platform.password
    });
    
    const devices = await session.getDevices();
    const device = devices[0];
    if (!device) return;

    const mqttClient = session.getMqttClient();
    const statusTopic = `${device.data.topic[0]}/status`;
    const controlTopic = `${device.data.topic[0]}/control`;

    mqttClient.on('message', (topic, message) => {
      if (topic === statusTopic) {
        console.log('--- RECEIVED STATUS PAYLOAD ---');
        console.log(message.toString());
        process.exit(0);
      }
    });

    console.log('Publishing ping to force status update...');
    const pingPayload = JSON.stringify({ ki: 1, cnt: "an", sid: "1" });
    mqttClient.publish(controlTopic, pingPayload);

    // Timeout after 15 seconds
    setTimeout(() => {
      console.log('No status received after 15 seconds.');
      process.exit(1);
    }, 15000);

  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
main();
