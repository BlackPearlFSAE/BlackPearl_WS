import json
import time
import random
import websocket
import ssl
import math

# --- CONFIGURATION ---
WSS_URL = "ws://localhost:3000"
EVENT_MODE = "SKIDPAD" # Options: "SKIDPAD" or "ENDURANCE"
PUBLISH_RATE = 2.0
INTERVAL = 1.0 / PUBLISH_RATE

class FSAEVehiclePhysics:
    def __init__(self):
        # Constants for your specific build
        self.total_cells = 80
        self.r_internal_cell = 0.002 # 2mOhm per cell
        self.v_oc_full = 4.15 # Volts per cell
        self.energy_cap_kwh = 10.0
        self.current_energy_wh = 10000.0

        # State Variables
        self.velocity_ms = 0.0
        self.lat_g = 0.0
        self.long_g = 0.0
        self.motor_temp = 35.0
        self.inv_temp = 32.0
        self.elapsed_s = 0

    def step(self):
        self.elapsed_s += INTERVAL

        if EVENT_MODE == "SKIDPAD":
            self._simulate_skidpad()
        else:
            self._simulate_endurance()

        # --- POWERTRAIN CALCULATIONS ---
        # Current logic: Higher acceleration = Higher current
        target_current = abs(self.long_g * 80) + abs(self.lat_g * 20) + (self.velocity_ms * 0.5)
        self.current = min(250, target_current + random.uniform(-2, 2))

        # Voltage Sag: V = Voc - (I * R)
        v_oc_pack = (self.current_energy_wh / 10000.0) * (self.v_oc_full * self.total_cells)
        r_pack = self.total_cells * self.r_internal_cell
        self.voltage = v_oc_pack - (self.current * r_pack)

        # Energy depletion
        self.current_energy_wh -= (self.voltage * self.current * INTERVAL) / 3600

        # --- SUSPENSION CALCULATIONS (Decoupled) ---
        # Heave: Responds to Downforce (v^2) and Pitch (long_g)
        # 22mm is neutral. Downforce compresses (+), Braking dives (+).
        aero_downforce = (self.velocity_ms**2) * 0.01
        self.heave = 20 + aero_downforce + (abs(self.long_g) * 2) + random.uniform(-0.2, 0.2)

        # Roll: Responds ONLY to Lat G (Decoupled trait)
        # 22mm is neutral.
        self.roll = 22 + (self.lat_g * 8) + random.uniform(-0.1, 0.1)

        # --- THERMALS ---
        # I^2R heating
        self.motor_temp += (self.current**2 * 0.000005) - 0.01
        self.inv_temp += (self.current**2 * 0.000002) - 0.005

    def _simulate_skidpad(self):
        """Logic for the figure-8 skidpad"""
        t = self.elapsed_s % 25
        if t < 5: # Acceleration to entry
            self.long_g = 0.8; self.lat_g = 0.0; self.velocity_ms = min(12, self.velocity_ms + 1)
        elif t < 15: # Right Circle
            self.long_g = 0.1; self.lat_g = 1.4; self.velocity_ms = 11.5
        else: # Left Circle
            self.long_g = 0.1; self.lat_g = -1.4; self.velocity_ms = 11.5

    def _simulate_endurance(self):
        """Dynamic lap simulation"""
        # Sine wave based acceleration/cornering to mimic a track
        self.long_g = math.sin(self.elapsed_s * 0.5) * 1.2
        self.lat_g = math.cos(self.elapsed_s * 0.3) * 1.5
        self.velocity_ms = max(2, min(28, self.velocity_ms + (self.long_g * 0.5)))

# Initialize
car = FSAEVehiclePhysics()

def generate_front_data():
    ts = int(time.time() * 1000)
    return [
        {"type": "data", "group": "front.mech", "ts": ts, "d": {"STR_Heave_mm": round(car.heave, 2), "STR_Roll_mm": round(car.roll, 2)}},
        {"type": "data", "group": "front.elect", "ts": ts, "d": {"I_SENSE": round(car.current * 0.02, 2), "TMP": round(car.inv_temp, 1), "APPS": round(max(0, car.long_g * 50), 1), "BPPS": round(max(0, -car.long_g * 30), 1)}},
        {"type": "data", "group": "front.faults", "ts": ts, "d": {"AMS_OK": True, "IMD_OK": True, "HV_ON": True, "BSPD_OK": True}}
    ]

def generate_bamo_data():
    ts = int(time.time() * 1000)
    return [
        {"type": "data", "group": "bamo.power", "ts": ts, "d": {"canVoltage": round(car.voltage, 1), "canCurrent": round(car.current, 1), "power": round(car.voltage * car.current, 1), "canVoltageValid": True, "canCurrentValid": True}},
        {"type": "data", "group": "bamo.temp", "ts": ts, "d": {"motorTemp": round(car.motor_temp, 1), "controllerTemp": round(car.inv_temp, 1), "motorTempValid": True, "ctrlTempValid": True}}
    ]

def generate_ams_data():
    messages = []
    ts = int(time.time() * 1000)
    # 80 cells total across 8 BMUs
    avg_cell_v = car.voltage / 80
    raw_cell_v = int(avg_cell_v / 0.02)

    for i in range(8):
        # Add tiny 1-bit variance to look like real balancing
        cells = [raw_cell_v + random.randint(-1, 1) for _ in range(10)]
        messages.append({"type": "data", "group": f"bmu{i}.cells", "ts": ts, "d": {"V_MODULE": sum(cells), "V_CELL": cells, "TEMP_SENSE": [int(car.motor_temp-5), int(car.motor_temp-6)], "DV": 1, "connected": True}})
    return messages

def run_simulator():
    try:
        ws = websocket.create_connection(WSS_URL)
        print(f"SIMULATING {EVENT_MODE} MODE...")
        while True:
            t_start = time.time()
            car.step()
            msgs = generate_front_data() + generate_bamo_data() + generate_ams_data()
            for m in msgs: ws.send(json.dumps(m))
            time.sleep(max(0, INTERVAL - (time.time() - t_start)))
    except Exception as e: print(f"Error: {e}")

if __name__ == "__main__":
    run_simulator()