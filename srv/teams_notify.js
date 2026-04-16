const axios = require('axios');

const MESSAGES = {
    ASSIGNED:  (d) => `🚚 Driver assigned — Delivery ${d.DeliveryDocument} | ${d.TruckRegistration || d.MobileNumber} | ${d.AssignedAt}`,
    LOCATION:  (d) => `📍 ${d.TruckRegistration || d.MobileNumber} — Delivery ${d.DeliveryDocument} — lat:${d.Latitude} lng:${d.Longitude} at ${d.RecordedAt}`,
    DELIVERED: (d) => `✅ Delivery ${d.DeliveryDocument} COMPLETED by ${d.TruckRegistration || d.MobileNumber} at ${d.DeliveredAt}`
};

module.exports = {
    async post(event, data) {
        const url = process.env.TEAMS_WEBHOOK_URL;
        if (!url) {
            console.warn('TEAMS_WEBHOOK_URL not set — skipping Teams notification');
            return;
        }
        const textFn = MESSAGES[event];
        if (!textFn) {
            console.warn(`Unknown Teams event type: ${event}`);
            return;
        }
        try {
            await axios.post(url, { text: textFn(data) });
        } catch (err) {
            // Non-fatal: Teams failure should never break the delivery flow
            console.error('Teams notification failed:', err.message);
        }
    }
};
