const { Kafka } = require('kafkajs');
const cds = require('@sap/cds');
const teamsNotify = require('./teams_notify');

const kafka = new Kafka({
    clientId: 'cap-gps-consumer',
    brokers: [(process.env.KAFKA_BROKER || 'localhost:9092')]
});

const consumer = kafka.consumer({ groupId: 'cap-gps-group' });
const _timers  = {};   // topicName → timeout handle

let _db = null;   // set via start(db)

async function _handleMessage({ topic, message }) {
    let gps;
    try {
        gps = JSON.parse(message.value.toString());
    } catch (e) {
        console.error('kafka_consumer: bad message on', topic, e.message);
        return;
    }

    // Persist GPS ping to DB
    if (_db) {
        try {
            const { GpsCoordinates } = _db.entities('iot_schema');
            await _db.run(
                INSERT.into(GpsCoordinates).entries({
                    ID:            cds.utils.uuid(),
                    assignment_ID: gps.assignmentId,
                    Latitude:      gps.lat,
                    Longitude:     gps.lng,
                    Speed:         gps.speed  || null,
                    Accuracy:      gps.accuracy || null,
                    RecordedAt:    gps.recordedAt || new Date().toISOString()
                })
            );
        } catch (err) {
            console.error('kafka_consumer: DB insert failed:', err.message);
        }
    }

    // 5-min Teams location timer: reset on each message
    if (_timers[topic]) clearTimeout(_timers[topic]);
    _timers[topic] = setTimeout(() => {
        teamsNotify.post('LOCATION', {
            TruckRegistration: gps.truck || null,
            MobileNumber:      gps.mobile || '',
            DeliveryDocument:  gps.deliveryDoc || topic.replace('gps-', ''),
            Latitude:          gps.lat,
            Longitude:         gps.lng,
            RecordedAt:        gps.recordedAt
        }).catch(err => console.error('Teams location timer failed:', err.message))
         .finally(() => { delete _timers[topic]; });
    }, 5 * 60 * 1000);
}

async function start(db) {
    _db = db;
    try {
        await consumer.connect();
        await consumer.subscribe({ topic: /^gps-/, fromBeginning: false });
        await consumer.run({ eachMessage: _handleMessage });
    } catch (err) {
        console.error('kafka_consumer: start failed, disconnecting:', err.message);
        await consumer.disconnect().catch(() => {});
        throw err;
    }
}

function clearTopicTimer(topicName) {
    if (_timers[topicName]) {
        clearTimeout(_timers[topicName]);
        delete _timers[topicName];
    }
}

module.exports = { start, clearTopicTimer };

function clearTopicTimer(topicName) {
    if (_timers[topicName]) {
        clearTimeout(_timers[topicName]);
        delete _timers[topicName];
    }
}

module.exports = { start, clearTopicTimer };
