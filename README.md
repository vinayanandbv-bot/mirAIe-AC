# homebridge-miraie-ac

A highly customized, fully featured Homebridge plugin for Panasonic MirAIe Air Conditioners.

This plugin seamlessly exposes your MirAIe ACs to Apple HomeKit while forcefully bypassing Apple's restrictive UI limitations. It correctly implements explicit HVAC modes, strict fan override logic, and precise 1-5 swing mappings without resorting to broken "External Television" accessories.

## 🌡 Thermostat Controls

The main AC tile natively integrates with Apple's Thermostat UI. The modes are explicitly mapped to bypass HomeKit limitations:

- **Cool (Blue)**: Activates standard Cool mode.
- **Heat (Orange)**: Activates **Dry Mode** (Dehumidifier). *Due to Apple UI restrictions, HomeKit will say "Heating to X°" when you use Dry mode.*
- **Auto (Green)**: Activates Auto mode.
- **Off (Gray)**: Turns the AC off.

## ⚙️ Advanced Settings & Toggles

If you open the AC settings in the Apple Home app, you will see a variety of toggles and sliders. Here is exactly how they interact:

### 1. Fan Only Mode (Switch)
- **Activating**: Turning this ON will instantly force the AC into Fan mode. The Thermostat dial's color/mode will **freeze** on its last known state (e.g., if it was on Cool, it stays Blue) so it remembers your previous mode.
- **Deactivating via Toggle**: If you turn this OFF manually, the AC will instantly snap back to whatever mode the Thermostat dial is currently displaying.
- **Deactivating via Dial (Override)**: If Fan mode is ON and you touch the Thermostat dial (either changing the temp or mode), the Fan mode toggle will instantly break and turn OFF, and the AC will assume the new dial mode.

### 2. Powerful & Eco Modes (Switches)
- **Powerful**: Forces the AC into Boost/Powerful mode.
- **Eco Mode**: Forces the AC into Eco preset mode.
- **Mutual Exclusivity**: These two modes enforce strict exclusivity. Turning **Powerful** ON will instantly flip **Eco** OFF in the UI (and vice versa), ensuring your Apple Home switches perfectly mirror the physical rules of the AC without any confusing "lag".

### 3. Display & Clean (Switches)
- **AC Display**: Toggles the physical LED display on the front of the AC unit.
- **Clean**: Activates the AC's self-cleaning preset mode.

### 4. Swing Controls (Sliders)
Apple HomeKit forces custom modes to be mapped to 0-100% fan sliders. The plugin intelligently snaps the percentages to the exact physical modes of your Panasonic unit:

**Horizontal & Vertical Swing**
- **0%**: Auto (Continuous Sweeping)
- **20%**: Position 1 (Vertical: Highest Angle / Horizontal: Far Left)
- **40%**: Position 2
- **60%**: Position 3 (Center)
- **80%**: Position 4
- **100%**: Position 5 (Vertical: Lowest Angle / Horizontal: Far Right)

**Converti Mode (Tonnage Limit)**
- **0%**: Off
- **15%**: 40% Capacity
- **30%**: 55% Capacity
- **45%**: 70% Capacity
- **60%**: 80% Capacity
- **75%**: 90% Capacity
- **90%**: 100% Capacity (Full Capacity)
- **100%**: 110% Capacity (High Capacity)

## 📡 Docker / Network Compatibility
Unlike standard "TV Hacks", this plugin embeds all advanced controls directly into the primary AC Accessory. This completely bypasses dynamic external port bindings, making it 100% compatible with Docker, HOOBS, and strict firewall environments.
