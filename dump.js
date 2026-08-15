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
    for (const d of devices) {
      console.log('--- DEVICE DATA ---');
      console.log(JSON.stringify(d.data, null, 2));
    }
    process.exit(0);
  } catch(e) {
    console.error(e);
  }
}
main();
