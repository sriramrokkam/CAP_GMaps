const { Kafka } = require('kafkajs');
const cds = require('@sap/cds');

const kafka = new Kafka({
    clientId: 'cap-gps-consumer',
    brokers: [(process.env.KAFKA_BROKER || 'localhost:9092')]
});

const consumer = kafka.consumer({ groupId: 'cap-gps-group' });

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

function clearTopicTimer(topicName) {}

module.exports = { start, clearTopicTimer };
