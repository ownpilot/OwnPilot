/**
 * EdgeDevicesOnboarding
 *
 * Full-page onboarding shown when no edge devices are registered.
 * Explains the IoT pipeline, MQTT flow, device types, and quick-start code.
 */

import { CodeBlock } from './CodeBlock';
import { Plus, Wifi, Cpu, Zap, Brain, Activity, CheckCircle2 } from './icons';

// =============================================================================
// Quick-start code samples
// =============================================================================

const PYTHON_SAMPLE = `import paho.mqtt.client as mqtt
import json, time, random

BROKER = "your-mqtt-broker:1883"
USER_ID = "your-user-id"
DEVICE_ID = "your-device-id"

client = mqtt.Client()
client.connect(BROKER)

# Listen for commands
def on_message(client, userdata, msg):
    cmd = json.loads(msg.payload)
    print(f"Command received: {cmd['commandType']}")
    # e.g. toggle a relay based on cmd['payload']

topic_cmd = f"ownpilot/{USER_ID}/devices/{DEVICE_ID}/commands"
client.subscribe(topic_cmd)
client.on_message = on_message
client.loop_start()

# Publish telemetry every 30 seconds
topic_tel = f"ownpilot/{USER_ID}/devices/{DEVICE_ID}/telemetry"
while True:
    payload = {
        "sensorId": "temp-1",
        "value": round(20 + random.uniform(0, 15), 1),
        "unit": "°C"
    }
    client.publish(topic_tel, json.dumps(payload))
    time.sleep(30)`;

const ARDUINO_SAMPLE = `#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* broker   = "your-mqtt-broker";
const char* userId   = "your-user-id";
const char* deviceId = "your-device-id";

WiFiClient wifi;
PubSubClient client(wifi);

void setup() {
  WiFi.begin("SSID", "PASSWORD");
  client.setServer(broker, 1883);
  client.connect(deviceId);

  // Subscribe to commands
  char cmdTopic[128];
  snprintf(cmdTopic, sizeof(cmdTopic),
    "ownpilot/%s/devices/%s/commands", userId, deviceId);
  client.subscribe(cmdTopic);
}

void loop() {
  client.loop();

  // Publish temperature every 10s
  char telTopic[128];
  snprintf(telTopic, sizeof(telTopic),
    "ownpilot/%s/devices/%s/telemetry", userId, deviceId);

  StaticJsonDocument<128> doc;
  doc["sensorId"] = "temp-1";
  doc["value"]    = 24.5;
  doc["unit"]     = "C";

  char buf[128];
  serializeJson(doc, buf);
  client.publish(telTopic, buf);

  delay(10000);
}`;

// =============================================================================
// Sub-components
// =============================================================================

