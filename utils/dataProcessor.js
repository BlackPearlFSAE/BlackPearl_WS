// Server-side normalization — same logic as frontend dataProcessor.js
// Pre-processes telemetry before WS broadcast so frontend skips normalizeData()

const SCALE_CONFIG = {
    V_MODULE: { scale: 0.02, offset: 0 },
    V_CELL: { scale: 0.02, offset: 0 },
    TEMP_SENSE: { scale: 0.5, offset: -40 },
    DV: { scale: 0.1, offset: 0 },
};

const applyScaling = (key, value) => {
    const baseKey = key.split('.').pop().replace(/\[\d+\]$/, '');
    const config = SCALE_CONFIG[baseKey];
    if (!config) return value;
    if (Array.isArray(value)) {
        return value.map(v => typeof v === 'number' ? v * config.scale + config.offset : v);
    }
    if (typeof value === 'number') {
        return value * config.scale + config.offset;
    }
    return value;
};

const flattenObject = (obj, prefix = "", res = {}) => {
    for (const key in obj) {
        const value = obj[key];
        const newKey = prefix ? `${prefix}.${key}` : key;

        if (Array.isArray(value)) {
            value.forEach((val, idx) => {
                const indexedKey = `${newKey}.${idx}`;
                res[indexedKey] = applyScaling(key, val);
            });
        } else if (value !== null && typeof value === "object") {
            flattenObject(value, newKey, res);
        } else {
            res[newKey] = applyScaling(key, value);
        }
    }
    return res;
};

// Normalize a raw telemetry message into the flat format the frontend expects
export const normalizeTelemetry = (statData, id, sessionId, sessionName, createdAt) => {
    const payload = statData.values || {};
    const flatPayload = flattenObject(payload);

    return {
        id,
        session_id: sessionId,
        session_name: sessionName,
        timestamp: statData.timestamp,
        createdAt,
        group: statData.group,
        ...flatPayload
    };
};
