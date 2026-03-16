import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const MQTT_CONFIG = `# Configure MQTT broker in .env or Config Center:
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=ownpilot          # optional
MQTT_PASSWORD=secret            # optional
MQTT_CLIENT_ID=ownpilot-server  # optional, auto-generated if omitted

# For TLS:
MQTT_BROKER_URL=mqtts://broker.example.com:8883
MQTT_CA_CERT=/certs/ca.crt`;

const MOSQUITTO_DOCKER = `# Start Mosquitto MQTT broker with Docker:
docker run -d \\
  --name mosquitto \\
  -p 1883:1883 \\
  -p 9001:9001 \\
  -v ./mosquitto.conf:/mosquitto/config/mosquitto.conf \\
  eclipse-mosquitto:latest

# mosquitto.conf:
listener 1883
allow_anonymous true`;

const REGISTER_DEVICE = `POST /api/v1/edge/devices
Content-Type: application/json

{
  "name": "Living Room Sensor",
  "type": "sensor",
  "deviceId": "esp32-livingroom-01",
  "protocol": "mqtt",
  "topicPrefix": "home/livingroom",
  "capabilities": ["temperature", "humidity", "motion"],
  "metadata": {
    "location": "Living Room",
    "firmware": "1.2.0"
  }
}`;

const DEVICE_TYPES = `# Supported device types:
# sensor     — Read-only data source (temperature, humidity, pressure, light, etc.)
# actuator   — Write-only control (relay, LED, motor, valve)
# controller — Read + write (smart thermostat, automation hub)
# display    — Output display (e-ink, LCD, LED matrix)
# camera     — Image/video capture
# gateway    — Sub-device aggregator (Zigbee bridge, Z-Wave controller)`;

const MQTT_TOPICS = `# Default topic structure (configurable per device):
# Telemetry (device → OwnPilot):
home/livingroom/telemetry   → {"temperature":22.5,"humidity":58,"timestamp":1710590400}

# Commands (OwnPilot → device):
home/livingroom/command     → {"action":"set_threshold","value":25}

# Status (device → OwnPilot):
home/livingroom/status      → {"online":true,"battery":87,"lastSeen":"2026-03-16T10:00:00Z"}

# OwnPilot auto-subscribes to all registered device topics on startup`;

const SEND_COMMAND = `POST /api/v1/edge/devices/:deviceId/command
Content-Type: application/json

{
  "action": "toggle_relay",
  "payload": { "relay": 1, "state": true },
  "qos": 1,
  "retain": false
}`;

const READ_TELEMETRY = `# Get latest telemetry for a device
GET /api/v1/edge/devices/:deviceId/telemetry

# Get telemetry history
GET /api/v1/edge/devices/:deviceId/telemetry/history?from=2026-03-15&to=2026-03-16

# Response:
{
  "data": [
    {
      "timestamp": "2026-03-16T10:00:00Z",
      "values": { "temperature": 22.5, "humidity": 58, "motion": false }
    }
  ]
}`;

const COMMAND_QUEUE = `# Commands are queued if the device is offline (QoS 1/2)
# Check command queue status:
GET /api/v1/edge/devices/:deviceId/commands/queue

# Pending commands are delivered when the device reconnects`;

const LLM_TOOLS = `# 6 Edge Device LLM tools available to agents:

core.list_edge_devices
  → List all registered devices with online status

core.get_device_status
  → Get current status, last seen, battery level

core.read_sensor
  → Read latest sensor value(s) from a device
  → args: { deviceId, sensor? }

core.send_device_command
  → Send a command to an actuator or controller
  → args: { deviceId, action, payload? }

core.get_telemetry_history
  → Retrieve historical sensor data with time range
  → args: { deviceId, sensor, from, to, limit? }

core.subscribe_device_events
  → Register a trigger for device events (threshold crossed, motion detected, etc.)
  → args: { deviceId, event, condition, triggerName }`;

const ESP32_EXAMPLE = `// ESP32 Arduino sketch — connect to OwnPilot MQTT broker
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* mqttServer = "192.168.1.100";  // OwnPilot server IP
const char* deviceId   = "esp32-sensor-01";

void publishTelemetry() {
  StaticJsonDocument<128> doc;
  doc["temperature"] = readTemperature();
  doc["humidity"]    = readHumidity();
  doc["timestamp"]   = millis();

  char payload[128];
  serializeJson(doc, payload);

  char topic[64];
  snprintf(topic, sizeof(topic), "home/sensors/%s/telemetry", deviceId);
  client.publish(topic, payload);
}`;

const EDGE_ROUTES = `# Edge Device REST API:
GET    /api/v1/edge/devices                     List all devices
POST   /api/v1/edge/devices                     Register device
GET    /api/v1/edge/devices/:id                 Get device details
PUT    /api/v1/edge/devices/:id                 Update device config
DELETE /api/v1/edge/devices/:id                 Unregister device
GET    /api/v1/edge/devices/:id/status          Online status + last seen
GET    /api/v1/edge/devices/:id/telemetry       Latest telemetry
GET    /api/v1/edge/devices/:id/telemetry/history  Historical data
POST   /api/v1/edge/devices/:id/command         Send command
GET    /api/v1/edge/devices/:id/commands/queue  Pending command queue
GET    /api/v1/edge/broker/status               MQTT broker connection status`;