function FlowDiagram() {
  return (
    <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-6 font-mono text-xs overflow-x-auto">
      <div className="min-w-[520px]">
        {/* Row 1: devices */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-4">
            <div className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-500/20 flex items-center justify-center text-lg">
                🍓
              </div>
              <span className="text-text-muted text-[10px]">Raspberry Pi</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-lg">
                📡
              </div>
              <span className="text-text-muted text-[10px]">ESP32</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-500/20 flex items-center justify-center text-lg">
                ⚡
              </div>
              <span className="text-text-muted text-[10px]">Arduino</span>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center gap-1 mx-4">
            <div className="w-full flex items-center gap-1">
              <div className="flex-1 h-px border-t-2 border-dashed border-green-400" />
              <span className="text-green-500 text-[10px] whitespace-nowrap">MQTT publish</span>
              <div className="flex-1 h-px border-t-2 border-dashed border-green-400" />
            </div>
            <div className="text-[10px] text-text-muted">telemetry • status</div>
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border-2 border-primary/30 flex items-center justify-center text-xl">
              🤖
            </div>
            <span className="text-text-muted text-[10px]">MQTT Broker</span>
          </div>

          <div className="flex-1 flex flex-col items-center gap-1 mx-4">
            <div className="w-full flex items-center gap-1">
              <div className="flex-1 h-px border-t-2 border-primary/60" />
              <span className="text-primary text-[10px] whitespace-nowrap">subscribe</span>
              <div className="flex-1 h-px border-t-2 border-primary/60" />
            </div>
            <div className="text-[10px] text-text-muted">store • broadcast</div>
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center text-xl">
              🧠
            </div>
            <span className="text-text-muted text-[10px]">OwnPilot</span>
          </div>
        </div>

        {/* Row 2: command path (reverse) */}
        <div className="flex items-center mt-4">
          <div className="w-[120px]" />
          <div className="flex-1 flex flex-col items-center gap-1 mx-4">
            <div className="w-full flex items-center gap-1">
              <div className="flex-1 h-px border-t-2 border-dashed border-red-400" />
              <span className="text-red-400 text-[10px] whitespace-nowrap">MQTT publish</span>
              <div className="flex-1 h-px border-t-2 border-dashed border-red-400" />
            </div>
            <div className="text-[10px] text-text-muted">commands</div>
          </div>
          <div className="w-12" />
          <div className="flex-1 flex flex-col items-center gap-1 mx-4">
            <div className="w-full flex items-center gap-1">
              <div className="flex-1 h-px border-t-2 border-violet-400/60" />
              <span className="text-violet-400 text-[10px] whitespace-nowrap">AI trigger</span>
              <div className="flex-1 h-px border-t-2 border-violet-400/60" />
            </div>
            <div className="text-[10px] text-text-muted">rule • agent</div>
          </div>
          <div className="w-12" />
        </div>

        {/* Topics */}
        <div className="mt-5 pt-4 border-t border-border dark:border-dark-border grid grid-cols-3 gap-3 text-[10px]">
          <div>
            <span className="text-text-muted">Telemetry topic:</span>
            <div className="mt-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded px-2 py-1 text-green-600 dark:text-green-400">
              ownpilot/&#123;userId&#125;/devices/&#123;deviceId&#125;/telemetry
            </div>
          </div>
          <div>
            <span className="text-text-muted">Commands topic:</span>
            <div className="mt-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded px-2 py-1 text-red-500 dark:text-red-400">
              ownpilot/&#123;userId&#125;/devices/&#123;deviceId&#125;/commands
            </div>
          </div>
          <div>
            <span className="text-text-muted">Status topic:</span>
            <div className="mt-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded px-2 py-1 text-blue-500 dark:text-blue-400">
              ownpilot/&#123;userId&#125;/devices/&#123;deviceId&#125;/status
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface UseCase {
  emoji: string;
  title: string;
  description: string;
  example: string;
}

const USE_CASES: UseCase[] = [
  {
    emoji: '🌡️',
    title: 'Environmental Monitoring',
    description: 'Collect temperature, humidity, CO₂, or pressure data from any room or location.',
    example: '"What\u2019s the temperature in the server room right now?"',
  },
  {
    emoji: '🚪',
    title: 'Security & Access',
    description: 'Track door, window, and motion sensors. Get notified on unusual activity.',
    example: '"Alert me if the garage door opens after midnight."',
  },
  {
    emoji: '💡',
    title: 'Actuator Control',
    description:
      'Send commands to relays, LEDs, motors, and servos — triggered by AI or schedules.',
    example: '"Turn off all relay switches in zone B."',
  },
  {
    emoji: '📊',
    title: 'AI-Powered Analysis',
    description: 'Query sensor history, detect anomalies, and get AI insights over your data.',
    example: '"Has humidity been above 80% in the last week?"',
  },
];

interface Step {
  n: number;
  title: string;
  detail: string;
}

const STEPS: Step[] = [
  {
    n: 1,
    title: 'Set up an MQTT broker',
    detail:
      'Run Mosquitto locally or use a hosted broker (HiveMQ, EMQX, AWS IoT). Set MQTT_BROKER_URL in your OwnPilot .env file.',
  },
  {
    n: 2,
    title: 'Register your device',
    detail:
      'Click "Register Device" above. Define the device type, its sensors (e.g. temperature, humidity) and actuators (e.g. relay, LED).',
  },
  {
    n: 3,
    title: 'Flash or run client code',
    detail:
      'Use the Python snippet (Raspberry Pi / any Linux device) or the Arduino/ESP32 sketch. Swap in your broker address, userId, and deviceId.',
  },
  {
    n: 4,
    title: 'Watch data flow in',
    detail:
      'Once the device publishes to the telemetry topic, values appear on the card in real time via WebSocket. Green dot = online.',
  },
  {
    n: 5,
    title: 'Connect to AI & Triggers',
    detail:
      'Create a Trigger with condition type "stale_goals" or ask the AI agent directly. It can read sensor values and send commands on your behalf.',
  },
];

// =============================================================================
// Main component
// =============================================================================

interface Props {
  onRegister: () => void;
}

export function EdgeDevicesOnboarding({ onRegister }: Props) {
  return (
    <div className="max-w-4xl mx-auto px-2 py-6 space-y-10">
      {/* Hero */}
      <div className="text-center space-y-3">
        <div className="flex justify-center gap-3 mb-4">
          <span className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Wifi className="w-6 h-6 text-primary" />
          </span>
          <span className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center">
            <Cpu className="w-6 h-6 text-orange-500" />
          </span>
          <span className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center">
            <Brain className="w-6 h-6 text-violet-500" />
          </span>
        </div>
        <h1 className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
          Connect Physical Devices to Your AI
        </h1>
        <p className="text-text-secondary dark:text-dark-text-secondary max-w-xl mx-auto leading-relaxed">
          Edge Devices lets you stream sensor data from IoT hardware into OwnPilot over MQTT, then
          query, analyze, and control those devices using natural language — or automated triggers.
        </p>
        <button
          onClick={onRegister}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors mt-2"
        >
          <Plus className="w-4 h-4" />
          Register Your First Device
        </button>
      </div>

      {/* Flow diagram */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          How It Works
        </h2>
        <FlowDiagram />
      </div>

      {/* Use cases */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          What You Can Do
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {USE_CASES.map((uc) => (
            <div
              key={uc.title}
              className="border border-border dark:border-dark-border rounded-xl p-4 space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{uc.emoji}</span>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {uc.title}
                </span>
              </div>
              <p className="text-xs text-text-secondary dark:text-dark-text-secondary leading-relaxed">
                {uc.description}
              </p>
              <p className="text-xs text-primary italic">"{uc.example}"</p>
            </div>
          ))}
        </div>
      </div>

      {/* Getting started steps */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          Getting Started
        </h2>
        <div className="space-y-3">
          {STEPS.map((step) => (
            <div key={step.n} className="flex gap-4">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {step.n}
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {step.title}
                </p>
                <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5 leading-relaxed">
                  {step.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Code samples */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary uppercase tracking-wide flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          Quick-Start Code
        </h2>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2 flex items-center gap-1.5">
              <span className="text-base">🍓</span> Raspberry Pi / Linux — Python (paho-mqtt)
            </p>
            <CodeBlock code={PYTHON_SAMPLE} language="python" filename="ownpilot_device.py" />
          </div>

          <div>
            <p className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2 flex items-center gap-1.5">
              <span className="text-base">📡</span> ESP32 / Arduino — C++ (PubSubClient +
              ArduinoJson)
            </p>
            <CodeBlock code={ARDUINO_SAMPLE} language="cpp" filename="ownpilot_device.ino" />
          </div>
        </div>
      </div>

      {/* Requirements */}
      <div className="border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">⚙️ Prerequisites</p>
        <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1 list-none">
          <li>
            <span className="font-mono bg-amber-100 dark:bg-amber-500/20 px-1.5 py-0.5 rounded">
              MQTT_BROKER_URL
            </span>{' '}
            — set in your OwnPilot <span className="font-mono">.env</span> file (e.g.{' '}
            <span className="font-mono">mqtt://localhost:1883</span>)
          </li>
          <li>
            An MQTT broker running —{' '}
            <a
              href="https://mosquitto.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Mosquitto
            </a>
            ,{' '}
            <a
              href="https://www.hivemq.com/mqtt-cloud-broker"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              HiveMQ Cloud
            </a>
            , or{' '}
            <a
              href="https://www.emqx.io"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              EMQX
            </a>
          </li>
          <li>
            Your device's <span className="font-mono">userId</span> from your OwnPilot profile and
            the <span className="font-mono">deviceId</span> you get after registering
          </li>
        </ul>
      </div>

      {/* CTA footer */}
      <div className="text-center pb-4">
        <button
          onClick={onRegister}
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Register Your First Device
        </button>
        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-2">
          You can add sensors and actuators during registration.
        </p>
      </div>
    </div>
  );
}
