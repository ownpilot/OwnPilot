#!/bin/sh
set -eu

if [ -z "${MQTT_USERNAME:-}" ] || [ -z "${MQTT_PASSWORD:-}" ]; then
  echo "MQTT_USERNAME and MQTT_PASSWORD are required for the OwnPilot Mosquitto profile." >&2
  exit 1
fi

umask 077
mosquitto_passwd -b -c /tmp/ownpilot-mosquitto-passwd "$MQTT_USERNAME" "$MQTT_PASSWORD"
chown mosquitto:mosquitto /tmp/ownpilot-mosquitto-passwd

unset MQTT_PASSWORD
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
