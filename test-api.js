import { createSession } from 'miraie-ac-js';
import fs from 'fs';

async function main() {
  const config = JSON.parse(fs.readFileSync('/Users/chaithanya/.gemini/antigravity-ide/scratch/hb-test/config.json', 'utf8'));
  const platform = config.platforms[0];
  
  const session = await createSession({
    username: platform.username,
    password: platform.password
  });
  const devices = await session.getDevices();
  console.log(JSON.stringify(devices.map(d => d.data), null, 2));
  process.exit(0);
}
main().catch(console.error);
