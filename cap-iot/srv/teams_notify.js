const axios = require('axios');
const cds   = require('@sap/cds');

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function mapsLink(lat, lng) {
    return lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : '';
}

async function reverseGeocode(lat, lng) {
    if (!lat || !lng) return null;
    try {
        const googleApi = await cds.connect.to('GoogleAPI-SR');
        const res = await googleApi.send({ method: 'GET', path: `/maps/api/geocode/json?latlng=${lat},${lng}` });
        const results = res && res.results;
        return results && results[0] ? results[0].formatted_address : null;
    } catch (_) { return null; }
}

function adaptiveCard(body, actions) {
    return {
        type:        'message',
        attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                type:    'AdaptiveCard',
                version: '1.4',
                body:    body,
                actions: actions || []
            }
        }]
    };
}

function factSet(facts) {
    return { type: 'FactSet', facts: facts.map(([t, v]) => ({ title: t, value: v || '—' })) };
}

const MESSAGES = {
    ASSIGNED: (d) => adaptiveCard([
        { type: 'TextBlock', text: '🚚 Driver Assigned', weight: 'Bolder', size: 'Medium', color: 'Accent' },
        { type: 'TextBlock', text: `Delivery **${d.DeliveryDocument}**`, wrap: true },
        factSet([
            ['Truck',          d.TruckRegistration],
            ['Driver',         d.DriverName || d.MobileNumber],
            ['Mobile',         d.MobileNumber],
            ['Est. Distance',  d.EstimatedDistance],
            ['Est. Duration',  d.EstimatedDuration],
            ['Assigned At',    fmtDate(d.AssignedAt)]
        ]),
        d.TrackingUrl ? {
            type: 'TextBlock',
            text: `📱 **Customer tracking link:** [Track Delivery](${d.TrackingUrl})`,
            wrap: true,
            spacing: 'Medium'
        } : null
    ].filter(Boolean), [
        d.TrackingUrl ? { type: 'Action.OpenUrl', title: 'Open Tracking Page', url: d.TrackingUrl } : null
    ].filter(Boolean)),

    LOCATION: (d) => adaptiveCard([
        { type: 'TextBlock', text: '📍 Location Update', weight: 'Bolder', size: 'Medium', color: 'Warning' },
        { type: 'TextBlock', text: `**${d.TruckRegistration || d.MobileNumber}** — Delivery **${d.DeliveryDocument}**`, wrap: true },
        factSet([
            ['Address',      d.Address],
            ['Coordinates',  `${d.Latitude}, ${d.Longitude}`],
            ['Speed',        d.Speed ? `${(d.Speed * 3.6).toFixed(0)} km/h` : null],
            ['Recorded At',  fmtDate(d.RecordedAt)]
        ])
    ], [
        d.Latitude ? { type: 'Action.OpenUrl', title: 'View on Google Maps', url: mapsLink(d.Latitude, d.Longitude) } : null
    ].filter(Boolean)),

    DELIVERED: (d) => adaptiveCard([
        { type: 'TextBlock', text: '✅ Delivery Complete', weight: 'Bolder', size: 'Medium', color: 'Good' },
        { type: 'TextBlock', text: `Delivery **${d.DeliveryDocument}** received by customer **${d.ShipToParty || '—'}**`, wrap: true },
        factSet([
            ['Truck',         d.TruckRegistration],
            ['Driver',        d.DriverName || d.MobileNumber],
            ['Customer',      d.ShipToParty],
            ['Delivered At',  fmtDate(d.DeliveredAt)],
            ['Final GPS',     d.LastLat && d.LastLng ? `${d.LastLat}, ${d.LastLng}` : null]
        ])
    ], [
        d.LastLat ? { type: 'Action.OpenUrl', title: 'View Delivery Location', url: mapsLink(d.LastLat, d.LastLng) } : null
    ].filter(Boolean))
};

module.exports = {
    async post(event, data) {
        const url = process.env.TEAMS_WEBHOOK_URL;
        if (!url) { console.warn('TEAMS_WEBHOOK_URL not set — skipping Teams notification'); return; }
        const cardFn = MESSAGES[event];
        if (!cardFn) { console.warn(`Unknown Teams event type: ${event}`); return; }
        try {
            if (event === 'LOCATION' && data.Latitude && data.Longitude)
                data.Address = await reverseGeocode(data.Latitude, data.Longitude);
            await axios.post(url, cardFn(data));
        } catch (err) {
            console.error('Teams notification failed:', err.message);
        }
    }
};
