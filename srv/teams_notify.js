const axios = require('axios');

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function mapsLink(lat, lng) {
    return lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : '';
}

const MESSAGES = {
    ASSIGNED: (d) => ({
        "@type": "MessageCard",
        "themeColor": "0854A0",
        "title": `🚚 Driver Assigned — Delivery ${d.DeliveryDocument}`,
        "sections": [{
            "facts": [
                { "name": "Truck", "value": d.TruckRegistration || "—" },
                { "name": "Driver Mobile", "value": d.MobileNumber || "—" },
                { "name": "Delivery", "value": d.DeliveryDocument },
                { "name": "Est. Distance", "value": d.EstimatedDistance || "—" },
                { "name": "Est. Duration", "value": d.EstimatedDuration || "—" },
                { "name": "Assigned At", "value": fmtDate(d.AssignedAt) }
            ],
            "text": d.EstimatedDuration
                ? `Truck **${d.TruckRegistration || d.MobileNumber}** assigned to delivery **${d.DeliveryDocument}**. Will reach in **${d.EstimatedDuration}** (${d.EstimatedDistance || '—'}).`
                : `Truck **${d.TruckRegistration || d.MobileNumber}** assigned to delivery **${d.DeliveryDocument}**.`
        }]
    }),

    LOCATION: (d) => ({
        "@type": "MessageCard",
        "themeColor": "E8581C",
        "title": `📍 Location Update — ${d.TruckRegistration || d.MobileNumber}`,
        "sections": [{
            "facts": [
                { "name": "Truck", "value": d.TruckRegistration || d.MobileNumber || "—" },
                { "name": "Delivery", "value": d.DeliveryDocument || "—" },
                { "name": "Coordinates", "value": `${d.Latitude}, ${d.Longitude}` },
                { "name": "Speed", "value": d.Speed ? `${(d.Speed * 3.6).toFixed(0)} km/h` : "—" },
                { "name": "Recorded At", "value": fmtDate(d.RecordedAt) }
            ],
            "text": `Truck **${d.TruckRegistration || d.MobileNumber}** — Delivery **${d.DeliveryDocument}** — [View on Map](${mapsLink(d.Latitude, d.Longitude)})`
        }],
        "potentialAction": d.Latitude ? [{
            "@type": "OpenUri",
            "name": "View on Google Maps",
            "targets": [{ "os": "default", "uri": mapsLink(d.Latitude, d.Longitude) }]
        }] : []
    }),

    DELIVERED: (d) => ({
        "@type": "MessageCard",
        "themeColor": "2B7C2B",
        "title": `✅ Delivery Complete — ${d.DeliveryDocument}`,
        "sections": [{
            "facts": [
                { "name": "Delivery", "value": d.DeliveryDocument },
                { "name": "Truck", "value": d.TruckRegistration || "—" },
                { "name": "Driver Mobile", "value": d.MobileNumber || "—" },
                { "name": "Customer (Ship-To)", "value": d.ShipToParty || "—" },
                { "name": "Delivered At", "value": fmtDate(d.DeliveredAt) },
                { "name": "Last GPS", "value": d.LastLat && d.LastLng ? `${d.LastLat}, ${d.LastLng}` : "—" }
            ],
            "text": `Delivery **${d.DeliveryDocument}** received by customer **${d.ShipToParty || '—'}**. Completed by **${d.TruckRegistration || d.MobileNumber}** at ${fmtDate(d.DeliveredAt)}.`
        }],
        "potentialAction": d.LastLat ? [{
            "@type": "OpenUri",
            "name": "View Delivery Location",
            "targets": [{ "os": "default", "uri": mapsLink(d.LastLat, d.LastLng) }]
        }] : []
    })
};

module.exports = {
    async post(event, data) {
        const url = process.env.TEAMS_WEBHOOK_URL;
        if (!url) {
            console.warn('TEAMS_WEBHOOK_URL not set — skipping Teams notification');
            return;
        }
        const cardFn = MESSAGES[event];
        if (!cardFn) {
            console.warn(`Unknown Teams event type: ${event}`);
            return;
        }
        try {
            await axios.post(url, cardFn(data));
        } catch (err) {
            console.error('Teams notification failed:', err.message);
        }
    }
};
