/**
 * Edge Device (MQTT) Pairing Wizard
 *
 * Steps: MQTT Status → Device Type → Sensors/Actuators → Register → Complete
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import {
  WizardLoadingView,
  WizardErrorView,
  WizardCompleteView,
  useWizardKeyboard,
} from '../../components/wizard';
import { edgeApi } from '../../api';
import type {
  EdgeDeviceType,
  EdgeProtocol,
  EdgeSensorType,
  EdgeActuatorType,
  MqttStatus,
} from '../../api/endpoints/edge';
import { Check, AlertTriangle, Wrench, Plus, Trash } from '../../components/icons';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'mqtt', label: 'Broker' },
  { id: 'device', label: 'Device' },
  { id: 'io', label: 'Sensors' },
  { id: 'register', label: 'Register' },
  { id: 'done', label: 'Complete' },
];

const DEVICE_TYPES: { id: EdgeDeviceType; label: string; desc: string }[] = [
  { id: 'raspberry-pi', label: 'Raspberry Pi', desc: 'Linux SBC with GPIO + camera' },
  { id: 'esp32', label: 'ESP32', desc: 'WiFi/BLE microcontroller' },
  { id: 'arduino', label: 'Arduino', desc: 'Classic MCU' },
  { id: 'custom', label: 'Custom', desc: 'Any MQTT-capable device' },
];

const PROTOCOLS: { id: EdgeProtocol; label: string }[] = [
  { id: 'mqtt', label: 'MQTT' },
  { id: 'websocket', label: 'WebSocket' },
  { id: 'http-poll', label: 'HTTP Poll' },
];

const SENSOR_TYPES: EdgeSensorType[] = [
  'temperature',
  'humidity',
  'motion',
  'light',
  'pressure',
  'camera',
  'door',
  'custom',
];

const ACTUATOR_TYPES: EdgeActuatorType[] = [
  'relay',
  'servo',
  'led',
  'buzzer',
  'display',
  'motor',
  'custom',
];

interface SensorRow {
  id: string;
  name: string;
  type: EdgeSensorType;
  unit: string;
}
interface ActuatorRow {
  id: string;
  name: string;
  type: EdgeActuatorType;
}

export function EdgeDeviceWizard({ onComplete, onCancel }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [mqttStatus, setMqttStatus] = useState<MqttStatus | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<EdgeDeviceType>('esp32');
  const [protocol, setProtocol] = useState<EdgeProtocol>('mqtt');
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [sensors, setSensors] = useState<SensorRow[]>([]);
  const [actuators, setActuators] = useState<ActuatorRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    deviceId?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    edgeApi
      .getMqttStatus()
      .then((s) => setMqttStatus(s))
      .catch(() => setMqttStatus({ connected: false, brokerUrl: null }));
  }, []);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return true;
      case 1:
        return name.trim().length >= 2;
      case 2:
        return true;
      case 3:
        return result?.ok === true;
      default:
        return false;
    }
  }, [step, name, result]);

  const handleNext = async () => {
    if (step === 2) {
      setIsProcessing(true);
      setResult(null);
      try {
        const device = await edgeApi.register({
          name: name.trim(),
          type,
          protocol,
          firmwareVersion: firmwareVersion.trim() || undefined,
          sensors: sensors.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            unit: s.unit || undefined,
          })),
          actuators: actuators.map((a) => ({ id: a.id, name: a.name, type: a.type })),
        });
        setResult({ ok: true, deviceId: device.id });
        setStep(3);
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to register device',
        });
        setStep(3);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    setStep(step + 1);
  };

  useWizardKeyboard({ canGoNext, onNext: handleNext, onCancel, isProcessing });

  const addSensor = () => {
    const idx = sensors.length + 1;
    setSensors((prev) => [
      ...prev,
      { id: `sensor-${idx}`, name: `Sensor ${idx}`, type: 'temperature', unit: '°C' },
    ]);
  };

  const addActuator = () => {
    const idx = actuators.length + 1;
    setActuators((prev) => [
      ...prev,
      { id: `actuator-${idx}`, name: `Actuator ${idx}`, type: 'relay' },
    ]);
  };

  return (
    <WizardShell
      title="Pair Edge Device"
      description="Register an IoT device via MQTT"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 4}
      onNext={handleNext}
      onBack={() => {
        setStep(Math.max(0, step - 1));
        if (step === 3) setResult(null);
      }}
      onCancel={onCancel}
      onComplete={onComplete}
      onStepClick={setStep}
    >
      {/* Step 0: MQTT status */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            MQTT Broker Status
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Edge devices communicate through MQTT. Make sure your broker is reachable.
          </p>

          {!mqttStatus && <WizardLoadingView label="Checking broker..." />}

          {mqttStatus?.connected && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-success/5 border border-success/30">
              <Check className="w-5 h-5 text-success mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text-primary">Broker is online</p>
                <p className="text-xs text-text-muted mt-0.5 font-mono break-all">
                  {mqttStatus.brokerUrl}
                </p>
              </div>
            </div>
          )}

          {mqttStatus && !mqttStatus.connected && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/5 border border-warning/30">
              <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text-primary">Broker not connected</p>
                <p className="text-xs text-text-muted mt-0.5">
                  You can still register the device — telemetry will arrive once the broker comes
                  online. Configure MQTT in Edge settings.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 1: Device */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Device Info
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Identify your device.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Living Room Sensor"
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            </div>

            <div>
              <p className="text-sm font-medium text-text-primary mb-2">Type</p>
              <div className="grid grid-cols-2 gap-2">
                {DEVICE_TYPES.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setType(d.id)}
                    className={`text-left p-3 rounded-lg border text-xs transition-all ${
                      type === d.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border dark:border-dark-border hover:border-primary/40'
                    }`}
                  >
                    <span className="text-sm font-medium text-text-primary block">{d.label}</span>
                    <p className="text-[10px] text-text-muted mt-0.5">{d.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Protocol</label>
                <select
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as EdgeProtocol)}
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm"
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Firmware version
                </label>
                <input
                  type="text"
                  value={firmwareVersion}
                  onChange={(e) => setFirmwareVersion(e.target.value)}
                  placeholder="optional"
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Sensors / Actuators */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Sensors & Actuators
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Declare what this device exposes. You can skip and add later.
          </p>

          <section className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-text-primary">Sensors</h3>
              <button
                onClick={addSensor}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="space-y-2">
              {sensors.map((s, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_120px_80px_auto] gap-2 items-center"
                >
                  <input
                    type="text"
                    value={s.id}
                    onChange={(e) => {
                      const arr = [...sensors];
                      arr[i] = { ...arr[i]!, id: e.target.value };
                      setSensors(arr);
                    }}
                    placeholder="id"
                    className="px-2 py-1.5 rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-xs font-mono"
                  />
                  <input
                    type="text"
                    value={s.name}
                    onChange={(e) => {
                      const arr = [...sensors];
                      arr[i] = { ...arr[i]!, name: e.target.value };
                      setSensors(arr);
                    }}
                    placeholder="name"
                    className="px-2 py-1.5 rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-xs"
                  />
                  <select
                    value={s.type}
                    onChange={(e) => {
                      const arr = [...sensors];
                      arr[i] = { ...arr[i]!, type: e.target.value as EdgeSensorType };
                      setSensors(arr);
                    }}
                    className="px-2 py-1.5 rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-xs"
                  >
                    {SENSOR_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={s.unit}
                    onChange={(e) => {
                      const arr = [...sensors];
                      arr[i] = { ...arr[i]!, unit: e.target.value };
                      setSensors(arr);
                    }}
                    placeholder="unit"
                    className="px-2 py-1.5 rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-xs"
                  />
                  <button
                    onClick={() => setSensors(sensors.filter((_, idx) => idx !== i))}
                    className="p-1 text-text-muted hover:text-error"
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {sensors.length === 0 && (
                <p className="text-xs text-text-muted text-center py-2">No sensors yet</p>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-text-primary">Actuators</h3>
              <button
                onClick={addActuator}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="space-y-2">
              {actuators.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_120px_auto] gap-2 items-center">
                  <input
                    type="text"
                    value={a.id}
                    onChange={(e) => {
                      const arr = [...actuators];
                      arr[i] = { ...arr[i]!, id: e.target.value };
                      setActuators(arr);
                    }}
                    placeholder="id"
                    className="px-2 py-1.5 rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-xs font-mono"
                  />
                  <input
                    type="text"
                    value={a.name}
                    onChange={(e) => {
                      const arr = [...actuators];
                      arr[i] = { ...arr[i]!, name: e.target.value };
                      setActuators(arr);
                    }}
                    placeholder="name"
                    className="px-2 py-1.5 rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-xs"
                  />
                  <select
                    value={a.type}
                    onChange={(e) => {
                      const arr = [...actuators];
                      arr[i] = { ...arr[i]!, type: e.target.value as EdgeActuatorType };
                      setActuators(arr);
                    }}
                    className="px-2 py-1.5 rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-xs"
                  >
                    {ACTUATOR_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setActuators(actuators.filter((_, idx) => idx !== i))}
                    className="p-1 text-text-muted hover:text-error"
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {actuators.length === 0 && (
                <p className="text-xs text-text-muted text-center py-2">No actuators yet</p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Step 3: Register */}
      {step === 3 && (
        <>
          {isProcessing && <WizardLoadingView label="Registering device..." />}
          {result?.ok && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
                <Wrench className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">Registered!</h3>
              <p className="text-sm text-text-muted mt-1">
                Device ID: <code className="text-xs">{result.deviceId}</code>
              </p>
            </div>
          )}
          {result && !result.ok && (
            <WizardErrorView
              title="Registration Failed"
              message={result.error}
              onRetry={() => {
                setStep(2);
                setResult(null);
              }}
            />
          )}
        </>
      )}

      {/* Step 4: Done */}
      {step === 4 && (
        <WizardCompleteView
          icon={Wrench}
          title="Device Paired!"
          subtitle={
            <>
              <strong>{name}</strong> is registered. Configure your firmware to publish to the MQTT
              topic for this device.
            </>
          }
          facts={[
            { label: 'Type', value: type },
            { label: 'Protocol', value: protocol },
            { label: 'Sensors', value: String(sensors.length) },
            { label: 'Actuators', value: String(actuators.length) },
          ]}
          actions={[{ label: 'Open Edge Devices', onClick: () => navigate('/edge') }]}
        />
      )}
    </WizardShell>
  );
}
