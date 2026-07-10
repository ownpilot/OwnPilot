-- Migration 010: Edge Delegation Protocol (IoT/edge device management via MQTT)

-- Edge devices: registered IoT/edge devices
CREATE TABLE IF NOT EXISTS edge_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name VARCHAR(200) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('raspberry-pi', 'esp32', 'arduino', 'custom')),
  protocol VARCHAR(20) NOT NULL DEFAULT 'mqtt' CHECK (protocol IN ('mqtt', 'websocket', 'http-poll')),
  sensors JSONB NOT NULL DEFAULT '[]',
  actuators JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(10) NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'error')),
  last_seen TIMESTAMPTZ,
  firmware_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edge_devices_user ON edge_devices(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_devices_status ON edge_devices(user_id, status);

-- Edge commands: command history (server → device)
CREATE TABLE IF NOT EXISTS edge_commands (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT 'default',
  command_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'acknowledged', 'completed', 'failed', 'timeout')),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_edge_commands_device ON edge_commands(device_id, created_at DESC);

-- Edge telemetry: sensor data history (device → server)
CREATE TABLE IF NOT EXISTS edge_telemetry (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  sensor_id TEXT NOT NULL,
  value JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edge_telemetry_device_sensor ON edge_telemetry(device_id, sensor_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_telemetry_time ON edge_telemetry(recorded_at DESC);