export function EdgeDevicesPage() {
  return (
    <DocsLayout>
      <Badge variant="orange" className="mb-3">
        Edge Devices
      </Badge>
      <h1>Edge Devices &amp; IoT</h1>
      <p className="text-lg text-[var(--color-text-muted)] mb-8">
        OwnPilot integrates with IoT devices via MQTT (Mosquitto), providing a device registry,
        telemetry storage, command queue, and 6 LLM tools so your AI assistant can read sensors and
        control actuators directly in conversation.
      </p>

      <h2>Architecture</h2>
      <p>
        OwnPilot connects to a Mosquitto MQTT broker. Devices publish telemetry to their topic
        prefix and subscribe to their command topic. OwnPilot subscribes to all registered device
        topics on startup and stores telemetry in PostgreSQL.
      </p>

      <h2>MQTT broker setup</h2>
      <h3>Option A: Docker (recommended)</h3>
      <CodeBlock code={MOSQUITTO_DOCKER} language="bash" filename="start-mosquitto.sh" />

      <h3>Option B: Existing broker</h3>
      <CodeBlock code={MQTT_CONFIG} language="bash" filename=".env" />

      <Callout type="info" title="Broker configuration">
        Configure the MQTT broker URL in <strong>Settings → Config Center → Edge</strong> or via the{' '}
        <code>MQTT_BROKER_URL</code> environment variable. The gateway connects automatically when
        the URL is set.
      </Callout>

      <h2>Registering devices</h2>
      <CodeBlock code={REGISTER_DEVICE} language="http" filename="register-device.http" />

      <h3>Device types</h3>
      <CodeBlock code={DEVICE_TYPES} language="bash" />

      <h3>Compatible hardware</h3>
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Example use</th>
            <th>Connection</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>ESP32 / ESP8266</td>
            <td>Temperature, humidity, motion sensors</td>
            <td>WiFi → MQTT</td>
          </tr>
          <tr>
            <td>Raspberry Pi</td>
            <td>GPIO, camera, complex automation</td>
            <td>Ethernet/WiFi → MQTT</td>
          </tr>
          <tr>
            <td>Arduino + ESP</td>
            <td>Simple sensors and actuators</td>
            <td>Serial → ESP → MQTT</td>
          </tr>
          <tr>
            <td>Shelly devices</td>
            <td>Smart plugs, switches, dimmers</td>
            <td>Built-in MQTT</td>
          </tr>
          <tr>
            <td>Zigbee2MQTT</td>
            <td>Zigbee device bridge</td>
            <td>USB → MQTT</td>
          </tr>
          <tr>
            <td>Tasmota devices</td>
            <td>Flashed smart plugs and relays</td>
            <td>Built-in MQTT</td>
          </tr>
        </tbody>
      </table>

      <h2>MQTT topic structure</h2>
      <CodeBlock code={MQTT_TOPICS} language="bash" filename="topic-structure.txt" />

      <h2>Reading telemetry</h2>
      <CodeBlock code={READ_TELEMETRY} language="http" filename="read-telemetry.http" />

      <h2>Sending commands</h2>
      <CodeBlock code={SEND_COMMAND} language="http" filename="send-command.http" />

      <h2>Command queue</h2>
      <p>
        Commands sent to offline devices are queued and delivered when the device reconnects,
        provided the QoS level is 1 or 2. QoS 0 commands are fire-and-forget.
      </p>
      <CodeBlock code={COMMAND_QUEUE} language="bash" />

      <h2>6 LLM tools for edge devices</h2>
      <p>Agents have 6 built-in tools for interacting with IoT devices in natural language:</p>
      <CodeBlock code={LLM_TOOLS} language="bash" filename="edge-tools.txt" />

      <Callout type="tip" title="Natural language device control">
        Once devices are registered, you can control them conversationally:
        <br />
        <em>"What's the temperature in the living room?"</em>
        <br />
        <em>"Turn on the bedroom fan"</em>
        <br />
        <em>"Show me humidity trends for the past week"</em>
        <br />
        <em>"Alert me when motion is detected in the garage"</em>
      </Callout>

      <h2>ESP32 example sketch</h2>
      <CodeBlock code={ESP32_EXAMPLE} language="typescript" filename="esp32-sensor.ino" />

      <h2>Full REST API reference</h2>
      <CodeBlock code={EDGE_ROUTES} language="bash" filename="edge-api.txt" />

      <h2>WebSocket events</h2>
      <p>Edge device events are broadcast over the WebSocket connection:</p>
      <CodeBlock
        code={`// Subscribe to device events:
ws.send(JSON.stringify({
  type: "subscribe",
  events: ["edge:telemetry", "edge:device:online", "edge:device:offline"]
}))

// Incoming telemetry event:
{
  "type": "edge:telemetry",
  "payload": {
    "deviceId": "esp32-livingroom-01",
    "values": { "temperature": 22.5, "humidity": 58 },
    "timestamp": "2026-03-16T10:00:00Z"
  }
}`}
        language="json"
      />

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/coding-agents"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Coding Agents
        </Link>
        <Link
          to="/docs/configuration"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Configuration
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
